BEGIN;

GRANT SELECT ON public.units, public.professionals TO prontomedic_worklist_rpc_owner;
GRANT INSERT ON public.imaging_orders, public.imaging_order_items
  TO prontomedic_worklist_rpc_owner;
GRANT USAGE ON SCHEMA auth TO prontomedic_worklist_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO prontomedic_worklist_rpc_owner;

DROP POLICY IF EXISTS units_attendance_rpc_select ON public.units;
CREATE POLICY units_attendance_rpc_select
  ON public.units FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    id = public.active_unit_id()
    AND company_id = public.active_company_id()
    AND lg_ativo IS TRUE
  );

DROP POLICY IF EXISTS professionals_attendance_rpc_select ON public.professionals;
CREATE POLICY professionals_attendance_rpc_select
  ON public.professionals FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND user_id = (SELECT auth.uid())
    AND lg_ativo IS TRUE
  );

DROP POLICY IF EXISTS imaging_orders_attendance_rpc_insert ON public.imaging_orders;
CREATE POLICY imaging_orders_attendance_rpc_insert
  ON public.imaging_orders FOR INSERT TO prontomedic_worklist_rpc_owner
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND created_by = (SELECT auth.uid())
    AND requesting_physician_id IN (
      SELECT professional.id
      FROM public.professionals professional
      WHERE professional.user_id = (SELECT auth.uid())
        AND professional.company_id = imaging_orders.company_id
        AND professional.lg_ativo IS TRUE
    )
  );

DROP POLICY IF EXISTS imaging_order_items_attendance_rpc_insert ON public.imaging_order_items;
CREATE POLICY imaging_order_items_attendance_rpc_insert
  ON public.imaging_order_items FOR INSERT TO prontomedic_worklist_rpc_owner
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND EXISTS (
      SELECT 1
      FROM public.imaging_orders imaging_order
      WHERE imaging_order.id = imaging_order_id
        AND imaging_order.company_id = imaging_order_items.company_id
        AND imaging_order.unit_id = imaging_order_items.unit_id
        AND imaging_order.requesting_physician_id IN (
          SELECT professional.id
          FROM public.professionals professional
          WHERE professional.user_id = (SELECT auth.uid())
            AND professional.company_id = imaging_order.company_id
            AND professional.lg_ativo IS TRUE
        )
    )
  );

CREATE OR REPLACE FUNCTION public.create_imaging_order_from_attendance(
  p_appointment_id BIGINT,
  p_exam_name TEXT,
  p_modality_type TEXT,
  p_clinical_indication TEXT DEFAULT NULL,
  p_priority TEXT DEFAULT 'normal',
  p_scheduled_datetime TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_user UUID := (SELECT auth.uid());
  v_appointment public.appointments;
  v_professional public.professionals;
  v_order public.imaging_orders;
  v_item public.imaging_order_items;
  v_accession TEXT;
BEGIN
  IF public.request_aal() <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required to create imaging order';
  END IF;
  IF NOT public.can_access('prontuario', 'create') THEN
    RAISE EXCEPTION 'Medical record create permission required';
  END IF;
  IF v_company IS NULL OR v_unit IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Active company, unit and user are required';
  END IF;
  IF trim(COALESCE(p_exam_name, '')) = '' THEN
    RAISE EXCEPTION 'Exam name is required';
  END IF;
  IF upper(COALESCE(p_modality_type, '')) NOT IN
    ('CR','CT','MR','US','DX','XA','MG','PT','NM','RF','OT') THEN
    RAISE EXCEPTION 'Invalid modality';
  END IF;
  IF p_priority NOT IN ('normal','urgent','emergency') THEN
    RAISE EXCEPTION 'Invalid priority';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('imaging-order:' || p_appointment_id::TEXT, 0));

  SELECT appointment.* INTO v_appointment
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company
    AND appointment.unit_id = v_unit
    AND appointment.status IN ('scheduled','confirmed','waiting','in_progress')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found in active scope';
  END IF;

  SELECT professional.* INTO v_professional
  FROM public.professionals professional
  WHERE professional.id = v_appointment.professional_id
    AND professional.user_id = v_user
    AND professional.company_id = v_company
    AND professional.lg_ativo IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment is not assigned to the active professional';
  END IF;

  SELECT imaging_order.* INTO v_order
  FROM public.imaging_orders imaging_order
  WHERE imaging_order.company_id = v_company
    AND imaging_order.unit_id = v_unit
    AND imaging_order.appointment_id = v_appointment.id
    AND imaging_order.patient_id = v_appointment.patient_id
    AND imaging_order.status <> 'cancelado'
  ORDER BY imaging_order.created_at
  LIMIT 1;

  IF FOUND THEN
    SELECT item.* INTO v_item
    FROM public.imaging_order_items item
    WHERE item.imaging_order_id = v_order.id
      AND item.company_id = v_company
      AND item.unit_id = v_unit
    ORDER BY item.created_at
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Existing imaging order has no item';
    END IF;
    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'item_id', v_item.id,
      'accession_number', v_order.accession_number,
      'reused', TRUE
    );
  END IF;

  v_accession := 'PM-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')
    || '-' || substr(gen_random_uuid()::TEXT, 1, 6);

  INSERT INTO public.imaging_orders(
    company_id, unit_id, patient_id, appointment_id, scheduling_id,
    requesting_physician_id, referring_physician_name, clinical_indication,
    priority, accession_number, status, created_by
  ) VALUES (
    v_company, v_unit, v_appointment.patient_id, v_appointment.id,
    v_appointment.id, v_professional.id, v_professional.full_name,
    p_clinical_indication, p_priority, v_accession, 'agendado', v_user
  ) RETURNING * INTO v_order;

  INSERT INTO public.imaging_order_items(
    company_id, unit_id, imaging_order_id, exam_name, modality_type,
    station_aetitle, scheduled_date, scheduled_time, scheduled_datetime,
    requested_procedure_id, scheduled_procedure_step_id, status
  ) VALUES (
    v_company, v_unit, v_order.id, trim(p_exam_name), upper(p_modality_type),
    'PRONTOMEDIC', p_scheduled_datetime::DATE, p_scheduled_datetime::TIME,
    p_scheduled_datetime, 'RP-' || v_order.id::TEXT,
    'SPS-' || gen_random_uuid()::TEXT, 'agendado'
  ) RETURNING * INTO v_item;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'item_id', v_item.id,
    'accession_number', v_accession,
    'reused', FALSE
  );
END;
$function$;

ALTER FUNCTION public.create_imaging_order_from_attendance(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) OWNER TO prontomedic_worklist_rpc_owner;
REVOKE ALL ON FUNCTION public.create_imaging_order_from_attendance(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.create_imaging_order_from_attendance(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO authenticated;

COMMENT ON FUNCTION public.create_imaging_order_from_attendance(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) IS 'Creates or reuses the scoped imaging order for an appointment; Worklist release remains owned by the reception workflow.';

COMMIT;

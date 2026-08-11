BEGIN;

DROP POLICY IF EXISTS m11_appointments_worklist_rpc_select
  ON public.appointments;
CREATE POLICY m11_appointments_worklist_rpc_select
  ON public.appointments
  FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS m11_appointments_worklist_rpc_update
  ON public.appointments;
CREATE POLICY m11_appointments_worklist_rpc_update
  ON public.appointments
  FOR UPDATE TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

GRANT SELECT, UPDATE ON public.appointments TO prontomedic_worklist_rpc_owner;

DROP POLICY IF EXISTS m11_patients_worklist_rpc_select
  ON public.patients;
CREATE POLICY m11_patients_worklist_rpc_select
  ON public.patients
  FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND public.active_unit_id() IS NOT NULL
    AND public.org_can_access_unit(company_id, public.active_unit_id())
  );

GRANT SELECT ON public.patients TO prontomedic_worklist_rpc_owner;

DROP POLICY IF EXISTS m11_workflow_worklist_rpc_select
  ON public.reception_checkin_workflows;
CREATE POLICY m11_workflow_worklist_rpc_select
  ON public.reception_checkin_workflows
  FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

GRANT SELECT ON public.reception_checkin_workflows
  TO prontomedic_worklist_rpc_owner;

DROP POLICY IF EXISTS m11_checkins_worklist_rpc_select
  ON public.reception_checkins;
CREATE POLICY m11_checkins_worklist_rpc_select
  ON public.reception_checkins
  FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS m11_tickets_worklist_rpc_select
  ON public.reception_queue_tickets;
CREATE POLICY m11_tickets_worklist_rpc_select
  ON public.reception_queue_tickets
  FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS m11_appointment_types_worklist_rpc_select
  ON public.appointment_types;
CREATE POLICY m11_appointment_types_worklist_rpc_select
  ON public.appointment_types
  FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    (company_id IS NULL OR company_id = public.active_company_id())
    AND public.active_unit_id() IS NOT NULL
    AND COALESCE(lg_ativo, TRUE)
  );

GRANT SELECT ON public.reception_checkins, public.reception_queue_tickets,
  public.appointment_types TO prontomedic_worklist_rpc_owner;

CREATE OR REPLACE FUNCTION public.ensure_reception_worklist_for_checkin_secure(
  p_workflow_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_workflow public.reception_checkin_workflows;
  v_appointment public.appointments;
  v_item_count INTEGER;
  v_requires_worklist BOOLEAN;
  v_has_imaging_order BOOLEAN;
BEGIN
  IF public.request_aal() <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required to release reception Worklist';
  END IF;
  IF NOT (
    public.can_access('recepcao', 'edit')
    OR public.can_access('dicom', 'create')
    OR public.can_access('worklist', 'create')
  ) THEN
    RAISE EXCEPTION 'Worklist release permission required';
  END IF;

  SELECT workflow.* INTO v_workflow
  FROM public.reception_checkin_workflows workflow
  WHERE workflow.id = p_workflow_id
    AND workflow.company_id = public.active_company_id()
    AND workflow.unit_id = public.active_unit_id()
    AND workflow.operation = 'reception_checkin'
    AND workflow.status IN ('in_progress', 'failed')
    AND workflow.current_step = 'checkin';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reception workflow is not ready for Worklist release';
  END IF;

  SELECT appointment.* INTO v_appointment
  FROM public.appointments appointment
  WHERE appointment.id = v_workflow.appointment_id
    AND appointment.company_id = v_workflow.company_id
    AND appointment.unit_id = v_workflow.unit_id
    AND appointment.patient_id = v_workflow.patient_id
    AND appointment.status IN ('scheduled', 'confirmed', 'waiting')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment is not active in reception scope';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.reception_checkins checkin_record
    JOIN public.reception_queue_tickets ticket
      ON ticket.checkin_id = checkin_record.id
     AND ticket.appointment_id = checkin_record.appointment_id
     AND ticket.company_id = checkin_record.company_id
     AND ticket.unit_id = checkin_record.unit_id
    WHERE checkin_record.appointment_id = v_workflow.appointment_id
      AND checkin_record.patient_id = v_workflow.patient_id
      AND checkin_record.company_id = v_workflow.company_id
      AND checkin_record.unit_id = v_workflow.unit_id
      AND checkin_record.status = 'checked_in'
  ) THEN
    RAISE EXCEPTION 'Reception check-in and queue ticket are required before Worklist release';
  END IF;

  SELECT lower(COALESCE(appointment_type.category, '')) = 'exame'
    INTO v_requires_worklist
  FROM public.appointment_types appointment_type
  WHERE appointment_type.id = v_appointment.appointment_type_id
   AND (
     appointment_type.company_id IS NULL
     OR appointment_type.company_id = v_appointment.company_id
   )
  ;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment type not found in active reception scope';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.imaging_orders imaging_order
    WHERE imaging_order.company_id = v_workflow.company_id
      AND imaging_order.unit_id = v_workflow.unit_id
      AND imaging_order.appointment_id = v_workflow.appointment_id
      AND imaging_order.patient_id = v_workflow.patient_id
      AND imaging_order.status <> 'cancelado'
  ) INTO v_has_imaging_order;

  IF v_requires_worklist AND NOT v_has_imaging_order THEN
    RAISE EXCEPTION 'Imaging order is required for exam appointment';
  END IF;

  IF NOT v_has_imaging_order THEN
    RETURN jsonb_build_object(
      'required', FALSE,
      'released', FALSE,
      'item_count', 0
    );
  END IF;

  SELECT count(*)::INTEGER INTO v_item_count
  FROM public.release_appointment_to_worklist_secure(
    v_workflow.appointment_id,
    v_workflow.idempotency_key
  );

  IF v_item_count < 1 THEN
    RAISE EXCEPTION 'No eligible imaging item was released';
  END IF;

  RETURN jsonb_build_object(
    'required', TRUE,
    'released', TRUE,
    'item_count', v_item_count
  );
END;
$function$;

ALTER FUNCTION public.ensure_reception_worklist_for_checkin_secure(UUID)
  OWNER TO prontomedic_worklist_rpc_owner;
REVOKE ALL ON FUNCTION public.ensure_reception_worklist_for_checkin_secure(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_reception_worklist_for_checkin_secure(UUID)
  TO authenticated, app_prontomedic;

COMMENT ON FUNCTION public.ensure_reception_worklist_for_checkin_secure(UUID)
  IS 'Idempotently releases DICOM Worklist items for the appointment coordinated by a reception check-in workflow; no imaging order is a successful no-op.';

COMMIT;

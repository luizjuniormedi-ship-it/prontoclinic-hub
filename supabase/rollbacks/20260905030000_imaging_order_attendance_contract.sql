BEGIN;

CREATE OR REPLACE FUNCTION public.create_imaging_order_from_attendance(
  p_appointment_id BIGINT, p_exam_name TEXT, p_modality_type TEXT,
  p_clinical_indication TEXT DEFAULT NULL, p_priority TEXT DEFAULT 'normal',
  p_scheduled_datetime TIMESTAMPTZ DEFAULT NOW()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_prof public.professionals%ROWTYPE;
  v_patient public.patients%ROWTYPE;
  v_order public.imaging_orders%ROWTYPE;
  v_item public.imaging_order_items%ROWTYPE;
  v_accession TEXT;
  v_unit_id INTEGER;
  v_node_id UUID;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF trim(coalesce(p_exam_name,'')) = '' THEN RAISE EXCEPTION 'exam name is required'; END IF;
  IF upper(p_modality_type) NOT IN ('CR','CT','MR','US','DX','XA','MG','PT','NM','RF','OT') THEN RAISE EXCEPTION 'invalid modality'; END IF;
  IF p_priority NOT IN ('normal','urgent','emergency') THEN RAISE EXCEPTION 'invalid priority'; END IF;

  SELECT * INTO v_prof FROM public.professionals WHERE user_id = (SELECT auth.uid()) AND lg_ativo = TRUE ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'usuário sem profissional ativo vinculado'; END IF;
  SELECT * INTO STRICT v_appointment FROM public.appointments
    WHERE id = p_appointment_id AND company_id = v_prof.company_id AND professional_id = v_prof.id FOR UPDATE;
  SELECT * INTO STRICT v_patient FROM public.patients WHERE id = v_appointment.patient_id AND company_id = v_prof.company_id;
  v_unit_id := COALESCE((to_jsonb(v_appointment)->>'unit_id')::INTEGER, (SELECT primary_unit_id FROM public.user_profiles WHERE id = (SELECT auth.uid())));
  v_accession := 'PM-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS') || '-' || substr(gen_random_uuid()::text,1,6);

  INSERT INTO public.imaging_orders(company_id, unit_id, patient_id, scheduling_id, requesting_physician_id,
    referring_physician_name, clinical_indication, priority, accession_number, status, created_by)
  VALUES(v_prof.company_id, v_unit_id, v_patient.id, v_appointment.id, v_prof.id, v_prof.full_name,
    p_clinical_indication, p_priority, v_accession, 'liberado_worklist', (SELECT auth.uid())) RETURNING * INTO v_order;

  INSERT INTO public.imaging_order_items(imaging_order_id, exam_name, modality_type, scheduled_date, scheduled_time,
    scheduled_datetime, requested_procedure_id, scheduled_procedure_step_id, status)
  VALUES(v_order.id, trim(p_exam_name), upper(p_modality_type), p_scheduled_datetime::date, p_scheduled_datetime::time,
    p_scheduled_datetime, 'RP-'||v_order.id, 'SPS-'||gen_random_uuid(), 'liberado_worklist') RETURNING * INTO v_item;

  SELECT id INTO v_node_id FROM public.dicom_nodes
    WHERE company_id = v_prof.company_id AND node_kind = 'worklist' AND is_active
      AND (unit_id = v_unit_id OR unit_id IS NULL)
    ORDER BY (unit_id = v_unit_id) DESC, is_default DESC, priority, id LIMIT 1;

  INSERT INTO public.dicom_worklist_queue(company_id, unit_id, destination_node_id, imaging_order_item_id,
    patient_id, patient_name, patient_birth_date, patient_sex, patient_identifier, accession_number,
    requested_procedure_description, requested_procedure_id, scheduled_procedure_step_id, modality_type,
    scheduled_datetime, referring_physician_name, status, exported_to_worklist)
  VALUES(v_prof.company_id, v_unit_id, v_node_id, v_item.id::text, v_patient.id::text, v_patient.full_name,
    v_patient.birth_date, v_patient.sex, v_patient.id::text, v_accession, v_item.exam_name,
    v_item.requested_procedure_id, v_item.scheduled_procedure_step_id, v_item.modality_type,
    p_scheduled_datetime, v_prof.full_name, 'pending', FALSE);

  RETURN jsonb_build_object('order_id',v_order.id,'item_id',v_item.id,'accession_number',v_accession);
END $$;

REVOKE EXECUTE ON FUNCTION public.create_imaging_order_from_attendance(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM authenticated;
ALTER FUNCTION public.create_imaging_order_from_attendance(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) SECURITY INVOKER;
ALTER FUNCTION public.create_imaging_order_from_attendance(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) OWNER TO postgres;

DROP POLICY IF EXISTS imaging_order_items_attendance_rpc_insert ON public.imaging_order_items;
DROP POLICY IF EXISTS imaging_orders_attendance_rpc_insert ON public.imaging_orders;
DROP POLICY IF EXISTS professionals_attendance_rpc_select ON public.professionals;
DROP POLICY IF EXISTS units_attendance_rpc_select ON public.units;
REVOKE INSERT ON public.imaging_orders, public.imaging_order_items
  FROM prontomedic_worklist_rpc_owner;
REVOKE SELECT ON public.units, public.professionals FROM prontomedic_worklist_rpc_owner;
REVOKE EXECUTE ON FUNCTION auth.uid() FROM prontomedic_worklist_rpc_owner;
REVOKE USAGE ON SCHEMA auth FROM prontomedic_worklist_rpc_owner;

GRANT EXECUTE ON FUNCTION public.create_imaging_order_from_attendance(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO authenticated, app_prontomedic;

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260905030000';

COMMIT;

BEGIN;

-- preserve_schema: retain data and additive integrity constraints, but restore
-- the predecessor runtime contracts and disable the new trigger surfaces.
DROP TRIGGER IF EXISTS trg_m11_assign_billing_authorization
  ON public.billing_accounts;
DROP TRIGGER IF EXISTS trg_m39_advance_reviewed_billing_account
  ON public.billing_accounts;

REVOKE ALL ON FUNCTION private.m11_assign_billing_authorization()
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m39_advance_reviewed_billing_account()
  FROM PUBLIC, anon, authenticated, app_prontomedic;

DROP POLICY IF EXISTS m11_billing_authz_trigger_select
  ON public.insurance_authorizations;
DROP POLICY IF EXISTS m11_billing_appointment_trigger_select
  ON public.appointments;
REVOKE ALL PRIVILEGES ON public.insurance_authorizations, public.appointments
  FROM prontomedic_billing_authz_trigger_owner;
REVOKE EXECUTE ON FUNCTION public.active_company_id(), public.active_unit_id()
  FROM prontomedic_billing_authz_trigger_owner;
REVOKE USAGE ON SCHEMA public, private
  FROM prontomedic_billing_authz_trigger_owner;

-- Restore only workflows captured by this migration and only while they still
-- carry its marker. The snapshot remains as immutable operational evidence.
UPDATE public.reception_checkin_workflows workflow
   SET requires_tiss = snapshot.requires_tiss,
       current_step = snapshot.current_step,
       request_payload = snapshot.request_payload,
       result_payload = snapshot.result_payload,
       version = snapshot.version,
       updated_at = snapshot.updated_at
  FROM private.m11_legacy_tiss_workflow_snapshot snapshot
 WHERE workflow.id = snapshot.workflow_id
   AND COALESCE(workflow.result_payload, '{}'::JSONB)
         @> '{"legacy_tiss_handoff_migrated": true}'::JSONB;

CREATE OR REPLACE FUNCTION public.start_reception_checkin_workflow_secure(
  p_appointment_id BIGINT,
  p_idempotency_key TEXT,
  p_request_payload JSONB DEFAULT '{}'::JSONB
)
RETURNS public.reception_checkin_workflows
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
  SELECT private.m11_start_workflow(
    p_appointment_id,
    p_idempotency_key,
    p_request_payload
  )
$function$;

ALTER FUNCTION public.start_reception_checkin_workflow_secure(BIGINT, TEXT, JSONB)
  OWNER TO prontomedic_reception_rpc_owner;
REVOKE ALL ON FUNCTION public.start_reception_checkin_workflow_secure(BIGINT, TEXT, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_reception_checkin_workflow_secure(BIGINT, TEXT, JSONB)
  TO authenticated, app_prontomedic;

-- Never restore the revoked Reception -> TISS materialization privilege.
REVOKE EXECUTE ON FUNCTION public.ensure_tiss_guide_for_checkin_secure(UUID, TEXT, TEXT)
  FROM authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.m39_billing_readiness(
  p_account public.billing_accounts
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  WITH issues AS (
    SELECT issue
    FROM (
      VALUES
        (CASE WHEN p_account.unit_id IS NULL THEN jsonb_build_object('code', 'unit_missing', 'severity', 'blocking') END),
        (CASE WHEN p_account.patient_id IS NULL THEN jsonb_build_object('code', 'patient_missing', 'severity', 'blocking') END),
        (CASE WHEN p_account.competence_month IS NULL THEN jsonb_build_object('code', 'competence_missing', 'severity', 'blocking') END),
        (CASE WHEN p_account.total_net_amount <= 0 THEN jsonb_build_object('code', 'net_amount_invalid', 'severity', 'blocking') END),
        (CASE WHEN p_account.total_paid_amount > p_account.total_net_amount THEN jsonb_build_object('code', 'paid_amount_exceeds_net', 'severity', 'blocking') END),
        (CASE WHEN p_account.total_pending_amount IS DISTINCT FROM GREATEST(p_account.total_net_amount - p_account.total_paid_amount, 0) THEN jsonb_build_object('code', 'pending_amount_mismatch', 'severity', 'blocking') END),
        (CASE WHEN p_account.billing_type = 'convenio' AND p_account.insurance_id IS NULL THEN jsonb_build_object('code', 'insurance_missing', 'severity', 'blocking') END),
        (CASE WHEN p_account.billing_type = 'convenio' AND NULLIF(trim(COALESCE(p_account.guide_number, '')), '') IS NULL THEN jsonb_build_object('code', 'guide_number_missing', 'severity', 'blocking') END),
        (CASE WHEN p_account.billing_type = 'convenio' AND NULLIF(trim(COALESCE(p_account.authorization_number, '')), '') IS NULL THEN jsonb_build_object('code', 'authorization_missing', 'severity', 'blocking') END),
        (CASE WHEN p_account.has_denial THEN jsonb_build_object('code', 'denial_open', 'severity', 'blocking') END),
        (CASE WHEN p_account.deleted_at IS NOT NULL THEN jsonb_build_object('code', 'account_deleted', 'severity', 'blocking') END)
    ) readiness(issue)
    WHERE issue IS NOT NULL
  )
  SELECT jsonb_build_object(
    'account_id', p_account.id,
    'version', p_account.version,
    'status', p_account.status,
    'issues', COALESCE(jsonb_agg(issue), '[]'::JSONB),
    'blocking_count', COUNT(*)::INTEGER,
    'can_close', COUNT(*) = 0
  )
  FROM issues
$function$;

REVOKE ALL ON FUNCTION public.m39_billing_readiness(public.billing_accounts)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m39_billing_readiness(public.billing_accounts)
  TO prontomedic_financial_rpc_owner;

CREATE OR REPLACE FUNCTION public.release_appointment_to_worklist_secure(
  p_appointment_id BIGINT,
  p_idempotency_key TEXT
)
RETURNS SETOF public.dicom_worklist_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_appointment public.appointments;
  v_order public.imaging_orders;
  v_patient public.patients;
  v_item public.imaging_order_items;
BEGIN
  IF public.request_aal() <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required to release DICOM worklist';
  END IF;
  IF v_company IS NULL OR v_unit IS NULL THEN
    RAISE EXCEPTION 'Active company and unit are required to release DICOM worklist';
  END IF;
  IF NOT (
    public.can_access('recepcao', 'edit')
    OR public.can_access('dicom', 'create')
    OR public.can_access('worklist', 'create')
  ) THEN
    RAISE EXCEPTION 'Worklist release permission required';
  END IF;
  IF p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,120}$' THEN
    RAISE EXCEPTION 'Invalid worklist idempotency key';
  END IF;
  SELECT * INTO v_appointment
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company
    AND appointment.unit_id = v_unit
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found in active scope';
  END IF;

  SELECT * INTO v_order
  FROM public.imaging_orders imaging_order
  WHERE imaging_order.company_id = v_company
    AND imaging_order.unit_id = v_appointment.unit_id
    AND imaging_order.appointment_id = v_appointment.id
    AND imaging_order.patient_id = v_appointment.patient_id
    AND imaging_order.status <> 'cancelado'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Imaging order not found for appointment';
  END IF;

  SELECT * INTO v_patient
  FROM public.patients patient
  WHERE patient.id = v_appointment.patient_id
    AND patient.company_id = v_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Patient not found in active company';
  END IF;

  IF COALESCE(trim(v_patient.full_name), '') = ''
     OR COALESCE(trim(COALESCE(v_patient.cpf, v_patient.nr_cpf, v_patient.cd_cpf)), '') = '' THEN
    RAISE EXCEPTION 'Patient identity is incomplete for DICOM worklist';
  END IF;

  FOR v_item IN
    SELECT *
    FROM public.imaging_order_items item
    WHERE item.company_id = v_company
      AND item.unit_id = v_order.unit_id
      AND item.imaging_order_id = v_order.id
      AND item.status = 'agendado'
    ORDER BY item.created_at
    FOR UPDATE
  LOOP
    IF v_item.station_aetitle !~ '^[A-Z0-9 _-]{1,16}$'
       OR v_item.modality_type !~ '^[A-Z0-9]{1,16}$'
       OR COALESCE(trim(v_item.requested_procedure_id), '') = ''
       OR COALESCE(trim(v_item.scheduled_procedure_step_id), '') = ''
       OR v_item.scheduled_datetime IS NULL THEN
      RAISE EXCEPTION 'Imaging item % has incomplete DICOM identifiers', v_item.id;
    END IF;

    INSERT INTO public.dicom_worklist_queue(
      company_id, unit_id, appointment_id, imaging_order_item_id,
      idempotency_key, patient_id, patient_name, patient_birth_date,
      patient_sex, patient_identifier, accession_number,
      requested_procedure_description, requested_procedure_id,
      scheduled_procedure_step_id, modality_type,
      scheduled_station_aetitle, scheduled_datetime,
      referring_physician_name
    ) VALUES (
      v_company, v_order.unit_id, v_appointment.id, v_item.id,
      p_idempotency_key, v_patient.id, v_patient.full_name,
      COALESCE(v_patient.birth_date, v_patient.dt_nascimento),
      COALESCE(v_patient.sex, v_patient.cd_sexo),
      COALESCE(v_patient.cpf, v_patient.nr_cpf, v_patient.cd_cpf),
      v_order.accession_number, v_item.exam_name,
      v_item.requested_procedure_id, v_item.scheduled_procedure_step_id,
      v_item.modality_type, v_item.station_aetitle,
      v_item.scheduled_datetime, v_order.referring_physician_name
    )
    ON CONFLICT (company_id, imaging_order_item_id) DO UPDATE
      SET updated_at = NOW()
      WHERE public.dicom_worklist_queue.idempotency_key = EXCLUDED.idempotency_key;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Worklist item already exists with another idempotency key';
    END IF;

    UPDATE public.imaging_order_items
    SET status = 'liberado_worklist', updated_at = NOW()
    WHERE id = v_item.id;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.dicom_worklist_queue queue
    WHERE queue.company_id = v_company
      AND queue.appointment_id = v_appointment.id
      AND queue.idempotency_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION 'No eligible imaging item was released';
  END IF;

  UPDATE public.imaging_orders
  SET status = 'liberado_worklist', updated_at = NOW()
  WHERE id = v_order.id;

  RETURN QUERY
  SELECT queue.*
  FROM public.dicom_worklist_queue queue
  WHERE queue.company_id = v_company
    AND queue.appointment_id = v_appointment.id
    AND queue.idempotency_key = p_idempotency_key
  ORDER BY queue.scheduled_datetime, queue.id;
END;
$function$;

ALTER FUNCTION public.release_appointment_to_worklist_secure(BIGINT, TEXT)
  OWNER TO prontomedic_worklist_rpc_owner;
REVOKE ALL ON FUNCTION public.release_appointment_to_worklist_secure(BIGINT, TEXT)
  FROM PUBLIC, anon, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.release_appointment_to_worklist_secure(BIGINT, TEXT)
  TO authenticated;

COMMIT;

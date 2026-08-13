\set ON_ERROR_STOP on

DO $smoke$
DECLARE
  v_start text := pg_get_functiondef(
    'public.start_reception_checkin_workflow_secure(bigint,text,jsonb)'::regprocedure
  );
  v_readiness text := pg_get_functiondef(
    'public.m39_billing_readiness(public.billing_accounts)'::regprocedure
  );
  v_worklist text := pg_get_functiondef(
    'public.release_appointment_to_worklist_secure(bigint,text)'::regprocedure
  );
BEGIN
  IF has_function_privilege(
       'authenticated',
       'public.ensure_tiss_guide_for_checkin_secure(uuid,text,text)',
       'EXECUTE'
     ) OR has_function_privilege(
       'app_prontomedic',
       'public.ensure_tiss_guide_for_checkin_secure(uuid,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Recepcao ainda pode materializar guia TISS';
  END IF;
  IF v_start !~* 'requires_tiss[^;]*false'
     OR v_start !~ '''tiss''' THEN
    RAISE EXCEPTION 'workflow de Recepcao nao remove TISS do check-in';
  END IF;
  IF v_readiness ~ 'guide_number_missing' THEN
    RAISE EXCEPTION 'readiness conserva dependencia circular da guia';
  END IF;
  IF v_worklist !~* 'item.status[[:space:]]+IN[[:space:]]*[(]'
     OR v_worklist !~ 'liberado_worklist'
     OR v_worklist !~ 'another idempotency key' THEN
    RAISE EXCEPTION 'retomada idempotente da Worklist ausente';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.billing_accounts'::regclass
         AND tgname = 'trg_m11_assign_billing_authorization'
         AND NOT tgisinternal
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.billing_accounts'::regclass
         AND tgname = 'trg_m39_advance_reviewed_billing_account'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'triggers canonicos de faturamento ausentes';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.dicom_worklist_queue'::regclass
      AND attname IN (
        'unit_id', 'appointment_id', 'imaging_order_item_id', 'idempotency_key',
        'patient_id', 'patient_identifier', 'requested_procedure_id',
        'scheduled_procedure_step_id', 'scheduled_station_aetitle', 'scheduled_datetime'
      )
      AND NOT attnotnull
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'hardening NOT NULL da Worklist incompleto';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.dicom_worklist_queue'::regclass
         AND conname = 'dicom_worklist_queue_imaging_order_item_id_fkey'
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.dicom_worklist_queue'::regclass
         AND conname = 'dicom_worklist_queue_patient_id_fkey'
     ) OR to_regclass('public.dicom_worklist_queue_company_item_uq') IS NULL THEN
    RAISE EXCEPTION 'constraints canonicas da Worklist ausentes';
  END IF;
END;
$smoke$;

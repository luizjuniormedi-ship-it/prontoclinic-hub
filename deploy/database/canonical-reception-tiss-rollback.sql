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
  IF NOT has_function_privilege(
       'authenticated',
       'public.ensure_tiss_guide_for_checkin_secure(uuid,text,text)',
       'EXECUTE'
     ) OR NOT has_function_privilege(
       'app_prontomedic',
       'public.ensure_tiss_guide_for_checkin_secure(uuid,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'rollback nao restaurou contrato TISS predecessor da Recepcao';
  END IF;
  IF v_start ~ 'requires_tiss.*false' OR v_readiness !~ 'guide_number_missing' THEN
    RAISE EXCEPTION 'rollback nao restaurou contratos predecessores';
  END IF;
  IF v_worklist !~* 'item.status[[:space:]]*=[[:space:]]*''agendado'''
     OR v_worklist ~* 'item.status[[:space:]]+IN[[:space:]]*[(]' THEN
    RAISE EXCEPTION 'rollback nao restaurou contrato predecessor da Worklist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.billing_accounts'::regclass
      AND tgname IN (
        'trg_m11_assign_billing_authorization',
        'trg_m39_advance_reviewed_billing_account'
      ) AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'rollback manteve triggers operacionais alterados';
  END IF;
  IF has_function_privilege(
       'authenticated', 'private.m11_assign_billing_authorization()', 'EXECUTE'
     ) OR has_function_privilege(
       'app_prontomedic', 'private.m39_advance_reviewed_billing_account()', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'rollback expos funcoes privadas preservadas';
  END IF;
  IF to_regclass('public.dicom_worklist_queue_company_item_uq') IS NULL THEN
    RAISE EXCEPTION 'rollback removeu indice de integridade preservado';
  END IF;
END;
$smoke$;

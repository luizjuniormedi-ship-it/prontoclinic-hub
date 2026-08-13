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
    RAISE EXCEPTION 'rollback reabriu contrato TISS inseguro da Recepcao';
  END IF;
  IF v_start ~ 'requires_tiss.*false' OR v_readiness !~ 'guide_number_missing' THEN
    RAISE EXCEPTION 'rollback nao restaurou contratos predecessores';
  END IF;
  IF v_worklist !~* 'item.status[[:space:]]*=[[:space:]]*''agendado'''
     OR v_worklist ~* 'item.status[[:space:]]+IN[[:space:]]*[(]'
     OR v_worklist !~ 'Active company and unit are required' THEN
    RAISE EXCEPTION 'rollback nao restaurou contrato predecessor da Worklist';
  END IF;
  IF to_regclass('private.m11_legacy_tiss_workflow_snapshot') IS NULL THEN
    RAISE EXCEPTION 'rollback removeu evidencia dos workflows legados';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM private.m11_legacy_tiss_workflow_snapshot snapshot
      JOIN public.reception_checkin_workflows workflow
        ON workflow.id = snapshot.workflow_id
     WHERE workflow.requires_tiss IS DISTINCT FROM snapshot.requires_tiss
        OR workflow.current_step IS DISTINCT FROM snapshot.current_step
        OR workflow.request_payload IS DISTINCT FROM snapshot.request_payload
        OR workflow.result_payload IS DISTINCT FROM snapshot.result_payload
        OR workflow.version IS DISTINCT FROM snapshot.version
        OR workflow.updated_at IS DISTINCT FROM snapshot.updated_at
  ) THEN
    RAISE EXCEPTION 'rollback nao restaurou o estado exato dos workflows legados';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname IN (
         'm11_billing_authz_trigger_select',
         'm11_billing_appointment_trigger_select'
       )
  ) THEN
    RAISE EXCEPTION 'rollback manteve policies operacionais do trigger';
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

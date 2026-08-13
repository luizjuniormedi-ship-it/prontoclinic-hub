\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF to_regprocedure('public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)') IS NULL
     OR to_regprocedure('public.start_reception_checkin_workflow_secure(bigint,text,jsonb)') IS NULL
     OR to_regprocedure('public.release_appointment_to_worklist_secure(bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'baseline canonica de Recepcao/TISS ausente';
  END IF;
  IF NOT has_function_privilege(
       'authenticated',
       'public.ensure_tiss_guide_for_checkin_secure(uuid,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'grant predecessor da guia TISS da Recepcao ausente';
  END IF;
  IF to_regprocedure('private.m11_assign_billing_authorization()') IS NOT NULL
     OR to_regprocedure('private.m39_advance_reviewed_billing_account()') IS NOT NULL THEN
    RAISE EXCEPTION 'superficie 20260813001000 ja existe antes da migration';
  END IF;
END;
$smoke$;

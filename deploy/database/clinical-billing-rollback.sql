DO $$
BEGIN
  IF pg_get_functiondef('public.m17_company_id()'::regprocedure) ~ 'request\.jwt\.claim\.company_id' THEN
    RAISE EXCEPTION 'rollback reintroduziu autoridade legada de tenant';
  END IF;
  IF to_regprocedure('public.m18_finalize_appointment_with_billing_secure(bigint,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'rollback removeu schema clínico-financeiro preservado';
  END IF;
  IF has_function_privilege('authenticated', 'public.m18_finalize_appointment_with_billing_secure(bigint,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('app_prontomedic', 'public.m18_finalize_appointment_with_billing_secure(bigint,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rollback não revogou o handoff clínico-financeiro';
  END IF;
END;
$$;

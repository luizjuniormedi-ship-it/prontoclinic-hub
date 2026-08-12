DO $$
BEGIN
  IF to_regprocedure('public.m18_finalize_appointment_with_billing_secure(bigint,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'handoff clínico-financeiro ausente após migration';
  END IF;
  IF has_function_privilege('anon', 'public.m18_finalize_appointment_with_billing_secure(bigint,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon recebeu execução do handoff clínico-financeiro';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.m18_finalize_appointment_with_billing_secure(bigint,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sem execução do handoff clínico-financeiro';
  END IF;
END;
$$;

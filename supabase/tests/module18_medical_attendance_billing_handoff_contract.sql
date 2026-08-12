DO $$
BEGIN
  IF to_regprocedure('public.m18_finalize_appointment_with_billing_secure(bigint,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'handoff clínico-financeiro M18 ausente';
  END IF;
  IF has_function_privilege('anon', 'public.m18_finalize_appointment_with_billing_secure(bigint,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon não pode finalizar atendimento e conta';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.m18_finalize_appointment_with_billing_secure(bigint,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sem acesso ao handoff M18';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.m18_finalize_appointment_with_billing_secure(bigint,jsonb,text)'::regprocedure) THEN
    RAISE EXCEPTION 'orquestrador M18 deve preservar o contexto RLS do invocador';
  END IF;
  IF has_table_privilege('authenticated', 'public.medical_records', 'INSERT')
     OR has_table_privilege('authenticated', 'public.medical_records', 'UPDATE') THEN
    RAISE EXCEPTION 'cliente não pode gravar medical_records diretamente';
  END IF;
END;
$$;

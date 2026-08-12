DO $$
BEGIN
  IF to_regprocedure('public.m18_complete_attendance_secure(uuid,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'rollback removeu schema clínico preservado';
  END IF;
  IF has_function_privilege('authenticated', 'public.m18_complete_attendance_secure(uuid,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('app_prontomedic', 'public.m18_complete_attendance_secure(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rollback não revogou execução clínica';
  END IF;
END;
$$;

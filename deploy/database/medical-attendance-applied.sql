DO $$
BEGIN
  IF to_regprocedure('public.m18_complete_attendance_secure(uuid,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'm18_complete_attendance_secure ausente após migration';
  END IF;
  IF has_function_privilege('anon', 'public.m18_complete_attendance_secure(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon recebeu execução clínica';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.m18_complete_attendance_secure(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sem execução clínica';
  END IF;
END;
$$;

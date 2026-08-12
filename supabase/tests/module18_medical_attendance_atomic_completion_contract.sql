DO $$
BEGIN
  IF to_regprocedure('public.m18_complete_attendance_secure(uuid,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'm18_complete_attendance_secure ausente';
  END IF;

  IF has_function_privilege('anon', 'public.m18_complete_attendance_secure(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon não pode executar m18_complete_attendance_secure';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.m18_complete_attendance_secure(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated deve executar m18_complete_attendance_secure';
  END IF;

  IF has_table_privilege('authenticated', 'public.encounters', 'INSERT')
     OR has_table_privilege('authenticated', 'public.encounters', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.encounters', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated não pode gravar encounters diretamente';
  END IF;
END;
$$;

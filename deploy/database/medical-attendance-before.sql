DO $$
BEGIN
  IF to_regprocedure('public.m18_save_attendance_secure(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.m18_finalize_attendance_secure(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'contrato base M18 ausente';
  END IF;
  IF to_regprocedure('public.m18_complete_attendance_secure(uuid,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'm18_complete_attendance_secure já existe antes da migration';
  END IF;
END;
$$;

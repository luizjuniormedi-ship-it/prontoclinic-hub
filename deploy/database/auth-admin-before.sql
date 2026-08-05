DO $$
BEGIN
  IF to_regprocedure('public.prepare_user_access_active(uuid,uuid,boolean)') IS NULL
     OR to_regprocedure('public.prepare_user_access_active(uuid,uuid,uuid,boolean)') IS NOT NULL
     OR to_regprocedure('public.admin_record_auth_operation(uuid,uuid,uuid,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Contrato Auth Admin anterior inesperado';
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.prepare_user_access_active(uuid,uuid,boolean)') IS NULL
     OR to_regprocedure('public.prepare_user_access_active(uuid,uuid,uuid,boolean)') IS NOT NULL
     OR to_regprocedure('public.admin_record_auth_operation(uuid,uuid,uuid,text,text,text)') IS NOT NULL
     OR NOT has_function_privilege('service_role', 'public.set_user_access_active(uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback Auth Admin não restaurou o contrato anterior';
  END IF;
END;
$$;

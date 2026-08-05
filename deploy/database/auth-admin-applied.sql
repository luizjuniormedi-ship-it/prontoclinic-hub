DO $$
BEGIN
  IF to_regprocedure('public.prepare_user_access_active(uuid,uuid,boolean)') IS NOT NULL
     OR to_regprocedure('public.prepare_user_access_active(uuid,uuid,uuid,boolean)') IS NULL
     OR to_regprocedure('public.admin_record_auth_operation(uuid,uuid,uuid,text,text,text)') IS NULL
     OR has_function_privilege('service_role', 'public.set_user_access_active(uuid,uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.prepare_user_access_active(uuid,uuid,uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_record_auth_operation(uuid,uuid,uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Contrato Auth Admin aplicado incompleto';
  END IF;
END;
$$;

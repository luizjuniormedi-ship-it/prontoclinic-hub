\set ON_ERROR_STOP on

DO $smoke$
DECLARE
  v_definition TEXT;
  v_owner TEXT;
  v_security_definer BOOLEAN;
  v_public_execute BOOLEAN;
BEGIN
  IF to_regprocedure(
    'public.create_imaging_order_from_attendance(bigint,text,text,text,text,timestamptz)'
  ) IS NULL THEN
    RAISE EXCEPTION 'RPC predecessor de pedido de imagem ausente';
  END IF;

  SELECT pg_get_functiondef(procedure.oid),
         pg_get_userbyid(procedure.proowner),
         procedure.prosecdef,
         EXISTS (
           SELECT 1
             FROM aclexplode(COALESCE(
               procedure.proacl,
               acldefault('f', procedure.proowner)
             )) privilege
            WHERE privilege.grantee = 0
              AND privilege.privilege_type = 'EXECUTE'
         )
    INTO v_definition, v_owner, v_security_definer, v_public_execute
    FROM pg_proc procedure
   WHERE procedure.oid =
     'public.create_imaging_order_from_attendance(bigint,text,text,text,text,timestamptz)'::regprocedure;

  IF v_owner <> 'postgres' OR v_security_definer THEN
    RAISE EXCEPTION 'RPC predecessor nao esta no owner/modo legado esperado';
  END IF;
  IF v_public_execute
     OR NOT has_function_privilege(
       'authenticated',
       'public.create_imaging_order_from_attendance(bigint,text,text,text,text,timestamptz)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'app_prontomedic',
       'public.create_imaging_order_from_attendance(bigint,text,text,text,text,timestamptz)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.create_imaging_order_from_attendance(bigint,text,text,text,text,timestamptz)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'ACL predecessor da RPC de imagem diverge do contrato';
  END IF;
  IF v_definition NOT ILIKE '%INSERT INTO public.dicom_worklist_queue%'
     OR v_definition NOT ILIKE '%liberado_worklist%'
     OR v_definition ILIKE '%request_aal()%'
     OR v_definition ILIKE '%pg_advisory_xact_lock%'
     OR v_definition ILIKE '%appointment_id, scheduling_id%'
  THEN
    RAISE EXCEPTION 'Implementacao predecessor da RPC de imagem diverge do baseline';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname IN (
         'units_attendance_rpc_select',
         'professionals_attendance_rpc_select',
         'imaging_orders_attendance_rpc_insert',
         'imaging_order_items_attendance_rpc_insert'
       )
  ) THEN
    RAISE EXCEPTION 'Policies da migration ja existem no estado predecessor';
  END IF;
  IF has_table_privilege('prontomedic_worklist_rpc_owner', 'public.units', 'SELECT')
     OR has_table_privilege('prontomedic_worklist_rpc_owner', 'public.professionals', 'SELECT')
     OR has_table_privilege('prontomedic_worklist_rpc_owner', 'public.imaging_orders', 'INSERT')
     OR has_table_privilege('prontomedic_worklist_rpc_owner', 'public.imaging_order_items', 'INSERT')
     OR EXISTS (
       SELECT 1
         FROM pg_proc procedure,
              LATERAL aclexplode(procedure.proacl) privilege
        WHERE procedure.oid = 'auth.uid()'::regprocedure
          AND privilege.grantee =
            (SELECT oid FROM pg_roles WHERE rolname = 'prontomedic_worklist_rpc_owner')
          AND privilege.privilege_type = 'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'Owner da RPC ja possui privilegios introduzidos pela migration';
  END IF;
END;
$smoke$;

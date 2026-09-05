\set ON_ERROR_STOP on

DO $smoke$
DECLARE
  v_definition TEXT;
  v_owner TEXT;
  v_security_definer BOOLEAN;
  v_config TEXT[];
  v_public_execute BOOLEAN;
BEGIN
  SELECT pg_get_functiondef(procedure.oid),
         pg_get_userbyid(procedure.proowner),
         procedure.prosecdef,
         procedure.proconfig,
         EXISTS (
           SELECT 1
             FROM aclexplode(COALESCE(
               procedure.proacl,
               acldefault('f', procedure.proowner)
             )) privilege
            WHERE privilege.grantee = 0
              AND privilege.privilege_type = 'EXECUTE'
         )
    INTO v_definition, v_owner, v_security_definer, v_config, v_public_execute
    FROM pg_proc procedure
   WHERE procedure.oid =
     'public.create_imaging_order_from_attendance(bigint,text,text,text,text,timestamptz)'::regprocedure;

  IF v_owner <> 'prontomedic_worklist_rpc_owner'
     OR NOT v_security_definer
     OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::TEXT[] THEN
    RAISE EXCEPTION 'RPC aplicada sem owner, SECURITY DEFINER ou search_path endurecido';
  END IF;
  IF v_public_execute
     OR NOT has_function_privilege(
       'authenticated',
       'public.create_imaging_order_from_attendance(bigint,text,text,text,text,timestamptz)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.create_imaging_order_from_attendance(bigint,text,text,text,text,timestamptz)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'app_prontomedic',
       'public.create_imaging_order_from_attendance(bigint,text,text,text,text,timestamptz)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'ACL aplicada da RPC de imagem diverge do contrato minimo';
  END IF;

  IF v_definition NOT ILIKE '%request_aal() <> ''aal2''%'
     OR v_definition NOT ILIKE '%can_access(''prontuario'', ''create'')%'
     OR v_definition NOT ILIKE '%pg_advisory_xact_lock%'
     OR v_definition NOT ILIKE '%appointment.status IN (%''scheduled''%''confirmed''%''waiting''%''in_progress''%)%'
     OR v_definition NOT ILIKE '%FOR UPDATE%'
     OR v_definition NOT ILIKE '%professional.user_id = v_user%'
     OR v_definition NOT ILIKE '%imaging_order.appointment_id = v_appointment.id%'
     OR v_definition NOT ILIKE '%''reused'', TRUE%'
     OR v_definition NOT ILIKE '%appointment_id, scheduling_id%'
     OR v_definition ILIKE '%INSERT INTO public.dicom_worklist_queue%'
  THEN
    RAISE EXCEPTION 'RPC aplicada nao preserva escopo, causalidade, idempotencia ou handoff';
  END IF;

  IF NOT has_table_privilege('prontomedic_worklist_rpc_owner', 'public.units', 'SELECT')
     OR NOT has_table_privilege('prontomedic_worklist_rpc_owner', 'public.professionals', 'SELECT')
     OR NOT has_table_privilege('prontomedic_worklist_rpc_owner', 'public.imaging_orders', 'INSERT')
     OR NOT has_table_privilege('prontomedic_worklist_rpc_owner', 'public.imaging_order_items', 'INSERT')
     OR NOT EXISTS (
       SELECT 1
         FROM pg_proc procedure,
              LATERAL aclexplode(procedure.proacl) privilege
        WHERE procedure.oid = 'auth.uid()'::regprocedure
          AND privilege.grantee =
            (SELECT oid FROM pg_roles WHERE rolname = 'prontomedic_worklist_rpc_owner')
          AND privilege.privilege_type = 'EXECUTE'
     )
     OR NOT has_schema_privilege('prontomedic_worklist_rpc_owner', 'auth', 'USAGE')
  THEN
    RAISE EXCEPTION 'Owner da RPC nao recebeu o conjunto minimo de privilegios';
  END IF;

  IF (
    SELECT count(*)
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (
         (tablename = 'units' AND policyname = 'units_attendance_rpc_select'
           AND cmd = 'SELECT' AND roles = ARRAY['prontomedic_worklist_rpc_owner']::name[]
           AND qual ILIKE '%active_unit_id()%'
           AND qual ILIKE '%active_company_id()%'
           AND qual ILIKE '%lg_ativo%')
         OR
         (tablename = 'professionals' AND policyname = 'professionals_attendance_rpc_select'
           AND cmd = 'SELECT' AND roles = ARRAY['prontomedic_worklist_rpc_owner']::name[]
           AND qual ILIKE '%active_company_id()%'
           AND qual ILIKE '%auth.uid()%'
           AND qual ILIKE '%lg_ativo%')
         OR
         (tablename = 'imaging_orders' AND policyname = 'imaging_orders_attendance_rpc_insert'
           AND cmd = 'INSERT' AND roles = ARRAY['prontomedic_worklist_rpc_owner']::name[]
           AND with_check ILIKE '%active_company_id()%'
           AND with_check ILIKE '%active_unit_id()%'
           AND with_check ILIKE '%created_by%auth.uid()%')
         OR
         (tablename = 'imaging_order_items' AND policyname = 'imaging_order_items_attendance_rpc_insert'
           AND cmd = 'INSERT' AND roles = ARRAY['prontomedic_worklist_rpc_owner']::name[]
           AND with_check ILIKE '%active_company_id()%'
           AND with_check ILIKE '%active_unit_id()%'
           AND with_check ILIKE '%imaging_order_id%')
       )
  ) <> 4 THEN
    RAISE EXCEPTION 'Policies aplicadas nao comprovam os quatro contratos RLS esperados';
  END IF;
END;
$smoke$;

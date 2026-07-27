\set ON_ERROR_STOP on

DO $contract$
DECLARE
  v_name TEXT;
  v_owner TEXT;
  v_definition TEXT;
  v_table TEXT;
  v_function TEXT;
  v_return_type REGTYPE;
  v_security_definer BOOLEAN;
  v_config TEXT[];
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'exames_lab_catalogo',
    'exames_lab_valor_referencia',
    'exames_lab_pedido',
    'exames_lab_pedido_itens',
    'exames_lab_resultado',
    'exames_lab_alerta_critico',
    'lab_order_operation_requests',
    'lab_result_operation_requests'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_class relation
        JOIN pg_namespace namespace
          ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relname = v_table
         AND relation.relrowsecurity
         AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS/FORCE RLS missing on public.%', v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'exames_lab_valor_referencia',
    'exames_lab_pedido_itens',
    'exames_lab_resultado',
    'exames_lab_alerta_critico'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = v_table
         AND column_name = 'company_id'
         AND data_type = 'uuid'
         AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'Mandatory UUID company_id missing on public.%', v_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = 'prontomedic_lis_rpc_owner'
       AND NOT rolcanlogin
       AND NOT rolinherit
       AND NOT rolbypassrls
       AND NOT rolsuper
       AND NOT rolcreatedb
       AND NOT rolcreaterole
       AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION 'LIS RPC owner is absent or unsafe';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'public.m23_upsert_exam_catalog_secure(jsonb)',
    'public.m23_upsert_reference_range_secure(jsonb)',
    'public.m23_create_lab_order_secure(uuid,jsonb,jsonb)',
    'public.m23_collect_specimen_secure(bigint,text)',
    'public.m23_transition_specimen_secure(bigint,text)',
    'public.m23_record_results_idempotent_secure(bigint,jsonb,uuid)',
    'public.m23_validate_result_secure(bigint)',
    'public.m23_acknowledge_critical_alert_secure(bigint,text)',
    'public.m23_deliver_order_secure(bigint)'
  ] LOOP
    IF to_regprocedure(v_function) IS NULL THEN
      RAISE EXCEPTION 'Required Module 23 RPC is missing: %', v_function;
    END IF;

    SELECT
      owner_role.rolname,
      function_row.prorettype::REGTYPE,
      function_row.prosecdef,
      function_row.proconfig
      INTO v_owner, v_return_type, v_security_definer, v_config
      FROM pg_proc function_row
      JOIN pg_roles owner_role ON owner_role.oid = function_row.proowner
     WHERE function_row.oid = to_regprocedure(v_function);

    IF v_owner IS DISTINCT FROM 'prontomedic_lis_rpc_owner'
       OR v_return_type IS DISTINCT FROM 'jsonb'::REGTYPE
       OR NOT v_security_definer
       OR COALESCE(array_to_string(v_config, ','), '')
          NOT LIKE '%search_path=pg_catalog, public%' THEN
      RAISE EXCEPTION
        'Unsafe owner/return/security/search_path contract on %',
        v_function;
    END IF;

    IF NOT has_function_privilege('app_prontomedic', v_function, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR has_function_privilege('anon', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'Unsafe EXECUTE ACL on %', v_function;
    END IF;
  END LOOP;

  IF to_regprocedure('public.m23_record_results_secure(bigint,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy non-idempotent result RPC signature is still exposed';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'private.m23_normalize_role(text)',
    'private.m23_require_actor(text[])'
  ] LOOP
    IF to_regprocedure(v_function) IS NULL
       OR NOT has_function_privilege(
         'prontomedic_lis_rpc_owner',
         v_function,
         'EXECUTE'
       )
       OR has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR has_function_privilege('app_prontomedic', v_function, 'EXECUTE')
       OR has_function_privilege('anon', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'Unsafe private helper ACL on %', v_function;
    END IF;
  END LOOP;

  IF to_regprocedure('public.is_lab_user(uuid)') IS NULL
     OR NOT has_function_privilege(
       'authenticated',
       'public.is_lab_user(uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'app_prontomedic',
       'public.is_lab_user(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege('anon', 'public.is_lab_user(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unsafe is_lab_user ACL';
  END IF;

  SELECT pg_get_functiondef('public.is_lab_user(uuid)'::REGPROCEDURE)
    INTO v_definition;
  IF v_definition NOT LIKE '%private.m23_normalize_role%'
     OR v_definition NOT LIKE '%private.m23_effective_company_id()%'
     OR v_definition NOT LIKE '%laboratorio%' THEN
    RAISE EXCEPTION 'is_lab_user does not normalize aliases/tenant safely';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'exames_lab_catalogo',
    'exames_lab_valor_referencia',
    'exames_lab_pedido',
    'exames_lab_pedido_itens',
    'exames_lab_resultado',
    'exames_lab_alerta_critico'
  ] LOOP
    IF has_table_privilege(
         'app_prontomedic',
         format('public.%I', v_table),
         'INSERT'
       )
       OR has_table_privilege(
         'app_prontomedic',
         format('public.%I', v_table),
         'UPDATE'
       )
       OR has_table_privilege(
         'app_prontomedic',
         format('public.%I', v_table),
         'DELETE'
       )
       OR has_table_privilege(
         'authenticated',
         format('public.%I', v_table),
         'INSERT'
       )
       OR has_table_privilege(
         'authenticated',
         format('public.%I', v_table),
         'UPDATE'
       )
       OR has_table_privilege(
         'authenticated',
         format('public.%I', v_table),
         'DELETE'
       ) THEN
      RAISE EXCEPTION 'Direct client DML privilege leaked on public.%', v_table;
    END IF;

    IF NOT has_table_privilege(
         'app_prontomedic',
         format('public.%I', v_table),
         'SELECT'
       )
       OR NOT has_table_privilege(
         'authenticated',
         format('public.%I', v_table),
         'SELECT'
       ) THEN
      RAISE EXCEPTION 'Tenant-scoped client read was not preserved on public.%', v_table;
    END IF;
  END LOOP;

  IF has_table_privilege(
       'app_prontomedic',
       'public.lab_order_operation_requests',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.lab_order_operation_requests',
       'SELECT'
     )
     OR has_table_privilege(
       'app_prontomedic',
       'public.lab_order_operation_requests',
       'INSERT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.lab_order_operation_requests',
       'INSERT'
     ) THEN
    RAISE EXCEPTION 'LIS idempotency ledger leaked to a client role';
  END IF;

  IF has_table_privilege(
       'app_prontomedic',
       'public.lab_result_operation_requests',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.lab_result_operation_requests',
       'SELECT'
     )
     OR has_table_privilege(
       'app_prontomedic',
       'public.lab_result_operation_requests',
       'INSERT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.lab_result_operation_requests',
       'INSERT'
     ) THEN
    RAISE EXCEPTION 'LIS result idempotency ledger leaked to a client role';
  END IF;

  FOREACH v_name IN ARRAY ARRAY[
    'lab_reference_company_exam_fk',
    'lab_order_company_patient_fk',
    'lab_order_company_professional_fk',
    'lab_order_company_appointment_fk',
    'lab_item_company_order_fk',
    'lab_item_company_exam_fk',
    'lab_result_company_item_fk',
    'lab_result_company_reference_fk',
    'lab_alert_company_result_fk',
    'lab_alert_company_patient_fk',
    'lab_alert_company_professional_fk',
    'lab_order_operation_company_order_fk',
    'lab_result_operation_company_item_fk'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conname = v_name
         AND contype = 'f'
         AND convalidated
    ) THEN
      RAISE EXCEPTION 'Validated composite tenant FK is missing: %', v_name;
    END IF;
  END LOOP;

  SELECT pg_get_constraintdef(constraint_row.oid)
    INTO v_definition
    FROM pg_constraint constraint_row
   WHERE constraint_row.conrelid =
         'public.lab_order_operation_requests'::REGCLASS
     AND constraint_row.contype = 'p';
  IF regexp_replace(lower(COALESCE(v_definition, '')), '\s+', '', 'g')
       IS DISTINCT FROM 'primarykey(company_id,operation_id)' THEN
    RAISE EXCEPTION 'Unsafe LIS idempotency primary key: %', v_definition;
  END IF;

  SELECT pg_get_constraintdef(constraint_row.oid)
    INTO v_definition
    FROM pg_constraint constraint_row
   WHERE constraint_row.conrelid =
         'public.lab_result_operation_requests'::REGCLASS
     AND constraint_row.contype = 'p';
  IF regexp_replace(lower(COALESCE(v_definition, '')), '\s+', '', 'g')
       IS DISTINCT FROM 'primarykey(company_id,operation_id)' THEN
    RAISE EXCEPTION 'Unsafe LIS result idempotency primary key: %', v_definition;
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'exames_lab_catalogo',
    'exames_lab_valor_referencia',
    'exames_lab_pedido',
    'exames_lab_pedido_itens',
    'exames_lab_resultado',
    'exames_lab_alerta_critico',
    'lab_order_operation_requests',
    'lab_result_operation_requests'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = v_table
         AND 'prontomedic_lis_rpc_owner' = ANY(policy.roles)
         AND policy.cmd = 'ALL'
         AND COALESCE(policy.qual, '') LIKE '%m23_effective_company_id%'
         AND COALESCE(policy.with_check, '') LIKE '%m23_effective_company_id%'
    ) THEN
      RAISE EXCEPTION 'Tenant-bound owner policy missing on public.%', v_table;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(
    'public.m23_create_lab_order_secure(uuid,jsonb,jsonb)'::REGPROCEDURE
  ) INTO v_definition;
  IF v_definition NOT LIKE '%pg_advisory_xact_lock%'
     OR v_definition NOT LIKE '%lab_order_operation_requests%'
     OR v_definition NOT LIKE '%request_payload%'
     OR v_definition NOT LIKE '%request_payload IS DISTINCT FROM%'
     OR v_definition NOT LIKE '%jsonb_build_object(%pedido_id%'
     OR v_definition NOT LIKE '%itens_ids%' THEN
    RAISE EXCEPTION 'Order RPC lacks atomic/idempotent stable JSON contract';
  END IF;

  SELECT pg_get_functiondef(
    'public.m23_record_results_idempotent_secure(bigint,jsonb,uuid)'::REGPROCEDURE
  ) INTO v_definition;
  IF v_definition NOT LIKE '%jsonb_build_array%'
     OR v_definition NOT LIKE '%tp_status = ''EM_ANALISE''%'
     OR v_definition NOT LIKE
        '%tp_status NOT IN (''COLETADO'', ''EM_ANALISE'')%'
     OR v_definition NOT LIKE '%lab_result_operation_requests%'
     OR v_definition NOT LIKE '%request_payload IS DISTINCT FROM%'
     OR v_definition NOT LIKE '%p_operation_id IS NULL%'
     OR v_definition LIKE '%input_result->>''tp_resultado''%' THEN
    RAISE EXCEPTION
      'Result RPC lacks server authority/idempotency/atomic transition';
  END IF;

  SELECT pg_get_functiondef(
    'public.m23_collect_specimen_secure(bigint,text)'::REGPROCEDURE
  ) INTO v_definition;
  IF v_definition NOT LIKE '%v_sample_id IS NULL%'
     OR v_definition NOT LIKE '%Sample id is required%'
     OR v_definition NOT LIKE '%Collected sample id cannot be changed%' THEN
    RAISE EXCEPTION 'Specimen RPC does not fail closed on sample identity';
  END IF;

  SELECT pg_get_functiondef(
    'public.m23_deliver_order_secure(bigint)'::REGPROCEDURE
  ) INTO v_definition;
  IF v_definition NOT LIKE
       '%alert_row.tp_status <> ''RESOLVIDO''%'
     OR v_definition NOT LIKE
       '%alert_row.tp_status = ''PENDENTE''%'
     OR v_definition NOT LIKE
       '%NOT COALESCE(alert_row.lg_comunicado, FALSE)%' THEN
    RAISE EXCEPTION 'Delivery RPC does not block unresolved critical alerts';
  END IF;

  IF to_regprocedure('public.m23_upsert_equipment_secure(jsonb)') IS NOT NULL
     OR to_regprocedure('public.m23_record_qc_run_secure(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Fictitious equipment/QC RPC was exposed';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc procedure_row
      JOIN pg_namespace namespace_row
        ON namespace_row.oid = procedure_row.pronamespace
     WHERE namespace_row.nspname = 'public'
       AND procedure_row.proname IN (
         'm23_upsert_equipment_secure',
         'm23_record_qc_run_secure'
       )
  ) THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.prontomedic_deployment_migrations
       WHERE filename =
         '20260724160543_module23_laboratory_lis_hardening.sql'
    ) THEN
      RAISE EXCEPTION
        'Equipment/QC runtime lacks its canonical migration ledger';
    END IF;

    IF to_regprocedure(
         'public.m23_upsert_equipment_secure(uuid,integer,jsonb)'
       ) IS NULL
       OR to_regprocedure(
         'public.m23_record_qc_run_secure(uuid,text,text,text,numeric,numeric,numeric,numeric,text)'
       ) IS NULL
       OR to_regprocedure(
         'm23_private.upsert_equipment(uuid,integer,jsonb)'
       ) IS NULL
       OR to_regprocedure(
         'm23_private.record_qc_run(uuid,text,text,text,numeric,numeric,numeric,numeric,text)'
       ) IS NULL THEN
      RAISE EXCEPTION 'Incomplete equipment/QC implementation is exposed';
    END IF;

    FOREACH v_table IN ARRAY ARRAY[
      'lab_equipment',
      'lab_quality_control_runs'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1
          FROM pg_class relation
          JOIN pg_namespace namespace_row
            ON namespace_row.oid = relation.relnamespace
         WHERE namespace_row.nspname = 'public'
           AND relation.relname = v_table
           AND relation.relkind = 'r'
           AND relation.relrowsecurity
           AND relation.relforcerowsecurity
      ) THEN
        RAISE EXCEPTION
          'Equipment/QC table lacks RLS/FORCE RLS: public.%',
          v_table;
      END IF;
    END LOOP;

    FOREACH v_function IN ARRAY ARRAY[
      'public.m23_upsert_equipment_secure(uuid,integer,jsonb)',
      'public.m23_record_qc_run_secure(uuid,text,text,text,numeric,numeric,numeric,numeric,text)'
    ] LOOP
      SELECT function_row.prosecdef
        INTO v_security_definer
        FROM pg_proc function_row
       WHERE function_row.oid = to_regprocedure(v_function);

      IF v_security_definer
         OR NOT has_function_privilege(
           'app_prontomedic',
           v_function,
           'EXECUTE'
         )
         OR has_function_privilege('authenticated', v_function, 'EXECUTE')
         OR has_function_privilege('anon', v_function, 'EXECUTE') THEN
        RAISE EXCEPTION 'Unsafe equipment/QC public wrapper: %', v_function;
      END IF;
    END LOOP;

    FOREACH v_function IN ARRAY ARRAY[
      'm23_private.upsert_equipment(uuid,integer,jsonb)',
      'm23_private.record_qc_run(uuid,text,text,text,numeric,numeric,numeric,numeric,text)'
    ] LOOP
      SELECT function_row.prosecdef
        INTO v_security_definer
        FROM pg_proc function_row
       WHERE function_row.oid = to_regprocedure(v_function);

      IF NOT v_security_definer
         OR NOT has_function_privilege(
           'app_prontomedic',
           v_function,
           'EXECUTE'
         )
         OR has_function_privilege('authenticated', v_function, 'EXECUTE')
         OR has_function_privilege('anon', v_function, 'EXECUTE') THEN
        RAISE EXCEPTION 'Unsafe equipment/QC private function: %', v_function;
      END IF;
    END LOOP;

    SELECT pg_get_functiondef(
      'public.m23_upsert_equipment_secure(uuid,integer,jsonb)'::REGPROCEDURE
    )
      INTO v_definition;
    IF v_definition NOT LIKE
         '%m23_private.upsert_equipment(p_equipment_id, p_unit_id, p_payload)%'
       OR v_definition LIKE '%SECURITY DEFINER%' THEN
      RAISE EXCEPTION 'Unexpected public equipment wrapper implementation';
    END IF;

    SELECT pg_get_functiondef(
      'public.m23_record_qc_run_secure(uuid,text,text,text,numeric,numeric,numeric,numeric,text)'::REGPROCEDURE
    )
      INTO v_definition;
    IF v_definition NOT LIKE '%m23_private.record_qc_run(%'
       OR v_definition LIKE '%SECURITY DEFINER%' THEN
      RAISE EXCEPTION 'Unexpected public QC wrapper implementation';
    END IF;

    SELECT pg_get_functiondef(
      'm23_private.upsert_equipment(uuid,integer,jsonb)'::REGPROCEDURE
    )
      INTO v_definition;
    IF v_definition NOT LIKE '%INSERT INTO public.lab_equipment%'
       OR v_definition NOT LIKE '%UPDATE public.lab_equipment%'
       OR v_definition NOT LIKE '%private.org_can_access_unit_runtime%'
       OR v_definition NOT LIKE '%m23_private.can(''edit''%' THEN
      RAISE EXCEPTION 'Unexpected private equipment implementation';
    END IF;

    SELECT pg_get_functiondef(
      'm23_private.record_qc_run(uuid,text,text,text,numeric,numeric,numeric,numeric,text)'::REGPROCEDURE
    )
      INTO v_definition;
    IF v_definition NOT LIKE '%INSERT INTO public.lab_quality_control_runs%'
       OR v_definition NOT LIKE '%private.org_can_access_unit_runtime%'
       OR v_definition NOT LIKE '%m23_private.can(''create''%'
       OR v_definition NOT LIKE '%OUT_OF_CONTROL%' THEN
      RAISE EXCEPTION 'Unexpected private QC implementation';
    END IF;
  END IF;
END;
$contract$;

\echo 'module23_lis_contract: PASS'

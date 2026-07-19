-- Structural contract for operational-domain RLS. Read-only catalog assertions.
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  expected_tables constant text[] := ARRAY[
    'exames_lab_catalogo', 'exames_lab_valor_referencia',
    'exames_lab_pedido', 'exames_lab_pedido_itens',
    'exames_lab_resultado', 'exames_lab_alerta_critico',
    'nps_pesquisas', 'nps_respostas', 'pre_cadastro',
    'notification_templates', 'notifications',
    'notification_preferences', 'notification_logs'
  ];
  functional_policies constant text[] := ARRAY[
    'Authenticated can read lab catalog', 'Lab can manage exam catalog',
    'Authenticated can read lab ref values', 'Lab can manage ref values',
    'Authenticated can read lab orders', 'Lab can manage lab orders',
    'Authenticated can read lab order items', 'Lab can manage lab order items',
    'Authenticated can read lab results', 'Lab can manage lab results',
    'Authenticated can read lab alerts', 'Lab can manage lab alerts',
    'Authenticated can read nps_pesquisas', 'Admins can manage nps_pesquisas',
    'Authenticated can read nps_respostas', 'pre_cadastro_staff_select',
    'pre_cadastro_staff_update', 'pre_cadastro_admin_delete',
    'notification_templates_read', 'notification_templates_admin_write',
    'notifications_read', 'notification_preferences_self', 'notification_logs_admin'
  ];
  child_table text;
  missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count
  FROM unnest(expected_tables) expected(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = expected.table_name
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity
  );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION '% operational table(s) lack ENABLE RLS or use FORCE RLS', missing_count;
  END IF;

  SELECT count(*) INTO missing_count
  FROM unnest(ARRAY[
    'exames_lab_valor_referencia', 'exames_lab_pedido_itens',
    'exames_lab_resultado', 'exames_lab_alerta_critico'
  ]) child(table_name)
  JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = child.table_name
   AND c.column_name = 'company_id';
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'LIS fixture/schema incorrectly gives company_id to % child table(s)', missing_count;
  END IF;

  SELECT count(*) INTO missing_count
  FROM unnest(expected_tables) expected(table_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = expected.table_name
      AND p.cmd = 'ALL'
      AND 'app_prontomedic' = ANY(p.roles)
      AND coalesce(p.qual, '') LIKE '%request_company_id%'
      AND coalesce(p.with_check, '') LIKE '%request_company_id%'
      AND coalesce(p.qual, '') NOT LIKE '%company_id IS NULL%'
      AND coalesce(p.with_check, '') NOT LIKE '%company_id IS NULL%'
  );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION '% table(s) lack strict app_prontomedic tenant ALL policy', missing_count;
  END IF;

  SELECT count(*) INTO missing_count
  FROM unnest(expected_tables) expected(table_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = expected.table_name
      AND 'authenticated' = ANY(p.roles)
      AND (
        coalesce(p.qual, '') LIKE '%current_company_id%'
        OR coalesce(p.with_check, '') LIKE '%current_company_id%'
      )
  );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION '% table(s) lack authenticated current_company_id tenant policy', missing_count;
  END IF;

  SELECT count(*) INTO missing_count
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename = ANY(expected_tables)
    AND (
      coalesce(p.qual, '') LIKE '%get_my_company_id%'
      OR coalesce(p.with_check, '') LIKE '%get_my_company_id%'
    );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION '% operational policy/policies still use get_my_company_id()', missing_count;
  END IF;

  SELECT count(*) INTO missing_count
  FROM unnest(expected_tables) expected(table_name)
  WHERE NOT (
    has_table_privilege('app_prontomedic', format('public.%I', expected.table_name), 'SELECT')
    AND has_table_privilege('app_prontomedic', format('public.%I', expected.table_name), 'INSERT')
    AND has_table_privilege('app_prontomedic', format('public.%I', expected.table_name), 'UPDATE')
    AND has_table_privilege('app_prontomedic', format('public.%I', expected.table_name), 'DELETE')
  );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'app_prontomedic lacks DML grants on % operational table(s)', missing_count;
  END IF;

  FOREACH child_table IN ARRAY ARRAY[
    'exames_lab_valor_referencia', 'exames_lab_pedido_itens',
    'exames_lab_resultado', 'exames_lab_alerta_critico'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = child_table
        AND 'app_prontomedic' = ANY(p.roles)
        AND coalesce(p.qual, '') ~ CASE child_table
          WHEN 'exames_lab_valor_referencia' THEN 'cd_exame'
          WHEN 'exames_lab_pedido_itens' THEN 'cd_pedido'
          WHEN 'exames_lab_resultado' THEN 'cd_item_pedido'
          WHEN 'exames_lab_alerta_critico' THEN 'cd_resultado'
        END
    ) THEN
      RAISE EXCEPTION 'LIS child % does not derive tenant through its real parent key', child_table;
    END IF;
  END LOOP;

  SELECT count(*) INTO missing_count
  FROM unnest(functional_policies) expected(policy_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.policyname = expected.policy_name
  );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION '% functional authenticated policy/policies were not preserved', missing_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'nps_respostas'
      AND policyname = 'Anonymous can submit NPS' AND cmd = 'INSERT'
      AND 'anon' = ANY(roles) AND NOT ('authenticated' = ANY(roles))
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pre_cadastro'
      AND policyname = 'pre_cadastro_anon_insert' AND cmd = 'INSERT'
      AND 'anon' = ANY(roles) AND NOT ('authenticated' = ANY(roles))
  ) THEN
    RAISE EXCEPTION 'Anonymous NPS/pre-registration insert capability was not preserved safely';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notification_templates'
      AND policyname = 'notification_templates_read' AND cmd = 'SELECT'
      AND coalesce(qual, '') LIKE '%company_id IS NULL%'
  ) OR EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notification_templates'
      AND cmd IN ('INSERT', 'UPDATE', 'ALL')
      AND (coalesce(qual, '') LIKE '%company_id IS NULL%'
        OR coalesce(with_check, '') LIKE '%company_id IS NULL%')
  ) THEN
    RAISE EXCEPTION 'Global notification templates must be readable but never writable';
  END IF;

  SELECT count(*) INTO missing_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY(expected_tables)
    AND ('public' = ANY(roles) OR 'PUBLIC' = ANY(roles));
  IF missing_count <> 0 THEN
    RAISE EXCEPTION '% operational policy/policies apply to PUBLIC', missing_count;
  END IF;

  SELECT count(*) INTO missing_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY(expected_tables)
    AND (
      coalesce(qual, '') ~* '^\s*\(?\s*true\s*\)?\s*$'
      OR coalesce(with_check, '') ~* '^\s*\(?\s*true\s*\)?\s*$'
    )
    AND NOT (
      cmd = 'INSERT' AND 'anon' = ANY(roles)
      AND policyname IN ('Anonymous can submit NPS', 'pre_cadastro_anon_insert')
    );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION '% broad true policy expression(s) remain outside approved anon inserts', missing_count;
  END IF;
END
$$;

ROLLBACK;

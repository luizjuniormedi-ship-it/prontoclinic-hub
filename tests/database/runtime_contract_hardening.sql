\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition BOOLEAN, message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'RUNTIME_CONTRACT_ASSERTION_FAILED: %', message;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  COALESCE(
    (
      SELECT 'security_invoker=true' = ANY (c.reloptions)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'v_ocupacao_profissional'
    ),
    FALSE
  )
  AND COALESCE(
    (
      SELECT 'security_invoker=true' = ANY (c.reloptions)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'v_faturamento_convenio'
    ),
    FALSE
  ),
  'views de BI precisam executar com privilegios do chamador'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'v_ocupacao_profissional'
      AND column_name = 'company_id'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'v_faturamento_convenio'
      AND column_name = 'company_id'
  ),
  'views de BI precisam expor company_id para defesa em profundidade'
);

SELECT pg_temp.assert_true(
  (
    SELECT NOT p.prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_lab_order_summaries'
      AND pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid'
  )
  AND (
    SELECT NOT p.prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_lab_critical_alerts'
      AND pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid'
  ),
  'RPCs de laboratorio devem permanecer SECURITY INVOKER'
);

SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.get_lab_order_summaries(uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.get_lab_critical_alerts(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_lab_order_summaries(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_lab_critical_alerts(uuid)',
    'EXECUTE'
  ),
  'RPCs de laboratorio devem ser exclusivas de authenticated'
);

SELECT pg_temp.assert_true(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'dicom_equipment'
  )
  AND (
    SELECT count(*) = 4
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'dicom_equipment'
      AND policyname IN (
        'dicom_equipment_tenant_select',
        'dicom_equipment_tenant_insert',
        'dicom_equipment_tenant_update',
        'dicom_equipment_tenant_delete'
      )
  ),
  'dicom_equipment precisa de RLS forcada e policies por operacao'
);

SELECT pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.dicom_equipment', 'SELECT')
  AND has_table_privilege('authenticated', 'public.dicom_equipment', 'INSERT')
  AND has_table_privilege('authenticated', 'public.dicom_equipment', 'UPDATE')
  AND has_table_privilege('authenticated', 'public.dicom_equipment', 'DELETE'),
  'runtime autenticado precisa dos grants minimos protegidos por RLS'
);

SELECT pg_temp.assert_true(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'payment_sources'
  )
  AND (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'billings'
  ),
  'bases das views de BI precisam de RLS forcada'
);

SELECT pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.payment_sources', 'SELECT')
  AND has_table_privilege('authenticated', 'public.billings', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.payment_sources', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.billings', 'SELECT'),
  'views de BI precisam somente dos grants autenticados protegidos por RLS'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 4
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_sources'
      AND policyname IN (
        'payment_sources_context_select',
        'payment_sources_context_insert',
        'payment_sources_context_update',
        'payment_sources_context_delete'
      )
  )
  AND EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'billings'
      AND policyname = 'billings_context_select'
  ),
  'bases de BI precisam de policies por contexto ativo'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'payment_sources',
        'billings',
        'exames_lab_pedido',
        'exames_lab_pedido_itens',
        'exames_lab_alerta_critico'
      )
      AND (
        COALESCE(qual, '') ~* '(^|[^a-z])true([^a-z]|$)'
        OR COALESCE(with_check, '') ~* '(^|[^a-z])true([^a-z]|$)'
      )
  ),
  'contratos runtime nao podem manter USING(true) ou WITH CHECK(true)'
);

SELECT pg_temp.assert_true(
  (
    SELECT bool_and(relrowsecurity AND relforcerowsecurity)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'exames_lab_pedido',
        'exames_lab_pedido_itens',
        'exames_lab_alerta_critico'
      )
  )
  AND has_table_privilege('authenticated', 'public.exames_lab_pedido', 'SELECT')
  AND has_table_privilege('authenticated', 'public.exames_lab_pedido_itens', 'SELECT')
  AND has_table_privilege('authenticated', 'public.exames_lab_alerta_critico', 'SELECT'),
  'RPCs invoker de laboratorio precisam de RLS forcada e grants autenticados'
);

SELECT pg_temp.assert_true(
  (
    SELECT NOT p.prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_gerar_alerta_critico'
      AND pg_get_function_identity_arguments(p.oid) = ''
  ),
  'trigger de alerta critico deve exercer RLS como SECURITY INVOKER'
);

ROLLBACK;

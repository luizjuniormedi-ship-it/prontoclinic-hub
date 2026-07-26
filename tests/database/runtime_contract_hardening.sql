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

ROLLBACK;

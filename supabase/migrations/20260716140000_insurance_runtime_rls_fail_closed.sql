-- Close the legacy app-role policies for insurance contract/rule tables.
-- The runtime backend sets request.jwt.claim.company_id per transaction.
-- This migration intentionally does not touch DataSIGH or public catalog tables.
BEGIN;

DO $$
DECLARE
  target_table TEXT;
  policy_name TEXT;
  target_tables CONSTANT TEXT[] := ARRAY[
    'insurance_company_contacts',
    'insurance_contracts',
    'insurance_contract_documents',
    'insurance_coverage_rules',
    'insurance_authorization_rules',
    'insurance_copay_rules',
    'insurance_return_rules',
    'insurance_tiss_guide_rules',
    'insurance_denial_rules',
    'insurance_deadline_rules',
    'insurance_rule_snapshots',
    'insurance_contract_audit_logs',
    'insurance_access_logs'
  ];
BEGIN
  IF to_regprocedure('public.request_company_id()') IS NULL THEN
    RAISE EXCEPTION 'runtime RLS requires public.request_company_id()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    RAISE EXCEPTION 'runtime RLS requires role app_prontomedic';
  END IF;

  FOREACH target_table IN ARRAY target_tables LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      RAISE EXCEPTION 'runtime RLS requires public.%', target_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'public'
        AND cols.table_name = target_table
        AND cols.column_name = 'company_id'
    ) THEN
      RAISE EXCEPTION 'runtime RLS requires company_id on public.%', target_table;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target_table);
    -- A policy permissiva combina por OR com a policy segura. Remover todas
    -- as policies legadas deste conjunto fechado evita deixar uma excecao
    -- residual com outro nome.
    FOR policy_name IN
      SELECT policies.policyname
      FROM pg_policies AS policies
      WHERE policies.schemaname = 'public'
        AND policies.tablename = target_table
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        policy_name,
        target_table
      );
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO app_prontomedic USING (company_id = public.request_company_id()) WITH CHECK (company_id = public.request_company_id())',
      'app_prontomedic_tenant_all_' || target_table,
      target_table
    );
  END LOOP;
END
$$;

COMMIT;

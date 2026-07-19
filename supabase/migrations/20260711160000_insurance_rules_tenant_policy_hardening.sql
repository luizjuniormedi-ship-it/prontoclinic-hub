-- Later tenant-aware replacement for the broad insurance rules policies.
-- Local preparation only; fails closed if the expected company_id contract is absent.
BEGIN;

DO $$
DECLARE
  table_name TEXT;
  target_tables CONSTANT TEXT[] := ARRAY[
    'insurance_company_contacts', 'insurance_contracts',
    'insurance_contract_documents', 'insurance_coverage_rules',
    'insurance_authorization_rules', 'insurance_copay_rules',
    'insurance_return_rules', 'insurance_tiss_guide_rules',
    'insurance_denial_rules', 'insurance_deadline_rules',
    'insurance_rule_snapshots', 'insurance_contract_audit_logs',
    'insurance_access_logs'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    RAISE EXCEPTION 'Tenant policy replacement requires role app_prontomedic';
  END IF;

  FOREACH table_name IN ARRAY target_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'Tenant policy replacement requires public.%', table_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'public' AND cols.table_name = table_name AND cols.column_name = 'company_id'
    ) THEN
      RAISE EXCEPTION 'Tenant policy replacement requires company_id on public.%', table_name;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'app_prontomedic_all_' || table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO app_prontomedic USING (company_id = public.get_my_company_id()) WITH CHECK (company_id = public.get_my_company_id())',
      'app_prontomedic_tenant_all_' || table_name, table_name
    );
  END LOOP;
END
$$;

COMMIT;

-- Structural contract for replacement of broad insurance policies. No DML.
BEGIN;

DO $$
DECLARE
  broad_count INTEGER;
  table_name TEXT;
BEGIN
  SELECT count(*) INTO broad_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename LIKE 'insurance_%'
    AND coalesce(qual, '') ~* '^\s*\(?\s*true\s*\)?\s*$';
  IF broad_count <> 0 THEN
    RAISE EXCEPTION 'Insurance rules still contain USING(true) policies: %', broad_count;
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'insurance_company_contacts', 'insurance_contracts',
    'insurance_contract_documents', 'insurance_coverage_rules',
    'insurance_authorization_rules', 'insurance_copay_rules',
    'insurance_return_rules', 'insurance_tiss_guide_rules',
    'insurance_denial_rules', 'insurance_deadline_rules',
    'insurance_rule_snapshots', 'insurance_contract_audit_logs',
    'insurance_access_logs'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
        AND policyname = 'app_prontomedic_tenant_all_' || table_name
    ) THEN
      RAISE EXCEPTION 'Tenant policy missing on public.%', table_name;
    END IF;
  END LOOP;
END
$$;

ROLLBACK;

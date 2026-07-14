-- Fecha o acesso direto global criado na fundação de Convênios.
-- O backend atual ainda não injeta contexto de tenant no PostgreSQL para essas
-- tabelas; portanto o role interno não pode receber CRUD com USING (true).
-- O módulo deve usar um RPC tenant-aware antes de qualquer liberação futura.

DO $$
DECLARE
  v_table TEXT;
  v_tables CONSTANT TEXT[] := ARRAY[
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    FOREACH v_table IN ARRAY v_tables LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'app_prontomedic_all_' || v_table, v_table);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM app_prontomedic', v_table);
    END LOOP;

    REVOKE EXECUTE ON FUNCTION public.validate_insurance_operation(
      UUID, TEXT, INTEGER, INTEGER, BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, DATE, BOOLEAN
    ) FROM app_prontomedic;
  END IF;
END $$;

COMMENT ON FUNCTION public.validate_insurance_operation(
  UUID, TEXT, INTEGER, INTEGER, BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, DATE, BOOLEAN
) IS 'Foundation only: execution remains closed until a tenant-aware RPC context is implemented.';

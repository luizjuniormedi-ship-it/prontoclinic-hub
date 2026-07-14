-- Fail closed the legacy app_prontomedic access path until request identity
-- propagation is proven. Direct table access cannot derive a tenant safely.

DO $f1$
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
    ALTER ROLE app_prontomedic NOLOGIN NOBYPASSRLS;

    FOREACH v_table IN ARRAY v_tables LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM app_prontomedic', v_table);
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        'app_prontomedic_all_' || v_table,
        v_table
      );
    END LOOP;

    REVOKE EXECUTE ON FUNCTION public.validate_insurance_operation(
      UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,BIGINT,BIGINT,DATE,BOOLEAN
    ) FROM PUBLIC, app_prontomedic;
  END IF;
END
$f1$;

COMMENT ON FUNCTION public.validate_insurance_operation(
  UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,BIGINT,BIGINT,DATE,BOOLEAN
) IS 'Legacy contract validation is disabled for direct app_prontomedic access until tenant identity propagation is proven.';

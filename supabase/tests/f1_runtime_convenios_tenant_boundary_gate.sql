DO $f1$
DECLARE
  v_broad_count INTEGER;
  v_table_access_count INTEGER;
  v_function_access BOOLEAN;
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    RAISE EXCEPTION 'F1 blocker: app_prontomedic role missing from replay';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'app_prontomedic' AND (rolcanlogin OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'F1 blocker: app_prontomedic must be NOLOGIN and NOBYPASSRLS';
  END IF;

  SELECT count(*) INTO v_broad_count
  FROM pg_policies
  WHERE 'app_prontomedic' = ANY (roles)
    AND tablename = ANY (v_tables)
    AND (
      lower(regexp_replace(coalesce(qual, ''), '\s+', '', 'g')) IN ('true', '(true)')
      OR lower(regexp_replace(coalesce(with_check, ''), '\s+', '', 'g')) IN ('true', '(true)')
    );

  IF v_broad_count > 0 THEN
    RAISE EXCEPTION 'F1 blocker: broad app_prontomedic policy count=%', v_broad_count;
  END IF;

  SELECT count(*) INTO v_table_access_count
  FROM (
    SELECT has_table_privilege('app_prontomedic', format('public.%I', table_name), 'SELECT') AS allowed
    FROM unnest(v_tables) AS table_name
  ) privileges
  WHERE allowed;

  IF v_table_access_count > 0 THEN
    RAISE EXCEPTION 'F1 blocker: app_prontomedic retains direct SELECT on % table(s)', v_table_access_count;
  END IF;

  SELECT has_function_privilege(
    'app_prontomedic',
    'public.validate_insurance_operation(uuid,text,integer,integer,bigint,integer,bigint,bigint,bigint,date,boolean)',
    'EXECUTE'
  ) INTO v_function_access;

  IF v_function_access THEN
    RAISE EXCEPTION 'F1 blocker: legacy validate_insurance_operation remains executable by app_prontomedic';
  END IF;
END
$f1$;

SELECT 'CONVENIOS_TENANT_BOUNDARY=PASS' AS gate;

DO $$
DECLARE
  v_policy_count INTEGER;
  v_rpc_count INTEGER;
  v_trigger_count INTEGER;
  v_event_trigger_count INTEGER;
BEGIN
  IF to_regclass('public.tiss_guides') IS NULL
     OR to_regclass('public.tiss_guide_events') IS NULL THEN
    RAISE EXCEPTION 'M16 guide tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tiss_xml'
      AND column_name IN ('guide_id', 'billing_account_id')
    GROUP BY table_schema, table_name
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'M16 TISS XML linkage columns are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.tiss_guides'::regclass
      AND relrowsecurity
      AND relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.tiss_guide_events'::regclass
      AND relrowsecurity
      AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'M16 RLS is not enabled and forced on guide tables';
  END IF;

  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('tiss_guides', 'tiss_guide_events')
    AND policyname LIKE 'm16_%';
  IF v_policy_count < 5 THEN
    RAISE EXCEPTION 'M16 RLS policies incomplete: %', v_policy_count;
  END IF;

  SELECT count(*) INTO v_rpc_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_tiss_guide_secure', 'validate_tiss_guide_secure',
      'sign_tiss_guide_secure', 'cancel_tiss_guide_secure',
      'substitute_tiss_guide_secure', 'link_tiss_xml_guide_secure'
    );
  IF v_rpc_count <> 6 THEN
    RAISE EXCEPTION 'M16 secure RPCs incomplete: %', v_rpc_count;
  END IF;

  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.tiss_guides'::regclass
    AND tgname = 'trg_m16_guard_tiss_guide'
    AND NOT tgisinternal;
  IF v_trigger_count <> 1 THEN
    RAISE EXCEPTION 'M16 immutability trigger missing';
  END IF;

  SELECT count(*) INTO v_event_trigger_count
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE t.tgrelid = 'public.tiss_guides'::regclass
    AND t.tgname = 'trg_m16_tiss_guide_event'
    AND n.nspname = 'private'
    AND p.proname = 'm16_record_tiss_guide_event'
    AND NOT t.tgisinternal;
  IF v_event_trigger_count <> 1 THEN
    RAISE EXCEPTION 'M16 private audit trigger missing';
  END IF;

  IF has_table_privilege('authenticated', 'public.tiss_guide_events', 'INSERT')
     OR has_table_privilege('app_prontomedic', 'public.tiss_guide_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.tiss_guide_events', 'UPDATE')
     OR has_table_privilege('app_prontomedic', 'public.tiss_guide_events', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.tiss_guide_events', 'DELETE')
     OR has_table_privilege('app_prontomedic', 'public.tiss_guide_events', 'DELETE') THEN
    RAISE EXCEPTION 'M16 audit table is directly writable by application roles';
  END IF;

  IF has_function_privilege('authenticated', 'private.m16_record_tiss_guide_event()', 'EXECUTE')
     OR has_function_privilege('app_prontomedic', 'private.m16_record_tiss_guide_event()', 'EXECUTE') THEN
    RAISE EXCEPTION 'M16 private audit trigger function is executable by application roles';
  END IF;
END
$$;

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('tiss_guides', 'tiss_guide_events')
ORDER BY tablename, policyname;

DO $$
DECLARE
  v_policy_count INTEGER;
  v_rpc_count INTEGER;
  v_trigger_count INTEGER;
BEGIN
  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('insurance_eligibility_checks', 'insurance_eligibility_events')
    AND policyname LIKE '%eligibility%';
  IF v_policy_count < 2 THEN
    RAISE EXCEPTION 'M14 tenant policies incomplete: %', v_policy_count;
  END IF;

  SELECT count(*) INTO v_rpc_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('create_insurance_eligibility_check_secure', 'update_insurance_eligibility_check_secure');
  IF v_rpc_count <> 2 THEN
    RAISE EXCEPTION 'M14 secure RPCs incomplete: %', v_rpc_count;
  END IF;

  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.insurance_eligibility_checks'::regclass
    AND tgname = 'trg_insurance_eligibility_event'
    AND NOT tgisinternal;
  IF v_trigger_count <> 1 THEN
    RAISE EXCEPTION 'M14 eligibility audit trigger missing';
  END IF;
END
$$;

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('insurance_eligibility_checks', 'insurance_eligibility_events')
ORDER BY tablename, policyname;

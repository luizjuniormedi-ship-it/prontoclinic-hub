DO $$
DECLARE
  v_policy_count INTEGER;
  v_rpc_count INTEGER;
  v_trigger_count INTEGER;
BEGIN
  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('insurance_authorizations', 'insurance_authorization_events', 'insurance_authorization_attachments')
    AND policyname LIKE 'm15_%';
  IF v_policy_count < 5 THEN
    RAISE EXCEPTION 'M15 tenant policies incomplete: %', v_policy_count;
  END IF;

  SELECT count(*) INTO v_rpc_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('create_insurance_authorization_secure', 'transition_insurance_authorization_secure',
                      'create_insurance_authorization_followup_secure', 'add_insurance_authorization_attachment_secure',
                      'consume_insurance_authorization');
  IF v_rpc_count <> 5 THEN
    RAISE EXCEPTION 'M15 secure RPCs incomplete: %', v_rpc_count;
  END IF;

  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.insurance_authorizations'::regclass
    AND tgname = 'trg_m15_authorization_audit'
    AND NOT tgisinternal;
  IF v_trigger_count <> 1 THEN
    RAISE EXCEPTION 'M15 authorization audit trigger missing';
  END IF;
END
$$;

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'insurance_authorization%'
ORDER BY tablename, policyname;

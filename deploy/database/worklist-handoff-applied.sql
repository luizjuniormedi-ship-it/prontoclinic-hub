DO $$
DECLARE
  v_policies INTEGER;
BEGIN
  IF to_regprocedure('public.ensure_reception_worklist_for_checkin_secure(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RPC do handoff Recepcao-Worklist ausente';
  END IF;
  SELECT count(*) INTO v_policies
  FROM pg_policies WHERE policyname LIKE 'm11_%_worklist_rpc_%';
  IF v_policies <> 7 THEN
    RAISE EXCEPTION 'policies do handoff incompletas: %', v_policies;
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.ensure_reception_worklist_for_checkin_secure(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sem EXECUTE no handoff';
  END IF;
  IF has_function_privilege('anon', 'public.ensure_reception_worklist_for_checkin_secure(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon possui EXECUTE no handoff';
  END IF;
END
$$;

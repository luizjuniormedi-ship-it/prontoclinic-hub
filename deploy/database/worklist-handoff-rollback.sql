DO $$
BEGIN
  IF to_regprocedure('public.ensure_reception_worklist_for_checkin_secure(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'RPC do handoff permaneceu apos rollback inverso';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname LIKE 'm11_%_worklist_rpc_%') THEN
    RAISE EXCEPTION 'policy do handoff permaneceu apos rollback inverso';
  END IF;
END
$$;

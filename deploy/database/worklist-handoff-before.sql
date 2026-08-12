DO $$
BEGIN
  IF to_regprocedure('public.ensure_reception_worklist_for_checkin_secure(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'handoff Recepcao-Worklist ja existe antes da migration';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname LIKE 'm11_%_worklist_rpc_%') THEN
    RAISE EXCEPTION 'policies do handoff ja existem antes da migration';
  END IF;
END
$$;

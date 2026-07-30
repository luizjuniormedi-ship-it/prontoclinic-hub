-- Restore the Reception workflow's narrow TISS draft capability after the
-- Module 16 runtime closure revokes application-wide table privileges.

ALTER FUNCTION private.m11_ensure_tiss_guide(UUID, TEXT, TEXT)
  OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.ensure_tiss_guide_for_checkin_secure(UUID, TEXT, TEXT)
  OWNER TO prontomedic_reception_rpc_owner;

GRANT USAGE ON SCHEMA public, private
  TO prontomedic_reception_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON public.tiss_guides
  TO prontomedic_reception_rpc_owner;

DROP POLICY IF EXISTS tiss_guides_reception_rpc_access
  ON public.tiss_guides;
CREATE POLICY tiss_guides_reception_rpc_access
  ON public.tiss_guides
  FOR ALL TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

REVOKE ALL ON FUNCTION private.m11_ensure_tiss_guide(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.m11_ensure_tiss_guide(UUID, TEXT, TEXT)
  TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.ensure_tiss_guide_for_checkin_secure(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.ensure_tiss_guide_for_checkin_secure(UUID, TEXT, TEXT)
  TO authenticated, prontomedic_reception_rpc_owner;

COMMENT ON POLICY tiss_guides_reception_rpc_access ON public.tiss_guides IS
  'Reception workflow may prepare a TISS draft only for the active company and an authorized unit.';

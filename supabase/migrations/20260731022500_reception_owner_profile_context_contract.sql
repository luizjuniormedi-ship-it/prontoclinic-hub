-- Align the reception RPC owner with the canonical authenticated context.
-- The gateway exposes auth.uid() and the active application company context.

DROP POLICY IF EXISTS m11_reception_owner_profiles_read
  ON public.user_profiles;
CREATE POLICY m11_reception_owner_profiles_read
  ON public.user_profiles
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND (id = auth.uid() OR user_id = auth.uid())
    AND lg_ativo = TRUE
  );


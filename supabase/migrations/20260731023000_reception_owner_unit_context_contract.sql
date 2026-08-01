-- Align the remaining reception owner scope policies with the canonical
-- authenticated user and active application company context.

DROP POLICY IF EXISTS m11_reception_owner_units_read ON public.units;
CREATE POLICY m11_reception_owner_units_read
  ON public.units
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND lg_ativo = TRUE
  );

DROP POLICY IF EXISTS m11_reception_owner_unit_access_read
  ON public.unit_access;
CREATE POLICY m11_reception_owner_unit_access_read
  ON public.unit_access
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND user_id = auth.uid()
  );


-- O catalogo LIS possui company_id e valores de cada clinica; nao e catalogo
-- universal. A leitura precisa respeitar o tenant como os pedidos laboratoriais.

DROP POLICY IF EXISTS "Authenticated can read lab catalog" ON public.exames_lab_catalogo;
CREATE POLICY "Authenticated can read lab catalog"
  ON public.exames_lab_catalogo
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

COMMENT ON POLICY "Authenticated can read lab catalog" ON public.exames_lab_catalogo
  IS 'Catalogo LIS e tenantizado porque contem precos e configuracoes da clinica.';

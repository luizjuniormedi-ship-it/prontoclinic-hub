-- Tenant isolation for LIS catalog, orders, results and critical alerts.
-- Global catalog rows are explicit (company_id IS NULL); clinical rows are not.

BEGIN;

DROP POLICY IF EXISTS "Authenticated can read lab catalog" ON public.exames_lab_catalogo;
CREATE POLICY "Authenticated can read lab catalog" ON public.exames_lab_catalogo
  FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id = public.get_my_company_id());

DROP POLICY IF EXISTS "Lab can manage exam catalog" ON public.exames_lab_catalogo;
CREATE POLICY "Lab can manage exam catalog" ON public.exames_lab_catalogo
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_lab_user(auth.uid()))
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_lab_user(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can read lab ref values" ON public.exames_lab_valor_referencia;
CREATE POLICY "Authenticated can read lab ref values" ON public.exames_lab_valor_referencia
  FOR SELECT TO authenticated
  USING (
    (company_id IS NULL OR company_id = public.get_my_company_id())
    AND EXISTS (
      SELECT 1
      FROM public.exames_lab_catalogo c
      WHERE c.id = cd_exame
        AND (c.company_id IS NULL OR c.company_id = public.get_my_company_id())
    )
  );

DROP POLICY IF EXISTS "Lab can manage ref values" ON public.exames_lab_valor_referencia;
CREATE POLICY "Lab can manage ref values" ON public.exames_lab_valor_referencia
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_lab_user(auth.uid()))
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_lab_user(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can read lab orders" ON public.exames_lab_pedido;
CREATE POLICY "Authenticated can read lab orders" ON public.exames_lab_pedido
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS "Lab can manage lab orders" ON public.exames_lab_pedido;
CREATE POLICY "Lab can manage lab orders" ON public.exames_lab_pedido
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_lab_user(auth.uid()))
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_lab_user(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can read lab order items" ON public.exames_lab_pedido_itens;
CREATE POLICY "Authenticated can read lab order items" ON public.exames_lab_pedido_itens
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.exames_lab_pedido p
    WHERE p.id = cd_pedido AND p.company_id = public.get_my_company_id()
  ));

DROP POLICY IF EXISTS "Lab can manage lab order items" ON public.exames_lab_pedido_itens;
CREATE POLICY "Lab can manage lab order items" ON public.exames_lab_pedido_itens
  FOR ALL TO authenticated
  USING (public.is_lab_user(auth.uid()) AND EXISTS (
    SELECT 1 FROM public.exames_lab_pedido p
    WHERE p.id = cd_pedido AND p.company_id = public.get_my_company_id()
  ))
  WITH CHECK (public.is_lab_user(auth.uid()) AND EXISTS (
    SELECT 1 FROM public.exames_lab_pedido p
    WHERE p.id = cd_pedido AND p.company_id = public.get_my_company_id()
  ));

DROP POLICY IF EXISTS "Authenticated can read lab results" ON public.exames_lab_resultado;
CREATE POLICY "Authenticated can read lab results" ON public.exames_lab_resultado
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.exames_lab_pedido_itens i
    JOIN public.exames_lab_pedido p ON p.id = i.cd_pedido
    WHERE i.id = cd_item_pedido AND p.company_id = public.get_my_company_id()
  ));

DROP POLICY IF EXISTS "Lab can manage lab results" ON public.exames_lab_resultado;
CREATE POLICY "Lab can manage lab results" ON public.exames_lab_resultado
  FOR ALL TO authenticated
  USING (public.is_lab_user(auth.uid()) AND EXISTS (
    SELECT 1
    FROM public.exames_lab_pedido_itens i
    JOIN public.exames_lab_pedido p ON p.id = i.cd_pedido
    WHERE i.id = cd_item_pedido AND p.company_id = public.get_my_company_id()
  ))
  WITH CHECK (public.is_lab_user(auth.uid()) AND EXISTS (
    SELECT 1
    FROM public.exames_lab_pedido_itens i
    JOIN public.exames_lab_pedido p ON p.id = i.cd_pedido
    WHERE i.id = cd_item_pedido AND p.company_id = public.get_my_company_id()
  ));

DROP POLICY IF EXISTS "Authenticated can read lab alerts" ON public.exames_lab_alerta_critico;
CREATE POLICY "Authenticated can read lab alerts" ON public.exames_lab_alerta_critico
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.exames_lab_resultado r
    JOIN public.exames_lab_pedido_itens i ON i.id = r.cd_item_pedido
    JOIN public.exames_lab_pedido p ON p.id = i.cd_pedido
    WHERE r.id = cd_resultado AND p.company_id = public.get_my_company_id()
  ));

DROP POLICY IF EXISTS "Lab can manage lab alerts" ON public.exames_lab_alerta_critico;
CREATE POLICY "Lab can manage lab alerts" ON public.exames_lab_alerta_critico
  FOR ALL TO authenticated
  USING (public.is_lab_user(auth.uid()) AND EXISTS (
    SELECT 1
    FROM public.exames_lab_resultado r
    JOIN public.exames_lab_pedido_itens i ON i.id = r.cd_item_pedido
    JOIN public.exames_lab_pedido p ON p.id = i.cd_pedido
    WHERE r.id = cd_resultado AND p.company_id = public.get_my_company_id()
  ))
  WITH CHECK (public.is_lab_user(auth.uid()) AND EXISTS (
    SELECT 1
    FROM public.exames_lab_resultado r
    JOIN public.exames_lab_pedido_itens i ON i.id = r.cd_item_pedido
    JOIN public.exames_lab_pedido p ON p.id = i.cd_pedido
    WHERE r.id = cd_resultado AND p.company_id = public.get_my_company_id()
  ));

COMMIT;


-- =============================================================================
-- Migration: 20260101000029_rls_critical_fixes
-- Descrição: CRÍTICO — Corrige RLS permissiva (USING true) que causava
--            CROSS-TENANT PHI LEAK.
--
--            Tabelas afetadas (LIS + Enfermagem):
--              exames_lab_catalogo          (018_lis:175)
--              exames_lab_valor_referencia (018_lis:187)
--              exames_lab_pedido           (018_lis:197)
--              exames_lab_pedido_itens     (018_lis:208)
--              exames_lab_resultado        (018_lis:218)
--              exames_lab_alerta_critico   (018_lis:228)
--              mnct_classificacao_risco    (016_enfermagem:207)
--              mnct_fluxograma             (016_enfermagem:211)
--
--            Para cada tabela:
--              - Leitura autenticada SEM filtro company_id → restrita à company
--              - Catálogo e valores de referência são PÚBLICOS (read-only)
--                (toda clínica usa TUSS/CBHPM), mas escrita ainda exige admin
--              - Pedidos, itens, resultados e alertas são PHI multi-tenant
-- =============================================================================

-- ============================================================================
-- 1. ENFERMAGEM (migration 016) — classificacao de risco + fluxograma
-- ============================================================================
DO $$
BEGIN
  -- mnct_classificacao_risco: catálogo clínico
  -- Leitura autenticada: livre (referência clínica pública)
  -- Escrita: apenas admin
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated can read mnct_classificacao_risco" ON public.mnct_classificacao_risco';
  EXECUTE 'CREATE POLICY "Authenticated can read mnct_classificacao_risco" ON public.mnct_classificacao_risco FOR SELECT TO authenticated USING (true)';
  EXECUTE 'DROP POLICY IF EXISTS "Admins can manage mnct_classificacao_risco" ON public.mnct_classificacao_risco';
  EXECUTE 'CREATE POLICY "Admins can manage mnct_classificacao_risco" ON public.mnct_classificacao_risco FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()))';

  -- mnct_fluxograma: fluxograma de decisão
  -- Mesmo padrão: leitura livre, escrita só admin
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated can read mnct_fluxograma" ON public.mnct_fluxograma';
  EXECUTE 'CREATE POLICY "Authenticated can read mnct_fluxograma" ON public.mnct_fluxograma FOR SELECT TO authenticated USING (true)';
  EXECUTE 'DROP POLICY IF EXISTS "Admins can manage mnct_fluxograma" ON public.mnct_fluxograma';
  EXECUTE 'CREATE POLICY "Admins can manage mnct_fluxograma" ON public.mnct_fluxograma FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()))';
END $$;

-- ============================================================================
-- 2. LIS — Catálogo e valores de referência (leitura pública, escrita restrita)
-- ============================================================================
DO $$
BEGIN
  -- exames_lab_catalogo: tabela de exames (TUSS/CBHPM, compartilhada)
  -- Leitura: autenticado (referência clínica)
  -- Escrita: admin ou lab_user
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated can read lab catalog" ON public.exames_lab_catalogo';
  EXECUTE 'CREATE POLICY "Authenticated can read lab catalog" ON public.exames_lab_catalogo FOR SELECT TO authenticated USING (true)';
  -- A policy "Lab can manage exam catalog" já existe e está OK (filtra por company)

  -- exames_lab_valor_referencia: valores de referência dos exames
  -- Leitura: autenticado (público)
  -- Escrita: já é restrita a lab_user
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated can read lab ref values" ON public.exames_lab_valor_referencia';
  EXECUTE 'CREATE POLICY "Authenticated can read lab ref values" ON public.exames_lab_valor_referencia FOR SELECT TO authenticated USING (true)';
END $$;

-- ============================================================================
-- 3. LIS — Pedidos, itens, resultados e alertas (PHI MULTI-TENANT)
--    ESSES são os críticos. Cada tenant só vê o seu.
-- ============================================================================
DO $$
BEGIN
  -- exames_lab_pedido
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated can read lab orders" ON public.exames_lab_pedido';
  EXECUTE 'CREATE POLICY "Authenticated can read lab orders" ON public.exames_lab_pedido FOR SELECT TO authenticated USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()))';

  -- exames_lab_pedido_itens (verifica company_id via pedido)
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated can read lab order items" ON public.exames_lab_pedido_itens';
  EXECUTE 'CREATE POLICY "Authenticated can read lab order items" ON public.exames_lab_pedido_itens FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.exames_lab_pedido p WHERE p.id = cd_pedido AND p.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())))';

  -- exames_lab_resultado (resultado -> item -> pedido -> company)
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated can read lab results" ON public.exames_lab_resultado';
  EXECUTE 'CREATE POLICY "Authenticated can read lab results" ON public.exames_lab_resultado FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.exames_lab_pedido p JOIN public.exames_lab_pedido_itens i ON i.cd_pedido = p.id WHERE i.id = cd_item_pedido AND p.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())))';

  -- exames_lab_alerta_critico (PHI crítico — alerta de resultado fora de faixa)
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated can read lab alerts" ON public.exames_lab_alerta_critico';
  EXECUTE 'CREATE POLICY "Authenticated can read lab alerts" ON public.exames_lab_alerta_critico FOR SELECT TO authenticated USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()))';
END $$;

-- ============================================================================
-- 4. pre_cadastro — Remove WITH CHECK(true) em INSERT anônimo
--    Migration 011:439 permitia qualquer um inserir leads
-- ============================================================================
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "pre_cadastro_anon_insert" ON public.pre_cadastro';
  -- Anônimos só podem criar (INSERT), nunca ler/editar
  EXECUTE 'CREATE POLICY "pre_cadastro_anon_insert" ON public.pre_cadastro FOR INSERT TO anon, authenticated WITH CHECK (length(nm_paciente) >= 3 AND length(nr_cpf) IN (11, 14) AND length(ds_email) >= 5 AND ds_email LIKE ''%@%'')';
  -- Leitura/edit restrito a admin
  EXECUTE 'DROP POLICY IF EXISTS "Admins can manage pre_cadastro" ON public.pre_cadastro';
  EXECUTE 'CREATE POLICY "Admins can manage pre_cadastro" ON public.pre_cadastro FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()))';
END $$;

-- ============================================================================
-- 5. CONSENTIMENTOS LGPD — Remove "OR auth.uid() IS NOT NULL" permissivo
--    Migration 006 permitia qualquer user autenticado inserir consentimento
--    em nome de qualquer paciente.
-- ============================================================================
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "consent_insert_patient_or_admin" ON public.paciente_consentimentos';
  -- Só admin pode inserir/atualizar consentimentos em nome de pacientes
  EXECUTE 'CREATE POLICY "consent_insert_admin_only" ON public.paciente_consentimentos FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()))';
  EXECUTE 'DROP POLICY IF EXISTS "consent_update_admin_only" ON public.paciente_consentimentos';
  EXECUTE 'CREATE POLICY "consent_update_admin_only" ON public.paciente_consentimentos FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()))';
  -- Leitura restrita à company
  EXECUTE 'DROP POLICY IF EXISTS "consent_select_company" ON public.paciente_consentimentos';
  EXECUTE 'CREATE POLICY "consent_select_company" ON public.paciente_consentimentos FOR SELECT TO authenticated USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()))';
END $$;

COMMENT ON POLICY "Authenticated can read lab orders" ON public.exames_lab_pedido
  IS 'CRÍTICO: filtra por company_id para evitar cross-tenant PHI leak (migration 029)';
COMMENT ON POLICY "Authenticated can read lab results" ON public.exames_lab_resultado
  IS 'CRÍTICO: filtra por company_id via pedido (migration 029)';
COMMENT ON POLICY "Authenticated can read lab alerts" ON public.exames_lab_alerta_critico
  IS 'CRÍTICO: filtra por company_id — alertas de resultados críticos são PHI (migration 029)';
COMMENT ON POLICY "pre_cadastro_anon_insert" ON public.pre_cadastro
  IS 'CRÍTICO: valida formato mínimo de CPF, email e nome (migration 029)';
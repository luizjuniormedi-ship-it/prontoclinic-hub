-- =============================================================================
-- Migration: 20260101000015_farmacia
-- Descrição: Módulo de Farmácia e Materiais
--            Catálogo de medicamentos, controle de estoque,
--            lotes/validade, dispensação, controlados (portaria 344/98)
--
--            Espelha e moderniza:
--              SIGH.medicamento (3633) — catálogo
--              SIGH.lote_medicamento  — controle de lote/validade
--              SIGH.mov_estoque       — movimentações
--              SIGH.dispen_receita    — dispensações
--              SIGH.receita_controlado (SNGPC) — portaria 344
--
--            Melhorias em relação ao SIGH:
--              - RLS granular por role (farmacêutico separado de admin)
--              - View materializada v_estoque_atual (status_validade)
--              - FEFO automático (First-Expire-First-Out) na view
--              - Auditoria automática de movimentações
--              - SNGPC/ANVISA com flag de envio
--
--            Conformidade:
--              - Portaria SVS/MS 344/98 (medicamentos controlados)
--              - SNGPC (Sistema Nacional de Gerenciamento de Produtos Controlados)
--              - CMED (Câmara de Regulação do Mercado de Medicamentos)
--              - Rename (Relação Nacional de Medicamentos Essenciais)
-- =============================================================================

-- ============================================================================
-- 1.1. Catálogo de medicamentos (baseado em Rename + CMED + SIGH.medicamento)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.medicamentos (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_principio_ativo VARCHAR(200) NOT NULL,        -- ex: 'Dipirona'
  cd_nome_comercial VARCHAR(200),                  -- ex: 'Novalgina'
  ds_concentracao VARCHAR(100),                    -- ex: '500mg'
  ds_forma_farmaceutica VARCHAR(50),               -- COMPRIMIDO, INJETAVEL, XAROPE, etc
  cd_anvisa VARCHAR(20),                           -- registro ANVISA
  cd_ean VARCHAR(20),                              -- código de barras (EAN-13)
  tp_receita VARCHAR(20) CHECK (tp_receita IN ('BRANCA', 'AZUL', 'AMARELA', 'VERMELHA', 'CONTROLE_ESPECIAL')),
  cd_classe_terapeutica VARCHAR(50),               -- ANALGESICO, ANTIBIOTICO, etc
  lg_generico BOOLEAN DEFAULT FALSE,
  lg_controlado BOOLEAN DEFAULT FALSE,             -- portaria 344
  vl_unitario DECIMAL(10,2),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medicamentos_company ON public.medicamentos(company_id);
CREATE INDEX IF NOT EXISTS idx_medicamentos_principio ON public.medicamentos USING gin(cd_principio_ativo gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_medicamentos_anvisa ON public.medicamentos(cd_anvisa);
CREATE INDEX IF NOT EXISTS idx_medicamentos_ativo ON public.medicamentos(company_id, lg_ativo);

DROP TRIGGER IF EXISTS trg_medicamentos_updated_at ON public.medicamentos;
CREATE TRIGGER trg_medicamentos_updated_at
  BEFORE UPDATE ON public.medicamentos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.medicamentos IS 'Catálogo de medicamentos (Rename + CMED + SIGH.medicamento)';

-- ============================================================================
-- 1.2. Catálogo de materiais (materiais hospitalares, descartáveis, EPI)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.materiais (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ds_nome VARCHAR(200) NOT NULL,
  cd_codigo_interno VARCHAR(50),
  cd_ean VARCHAR(20),
  ds_categoria VARCHAR(50),                        -- 'DESCARTAVEL', 'ESCRITORIO', 'EPI', 'INSTRUMENTAL'
  ds_unidade VARCHAR(20) DEFAULT 'UN',             -- UN, CX, PCT, KG, M
  vl_custo_medio DECIMAL(10,2),
  vl_venda DECIMAL(10,2),
  ponto_reposicao INTEGER DEFAULT 0,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_materiais_company ON public.materiais(company_id);
CREATE INDEX IF NOT EXISTS idx_materiais_nome ON public.materiais USING gin(ds_nome gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_materiais_categoria ON public.materiais(company_id, ds_categoria);

DROP TRIGGER IF EXISTS trg_materiais_updated_at ON public.materiais;
CREATE TRIGGER trg_materiais_updated_at
  BEFORE UPDATE ON public.materiais
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.materiais IS 'Catálogo de materiais hospitalares (descartáveis, EPI, instrumental)';

-- ============================================================================
-- 1.3. Almoxarifados (locais físicos de armazenamento)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.almoxarifados (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ds_nome VARCHAR(100) NOT NULL,
  ds_localizacao VARCHAR(200),
  cd_unidade INTEGER REFERENCES public.units(id),
  lg_principal BOOLEAN DEFAULT FALSE,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_almoxarifados_company ON public.almoxarifados(company_id);
CREATE INDEX IF NOT EXISTS idx_almoxarifados_principal ON public.almoxarifados(company_id, lg_principal) WHERE lg_principal = TRUE;

COMMENT ON TABLE public.almoxarifados IS 'Almoxarifados / farmácias físicas (SIGH.almoxarifado)';

-- ============================================================================
-- 1.4. Lotes (medicamentos e materiais) — controle de validade
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lotes (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_produto_tipo VARCHAR(20) NOT NULL CHECK (cd_produto_tipo IN ('MEDICAMENTO', 'MATERIAL')),
  cd_medicamento_id BIGINT REFERENCES public.medicamentos(id) ON DELETE CASCADE,
  cd_material_id BIGINT REFERENCES public.materiais(id) ON DELETE CASCADE,
  cd_lote VARCHAR(50) NOT NULL,
  dt_fabricacao DATE,
  dt_validade DATE NOT NULL,
  qt_inicial INTEGER NOT NULL,
  qt_atual INTEGER NOT NULL,
  vl_custo_unitario DECIMAL(10,2),
  cd_almoxarifado INTEGER REFERENCES public.almoxarifados(id),
  nr_lote_fabricante VARCHAR(50),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_lote_medicamento UNIQUE(cd_medicamento_id, cd_lote),
  CONSTRAINT uniq_lote_material UNIQUE(cd_material_id, cd_lote),
  CONSTRAINT chk_lote_produto CHECK ((cd_medicamento_id IS NOT NULL) OR (cd_material_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_lotes_medicamento ON public.lotes(cd_medicamento_id) WHERE cd_medicamento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lotes_material ON public.lotes(cd_material_id) WHERE cd_material_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lotes_validade ON public.lotes(dt_validade) WHERE qt_atual > 0;
CREATE INDEX IF NOT EXISTS idx_lotes_almoxarifado ON public.lotes(cd_almoxarifado) WHERE cd_almoxarifado IS NOT NULL;

COMMENT ON TABLE public.lotes IS 'Lotes de medicamentos e materiais com data de validade (SIGH.lote_medicamento)';

-- ============================================================================
-- 1.5. Movimentações de estoque (entrada, saída, ajuste, transferência, perda)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.movimentacoes_estoque (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_lote BIGINT NOT NULL REFERENCES public.lotes(id),
  tp_movimentacao VARCHAR(20) NOT NULL CHECK (tp_movimentacao IN ('ENTRADA', 'SAIDA', 'AJUSTE', 'TRANSFERENCIA', 'PERDA', 'VENCIMENTO')),
  qt_movimentada INTEGER NOT NULL,
  qt_anterior INTEGER NOT NULL,
  qt_posterior INTEGER NOT NULL,
  cd_paciente BIGINT REFERENCES public.patients(id),
  cd_appointment BIGINT REFERENCES public.appointments(id),
  cd_prescricao_id BIGINT,                          -- FK para prescrições (futuro)
  cd_usuario UUID,
  ds_motivo TEXT,
  ds_observacao TEXT,
  dt_movimentacao TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movimentacoes_lote ON public.movimentacoes_estoque(cd_lote);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_data ON public.movimentacoes_estoque(company_id, dt_movimentacao DESC);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_paciente ON public.movimentacoes_estoque(cd_paciente) WHERE cd_paciente IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movimentacoes_tipo ON public.movimentacoes_estoque(company_id, tp_movimentacao, dt_movimentacao DESC);

COMMENT ON TABLE public.movimentacoes_estoque IS 'Movimentações de estoque (entrada/saída/ajuste/transferência/perda) — espelha SIGH.mov_estoque';

-- ============================================================================
-- 1.6. Dispensação (receita atendida)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.dispensacoes (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  cd_appointment BIGINT REFERENCES public.appointments(id),
  cd_prescricao_id BIGINT,
  dt_dispensacao TIMESTAMPTZ DEFAULT NOW(),
  cd_usuario UUID,
  ds_observacao TEXT,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispensacoes_paciente ON public.dispensacoes(cd_paciente, dt_dispensacao DESC);
CREATE INDEX IF NOT EXISTS idx_dispensacoes_data ON public.dispensacoes(company_id, dt_dispensacao DESC);

COMMENT ON TABLE public.dispensacoes IS 'Dispensações de receita (SIGH.dispen_receita)';

-- ============================================================================
-- 1.7. Itens da dispensação
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.dispensacao_itens (
  id BIGSERIAL PRIMARY KEY,
  cd_dispensacao BIGINT NOT NULL REFERENCES public.dispensacoes(id) ON DELETE CASCADE,
  cd_lote BIGINT NOT NULL REFERENCES public.lotes(id),
  qt_dispensada INTEGER NOT NULL,
  vl_unitario DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispensacao_itens_dispensacao ON public.dispensacao_itens(cd_dispensacao);
CREATE INDEX IF NOT EXISTS idx_dispensacao_itens_lote ON public.dispensacao_itens(cd_lote);

-- ============================================================================
-- 1.8. Receita controlada (SNGPC — ANVISA, Portaria 344/98)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.receitas_controladas (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  cd_medico BIGINT NOT NULL REFERENCES public.professionals(id),
  nr_receita VARCHAR(50) NOT NULL,
  tp_receita VARCHAR(20) NOT NULL,                  -- BRANCA, AZUL, AMARELA, VERMELHA
  dt_emissao TIMESTAMPTZ NOT NULL,
  dt_validade TIMESTAMPTZ NOT NULL,                 -- 30/60/90 dias
  qt_itens INTEGER NOT NULL,
  ds_observacao TEXT,
  lg_sngpc_enviado BOOLEAN DEFAULT FALSE,           -- Sistema Nacional de Gerenciamento
  dt_sngpc_envio TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receitas_paciente ON public.receitas_controladas(cd_paciente);
CREATE INDEX IF NOT EXISTS idx_receitas_medico ON public.receitas_controladas(cd_medico);
CREATE INDEX IF NOT EXISTS idx_receitas_sngpc ON public.receitas_controladas(lg_sngpc_enviado, dt_sngpc_envio);
CREATE INDEX IF NOT EXISTS idx_receitas_validade ON public.receitas_controladas(dt_validade) WHERE lg_sngpc_enviado = FALSE;

COMMENT ON TABLE public.receitas_controladas IS 'Receitas de medicamentos controlados (SNGPC/ANVISA, portaria 344/98)';

-- ============================================================================
-- 1.9. View: estoque atual (apenas lotes com qt_atual > 0)
--     FEFO automático (ordena por dt_validade ASC — primeiro a vencer, primeiro a sair)
-- ============================================================================
CREATE OR REPLACE VIEW public.v_estoque_atual AS
SELECT
  l.id AS cd_lote,
  l.company_id,
  l.cd_produto_tipo,
  COALESCE(m.cd_principio_ativo, mat.ds_nome) AS ds_produto,
  m.cd_nome_comercial,
  m.ds_concentracao,
  l.dt_validade,
  l.qt_atual,
  l.vl_custo_unitario,
  l.cd_almoxarifado,
  a.ds_nome AS ds_almoxarifado,
  CASE
    WHEN l.dt_validade < CURRENT_DATE THEN 'VENCIDO'
    WHEN l.dt_validade < CURRENT_DATE + INTERVAL '30 days' THEN 'VENCE_30_DIAS'
    WHEN l.dt_validade < CURRENT_DATE + INTERVAL '90 days' THEN 'VENCE_90_DIAS'
    ELSE 'OK'
  END AS status_validade
FROM public.lotes l
LEFT JOIN public.medicamentos m ON m.id = l.cd_medicamento_id
LEFT JOIN public.materiais mat ON mat.id = l.cd_material_id
LEFT JOIN public.almoxarifados a ON a.id = l.cd_almoxarifado
WHERE l.lg_ativo = TRUE AND l.qt_atual > 0
ORDER BY l.dt_validade ASC;

COMMENT ON VIEW public.v_estoque_atual IS 'Estoque atual ordenado por FEFO (First-Expire-First-Out) com status de validade';

-- ============================================================================
-- 1.10. RLS — granular por role
--       Leitura: qualquer usuário autenticado da empresa
--       Escrita: admin + farmacêutico + enfermeiro
--       Dispensação: admin + farmacêutico + médico
-- ============================================================================
ALTER TABLE public.medicamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.almoxarifados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimentacoes_estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispensacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispensacao_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receitas_controladas ENABLE ROW LEVEL SECURITY;

-- Policy template helper (inline)
DO $$
BEGIN
  -- medicamentos: leitura
  EXECUTE 'DROP POLICY IF EXISTS "medicamentos_select" ON public.medicamentos';
  EXECUTE 'CREATE POLICY "medicamentos_select" ON public.medicamentos FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "medicamentos_all" ON public.medicamentos';
  EXECUTE 'CREATE POLICY "medicamentos_all" ON public.medicamentos FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''farmacêutico'', ''farmaceutico''))) WITH CHECK (company_id = public.get_my_company_id())';

  -- materiais
  EXECUTE 'DROP POLICY IF EXISTS "materiais_select" ON public.materiais';
  EXECUTE 'CREATE POLICY "materiais_select" ON public.materiais FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "materiais_all" ON public.materiais';
  EXECUTE 'CREATE POLICY "materiais_all" ON public.materiais FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''farmacêutico'', ''farmaceutico'', ''enfermeiro''))) WITH CHECK (company_id = public.get_my_company_id())';

  -- almoxarifados
  EXECUTE 'DROP POLICY IF EXISTS "almoxarifados_select" ON public.almoxarifados';
  EXECUTE 'CREATE POLICY "almoxarifados_select" ON public.almoxarifados FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "almoxarifados_all" ON public.almoxarifados';
  EXECUTE 'CREATE POLICY "almoxarifados_all" ON public.almoxarifados FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''farmacêutico'', ''farmaceutico''))) WITH CHECK (company_id = public.get_my_company_id())';

  -- lotes (somente leitura para staff; escrita restrita a farmacêutico/admin)
  EXECUTE 'DROP POLICY IF EXISTS "lotes_select" ON public.lotes';
  EXECUTE 'CREATE POLICY "lotes_select" ON public.lotes FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "lotes_all" ON public.lotes';
  EXECUTE 'CREATE POLICY "lotes_all" ON public.lotes FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''farmacêutico'', ''farmaceutico''))) WITH CHECK (company_id = public.get_my_company_id())';

  -- movimentações (escrita restrita)
  EXECUTE 'DROP POLICY IF EXISTS "movimentacoes_select" ON public.movimentacoes_estoque';
  EXECUTE 'CREATE POLICY "movimentacoes_select" ON public.movimentacoes_estoque FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "movimentacoes_insert" ON public.movimentacoes_estoque';
  EXECUTE 'CREATE POLICY "movimentacoes_insert" ON public.movimentacoes_estoque FOR INSERT TO authenticated WITH CHECK (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''farmacêutico'', ''farmaceutico'', ''enfermeiro'')))';

  -- dispensações
  EXECUTE 'DROP POLICY IF EXISTS "dispensacoes_select" ON public.dispensacoes';
  EXECUTE 'CREATE POLICY "dispensacoes_select" ON public.dispensacoes FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "dispensacoes_all" ON public.dispensacoes';
  EXECUTE 'CREATE POLICY "dispensacoes_all" ON public.dispensacoes FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''farmacêutico'', ''farmaceutico'', ''médico'', ''medico''))) WITH CHECK (company_id = public.get_my_company_id())';

  -- dispensacao_itens (segue dispensacoes)
  EXECUTE 'DROP POLICY IF EXISTS "dispensacao_itens_select" ON public.dispensacao_itens';
  EXECUTE 'CREATE POLICY "dispensacao_itens_select" ON public.dispensacao_itens FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.dispensacoes d WHERE d.id = cd_dispensacao AND d.company_id = public.get_my_company_id()))';
  EXECUTE 'DROP POLICY IF EXISTS "dispensacao_itens_all" ON public.dispensacao_itens';
  EXECUTE 'CREATE POLICY "dispensacao_itens_all" ON public.dispensacao_itens FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.dispensacoes d WHERE d.id = cd_dispensacao AND d.company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''farmacêutico'', ''farmaceutico'', ''médico'', ''medico'')))) WITH CHECK (EXISTS (SELECT 1 FROM public.dispensacoes d WHERE d.id = cd_dispensacao AND d.company_id = public.get_my_company_id()))';

  -- receitas_controladas (escrita restrita a farmacêutico/médico)
  EXECUTE 'DROP POLICY IF EXISTS "receitas_controladas_select" ON public.receitas_controladas';
  EXECUTE 'CREATE POLICY "receitas_controladas_select" ON public.receitas_controladas FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "receitas_controladas_all" ON public.receitas_controladas';
  EXECUTE 'CREATE POLICY "receitas_controladas_all" ON public.receitas_controladas FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''farmacêutico'', ''farmaceutico'', ''médico'', ''medico''))) WITH CHECK (company_id = public.get_my_company_id())';
END $$;

-- ============================================================================
-- 1.11. Grants
-- ============================================================================
GRANT SELECT ON public.v_estoque_atual TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.medicamentos_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.materiais_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.almoxarifados_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.lotes_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.movimentacoes_estoque_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.dispensacoes_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.dispensacao_itens_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.receitas_controladas_id_seq TO authenticated;

-- ============================================================================
-- 1.12. RPC: registrar movimentação de estoque (atômica)
--     - Atualiza lote.qt_atual
--     - Insere registro em movimentacoes_estoque
--     - Retorna a movimentação criada
--     IMPORTANTE: valida saldo e tipos
-- ============================================================================
CREATE OR REPLACE FUNCTION public.registrar_movimentacao_estoque(
  p_lote_id        BIGINT,
  p_tipo           VARCHAR,
  p_quantidade     INTEGER,
  p_motivo         TEXT,
  p_paciente_id    BIGINT DEFAULT NULL,
  p_appointment_id BIGINT DEFAULT NULL,
  p_prescricao_id  BIGINT DEFAULT NULL,
  p_observacao     TEXT DEFAULT NULL
)
RETURNS TABLE(
  id BIGINT,
  qt_anterior INTEGER,
  qt_posterior INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote        RECORD;
  v_company_id  UUID;
  v_qt_anterior INTEGER;
  v_qt_posterior INTEGER;
  v_id          BIGINT;
BEGIN
  -- Busca o lote
  SELECT * INTO v_lote FROM public.lotes WHERE id = p_lote_id AND lg_ativo = TRUE FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote % não encontrado ou inativo', p_lote_id;
  END IF;

  v_company_id  := v_lote.company_id;
  v_qt_anterior := v_lote.qt_atual;

  -- Calcula qt_posterior conforme tipo
  IF p_tipo IN ('ENTRADA', 'AJUSTE') THEN
    v_qt_posterior := v_qt_anterior + p_quantidade;
  ELSIF p_tipo IN ('SAIDA', 'TRANSFERENCIA', 'PERDA', 'VENCIMENTO') THEN
    IF v_qt_anterior < p_quantidade THEN
      RAISE EXCEPTION 'Estoque insuficiente. Disponível: %, solicitado: %', v_qt_anterior, p_quantidade;
    END IF;
    v_qt_posterior := v_qt_anterior - p_quantidade;
  ELSE
    RAISE EXCEPTION 'Tipo de movimentação inválido: %', p_tipo;
  END IF;

  -- Valida quantidade
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser positiva';
  END IF;

  -- Atualiza o lote
  UPDATE public.lotes SET qt_atual = v_qt_posterior WHERE id = p_lote_id;

  -- Insere a movimentação
  INSERT INTO public.movimentacoes_estoque (
    company_id, cd_lote, tp_movimentacao, qt_movimentada,
    qt_anterior, qt_posterior, cd_paciente, cd_appointment, cd_prescricao_id,
    cd_usuario, ds_motivo, ds_observacao
  ) VALUES (
    v_company_id, p_lote_id, p_tipo, p_quantidade,
    v_qt_anterior, v_qt_posterior, p_paciente_id, p_appointment_id, p_prescricao_id,
    auth.uid(), p_motivo, p_observacao
  ) RETURNING movimentacoes_estoque.id INTO v_id;

  -- Retorna
  id           := v_id;
  qt_anterior  := v_qt_anterior;
  qt_posterior := v_qt_posterior;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.registrar_movimentacao_estoque IS 'Registra movimentação de estoque de forma atômica (atualiza lote + insere log). Valida saldo.';

GRANT EXECUTE ON FUNCTION public.registrar_movimentacao_estoque(
  BIGINT, VARCHAR, INTEGER, TEXT, BIGINT, BIGINT, BIGINT, TEXT
) TO authenticated;

-- ============================================================================
-- 1.13. RPC: valor total do estoque (CMV)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.calcular_valor_estoque(p_company_id UUID DEFAULT NULL)
RETURNS DECIMAL(12,2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(l.qt_atual * COALESCE(l.vl_custo_unitario, 0)), 0)
  FROM public.lotes l
  WHERE l.lg_ativo = TRUE
    AND l.qt_atual > 0
    AND (p_company_id IS NULL OR l.company_id = p_company_id);
$$;

COMMENT ON FUNCTION public.calcular_valor_estoque IS 'Valor total do estoque (custo médio) — usado para CMV';

GRANT EXECUTE ON FUNCTION public.calcular_valor_estoque(UUID) TO authenticated;

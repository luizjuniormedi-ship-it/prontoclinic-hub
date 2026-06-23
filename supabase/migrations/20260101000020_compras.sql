-- =============================================================================
-- Migration: 20260101000020_compras
-- Descrição: Módulo de Compras e Suprimentos
--            Cadastro de fornecedores, cotações comparativas,
--            ordens de compra com aprovação e recebimento.
--
--            Espelha e moderniza:
--              SIGH.fornecedor (1637)         → public.fornecedores
--              SIGH.cotacao / cotacao_item    → public.cotacoes + public.cotacao_itens
--              SIGH.ordem_compra              → public.ordens_compra + public.ordem_compra_itens
--
--            Decisões:
--              - Multi-empresa (RLS por company_id)
--              - Status de OC: PENDENTE → APROVADA → ENVIADA → RECEBIDA
--              - Snapshot do nome do produto na OC (imutável após emissão)
--              - RLS com perfil "compras" específico
-- =============================================================================

-- ============================================================================
-- 1.1. Fornecedores
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.fornecedores (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nm_razao_social VARCHAR(200) NOT NULL,
  nm_fantasia VARCHAR(200),
  cd_cnpj VARCHAR(14) UNIQUE,
  cd_inscricao_estadual VARCHAR(20),
  ds_endereco TEXT,
  cd_cep VARCHAR(10),
  ds_cidade VARCHAR(100),
  ds_uf CHAR(2),
  nr_telefone VARCHAR(20),
  nr_celular VARCHAR(20),
  ds_email VARCHAR(255),
  ds_contato VARCHAR(100),
  tp_fornecedor VARCHAR(30) CHECK (tp_fornecedor IN ('MEDICAMENTOS', 'MATERIAIS', 'EQUIPAMENTOS', 'SERVICOS', 'OUTROS')),
  ds_observacoes TEXT,
  vl_prazo_pagto_dias INTEGER DEFAULT 30,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fornecedores_company ON public.fornecedores(company_id);
CREATE INDEX IF NOT EXISTS idx_fornecedores_cnpj ON public.fornecedores(cd_cnpj);
CREATE INDEX IF NOT EXISTS idx_fornecedores_nome ON public.fornecedores USING gin(nm_razao_social gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_fornecedores_ativo ON public.fornecedores(company_id, lg_ativo);

DROP TRIGGER IF EXISTS trg_fornecedores_updated_at ON public.fornecedores;
CREATE TRIGGER trg_fornecedores_updated_at
  BEFORE UPDATE ON public.fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 1.2. Cotações comparativas
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.cotacoes (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nr_cotacao VARCHAR(50) NOT NULL,
  dt_cotacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dt_validade DATE,
  cd_usuario UUID,
  ds_observacoes TEXT,
  tp_status VARCHAR(20) DEFAULT 'EM_ANDAMENTO' CHECK (tp_status IN ('EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA')),
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cotacoes_company ON public.cotacoes(company_id);
CREATE INDEX IF NOT EXISTS idx_cotacoes_status ON public.cotacoes(company_id, tp_status);

-- ============================================================================
-- 1.3. Itens da cotação (uma linha por fornecedor x produto)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.cotacao_itens (
  id BIGSERIAL PRIMARY KEY,
  cd_cotacao BIGINT NOT NULL REFERENCES public.cotacoes(id) ON DELETE CASCADE,
  cd_fornecedor INTEGER NOT NULL REFERENCES public.fornecedores(id),
  cd_produto_tipo VARCHAR(20) CHECK (cd_produto_tipo IN ('MEDICAMENTO', 'MATERIAL', 'EQUIPAMENTO')),
  cd_medicamento_id BIGINT,
  cd_material_id BIGINT,
  qt_pedida INTEGER NOT NULL CHECK (qt_pedida > 0),
  vl_unitario DECIMAL(10,2) CHECK (vl_unitario >= 0),
  vl_total DECIMAL(12,2) CHECK (vl_total >= 0),
  dt_entrega_prevista DATE,
  ds_observacao TEXT,
  lg_escolhido BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cotacao_itens_cotacao ON public.cotacao_itens(cd_cotacao);
CREATE INDEX IF NOT EXISTS idx_cotacao_itens_fornecedor ON public.cotacao_itens(cd_fornecedor);

-- ============================================================================
-- 1.4. Ordens de Compra
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ordens_compra (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nr_ordem VARCHAR(50) NOT NULL UNIQUE,
  cd_fornecedor INTEGER NOT NULL REFERENCES public.fornecedores(id),
  dt_emissao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dt_previsao_entrega DATE,
  vl_total DECIMAL(12,2) NOT NULL CHECK (vl_total >= 0),
  tp_status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE' CHECK (tp_status IN ('PENDENTE', 'APROVADA', 'ENVIADA', 'RECEBIDA', 'CANCELADA')),
  tp_pagamento VARCHAR(20) CHECK (tp_pagamento IN ('BOLETO', 'PIX', 'CARTAO', 'TRANSFERENCIA', 'DINHEIRO')),
  cd_condicao_pagto VARCHAR(100),
  cd_usuario_solicitante UUID,
  cd_usuario_aprovador UUID,
  ds_observacoes TEXT,
  dt_recebimento TIMESTAMPTZ,
  nr_nota_fiscal VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oc_company_status ON public.ordens_compra(company_id, tp_status);
CREATE INDEX IF NOT EXISTS idx_oc_fornecedor ON public.ordens_compra(cd_fornecedor);
CREATE INDEX IF NOT EXISTS idx_oc_emissao ON public.ordens_compra(company_id, dt_emissao DESC);

DROP TRIGGER IF EXISTS trg_oc_updated_at ON public.ordens_compra;
CREATE TRIGGER trg_oc_updated_at
  BEFORE UPDATE ON public.ordens_compra
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 1.5. Itens da ordem de compra (snapshot do nome do produto)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ordem_compra_itens (
  id BIGSERIAL PRIMARY KEY,
  cd_ordem_compra BIGINT NOT NULL REFERENCES public.ordens_compra(id) ON DELETE CASCADE,
  cd_produto_tipo VARCHAR(20) CHECK (cd_produto_tipo IN ('MEDICAMENTO', 'MATERIAL', 'EQUIPAMENTO')),
  cd_medicamento_id BIGINT,
  cd_material_id BIGINT,
  ds_produto VARCHAR(200) NOT NULL,
  qt_solicitada INTEGER NOT NULL CHECK (qt_solicitada > 0),
  qt_recebida INTEGER DEFAULT 0 CHECK (qt_recebida >= 0),
  vl_unitario DECIMAL(10,2) NOT NULL CHECK (vl_unitario >= 0),
  vl_total DECIMAL(12,2) NOT NULL CHECK (vl_total >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oc_itens_oc ON public.ordem_compra_itens(cd_ordem_compra);

-- ============================================================================
-- 1.6. RLS
-- ============================================================================
ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cotacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cotacao_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordem_compra_itens ENABLE ROW LEVEL SECURITY;

-- Fornecedores: leitura para todos da company; escrita para admin/compras
DROP POLICY IF EXISTS "Users can read fornecedores from their company" ON public.fornecedores;
CREATE POLICY "Users can read fornecedores from their company"
  ON public.fornecedores FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage fornecedores" ON public.fornecedores;
CREATE POLICY "Admins can manage fornecedores"
  ON public.fornecedores FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin', 'compras', 'administrador')))
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

-- Cotações
DROP POLICY IF EXISTS "Users can read cotacoes from their company" ON public.cotacoes;
CREATE POLICY "Users can read cotacoes from their company"
  ON public.cotacoes FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Compras can manage cotacoes" ON public.cotacoes;
CREATE POLICY "Compras can manage cotacoes"
  ON public.cotacoes FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin', 'compras', 'administrador')))
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

-- Cotacao itens: herda da cotação pai via subquery
DROP POLICY IF EXISTS "Users can read cotacao_itens" ON public.cotacao_itens;
CREATE POLICY "Users can read cotacao_itens"
  ON public.cotacao_itens FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cotacoes c
    WHERE c.id = cotacao_itens.cd_cotacao
      AND c.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
  ));

DROP POLICY IF EXISTS "Compras can manage cotacao_itens" ON public.cotacao_itens;
CREATE POLICY "Compras can manage cotacao_itens"
  ON public.cotacao_itens FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cotacoes c
    WHERE c.id = cotacao_itens.cd_cotacao
      AND c.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin', 'compras', 'administrador'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.cotacoes c
    WHERE c.id = cotacao_itens.cd_cotacao
      AND c.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
  ));

-- Ordens de compra
DROP POLICY IF EXISTS "Users can read oc from their company" ON public.ordens_compra;
CREATE POLICY "Users can read oc from their company"
  ON public.ordens_compra FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Compras can manage oc" ON public.ordens_compra;
CREATE POLICY "Compras can manage oc"
  ON public.ordens_compra FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin', 'compras', 'administrativo', 'administrador')))
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

-- OC itens
DROP POLICY IF EXISTS "Users can read oc_itens" ON public.ordem_compra_itens;
CREATE POLICY "Users can read oc_itens"
  ON public.ordem_compra_itens FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ordens_compra oc
    WHERE oc.id = ordem_compra_itens.cd_ordem_compra
      AND oc.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
  ));

DROP POLICY IF EXISTS "Compras can manage oc_itens" ON public.ordem_compra_itens;
CREATE POLICY "Compras can manage oc_itens"
  ON public.ordem_compra_itens FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ordens_compra oc
    WHERE oc.id = ordem_compra_itens.cd_ordem_compra
      AND oc.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin', 'compras', 'administrativo', 'administrador'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ordens_compra oc
    WHERE oc.id = ordem_compra_itens.cd_ordem_compra
      AND oc.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
  ));
-- =============================================================================
-- Migration: 20260101000010_tiss
-- Descrição: Módulo TISS/XML — faturamento eletrônico de convênios
--            Espelha SIGH.xml (544 XMLs) + xml_pagamentos + recurso_de_glosa
--
-- Padrão TISS definido pela ANS (Agência Nacional de Saúde Suplementar)
-- Versão atual: 3.05.00 (componentes: comunicacaoBeneficiario,
--   solicitacaoProcedimento, demonstrativoAnaliseConta, etc)
--
-- Fluxo:
--   1. Gerar XML TISS (consulta/SP-SADT/internacao)
--   2. Enviar via webservice da operadora
--   3. Receber XML de retorno com protocolo
--   4. Operadora processa e devolve demonstrativo (lotes)
--   5. Em caso de glosa: gerar XML de recurso
--   6. Receber pagamento (xml_pagamentos)
-- =============================================================================

-- ============================================================================
-- 2.1. tiss_xml — XMLs TISS gerados/enviados/recebidos
--     Espelha SIGH.xml (544 registros)
--     Status workflow:
--       PENDENTE → ENVIADO → PROCESSADO → (GLOSADO → RECEBIDO | PAGO) | CANCELADO
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tiss_xml (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_fatura BIGINT,
  cd_convenio INTEGER REFERENCES public.insurance_companies(id) ON DELETE SET NULL,
  ds_descricao VARCHAR(255),
  ds_filename VARCHAR(255),
  dt_fatura DATE,
  ds_tipo_guia VARCHAR(50) CHECK (ds_tipo_guia IS NULL OR ds_tipo_guia IN (
    'CONSULTA', 'SP/SADT', 'INTERNACAO', 'HONORARIO', 'ODONTOLOGIA', 'AUXILIAR'
  )),
  cd_lote INTEGER,
  ds_protocolo VARCHAR(50),
  dt_recurso DATE,
  ds_recurso_xml VARCHAR(255),
  ds_protocolo_recurso VARCHAR(50),
  vl_informado DECIMAL(10,2),
  vl_processado DECIMAL(10,2),
  vl_liberado DECIMAL(10,2),
  vl_glosa DECIMAL(10,2),
  bl_xml_enviado TEXT,
  bl_xml_retorno TEXT,
  bl_xml_recurso TEXT,
  ds_hash_envio VARCHAR(64),
  ds_hash_retorno VARCHAR(64),
  ds_versao_tiss VARCHAR(10) DEFAULT '3.05.00',
  tp_ambiente VARCHAR(20) DEFAULT 'HOMOLOGACAO' CHECK (tp_ambiente IN ('HOMOLOGACAO', 'PRODUCAO')),
  status VARCHAR(20) DEFAULT 'PENDENTE' CHECK (status IN (
    'PENDENTE', 'ENVIADO', 'PROCESSADO', 'GLOSADO', 'RECEBIDO', 'PAGO', 'CANCELADO', 'REJEITADO'
  )),
  ds_motivo_rejeicao TEXT,
  lg_deletado BOOLEAN DEFAULT FALSE,
  dt_envio TIMESTAMPTZ,
  dt_retorno TIMESTAMPTZ,
  dt_pagamento DATE,
  cd_user_envio UUID,
  cd_user_recebimento UUID,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The base migration creates a minimal tiss_xml stub for early foreign keys.
-- Complete that stub before indexes/functions so a clean replay is deterministic.
ALTER TABLE public.tiss_xml
  ADD COLUMN IF NOT EXISTS cd_fatura BIGINT,
  ADD COLUMN IF NOT EXISTS cd_convenio INTEGER,
  ADD COLUMN IF NOT EXISTS ds_descricao VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ds_filename VARCHAR(255),
  ADD COLUMN IF NOT EXISTS dt_fatura DATE,
  ADD COLUMN IF NOT EXISTS ds_tipo_guia VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cd_lote INTEGER,
  ADD COLUMN IF NOT EXISTS ds_protocolo VARCHAR(50),
  ADD COLUMN IF NOT EXISTS dt_recurso DATE,
  ADD COLUMN IF NOT EXISTS ds_recurso_xml VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ds_protocolo_recurso VARCHAR(50),
  ADD COLUMN IF NOT EXISTS vl_informado DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS vl_processado DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS vl_liberado DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS vl_glosa DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS bl_xml_enviado TEXT,
  ADD COLUMN IF NOT EXISTS bl_xml_retorno TEXT,
  ADD COLUMN IF NOT EXISTS bl_xml_recurso TEXT,
  ADD COLUMN IF NOT EXISTS ds_hash_envio VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ds_hash_retorno VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ds_versao_tiss VARCHAR(10),
  ADD COLUMN IF NOT EXISTS tp_ambiente VARCHAR(20),
  ADD COLUMN IF NOT EXISTS status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS ds_motivo_rejeicao TEXT,
  ADD COLUMN IF NOT EXISTS lg_deletado BOOLEAN,
  ADD COLUMN IF NOT EXISTS dt_envio TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dt_retorno TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dt_pagamento DATE,
  ADD COLUMN IF NOT EXISTS cd_user_envio UUID,
  ADD COLUMN IF NOT EXISTS cd_user_recebimento UUID,
  ADD COLUMN IF NOT EXISTS cd_origem_sigh INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_tiss_xml_company ON public.tiss_xml(company_id);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_convenio ON public.tiss_xml(cd_convenio);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_status ON public.tiss_xml(company_id, status);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_dt_fatura ON public.tiss_xml(company_id, dt_fatura DESC);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_protocolo ON public.tiss_xml(ds_protocolo);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_lote ON public.tiss_xml(company_id, cd_lote);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_tipo_guia ON public.tiss_xml(company_id, ds_tipo_guia);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_dt_envio ON public.tiss_xml(company_id, dt_envio DESC);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_dt_pagamento ON public.tiss_xml(company_id, dt_pagamento);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_valores ON public.tiss_xml(company_id, vl_informado, vl_liberado, vl_glosa);

COMMENT ON TABLE public.tiss_xml IS 'XMLs TISS de faturamento eletronico (SIGH.xml — 544 registros)';
COMMENT ON COLUMN public.tiss_xml.cd_fatura IS 'FK para fatura/nota (criar ou referenciar bills)';
COMMENT ON COLUMN public.tiss_xml.cd_lote IS 'Numero do lote TISS (1 lote = N guias)';
COMMENT ON COLUMN public.tiss_xml.ds_protocolo IS 'Protocolo de retorno da operadora (cd_protocolo_recurso para recursos)';
COMMENT ON COLUMN public.tiss_xml.vl_informado IS 'Valor total informado na guia';
COMMENT ON COLUMN public.tiss_xml.vl_processado IS 'Valor processado pela operadora';
COMMENT ON COLUMN public.tiss_xml.vl_liberado IS 'Valor liberado para pagamento';
COMMENT ON COLUMN public.tiss_xml.vl_glosa IS 'Valor glosado (vl_informado - vl_liberado)';
COMMENT ON COLUMN public.tiss_xml.cd_origem_sigh IS 'SIGH.xml.cd_xml';

DROP TRIGGER IF EXISTS trg_tiss_xml_updated_at ON public.tiss_xml;
CREATE TRIGGER trg_tiss_xml_updated_at
  BEFORE UPDATE ON public.tiss_xml
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2.2. tiss_glosas — itens glosados por guia
--     Espelha SIGH.recurso_de_glosa (parcial)
--     Cada guia pode ter N glosas, cada uma com codigo TISS padrao
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tiss_glosas (
  id BIGSERIAL PRIMARY KEY,
  cd_tiss_xml BIGINT NOT NULL REFERENCES public.tiss_xml(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_glosa_code VARCHAR(20),
  ds_motivo TEXT,
  vl_glosa DECIMAL(10,2) NOT NULL,
  dt_glosa DATE NOT NULL DEFAULT CURRENT_DATE,
  lg_recurso_enviado BOOLEAN DEFAULT FALSE,
  dt_recurso DATE,
  ds_protocolo_recurso VARCHAR(50),
  bl_xml_recurso TEXT,
  ds_status_recurso VARCHAR(20) DEFAULT 'PENDENTE' CHECK (ds_status_recurso IN (
    'PENDENTE', 'ENVIADO', 'DEFERIDO', 'INDEFERIDO', 'PARCIAL'
  )),
  cd_procedimento_tuss VARCHAR(20),
  cd_executante VARCHAR(50),
  cd_user_registro UUID,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tiss_glosas_xml ON public.tiss_glosas(cd_tiss_xml);
CREATE INDEX idx_tiss_glosas_company ON public.tiss_glosas(company_id);
CREATE INDEX idx_tiss_glosas_status ON public.tiss_glosas(company_id, ds_status_recurso);
CREATE INDEX idx_tiss_glosas_dt ON public.tiss_glosas(company_id, dt_glosa DESC);
CREATE INDEX idx_tiss_glosas_recurso ON public.tiss_glosas(company_id, lg_recurso_enviado);

COMMENT ON TABLE public.tiss_glosas IS 'Glosas por guia TISS (SIGH.recurso_de_glosa)';
COMMENT ON COLUMN public.tiss_glosas.cd_glosa_code IS 'Codigo da glosa TISS padrao ANS (tabela oficial)';
COMMENT ON COLUMN public.tiss_glosas.ds_status_recurso IS 'PENDENTE → ENVIADO → DEFERIDO/INDEFERIDO/PARCIAL';

CREATE TRIGGER trg_tiss_glosas_updated_at
  BEFORE UPDATE ON public.tiss_glosas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2.3. tiss_protocols — endpoints TISS por operadora (homologacao/producao)
--     Configuracao para envio via webservice SOAP ou REST
--     Certificado A1 exigido para comunicacao com a ANS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tiss_protocols (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_convenio INTEGER NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  ds_endpoint VARCHAR(255) NOT NULL,
  ds_versao_tiss VARCHAR(10) DEFAULT '3.05.00',
  tp_ambiente VARCHAR(20) DEFAULT 'HOMOLOGACAO' CHECK (tp_ambiente IN ('HOMOLOGACAO', 'PRODUCAO')),
  cd_certificado_a1_path TEXT,
  ds_certificado_senha TEXT,
  ds_usuario VARCHAR(50),
  ds_senha TEXT,
  lg_active BOOLEAN DEFAULT TRUE,
  ds_observacao TEXT,
  dt_ultimo_teste TIMESTAMPTZ,
  ds_status_teste VARCHAR(20),
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tiss_protocols_company ON public.tiss_protocols(company_id);
CREATE INDEX idx_tiss_protocols_convenio ON public.tiss_protocols(cd_convenio);
CREATE INDEX idx_tiss_protocols_active ON public.tiss_protocols(company_id, lg_active) WHERE lg_active = TRUE;

COMMENT ON TABLE public.tiss_protocols IS 'Endpoints TISS por operadora e ambiente (homologacao/producao)';
COMMENT ON COLUMN public.tiss_protocols.cd_certificado_a1_path IS 'Caminho do certificado A1 (.pfx) - VITE_TISS_CERT_PATH';
COMMENT ON COLUMN public.tiss_protocols.ds_versao_tiss IS 'Versao TISS suportada (padrao: 3.05.00)';

CREATE TRIGGER trg_tiss_protocols_updated_at
  BEFORE UPDATE ON public.tiss_protocols
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2.4. RLS
-- ============================================================================
ALTER TABLE public.tiss_xml ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_glosas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_protocols ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read tiss_xml from their company"
  ON public.tiss_xml FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Financial and admins can manage tiss_xml"
  ON public.tiss_xml FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'financial', 'billing')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can read tiss_glosas from their company"
  ON public.tiss_glosas FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Financial can manage tiss_glosas"
  ON public.tiss_glosas FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'financial', 'billing')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins and financial can manage tiss_protocols"
  ON public.tiss_protocols FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'financial')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can read tiss_protocols from their company"
  ON public.tiss_protocols FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

-- ============================================================================
-- Funcao: estatisticas de faturamento TISS por periodo/operadora
--     Retorna totais para dashboard financeiro
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tiss_get_stats(
  p_company_id UUID,
  p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER
)
RETURNS TABLE (
  cd_convenio INTEGER,
  convenio_name VARCHAR,
  total_guias BIGINT,
  total_enviado DECIMAL,
  total_processado DECIMAL,
  total_liberado DECIMAL,
  total_glosado DECIMAL,
  total_pago DECIMAL,
  taxa_glosa_percent DECIMAL,
  taxa_recebimento_percent DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ic.id,
    ic.name,
    COUNT(t.id)::BIGINT,
    COALESCE(SUM(t.vl_informado), 0),
    COALESCE(SUM(t.vl_processado), 0),
    COALESCE(SUM(t.vl_liberado), 0),
    COALESCE(SUM(t.vl_glosa), 0),
    COALESCE(SUM(CASE WHEN t.status = 'PAGO' THEN t.vl_liberado ELSE 0 END), 0),
    CASE
      WHEN COALESCE(SUM(t.vl_informado), 0) > 0
      THEN ROUND((SUM(t.vl_glosa) / SUM(t.vl_informado)) * 100, 2)
      ELSE 0
    END,
    CASE
      WHEN COALESCE(SUM(t.vl_liberado), 0) > 0
      THEN ROUND((SUM(CASE WHEN t.status = 'PAGO' THEN t.vl_liberado ELSE 0 END) / SUM(t.vl_liberado)) * 100, 2)
      ELSE 0
    END
  FROM public.insurance_companies ic
  LEFT JOIN public.tiss_xml t
    ON t.cd_convenio = ic.id
    AND EXTRACT(YEAR FROM t.dt_fatura) = p_year
    AND t.lg_deletado = FALSE
  WHERE ic.company_id = p_company_id
    AND ic.lg_ativo = TRUE
  GROUP BY ic.id, ic.name
  ORDER BY total_liberado DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION public.tiss_get_stats(UUID, INTEGER) IS 'Estatisticas anuais de faturamento TISS por operadora';

-- ============================================================================
-- View: glosas pendentes de recurso
-- ============================================================================
CREATE OR REPLACE VIEW public.vw_tiss_glosas_pendentes AS
SELECT
  g.id,
  g.company_id,
  g.cd_tiss_xml,
  t.cd_convenio,
  ic.name AS convenio_name,
  t.ds_protocolo,
  t.dt_fatura,
  t.vl_informado,
  t.vl_glosa,
  g.cd_glosa_code,
  g.ds_motivo,
  g.vl_glosa AS vl_glosa_item,
  g.dt_glosa,
  g.lg_recurso_enviado,
  g.ds_status_recurso,
  EXTRACT(DAY FROM NOW() - g.dt_glosa)::INTEGER AS dias_desde_glosa
FROM public.tiss_glosas g
JOIN public.tiss_xml t ON t.id = g.cd_tiss_xml
LEFT JOIN public.insurance_companies ic ON ic.id = t.cd_convenio
WHERE g.ds_status_recurso IN ('PENDENTE', 'ENVIADO')
  AND t.lg_deletado = FALSE;

COMMENT ON VIEW public.vw_tiss_glosas_pendentes IS 'Glosas aguardando recurso ou em tramitacao';

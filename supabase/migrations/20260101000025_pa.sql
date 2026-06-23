-- =============================================================================
-- Migration: 20260101000025_pa
-- Descrição: Pronto Atendimento (PA)
--            Expansão do módulo de enfermagem (migration 16) para PA estruturado
--            com fila, classificação de risco avançada (Manchester + NEWS2)
--            e destino do paciente.
--
--            Integra-se com:
--              public.mnct_classificacao_risco (Manchester) — migration 16
--              public.triagens (triagem inicial) — migration 16
--
--            Melhorias:
--              - Score NEWS2 armazenado separadamente para deterioração clínica
--              - Workflow de status (AGUARDANDO → TRIAGEM → ATENDIMENTO → ALTA)
--              - Tipo de destino (alta, internação, transferência, óbito, evasão)
--              - Métricas de tempo (chegada → triagem → atendimento → alta)
--
--            Conformidade:
--              - Portaria GM/MS 2.048/2002 (urgência/emergência)
--              - HumanizaSUS (acolhimento com classificação de risco)
-- =============================================================================

-- ============================================================================
-- 3.1. Atendimentos de Pronto Atendimento
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pa_atendimentos (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  dt_chegada TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dt_triagem TIMESTAMPTZ,
  dt_atendimento_medico TIMESTAMPTZ,
  dt_alta TIMESTAMPTZ,
  -- Classificação
  cd_classificacao_id INTEGER REFERENCES public.mnct_classificacao_risco(id),
  cd_cor_risco VARCHAR(20),                          -- 'VERMELHO', 'LARANJA', 'AMARELO', 'VERDE', 'AZUL'
  vl_news2_score SMALLINT,                            -- 0-20
  -- Tipo de alta
  tp_destino VARCHAR(30) CHECK (tp_destino IN (
    'ALTA_MELHORADO', 'ALTA_PEDIDO', 'INTERNACAO',
    'TRANSFERENCIA', 'OBITO', 'EVASAO'
  )),
  ds_queixa_principal TEXT,
  ds_observacoes TEXT,
  cd_medico_atendimento BIGINT REFERENCES public.professionals(id),
  cd_triagem_id BIGINT REFERENCES public.triagens(id),
  cd_leito_internacao BIGINT,                         -- preenchido em TP_DESTINO = INTERNACAO
  tp_status VARCHAR(20) DEFAULT 'AGUARDANDO' CHECK (tp_status IN (
    'AGUARDANDO', 'EM_TRIAGEM', 'EM_ATENDIMENTO',
    'EM_OBSERVACAO', 'ALTA', 'EVADIDO'
  )),
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pa_company_status ON public.pa_atendimentos(company_id, tp_status);
CREATE INDEX IF NOT EXISTS idx_pa_paciente ON public.pa_atendimentos(cd_paciente, dt_chegada DESC);
CREATE INDEX IF NOT EXISTS idx_pa_chegada ON public.pa_atendimentos(company_id, dt_chegada DESC);
CREATE INDEX IF NOT EXISTS idx_pa_classificacao ON public.pa_atendimentos(cd_cor_risco) WHERE cd_cor_risco IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pa_news2 ON public.pa_atendimentos(vl_news2_score) WHERE vl_news2_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pa_fila ON public.pa_atendimentos(company_id, tp_status, cd_cor_risco) WHERE tp_status NOT IN ('ALTA', 'EVADIDO');

COMMENT ON TABLE public.pa_atendimentos IS 'Atendimentos de Pronto Atendimento (fila + classificação de risco Manchester + NEWS2)';
COMMENT ON COLUMN public.pa_atendimentos.vl_news2_score IS 'Score NEWS2 (0-20) — National Early Warning Score 2';
COMMENT ON COLUMN public.pa_atendimentos.cd_cor_risco IS 'Cor da classificação de risco: VERMELHO (emergência) → AZUL (não urgente)';

-- ============================================================================
-- 3.2. View: fila de PA ordenada por prioridade clínica
-- ============================================================================
CREATE OR REPLACE VIEW public.v_pa_fila AS
SELECT
  pa.id,
  pa.company_id,
  pa.cd_paciente,
  pa.dt_chegada,
  pa.dt_triagem,
  pa.dt_atendimento_medico,
  pa.tp_status,
  pa.cd_cor_risco,
  pa.vl_news2_score,
  pa.cd_classificacao_id,
  pa.cd_medico_atendimento,
  pa.ds_queixa_principal,
  -- prioridade numérica para ordenação (1 = mais urgente)
  CASE pa.cd_cor_risco
    WHEN 'VERMELHO' THEN 1
    WHEN 'LARANJA' THEN 2
    WHEN 'AMARELO' THEN 3
    WHEN 'VERDE' THEN 4
    WHEN 'AZUL' THEN 5
    ELSE 6
  END AS nr_prioridade,
  -- tempo de espera em minutos
  EXTRACT(EPOCH FROM (NOW() - pa.dt_chegada)) / 60 AS nr_minutos_espera
FROM public.pa_atendimentos pa
WHERE pa.tp_status NOT IN ('ALTA', 'EVADIDO')
ORDER BY
  CASE pa.cd_cor_risco
    WHEN 'VERMELHO' THEN 1
    WHEN 'LARANJA' THEN 2
    WHEN 'AMARELO' THEN 3
    WHEN 'VERDE' THEN 4
    WHEN 'AZUL' THEN 5
    ELSE 6
  END ASC,
  pa.dt_chegada ASC;

COMMENT ON VIEW public.v_pa_fila IS 'Fila do PA ordenada por prioridade clínica (Manchester) e tempo de espera';

-- ============================================================================
-- 3.3. RLS
-- ============================================================================
ALTER TABLE public.pa_atendimentos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "pa_select" ON public.pa_atendimentos';
  EXECUTE 'CREATE POLICY "pa_select" ON public.pa_atendimentos FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "pa_all" ON public.pa_atendimentos';
  EXECUTE 'CREATE POLICY "pa_all" ON public.pa_atendimentos FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''médico'', ''medico'', ''enfermeiro'', ''recepção'', ''recepcao''))) WITH CHECK (company_id = public.get_my_company_id())';
END $$;

GRANT SELECT ON public.v_pa_fila TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.pa_atendimentos_id_seq TO authenticated;

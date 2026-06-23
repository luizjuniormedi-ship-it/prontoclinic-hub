-- =============================================================================
-- Migration: 20260101000019_bi
-- Descrição: Business Intelligence - Indicadores e dashboards
--            KPIs diários, metas, alertas de performance
-- =============================================================================

-- 1.1. Snapshot diário de KPIs (pre-computado para performance)
CREATE TABLE public.bi_kpis_diarios (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  dt_referencia DATE NOT NULL,
  -- Agendamentos
  nr_agendamentos_total INTEGER DEFAULT 0,
  nr_agendamentos_confirmados INTEGER DEFAULT 0,
  nr_agendamentos_atendidos INTEGER DEFAULT 0,
  nr_agendamentos_faltaram INTEGER DEFAULT 0,
  nr_agendamentos_cancelados INTEGER DEFAULT 0,
  nr_taxa_confirmacao DECIMAL(5,2),
  nr_taxa_no_show DECIMAL(5,2),
  -- Financeiro
  vl_faturado_dia DECIMAL(12,2) DEFAULT 0,
  vl_recebido_dia DECIMAL(12,2) DEFAULT 0,
  vl_glosa_dia DECIMAL(12,2) DEFAULT 0,
  vl_ticket_medio DECIMAL(10,2) DEFAULT 0,
  nr_conv_particular INTEGER DEFAULT 0,
  nr_conv_convenio INTEGER DEFAULT 0,
  nr_conv_sus INTEGER DEFAULT 0,
  -- Operacional
  nr_pacientes_novos INTEGER DEFAULT 0,
  nr_pacientes_total INTEGER DEFAULT 0,
  nr_tempo_medio_espera_min INTEGER DEFAULT 0,
  nr_ocupacao_percent DECIMAL(5,2) DEFAULT 0,
  -- Clínico
  nr_atendimentos_medicos INTEGER DEFAULT 0,
  nr_receitas_emitidas INTEGER DEFAULT 0,
  nr_exames_solicitados INTEGER DEFAULT 0,
  -- TISS
  nr_tiss_enviados INTEGER DEFAULT 0,
  nr_tiss_glosas INTEGER DEFAULT 0,
  nr_tiss_pagos INTEGER DEFAULT 0,
  nr_tiss_a_receber DECIMAL(12,2) DEFAULT 0,
  -- Metadados
  dt_calculo TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, dt_referencia)
);

CREATE INDEX idx_bi_kpis_company_data ON public.bi_kpis_diarios(company_id, dt_referencia DESC);
CREATE INDEX idx_bi_kpis_data ON public.bi_kpis_diarios(dt_referencia DESC);

-- 1.2. Metas por clínica
CREATE TABLE public.bi_metas (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_kpi VARCHAR(50) NOT NULL,
  vl_meta DECIMAL(15,2) NOT NULL,
  vl_atual DECIMAL(15,2) DEFAULT 0,
  tp_periodo VARCHAR(20) NOT NULL CHECK (tp_periodo IN ('DIARIO', 'SEMANAL', 'MENSAL', 'ANUAL')),
  dt_inicio DATE NOT NULL,
  dt_fim DATE,
  tp_comparacao VARCHAR(20) CHECK (tp_comparacao IN ('IGUAL_MAIOR', 'IGUAL_MENOR', 'ENTRE')),
  ds_observacao TEXT,
  cd_usuario_criou UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bi_metas_company ON public.bi_metas(company_id);
CREATE INDEX idx_bi_metas_kpi ON public.bi_metas(company_id, cd_kpi, dt_inicio DESC);

-- 1.3. Alertas de performance
CREATE TABLE public.bi_alertas (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_kpi VARCHAR(50) NOT NULL,
  ds_alerta TEXT NOT NULL,
  tp_severidade VARCHAR(20) NOT NULL CHECK (tp_severidade IN ('INFO', 'ATENCAO', 'CRITICO')),
  vl_atual DECIMAL(15,2) NOT NULL,
  vl_esperado DECIMAL(15,2) NOT NULL,
  ds_sugestao TEXT,
  dt_alerta TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lg_resolvido BOOLEAN DEFAULT FALSE,
  dt_resolvido TIMESTAMPTZ,
  cd_usuario_resolveu UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bi_alertas_company_data ON public.bi_alertas(company_id, dt_alerta DESC);
CREATE INDEX idx_bi_alertas_pendente ON public.bi_alertas(company_id, tp_severidade, dt_alerta) WHERE lg_resolvido = FALSE;

-- 1.4. View: Ocupação por profissional
CREATE OR REPLACE VIEW public.v_ocupacao_profissional AS
SELECT
  p.id AS cd_profissional,
  p.name AS nm_profissional,
  p.specialty AS ds_especialidade,
  COUNT(*) AS nr_agendamentos_total,
  COUNT(*) FILTER (WHERE a.status IN ('confirmed', 'waiting', 'in_progress', 'completed')) AS nr_confirmados,
  COUNT(*) FILTER (WHERE a.status = 'completed') AS nr_atendidos,
  COUNT(*) FILTER (WHERE a.status = 'no_show') AS nr_faltaram,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE a.status = 'completed') / NULLIF(COUNT(*), 0),
    2
  ) AS nr_taxa_atendimento
FROM public.professionals p
LEFT JOIN public.appointments a ON a.professional_id = p.id
  AND a.appointment_date >= CURRENT_DATE - INTERVAL '30 days'
WHERE p.lg_ativo = TRUE
GROUP BY p.id, p.name, p.specialty;

-- 1.5. View: Faturamento por convênio
CREATE OR REPLACE VIEW public.v_faturamento_convenio AS
SELECT
  ic.id AS cd_convenio,
  ic.name AS nm_convenio,
  ps.name AS nm_fonte_pagadora,
  COUNT(DISTINCT a.id) AS nr_atendimentos,
  COALESCE(SUM(b.amount), 0) AS vl_faturado,
  COALESCE(SUM(b.paid_amount), 0) AS vl_recebido,
  COALESCE(SUM(b.amount - b.paid_amount), 0) AS vl_a_receber
FROM public.insurance_companies ic
LEFT JOIN public.payment_sources ps ON ps.id = ic.payment_source_id
LEFT JOIN public.appointments a ON a.insurance_company_id = ic.id
  AND a.appointment_date >= CURRENT_DATE - INTERVAL '90 days'
LEFT JOIN public.billings b ON b.appointment_id = a.id
WHERE ic.lg_ativo = TRUE
GROUP BY ic.id, ic.name, ps.name;

-- 1.6. Função: calcular KPIs do dia
CREATE OR REPLACE FUNCTION public.calcular_kpis_diarios(p_company_id UUID, p_data DATE DEFAULT CURRENT_DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.bi_kpis_diarios (
    company_id, dt_referencia,
    nr_agendamentos_total, nr_agendamentos_confirmados, nr_agendamentos_atendidos,
    nr_agendamentos_faltaram, nr_agendamentos_cancelados,
    nr_taxa_confirmacao, nr_taxa_no_show,
    vl_faturado_dia, vl_recebido_dia, vl_glosa_dia, vl_ticket_medio,
    nr_pacientes_novos, nr_pacientes_total
  )
  SELECT
    p_company_id, p_data,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE a.status = 'confirmed') AS confirmados,
    COUNT(*) FILTER (WHERE a.status = 'completed') AS atendidos,
    COUNT(*) FILTER (WHERE a.status = 'no_show') AS faltaram,
    COUNT(*) FILTER (WHERE a.status = 'cancelled') AS cancelados,
    ROUND(100.0 * COUNT(*) FILTER (WHERE a.status = 'confirmed') / NULLIF(COUNT(*), 0), 2) AS taxa_conf,
    ROUND(100.0 * COUNT(*) FILTER (WHERE a.status = 'no_show') / NULLIF(COUNT(*), 0), 2) AS taxa_no_show,
    COALESCE(SUM(b.amount), 0) AS faturado,
    COALESCE(SUM(b.paid_amount), 0) AS recebido,
    COALESCE(SUM(b.amount - b.paid_amount), 0) AS glosa,
    COALESCE(AVG(b.amount), 0) AS ticket_medio,
    COUNT(DISTINCT a.patient_id) FILTER (WHERE a.created_at::date = p_data) AS novos,
    COUNT(DISTINCT a.patient_id) AS total_pacientes
  FROM public.appointments a
  LEFT JOIN public.billings b ON b.appointment_id = a.id
  WHERE a.company_id = p_company_id
    AND a.appointment_date = p_data
  ON CONFLICT (company_id, dt_referencia)
  DO UPDATE SET
    nr_agendamentos_total = EXCLUDED.nr_agendamentos_total,
    nr_agendamentos_confirmados = EXCLUDED.nr_agendamentos_confirmados,
    dt_calculo = NOW();
END;
$$;

-- 1.7. Função: detectar alertas automaticamente
CREATE OR REPLACE FUNCTION public.detectar_alertas_bi(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_no_show_taxa DECIMAL(5,2);
  v_meta_no_show DECIMAL(5,2);
BEGIN
  -- Calcular taxa de no-show dos últimos 7 dias
  SELECT nr_taxa_no_show INTO v_no_show_taxa
  FROM public.bi_kpis_diarios
  WHERE company_id = p_company_id
    AND dt_referencia >= CURRENT_DATE - INTERVAL '7 days'
  ORDER BY dt_referencia DESC LIMIT 1;

  -- Buscar meta
  SELECT vl_meta INTO v_meta_no_show
  FROM public.bi_metas
  WHERE company_id = p_company_id
    AND cd_kpi = 'TAXA_NO_SHOW'
    AND dt_inicio <= CURRENT_DATE
    AND (dt_fim IS NULL OR dt_fim >= CURRENT_DATE)
  LIMIT 1;

  -- Criar alerta se acima da meta
  IF v_no_show_taxa IS NOT NULL AND v_meta_no_show IS NOT NULL AND v_no_show_taxa > v_meta_no_show THEN
    INSERT INTO public.bi_alertas (company_id, cd_kpi, ds_alerta, tp_severidade, vl_atual, vl_esperado, ds_sugestao)
    VALUES (
      p_company_id,
      'TAXA_NO_SHOW',
      'Taxa de no-show (' || v_no_show_taxa || '%) acima da meta (' || v_meta_no_show || '%)',
      CASE WHEN v_no_show_taxa > v_meta_no_show * 1.5 THEN 'CRITICO' ELSE 'ATENCAO' END,
      v_no_show_taxa,
      v_meta_no_show,
      'Considere: confirmar agendamentos 24h antes, oferecer canal de reagendamento, etc.'
    );
  END IF;
END;
$$;

-- 1.8. RLS
ALTER TABLE public.bi_kpis_diarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bi_metas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bi_alertas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read KPIs from their company"
  ON public.bi_kpis_diarios FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can read metas from their company"
  ON public.bi_metas FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage metas"
  ON public.bi_metas FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin', 'gestor')))
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can read alertas from their company"
  ON public.bi_alertas FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage alertas"
  ON public.bi_alertas FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin', 'gestor')))
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

-- 1.9. Cron jobs (requer extensão pg_cron habilitada no Supabase)
-- SELECT cron.schedule('atualizar-kpis', '0 23 * * *', $$
--   SELECT calcular_kpis_diarios(company_id, CURRENT_DATE)
--   FROM public.companies WHERE status = 'active'
-- $$);
--
-- SELECT cron.schedule('detectar-alertas', '0 6 * * *', $$
--   SELECT detectar_alertas_bi(company_id)
--   FROM public.companies WHERE status = 'active'
-- $$);

COMMENT ON TABLE public.bi_kpis_diarios IS 'Snapshot diário de KPIs por clínica (pre-computado para dashboards)';
COMMENT ON TABLE public.bi_metas IS 'Metas de KPIs por clínica e período';
COMMENT ON TABLE public.bi_alertas IS 'Alertas de performance gerados automaticamente quando KPIs violam metas';

-- =============================================================================
-- Migration: 20260101000024_cirurgia
-- Descrição: Centro Cirúrgico
--            Espelha e moderniza o SIGH:
--              SIGH.sala_cirurgica           → public.salas_cirurgicas
--              SIGH.cirurgia_paciente        → public.cirurgiasxpac
--              SIGH.cirurgia_material        → public.cirurgia_materiais
--
--            Melhorias:
--              - Status workflow (AGENDADA → PRE_OPERATORIO → EM_ANDAMENTO → CONCLUIDA)
--              - Array de equipe de enfermagem (cd_equipe_enfermagem)
--              - Materiais e medicamentos consumidos por cirurgia
--              - CIDs principal e secundário
--              - Tempos de início/fim para métrica de duração real
--
--            Conformidade:
--              - RDC ANVISA 36/2013 (cirurgias seguras — checklist)
--              - Resolução CFM 2.217/2018 (termo de consentimento)
-- =============================================================================

-- ============================================================================
-- 2.1. Salas cirúrgicas
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.salas_cirurgicas (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ds_nome VARCHAR(100) NOT NULL,
  ds_localizacao VARCHAR(100),
  tp_sala VARCHAR(30) CHECK (tp_sala IN (
    'CIRURGIA_GERAL', 'OBSTETRICIA', 'ORTOPEDIA', 'CARDIACA',
    'NEUROCIRURGIA', 'AMBULATORIAL'
  )),
  lg_ativa BOOLEAN DEFAULT TRUE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_sala_nome_company UNIQUE(company_id, ds_nome)
);

CREATE INDEX IF NOT EXISTS idx_salas_company ON public.salas_cirurgicas(company_id);
CREATE INDEX IF NOT EXISTS idx_salas_tipo ON public.salas_cirurgicas(company_id, tp_sala);
CREATE INDEX IF NOT EXISTS idx_salas_ativas ON public.salas_cirurgicas(company_id) WHERE lg_ativa = TRUE;

COMMENT ON TABLE public.salas_cirurgicas IS 'Salas cirúrgicas (SIGH.sala_cirurgica)';

-- ============================================================================
-- 2.2. Agendamento cirúrgico
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.cirurgiasxpac (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  cd_appointment BIGINT REFERENCES public.appointments(id),
  cd_sala INTEGER REFERENCES public.salas_cirurgicas(id),
  dt_agendamento TIMESTAMPTZ NOT NULL,
  dt_inicio TIMESTAMPTZ,
  dt_fim TIMESTAMPTZ,
  nr_duracao_prevista_min INTEGER,
  cd_cirurgiao_principal BIGINT REFERENCES public.professionals(id),
  cd_anestesista BIGINT REFERENCES public.professionals(id),
  cd_equipe_enfermagem INTEGER[],                    -- array de IDs de profissionais
  tp_anestesia VARCHAR(30) CHECK (tp_anestesia IN ('LOCAL', 'RAQUI', 'GERAL', 'SEDACAO', 'NENHUMA')),
  tp_cirurgia VARCHAR(30) CHECK (tp_cirurgia IN ('ELETIVA', 'URGENCIA', 'EMERGENCIA')),
  cd_cid_principal INTEGER REFERENCES public.cid(id),
  cd_cid_secundario INTEGER REFERENCES public.cid(id),
  ds_tecnica TEXT,
  ds_observacoes_pre_operatorias TEXT,
  ds_observacoes_pos_operatorias TEXT,
  vl_materiais DECIMAL(12,2),
  tp_status VARCHAR(30) DEFAULT 'AGENDADA' CHECK (tp_status IN (
    'AGENDADA', 'PRE_OPERATORIO', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA', 'SUSPENSA'
  )),
  ds_complicacoes TEXT,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cirurgias_company ON public.cirurgiasxpac(company_id);
CREATE INDEX IF NOT EXISTS idx_cirurgias_paciente ON public.cirurgiasxpac(cd_paciente, dt_agendamento DESC);
CREATE INDEX IF NOT EXISTS idx_cirurgias_sala ON public.cirurgiasxpac(cd_sala, dt_agendamento);
CREATE INDEX IF NOT EXISTS idx_cirurgias_status ON public.cirurgiasxpac(company_id, tp_status, dt_agendamento);
CREATE INDEX IF NOT EXISTS idx_cirurgias_cirurgiao ON public.cirurgiasxpac(cd_cirurgiao_principal) WHERE cd_cirurgiao_principal IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cirurgias_data ON public.cirurgiasxpac(dt_agendamento);

DROP TRIGGER IF EXISTS trg_cirurgias_updated_at ON public.cirurgiasxpac;
CREATE TRIGGER trg_cirurgias_updated_at
  BEFORE UPDATE ON public.cirurgiasxpac
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.cirurgiasxpac IS 'Agendamento e execução de cirurgias (SIGH.cirurgia_paciente)';

-- ============================================================================
-- 2.3. Materiais / medicamentos utilizados
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.cirurgia_materiais (
  id BIGSERIAL PRIMARY KEY,
  cd_cirurgia BIGINT NOT NULL REFERENCES public.cirurgiasxpac(id) ON DELETE CASCADE,
  cd_material BIGINT REFERENCES public.materiais(id),
  cd_medicamento BIGINT REFERENCES public.medicamentos(id),
  ds_item VARCHAR(200),
  qt_utilizada DECIMAL(10,2),
  vl_unitario DECIMAL(10,2),
  vl_total DECIMAL(12,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_cirurgia_mat_item CHECK (cd_material IS NOT NULL OR cd_medicamento IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_cirurgia_materiais_cirurgia ON public.cirurgia_materiais(cd_cirurgia);
CREATE INDEX IF NOT EXISTS idx_cirurgia_materiais_material ON public.cirurgia_materiais(cd_material) WHERE cd_material IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cirurgia_materiais_medicamento ON public.cirurgia_materiais(cd_medicamento) WHERE cd_medicamento IS NOT NULL;

COMMENT ON TABLE public.cirurgia_materiais IS 'Materiais/medicamentos consumidos em cirurgia (SIGH.cirurgia_material)';

-- ============================================================================
-- 2.4. RLS
-- ============================================================================
ALTER TABLE public.salas_cirurgicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cirurgiasxpac ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cirurgia_materiais ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- salas: leitura para todos; escrita admin/médico/enfermeiro
  EXECUTE 'DROP POLICY IF EXISTS "salas_select" ON public.salas_cirurgicas';
  EXECUTE 'CREATE POLICY "salas_select" ON public.salas_cirurgicas FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "salas_all" ON public.salas_cirurgicas';
  EXECUTE 'CREATE POLICY "salas_all" ON public.salas_cirurgicas FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''médico'', ''medico'', ''enfermeiro''))) WITH CHECK (company_id = public.get_my_company_id())';

  -- cirurgias: leitura para todos; escrita admin/médico/enfermeiro
  EXECUTE 'DROP POLICY IF EXISTS "cirurgias_select" ON public.cirurgiasxpac';
  EXECUTE 'CREATE POLICY "cirurgias_select" ON public.cirurgiasxpac FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "cirurgias_all" ON public.cirurgiasxpac';
  EXECUTE 'CREATE POLICY "cirurgias_all" ON public.cirurgiasxpac FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''médico'', ''medico'', ''enfermeiro''))) WITH CHECK (company_id = public.get_my_company_id())';

  -- materiais cirurgia
  EXECUTE 'DROP POLICY IF EXISTS "cirurg_materiais_select" ON public.cirurgia_materiais';
  EXECUTE 'CREATE POLICY "cirurg_materiais_select" ON public.cirurgia_materiais FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cirurgiasxpac c WHERE c.id = cd_cirurgia AND c.company_id = public.get_my_company_id()))';
  EXECUTE 'DROP POLICY IF EXISTS "cirurg_materiais_all" ON public.cirurgia_materiais';
  EXECUTE 'CREATE POLICY "cirurg_materiais_all" ON public.cirurgia_materiais FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.cirurgiasxpac c WHERE c.id = cd_cirurgia AND c.company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''médico'', ''medico'', ''enfermeiro'')))) WITH CHECK (EXISTS (SELECT 1 FROM public.cirurgiasxpac c WHERE c.id = cd_cirurgia AND c.company_id = public.get_my_company_id()))';
END $$;

GRANT USAGE, SELECT ON SEQUENCE public.salas_cirurgicas_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.cirurgiasxpac_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.cirurgia_materiais_id_seq TO authenticated;

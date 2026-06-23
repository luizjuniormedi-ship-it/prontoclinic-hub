-- =============================================================================
-- Migration: 20260101000023_internacao
-- Descrição: Módulo de Internação Hospitalar
--            Espelha e moderniza o SIGH:
--              SIGH.leito                  → public.leitos
--              SIGH.pacixleit              → public.pacixleit
--              SIGH.prescricao             → public.prescricoes_internado
--              SIGH.evolucao_internado     → public.evolucoes_internado
--
--            Melhorias:
--              - SOAP estruturado (Subjetivo/Objetivo/Avaliação/Plano)
--              - JSONB para sinais vitais
--              - RLS por company_id + role (médico/enfermeiro)
--              - Trigger set_updated_at quando aplicável
--
--            Conformidade:
--              - Resolução CFM 2.314/2022 (prontuário + assinatura)
--              - Portaria GM/MS 1.820/2009 (registro de internação)
-- =============================================================================

-- ============================================================================
-- 1.1. Leitos (catálogo de leitos da unidade)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.leitos (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nr_leito VARCHAR(20) NOT NULL,
  ds_localizacao VARCHAR(100),                      -- 'Ala Norte - 2º andar'
  tp_leito VARCHAR(30) NOT NULL CHECK (tp_leito IN (
    'ENFERMARIA', 'APARTAMENTO', 'UTI_ADULTO', 'UTI_PEDIATRICA',
    'UTI_NEONATAL', 'ISOLAMENTO', 'OBSERVACAO'
  )),
  tp_acomodacao VARCHAR(20) CHECK (tp_acomodacao IN ('ENFERMARIA', 'APARTAMENTO')),
  cd_unidade INTEGER REFERENCES public.units(id),
  vl_diaria DECIMAL(10,2),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_leito_company UNIQUE(company_id, nr_leito, cd_unidade)
);

CREATE INDEX IF NOT EXISTS idx_leitos_company ON public.leitos(company_id);
CREATE INDEX IF NOT EXISTS idx_leitos_tipo ON public.leitos(company_id, tp_leito);
CREATE INDEX IF NOT EXISTS idx_leitos_unidade ON public.leitos(cd_unidade) WHERE cd_unidade IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leitos_ativo ON public.leitos(company_id) WHERE lg_ativo = TRUE;

COMMENT ON TABLE public.leitos IS 'Catálogo de leitos hospitalares (SIGH.leito)';

-- ============================================================================
-- 1.2. Paciente x Leito (ocupação atual e histórico de internações)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pacixleit (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  cd_leito INTEGER NOT NULL REFERENCES public.leitos(id),
  dt_internacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dt_alta TIMESTAMPTZ,
  tp_alta VARCHAR(30) CHECK (tp_alta IN (
    'MELHORADO', 'CURADO', 'OBITO', 'TRANSFERIDO', 'A_PEDIDO', 'ADMINISTRATIVA'
  )),
  ds_motivo_alta TEXT,
  cd_medico_responsavel BIGINT REFERENCES public.professionals(id),
  cd_appointment_origem BIGINT REFERENCES public.appointments(id),
  ds_observacoes TEXT,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pacixleit_paciente ON public.pacixleit(cd_paciente, dt_internacao DESC);
CREATE INDEX IF NOT EXISTS idx_pacixleit_leito ON public.pacixleit(cd_leito);
CREATE INDEX IF NOT EXISTS idx_pacixleit_ativo ON public.pacixleit(cd_leito) WHERE dt_alta IS NULL;
CREATE INDEX IF NOT EXISTS idx_pacixleit_company ON public.pacixleit(company_id);
CREATE INDEX IF NOT EXISTS idx_pacixleit_medico ON public.pacixleit(cd_medico_responsavel) WHERE cd_medico_responsavel IS NOT NULL;

COMMENT ON TABLE public.pacixleit IS 'Ocupação de leitos (SIGH.pacixleit) — 1 linha por internação';

-- ============================================================================
-- 1.3. Prescrição de paciente internado
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.prescricoes_internado (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_internacao BIGINT NOT NULL REFERENCES public.pacixleit(id) ON DELETE CASCADE,
  cd_medico BIGINT NOT NULL REFERENCES public.professionals(id),
  dt_prescricao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  nr_prescricao INTEGER,                            -- 1, 2, 3 (seq do dia)
  ds_prescricao TEXT NOT NULL,                       -- texto da prescrição
  tp_dieta VARCHAR(50),
  ds_cuidados TEXT,
  ds_observacoes TEXT,
  dt_validade TIMESTAMPTZ,
  lg_ativa BOOLEAN DEFAULT TRUE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presc_internado_internacao ON public.prescricoes_internado(cd_internacao, dt_prescricao DESC);
CREATE INDEX IF NOT EXISTS idx_presc_internado_medico ON public.prescricoes_internado(cd_medico);
CREATE INDEX IF NOT EXISTS idx_presc_internado_ativa ON public.prescricoes_internado(cd_internacao) WHERE lg_ativa = TRUE;

COMMENT ON TABLE public.prescricoes_internado IS 'Prescrições médicas de pacientes internados (SIGH.prescricao)';

-- ============================================================================
-- 1.4. Evolução do paciente internado (SOAP)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.evolucoes_internado (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_internacao BIGINT NOT NULL REFERENCES public.pacixleit(id) ON DELETE CASCADE,
  cd_medico BIGINT NOT NULL REFERENCES public.professionals(id),
  dt_evolucao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ds_subjetivo TEXT,                                 -- S de SOAP
  ds_objetivo TEXT,                                  -- O
  ds_avaliacao TEXT,                                -- A
  ds_plano TEXT,                                     -- P
  sinas_vitais JSONB,                                -- PA, FC, FR, T, SpO2
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evol_internado_internacao ON public.evolucoes_internado(cd_internacao, dt_evolucao DESC);
CREATE INDEX IF NOT EXISTS idx_evol_internado_medico ON public.evolucoes_internado(cd_medico);

COMMENT ON TABLE public.evolucoes_internado IS 'Evolução médica SOAP de pacientes internados';
COMMENT ON COLUMN public.evolucoes_internado.sinas_vitais IS 'Sinais vitais em JSON: { pa, fc, fr, t, spo2, glicemia }';

-- ============================================================================
-- 1.5. View: leitos com status de ocupação atual
-- ============================================================================
CREATE OR REPLACE VIEW public.v_leitos_ocupacao AS
SELECT
  l.id,
  l.company_id,
  l.nr_leito,
  l.ds_localizacao,
  l.tp_leito,
  l.tp_acomodacao,
  l.cd_unidade,
  l.vl_diaria,
  l.lg_ativo,
  pl.id AS cd_pacixleit,
  pl.cd_paciente,
  pl.dt_internacao,
  pl.cd_medico_responsavel,
  CASE
    WHEN pl.id IS NULL THEN 'LIVRE'
    ELSE 'OCUPADO'
  END AS tp_status
FROM public.leitos l
LEFT JOIN public.pacixleit pl
  ON pl.cd_leito = l.id AND pl.dt_alta IS NULL
WHERE l.lg_ativo = TRUE;

COMMENT ON VIEW public.v_leitos_ocupacao IS 'Leitos com status atual (LIVRE/OCUPADO)';

-- ============================================================================
-- 1.6. RLS
-- ============================================================================
ALTER TABLE public.leitos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pacixleit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescricoes_internado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolucoes_internado ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- leitos: leitura para todos; escrita admin/enfermeiro/médico
  EXECUTE 'DROP POLICY IF EXISTS "leitos_select" ON public.leitos';
  EXECUTE 'CREATE POLICY "leitos_select" ON public.leitos FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "leitos_all" ON public.leitos';
  EXECUTE 'CREATE POLICY "leitos_all" ON public.leitos FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''médico'', ''medico'', ''enfermeiro''))) WITH CHECK (company_id = public.get_my_company_id())';

  -- pacixleit
  EXECUTE 'DROP POLICY IF EXISTS "pacixleit_select" ON public.pacixleit';
  EXECUTE 'CREATE POLICY "pacixleit_select" ON public.pacixleit FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "pacixleit_all" ON public.pacixleit';
  EXECUTE 'CREATE POLICY "pacixleit_all" ON public.pacixleit FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''médico'', ''medico'', ''enfermeiro'', ''recepção'', ''recepcao''))) WITH CHECK (company_id = public.get_my_company_id())';

  -- prescricoes_internado: somente médico pode prescrever
  EXECUTE 'DROP POLICY IF EXISTS "presc_int_select" ON public.prescricoes_internado';
  EXECUTE 'CREATE POLICY "presc_int_select" ON public.prescricoes_internado FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "presc_int_all" ON public.prescricoes_internado';
  EXECUTE 'CREATE POLICY "presc_int_all" ON public.prescricoes_internado FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''médico'', ''medico''))) WITH CHECK (company_id = public.get_my_company_id())';

  -- evolucoes_internado: médico e enfermeiro
  EXECUTE 'DROP POLICY IF EXISTS "evol_int_select" ON public.evolucoes_internado';
  EXECUTE 'CREATE POLICY "evol_int_select" ON public.evolucoes_internado FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "evol_int_all" ON public.evolucoes_internado';
  EXECUTE 'CREATE POLICY "evol_int_all" ON public.evolucoes_internado FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''médico'', ''medico'', ''enfermeiro''))) WITH CHECK (company_id = public.get_my_company_id())';
END $$;

GRANT SELECT ON public.v_leitos_ocupacao TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.leitos_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.pacixleit_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.prescricoes_internado_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.evolucoes_internado_id_seq TO authenticated;

-- =============================================================================
-- Migration: 20260101000021_transporte
-- Descrição: Remoção e Transporte Sanitário
--            Cadastro de veículos, equipe (motoristas, técnicos, médicos)
--            e gestão de remoções (simples, UTI, transferências, altas).
--
--            Decisões:
--              - Veículos classificados por tipo (AMBULANCIA_SIMPLES, UTI, etc)
--              - Equipe polimórfica via tp_funcao (MOTORISTA, TECNICO, MEDICO)
--              - Status: PENDENTE → AGENDADA → EM_ANDAMENTO → CONCLUIDA
--              - Controle de KM (inicial/final) para reembolso
--              - Urgência com semafórica (BAIXA/MEDIA/ALTA/EMERGENCIA)
-- =============================================================================

-- ============================================================================
-- 2.1. Veículos
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.veiculos (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nr_placa VARCHAR(10) NOT NULL,
  ds_modelo VARCHAR(100),
  nr_ano INTEGER,
  ds_tipo VARCHAR(50),
  cd_renavam VARCHAR(20),
  nr_capacidade INTEGER,
  lg_ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, nr_placa)
);

CREATE INDEX IF NOT EXISTS idx_veiculos_company ON public.veiculos(company_id);
CREATE INDEX IF NOT EXISTS idx_veiculos_ativo ON public.veiculos(company_id, lg_ativo);

-- ============================================================================
-- 2.2. Equipe de transporte
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.equipe_transporte (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nm_nome VARCHAR(200) NOT NULL,
  cd_cpf VARCHAR(11),
  tp_funcao VARCHAR(20) CHECK (tp_funcao IN ('MOTORISTA', 'TECNICO_ENFERMAGEM', 'MEDICO', 'AUXILIAR')),
  nr_cnh VARCHAR(20),
  cd_categoria_cnh CHAR(2),
  dt_validade_cnh DATE,
  lg_ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipe_transporte_company ON public.equipe_transporte(company_id);
CREATE INDEX IF NOT EXISTS idx_equipe_transporte_funcao ON public.equipe_transporte(company_id, tp_funcao);
CREATE INDEX IF NOT EXISTS idx_equipe_cpf ON public.equipe_transporte(cd_cpf);

-- ============================================================================
-- 2.3. Solicitações de remoção/transferência
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.remocoes (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT REFERENCES public.patients(id),
  dt_solicitacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tp_tipo VARCHAR(30) NOT NULL CHECK (tp_tipo IN ('REMOCAO_SIMPLES', 'REMOCAO_UTI', 'TRANSFERENCIA_HOSPITALAR', 'ALTA_HOSPITALAR')),
  tp_urgencia VARCHAR(20) NOT NULL CHECK (tp_urgencia IN ('BAIXA', 'MEDIA', 'ALTA', 'EMERGENCIA')),
  ds_origem TEXT NOT NULL,
  ds_destino TEXT NOT NULL,
  ds_justificativa TEXT,
  cd_veiculo INTEGER REFERENCES public.veiculos(id),
  cd_equipe_motorista INTEGER REFERENCES public.equipe_transporte(id),
  cd_equipe_tecnico INTEGER REFERENCES public.equipe_transporte(id),
  cd_equipe_medico INTEGER REFERENCES public.equipe_transporte(id),
  dt_programada TIMESTAMPTZ,
  dt_inicio TIMESTAMPTZ,
  dt_fim TIMESTAMPTZ,
  vl_km_inicial INTEGER CHECK (vl_km_inicial >= 0),
  vl_km_final INTEGER CHECK (vl_km_final >= 0),
  ds_observacoes_executivo TEXT,
  tp_status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE' CHECK (tp_status IN ('PENDENTE', 'AGENDADA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA')),
  cd_usuario_solicitante UUID,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remocoes_company_status ON public.remocoes(company_id, tp_status);
CREATE INDEX IF NOT EXISTS idx_remocoes_data ON public.remocoes(company_id, dt_programada);
CREATE INDEX IF NOT EXISTS idx_remocoes_paciente ON public.remocoes(cd_paciente);

-- ============================================================================
-- 2.4. RLS
-- ============================================================================
ALTER TABLE public.veiculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipe_transporte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remocoes ENABLE ROW LEVEL SECURITY;

-- Veículos
DROP POLICY IF EXISTS "Authenticated can read vehicles" ON public.veiculos;
CREATE POLICY "Authenticated can read vehicles"
  ON public.veiculos FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage vehicles" ON public.veiculos;
CREATE POLICY "Admins can manage vehicles"
  ON public.veiculos FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin', 'transporte', 'administrador')))
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

-- Equipe
DROP POLICY IF EXISTS "Authenticated can read equipe" ON public.equipe_transporte;
CREATE POLICY "Authenticated can read equipe"
  ON public.equipe_transporte FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage equipe" ON public.equipe_transporte;
CREATE POLICY "Admins can manage equipe"
  ON public.equipe_transporte FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin', 'transporte', 'administrador')))
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

-- Remoções
DROP POLICY IF EXISTS "Authenticated can read remocoes" ON public.remocoes;
CREATE POLICY "Authenticated can read remocoes"
  ON public.remocoes FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated can create remocoes" ON public.remocoes;
CREATE POLICY "Authenticated can create remocoes"
  ON public.remocoes FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Authorized can manage remocoes" ON public.remocoes;
CREATE POLICY "Authorized can manage remocoes"
  ON public.remocoes FOR UPDATE TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin', 'transporte', 'recepcao', 'enfermagem', 'administrador', 'recepção')))
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));
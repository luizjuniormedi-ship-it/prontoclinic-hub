-- =============================================================================
-- Migration: 20260101000016_enfermagem
-- Descrição: Módulo de Enfermagem e Triagem
--            Classificação de risco (Manchester + NEWS2),
--            sinais vitais, antropometria, escore de dor.
--
--            Decisões:
--            - Tabelas prefixadas mnct_ (Manchester Triage) seguem convenção
--              SIGH para permitir migração de dados legados.
--            - company_id em todas as tabelas para multi-tenancy (RLS).
--            - cd_origem_sigh permite preservar IDs do banco legado.
--            - Glasgow total é coluna gerada para evitar inconsistência.
--            - NEWS2 total é coluna gerada para performance de leitura.
--            - Fila de triagem SEPARADA da fila administrativa (recepção).
-- =============================================================================

-- =============================================================================
-- 1.1. Classificações de risco (Manchester)
--      5 cores padronizadas: VERMELHO (emergência), LARANJA (muito urgente),
--      AMARELO (urgente), VERDE (pouco urgente), AZUL (não urgente).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.mnct_classificacao_risco (
  id SERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ds_classificacao VARCHAR(50) NOT NULL UNIQUE,
  cd_cor_hex VARCHAR(7) NOT NULL,
  nr_tempo_max_atendimento_min INTEGER NOT NULL,
  ds_descricao TEXT,
  lg_ativo BOOLEAN DEFAULT TRUE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  public.mnct_classificacao_risco IS 'Classificação de risco Manchester — 5 cores com SLA de atendimento';
COMMENT ON COLUMN public.mnct_classificacao_risco.ds_classificacao IS 'VERMELHO | LARANJA | AMARELO | VERDE | AZUL';
COMMENT ON COLUMN public.mnct_classificacao_risco.nr_tempo_max_atendimento_min IS 'SLA em minutos (0=imediato)';

CREATE INDEX idx_mnct_classificacao_company ON public.mnct_classificacao_risco(company_id) WHERE company_id IS NOT NULL;

-- =============================================================================
-- 1.2. Fluxograma Manchester (perguntas por discriminador)
--      Cada pergunta pertence a um fluxograma (categoria clínica) e possui
--      uma classificação de risco se a resposta for SIM.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.mnct_fluxograma (
  id SERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ds_discriminador VARCHAR(100) NOT NULL,
  ds_pergunta TEXT NOT NULL,
  cd_classificacao_se_sim VARCHAR(20) NOT NULL,
  cd_ordem SMALLINT NOT NULL,
  ds_categoria VARCHAR(50),
  lg_ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.mnct_fluxograma IS 'Perguntas do fluxograma Manchester (discriminadores por sistema)';

CREATE INDEX idx_mnct_fluxograma_company ON public.mnct_fluxograma(company_id) WHERE company_id IS NOT NULL;
CREATE INDEX idx_mnct_fluxograma_ordem ON public.mnct_fluxograma(cd_ordem);

-- =============================================================================
-- 1.3. Triagem (avaliação inicial de enfermagem)
--      Tabela central do módulo. Cada consulta ambulatorial/urgência gera
--      um registro de triagem com sinais vitais, antropometria e Glasgow.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.triagens (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  cd_appointment BIGINT REFERENCES public.appointments(id),
  dt_triagem TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cd_classificacao_id INTEGER REFERENCES public.mnct_classificacao_risco(id),
  cd_usuario_enfermeiro UUID,
  -- Sinais vitais
  vl_pressao_sistolica SMALLINT CHECK (vl_pressao_sistolica BETWEEN 0 AND 300),
  vl_pressao_diastolica SMALLINT CHECK (vl_pressao_diastolica BETWEEN 0 AND 200),
  vl_frequencia_cardiaca SMALLINT CHECK (vl_frequencia_cardiaca BETWEEN 0 AND 250),
  vl_frequencia_respiratoria SMALLINT CHECK (vl_frequencia_respiratoria BETWEEN 0 AND 80),
  vl_temperatura DECIMAL(4,1) CHECK (vl_temperatura BETWEEN 20.0 AND 45.0),
  vl_saturacao_o2 SMALLINT CHECK (vl_saturacao_o2 BETWEEN 0 AND 100),
  vl_glicemia SMALLINT CHECK (vl_glicemia BETWEEN 0 AND 700),
  vl_escala_dor SMALLINT CHECK (vl_escala_dor BETWEEN 0 AND 10),
  -- Antropometria
  vl_peso_kg DECIMAL(5,2) CHECK (vl_peso_kg BETWEEN 0 AND 500),
  vl_altura_cm DECIMAL(5,1) CHECK (vl_altura_cm BETWEEN 0 AND 250),
  -- Glasgow
  vl_glasgow_ocular SMALLINT CHECK (vl_glasgow_ocular BETWEEN 1 AND 4),
  vl_glasgow_verbal SMALLINT CHECK (vl_glasgow_verbal BETWEEN 1 AND 5),
  vl_glasgow_motor SMALLINT CHECK (vl_glasgow_motor BETWEEN 1 AND 6),
  vl_glasgow_total SMALLINT GENERATED ALWAYS AS (
    COALESCE(vl_glasgow_ocular, 0) +
    COALESCE(vl_glasgow_verbal, 0) +
    COALESCE(vl_glasgow_motor, 0)
  ) STORED,
  -- Avaliação clínica
  ds_queixa_principal TEXT,
  ds_historia_doenca_atual TEXT,
  ds_medicamentos_uso TEXT,
  ds_alergias TEXT,
  ds_observacoes_enfermagem TEXT,
  -- Status
  tp_status VARCHAR(20) DEFAULT 'AGUARDANDO' CHECK (tp_status IN ('AGUARDANDO', 'EM_TRIAGEM', 'TRIADO', 'ENCAMINHADO', 'FINALIZADO')),
  dt_encaminhamento TIMESTAMPTZ,
  cd_destino VARCHAR(50),
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  public.triagens IS 'Triagens de enfermagem — avaliação inicial com sinais vitais e Manchester';
COMMENT ON COLUMN public.triagens.vl_escala_dor IS 'Escala visual analógica 0-10 (EVA)';
COMMENT ON COLUMN public.triagens.vl_glasgow_total IS 'Soma gerada (ocular + verbal + motor). Varia 3-15';

CREATE INDEX idx_triagens_company_data    ON public.triagens(company_id, dt_triagem DESC);
CREATE INDEX idx_triagens_paciente        ON public.triagens(cd_paciente, dt_triagem DESC);
CREATE INDEX idx_triagens_classificacao   ON public.triagens(cd_classificacao_id) WHERE cd_classificacao_id IS NOT NULL;
CREATE INDEX idx_triagens_aguardando      ON public.triagens(company_id, dt_triagem) WHERE tp_status = 'AGUARDANDO';
CREATE INDEX idx_triagens_appointment     ON public.triagens(cd_appointment) WHERE cd_appointment IS NOT NULL;

-- =============================================================================
-- 1.4. Perguntas aplicadas no fluxograma (histórico)
--      Armazena o caminho percorrido no fluxograma Manchester para auditoria.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.mnct_fluxoxpergunta (
  id BIGSERIAL PRIMARY KEY,
  cd_triagem BIGINT NOT NULL REFERENCES public.triagens(id) ON DELETE CASCADE,
  cd_fluxograma INTEGER NOT NULL REFERENCES public.mnct_fluxograma(id),
  lg_sim BOOLEAN NOT NULL,
  dt_resposta TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.mnct_fluxoxpergunta IS 'Histórico das perguntas do fluxograma respondidas durante a triagem';

CREATE INDEX idx_fluxoxpergunta_triagem   ON public.mnct_fluxoxpergunta(cd_triagem);
CREATE INDEX idx_fluxoxpergunta_fluxograma ON public.mnct_fluxoxpergunta(cd_fluxograma);

-- =============================================================================
-- 1.5. NEWS2 Score (avaliação de deterioração clínica)
--      National Early Warning Score 2 — padrão internacional NHS.
--      Cada parâmetro fisiológico é pontuado 0-3; score ≥ 7 = alto risco.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.news2_avaliacoes (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_triagem BIGINT NOT NULL REFERENCES public.triagens(id) ON DELETE CASCADE,
  nr_frequencia_respiratoria SMALLINT CHECK (nr_frequencia_respiratoria BETWEEN 0 AND 3),
  nr_saturacao_o2 SMALLINT CHECK (nr_saturacao_o2 BETWEEN 0 AND 3),
  nr_temperatura SMALLINT CHECK (nr_temperatura BETWEEN 0 AND 3),
  nr_pressao_sistolica SMALLINT CHECK (nr_pressao_sistolica BETWEEN 0 AND 3),
  nr_frequencia_cardiaca SMALLINT CHECK (nr_frequencia_cardiaca BETWEEN 0 AND 3),
  nr_nivel_consciencia SMALLINT CHECK (nr_nivel_consciencia BETWEEN 0 AND 3),
  nr_score_total SMALLINT GENERATED ALWAYS AS (
    COALESCE(nr_frequencia_respiratoria, 0) +
    COALESCE(nr_saturacao_o2, 0) +
    COALESCE(nr_temperatura, 0) +
    COALESCE(nr_pressao_sistolica, 0) +
    COALESCE(nr_frequencia_cardiaca, 0) +
    COALESCE(nr_nivel_consciencia, 0)
  ) STORED,
  cd_classificacao_risco VARCHAR(20),
  dt_avaliacao TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  public.news2_avaliacoes IS 'NEWS2 — National Early Warning Score 2 (NHS UK)';
COMMENT ON COLUMN public.news2_avaliacoes.nr_score_total IS 'Score 0-18. 0-4=BAIXO, 5-6=MEDIO (resposta única), 7+=ALTO (resposta emergente)';

CREATE INDEX idx_news2_company ON public.news2_avaliacoes(company_id, dt_avaliacao DESC);
CREATE INDEX idx_news2_triagem ON public.news2_avaliacoes(cd_triagem);

-- =============================================================================
-- 1.6. Fila de Triagem (separada da fila administrativa)
--      Gera senhas sequenciais por dia. Permite chamar e gerenciar visualmente.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.triagem_fila (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  dt_chegada TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dt_chamada TIMESTAMPTZ,
  cd_senha VARCHAR(20) NOT NULL,
  cd_classificacao_id INTEGER REFERENCES public.mnct_classificacao_risco(id),
  tp_status VARCHAR(20) NOT NULL DEFAULT 'AGUARDANDO' CHECK (tp_status IN ('AGUARDANDO', 'CHAMADO', 'EM_TRIAGEM', 'TRIADO', 'DESISTIU')),
  ds_queixa_inicial TEXT,
  cd_cor_hex VARCHAR(7),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.triagem_fila IS 'Fila específica de triagem — senhas sequenciais por dia';
COMMENT ON COLUMN public.triagem_fila.cd_senha IS 'Formato T001, T002, T003... (T de Triagem)';

CREATE INDEX idx_triagem_fila_company_status ON public.triagem_fila(company_id, tp_status);
CREATE INDEX idx_triagem_fila_chegada        ON public.triagem_fila(company_id, dt_chegada);
-- index dropped (DATE() on timestamptz is not immutable in Postgres)

-- =============================================================================
-- 1.7. RLS — Row Level Security
-- =============================================================================
ALTER TABLE public.mnct_classificacao_risco ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mnct_fluxograma           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triagens                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news2_avaliacoes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triagem_fila             ENABLE ROW LEVEL SECURITY;

-- Policies — classificações e fluxograma são leitura global (lookup tables)
DROP POLICY IF EXISTS "Authenticated can read nursing classifications" ON public.mnct_classificacao_risco;
CREATE POLICY "Authenticated can read nursing classifications"
  ON public.mnct_classificacao_risco FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can read flowcharts" ON public.mnct_fluxograma;
CREATE POLICY "Authenticated can read flowcharts"
  ON public.mnct_fluxograma FOR SELECT TO authenticated USING (true);

-- triagens — escopo por company_id via função helper
DROP POLICY IF EXISTS "Users can read triagens from their company" ON public.triagens;
CREATE POLICY "Users can read triagens from their company"
  ON public.triagens FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS "Nursing staff can manage triagens" ON public.triagens;
CREATE POLICY "Nursing staff can manage triagens"
  ON public.triagens FOR ALL TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND lower(coalesce(up.role_name, '')) IN ('admin', 'enfermagem', 'médico', 'medico', 'recepção', 'recepcao')
    )
  )
  WITH CHECK (company_id = public.get_my_company_id());

-- mnct_fluxoxpergunta — herda escopo via triagem
DROP POLICY IF EXISTS "Users can read fluxograma answers" ON public.mnct_fluxoxpergunta;
CREATE POLICY "Users can read fluxograma answers"
  ON public.mnct_fluxoxpergunta FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.triagens t
      WHERE t.id = mnct_fluxoxpergunta.cd_triagem
        AND t.company_id = public.get_my_company_id()
    )
  );

DROP POLICY IF EXISTS "Nursing staff can insert fluxograma answers" ON public.mnct_fluxoxpergunta;
CREATE POLICY "Nursing staff can insert fluxograma answers"
  ON public.mnct_fluxoxpergunta FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.triagens t
      WHERE t.id = mnct_fluxoxpergunta.cd_triagem
        AND t.company_id = public.get_my_company_id()
    )
  );

-- news2_avaliacoes
DROP POLICY IF EXISTS "Users can read news2 from their company" ON public.news2_avaliacoes;
CREATE POLICY "Users can read news2 from their company"
  ON public.news2_avaliacoes FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS "Nursing staff can manage news2" ON public.news2_avaliacoes;
CREATE POLICY "Nursing staff can manage news2"
  ON public.news2_avaliacoes FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

-- triagem_fila
DROP POLICY IF EXISTS "Users can read fila from their company" ON public.triagem_fila;
CREATE POLICY "Users can read fila from their company"
  ON public.triagem_fila FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS "Staff can manage fila" ON public.triagem_fila;
CREATE POLICY "Staff can manage fila"
  ON public.triagem_fila FOR ALL TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND lower(coalesce(up.role_name, '')) IN ('admin', 'enfermagem', 'médico', 'medico', 'recepção', 'recepcao')
    )
  )
  WITH CHECK (company_id = public.get_my_company_id());

-- =============================================================================
-- 1.8. Função: gerar senha sequencial de triagem por dia (T001, T002...)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.gerar_senha_triagem(p_company_id UUID)
RETURNS VARCHAR(20)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
  v_senha VARCHAR(20);
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id é obrigatório';
  END IF;

  SELECT COUNT(*) + 1 INTO v_count
  FROM public.triagem_fila
  WHERE company_id = p_company_id
    AND DATE(dt_chegada AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE;

  v_senha := 'T' || LPAD(v_count::TEXT, 3, '0');
  RETURN v_senha;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gerar_senha_triagem(UUID) TO authenticated;

COMMENT ON FUNCTION public.gerar_senha_triagem(UUID) IS 'Gera próxima senha sequencial (T001, T002...) por empresa no dia corrente';

-- =============================================================================
-- 1.9. Função: classificar Manchester automaticamente
--      Recebe os sinais vitais + queixa principal e retorna a classificação
--      mais grave identificada pelas regras do NEWS2/SpO2/dor.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.classificar_manchester(
  p_pressao_sistolica SMALLINT,
  p_frequencia_cardiaca SMALLINT,
  p_frequencia_respiratoria SMALLINT,
  p_saturacao_o2 SMALLINT,
  p_temperatura DECIMAL,
  p_escala_dor SMALLINT,
  p_queixa_principal TEXT
)
RETURNS VARCHAR(20)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_queixa TEXT;
BEGIN
  v_queixa := lower(coalesce(p_queixa_principal, ''));

  -- VERMELHO: emergência
  IF p_saturacao_o2 IS NOT NULL AND p_saturacao_o2 < 85 THEN
    RETURN 'VERMELHO';
  END IF;
  IF v_queixa LIKE '%dispneia%' OR v_queixa LIKE '%não respira%' OR v_queixa LIKE '%inconsciente%' THEN
    RETURN 'VERMELHO';
  END IF;
  IF p_temperatura IS NOT NULL AND p_temperatura >= 40.0 THEN
    RETURN 'VERMELHO';
  END IF;
  IF p_pressao_sistolica IS NOT NULL AND p_pressao_sistolica < 80 THEN
    RETURN 'VERMELHO';
  END IF;

  -- LARANJA: muito urgente
  IF p_escala_dor IS NOT NULL AND p_escala_dor >= 7 THEN
    RETURN 'LARANJA';
  END IF;
  IF v_queixa LIKE '%dor torácica%' OR v_queixa LIKE '%dor no peito%' OR v_queixa LIKE '%hemorragia%' OR v_queixa LIKE '%sangramento ativo%' THEN
    RETURN 'LARANJA';
  END IF;
  IF p_pressao_sistolica IS NOT NULL AND (p_pressao_sistolica < 90 OR p_pressao_sistolica > 200) THEN
    RETURN 'LARANJA';
  END IF;
  IF p_saturacao_o2 IS NOT NULL AND p_saturacao_o2 < 90 THEN
    RETURN 'LARANJA';
  END IF;

  -- AMARELO: urgente
  IF p_temperatura IS NOT NULL AND p_temperatura >= 39.0 THEN
    RETURN 'AMARELO';
  END IF;
  IF p_escala_dor IS NOT NULL AND p_escala_dor >= 4 THEN
    RETURN 'AMARELO';
  END IF;
  IF p_frequencia_cardiaca IS NOT NULL AND (p_frequencia_cardiaca < 50 OR p_frequencia_cardiaca > 120) THEN
    RETURN 'AMARELO';
  END IF;
  IF v_queixa LIKE '%febre%' OR v_queixa LIKE '%vômito%' OR v_queixa LIKE '%vomito%' THEN
    RETURN 'AMARELO';
  END IF;

  -- VERDE: pouco urgente
  IF p_escala_dor IS NOT NULL AND p_escala_dor >= 1 THEN
    RETURN 'VERDE';
  END IF;

  -- AZUL: não urgente (default)
  RETURN 'AZUL';
END;
$$;

GRANT EXECUTE ON FUNCTION public.classificar_manchester(
  SMALLINT, SMALLINT, SMALLINT, SMALLINT, DECIMAL, SMALLINT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.classificar_manchester IS 'Algoritmo simplificado de classificação Manchester baseado em SSVV + queixa';

-- =============================================================================
-- 1.10. Trigger: registrar cor automaticamente ao inserir na fila
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_triagem_fila_set_cor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cd_cor_hex IS NULL AND NEW.cd_classificacao_id IS NOT NULL THEN
    SELECT cd_cor_hex INTO NEW.cd_cor_hex
    FROM public.mnct_classificacao_risco
    WHERE id = NEW.cd_classificacao_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_triagem_fila_cor ON public.triagem_fila;
CREATE TRIGGER trg_triagem_fila_cor
  BEFORE INSERT OR UPDATE ON public.triagem_fila
  FOR EACH ROW EXECUTE FUNCTION public.trg_triagem_fila_set_cor();

-- =============================================================================
-- Fim da migration 20260101000016_enfermagem
-- =============================================================================

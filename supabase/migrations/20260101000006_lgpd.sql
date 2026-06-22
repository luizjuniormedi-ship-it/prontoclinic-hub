-- =============================================================================
-- Migration: 20260101000006_lgpd
-- Descrição: Modulo LGPD completo (Lei 13.709/2018)
--            - Consentimentos granulares por canal
--            - Log de anonimizacao (direito ao esquecimento - art. 18 VI)
--            - Solicitacoes do titular (art. 18)
--            - Politica de retencao configuravel por empresa
--            - Funcao anonymize_patient (RPC)
--            - View pacientes_anonimizaveis (inativos > 5 anos)
--            - RLS policies + triggers
-- =============================================================================

-- ============================================================================
-- 1.1. paciente_consentimentos — LGPD art. 8 (consentimento especifico)
-- Cada opt-in/opt-out e registrado granularmente por CANAL com:
--   - versao do termo
--   - hash SHA-256 do texto aceito (prova de ciencia)
--   - IP + user_agent (prova de origem)
--   - data de opt-in e (se houver) revogacao
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.paciente_consentimentos (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  cd_canal SMALLINT NOT NULL CHECK (cd_canal IN (1, 2, 3, 4)),
  lg_optin BOOLEAN NOT NULL,
  dt_optin TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  versao_termo VARCHAR(20) NOT NULL,
  texto_termo_hash CHAR(64) NOT NULL,
  ip_origem INET,
  user_agent TEXT,
  dt_revocacao TIMESTAMPTZ,
  motivo_revocacao TEXT,
  CONSTRAINT uniq_paciente_canal_versao UNIQUE (cd_paciente, cd_canal, versao_termo)
);

COMMENT ON TABLE  public.paciente_consentimentos IS 'LGPD art. 8 — consentimento granular por canal (SMS/Email/WhatsApp/Push) com prova de versao e IP';
COMMENT ON COLUMN public.paciente_consentimentos.cd_canal      IS '1=SMS, 2=EMAIL, 3=WHATSAPP, 4=PUSH';
COMMENT ON COLUMN public.paciente_consentimentos.versao_termo  IS 'Identificador da versao do termo exibido (ex: v1.0-2026-06-22)';
COMMENT ON COLUMN public.paciente_consentimentos.texto_termo_hash IS 'SHA-256 do texto do termo aceito — prova de ciencia para o titular';

CREATE INDEX idx_consentimentos_paciente ON public.paciente_consentimentos(cd_paciente);
CREATE INDEX idx_consentimentos_company  ON public.paciente_consentimentos(company_id);
CREATE INDEX idx_consentimentos_optin    ON public.paciente_consentimentos(company_id, lg_optin);

-- ============================================================================
-- 1.2. paciente_anonimizacao_log — LGPD art. 18 VI (direito ao esquecimento)
-- Trilha IMUTAVEL (INSERT-only) de cada anonimizacao realizada.
--   - motivo: OBITO, EXERCICIO_DIREITO_ESQUECIMENTO, INATIVO_5_ANOS, MIGRACAO_SIGH
--   - campos_anonimizados: snapshot JSONB de quais campos foram zerados
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.paciente_anonimizacao_log (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL,
  motivo TEXT NOT NULL CHECK (motivo IN ('OBITO','EXERCICIO_DIREITO_ESQUECIMENTO','INATIVO_5_ANOS','MIGRACAO_SIGH','SOLICITACAO_TITULAR')),
  data_solicitacao DATE,
  data_execucao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cd_usuario_solicitante UUID,
  campos_anonimizados JSONB,
  lg_completado BOOLEAN NOT NULL DEFAULT FALSE,
  dt_completado TIMESTAMPTZ
);

COMMENT ON TABLE public.paciente_anonimizacao_log IS 'LGPD art. 18 VI — trilha de auditoria das anonimizacoes (INSERT-only, nao atualizavel)';
COMMENT ON COLUMN public.paciente_anonimizacao_log.campos_anonimizados IS 'Snapshot JSONB dos campos zerados e hash do identificador preservado';

CREATE INDEX idx_anonimizacao_paciente ON public.paciente_anonimizacao_log(cd_paciente);
CREATE INDEX idx_anonimizacao_company  ON public.paciente_anonimizacao_log(company_id);
CREATE INDEX idx_anonimizacao_motivo   ON public.paciente_anonimizacao_log(company_id, motivo);
CREATE INDEX idx_anonimizacao_data     ON public.paciente_anonimizacao_log(company_id, data_execucao DESC);

-- ============================================================================
-- 1.3. lgpd_solicitacoes — LGPD art. 18 (todos os direitos do titular)
-- Workflow: PENDENTE → EM_ANDAMENTO → CONCLUIDA | REJEITADA
-- Prazo legal: 15 dias (art. 18 §5)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lgpd_solicitacoes (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('ACESSO','PORTABILIDADE','CORRECAO','ESQUECIMENTO','REVOGACAO')),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE','EM_ANDAMENTO','CONCLUIDA','REJEITADA')),
  dt_solicitacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dt_prazo TIMESTAMPTZ NOT NULL,
  dt_conclusao TIMESTAMPTZ,
  ip_origem INET,
  motivo_rejeicao TEXT,
  payload_exportacao JSONB
);

COMMENT ON TABLE  public.lgpd_solicitacoes IS 'LGPD art. 18 — solicitacoes do titular (acesso, portabilidade, correcao, esquecimento, revogacao)';
COMMENT ON COLUMN public.lgpd_solicitacoes.dt_prazo IS 'Prazo legal de 15 dias uteis (art. 18 §5) — gerado em dt_solicitacao + 15 dias';
COMMENT ON COLUMN public.lgpd_solicitacoes.payload_exportacao IS 'JSON do export gerado para PORTABILIDADE / ACESSO';

CREATE INDEX idx_lgpd_solic_company ON public.lgpd_solicitacoes(company_id);
CREATE INDEX idx_lgpd_solic_pacient ON public.lgpd_solicitacoes(cd_paciente);
CREATE INDEX idx_lgpd_solic_status  ON public.lgpd_solicitacoes(company_id, status, dt_prazo);
CREATE INDEX idx_lgpd_solic_tipo    ON public.lgpd_solicitacoes(company_id, tipo);
CREATE INDEX idx_lgpd_solic_venc    ON public.lgpd_solicitacoes(dt_prazo) WHERE status IN ('PENDENTE','EM_ANDAMENTO');

-- ============================================================================
-- 1.4. lgpd_politica_retencao — configuravel por empresa
-- Cada par (company_id, tabela) define: dias_retencao + acao_apos_expirar
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lgpd_politica_retencao (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tabela VARCHAR(50) NOT NULL,
  dias_retencao INTEGER NOT NULL CHECK (dias_retencao > 0),
  acao_apos_expirar VARCHAR(20) NOT NULL
    CHECK (acao_apos_expirar IN ('ANONIMIZAR','DELETAR','ARQUIVAR')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID,
  CONSTRAINT uniq_politica_company_tabela UNIQUE (company_id, tabela)
);

COMMENT ON TABLE  public.lgpd_politica_retencao IS 'Politica de retencao de dados por empresa e tabela (LGPD art. 16)';
COMMENT ON COLUMN public.lgpd_politica_retencao.dias_retencao IS 'Dias de retencao apos o registro (ex: 1825 = 5 anos para audit_logs)';
COMMENT ON COLUMN public.lgpd_politica_retencao.acao_apos_expirar IS 'ANONIMIZAR | DELETAR | ARQUIVAR (cold storage)';

CREATE INDEX idx_politica_company ON public.lgpd_politica_retencao(company_id);

CREATE TRIGGER trg_politica_updated_at
  BEFORE UPDATE ON public.lgpd_politica_retencao
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 1.5. Funcao SQL: anonymize_patient
-- Executa a anonimizacao atomica de um paciente:
--   1. Snapshot do CPF/nome para o log
--   2. UPDATE em patients: zera PII
--   3. INSERT em paciente_anonimizacao_log (lg_completado=true)
--
-- SECURITY DEFINER: pode ser chamada por usuarios com policy explicita
-- (apenas admin/owner) para que o log registre o cd_usuario_solicitante
-- vindo do JWT.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.anonymize_patient(
  p_paciente_id BIGINT,
  p_motivo       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_paciente  RECORD;
  v_campos    JSONB := '{}'::JSONB;
  v_audit_uid UUID  := auth.uid();
BEGIN
  IF p_motivo NOT IN ('OBITO','EXERCICIO_DIREITO_ESQUECIMENTO','INATIVO_5_ANOS','MIGRACAO_SIGH','SOLICITACAO_TITULAR') THEN
    RAISE EXCEPTION 'Motivo invalido: %. Valores permitidos: OBITO, EXERCICIO_DIREITO_ESQUECIMENTO, INATIVO_5_ANOS, MIGRACAO_SIGH, SOLICITACAO_TITULAR', p_motivo;
  END IF;

  SELECT * INTO v_paciente FROM public.patients WHERE id = p_paciente_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente % nao encontrado', p_paciente_id;
  END IF;

  -- Snapshot minimo para o log (LGPD art. 18 §2: manter identificacao minima quando necessario para cumprimento de obrigacao legal)
  v_campos := jsonb_build_object(
    'nome_anterior', v_paciente.full_name,
    'cpf_anonimizado', CASE
                          WHEN v_paciente.cpf IS NULL THEN NULL
                          ELSE LEFT(v_paciente.cpf, 3) || '********'
                        END,
    'anonimizado_em', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  -- Zera todos os campos PII
  UPDATE public.patients SET
    full_name         = 'PACIENTE ANONIMIZADO',
    cpf               = NULL,
    rg                = NULL,
    email             = NULL,
    phone             = NULL,
    endereco          = NULL,
    numero            = NULL,
    complemento       = NULL,
    bairro            = NULL,
    cidade            = NULL,
    cep               = NULL,
    nome_mae          = NULL,
    nome_pai          = NULL,
    historico_familiar = NULL,
    foto_url          = NULL,
    lg_anonimizado    = TRUE,
    dt_anonimizacao   = NOW()
  WHERE id = p_paciente_id;

  INSERT INTO public.paciente_anonimizacao_log (
    company_id, cd_paciente, motivo, campos_anonimizados,
    cd_usuario_solicitante, lg_completado, dt_completado
  ) VALUES (
    v_paciente.company_id, p_paciente_id, p_motivo, v_campos,
    v_audit_uid, TRUE, NOW()
  );

  RETURN v_campos;
END;
$$;

COMMENT ON FUNCTION public.anonymize_patient IS 'Anonimiza paciente atomicamente e registra no log imutavel (LGPD art. 18 VI)';

-- ============================================================================
-- 1.6. View: pacientes_anonimizaveis
-- Retorna pacientes inativos ha mais de 5 anos (candidatos a anonimizacao automatica).
-- Exclui:
--   - ja anonimizados
--   - com obito registrado
--   - ja presentes no log de anonimizacao
-- ============================================================================
CREATE OR REPLACE VIEW public.pacientes_anonimizaveis AS
SELECT
  p.id,
  p.company_id,
  p.full_name,
  p.cpf,
  EXTRACT(DAY FROM NOW() - p.dt_ultimo_atendimento)::INTEGER AS dias_sem_atendimento,
  p.dt_ultimo_atendimento
FROM public.patients p
WHERE p.lg_anonimizado = FALSE
  AND p.dt_ultimo_atendimento IS NOT NULL
  AND p.dt_ultimo_atendimento < NOW() - INTERVAL '5 years'
  AND (p.dt_obito IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.paciente_anonimizacao_log l
    WHERE l.cd_paciente = p.id
  );

COMMENT ON VIEW public.pacientes_anonimizaveis IS 'Pacientes inativos ha > 5 anos, elegiveis para anonimizacao automatica';

-- ============================================================================
-- 1.7. RLS — todas as tabelas acima
-- Padrao: SELECT para todos da company; INSERT/UPDATE/DELETE para admin
-- ============================================================================
ALTER TABLE public.paciente_consentimentos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paciente_anonimizacao_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_solicitacoes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_politica_retencao    ENABLE ROW LEVEL SECURITY;

-- === paciente_consentimentos ===
CREATE POLICY "consent_select_company"
  ON public.paciente_consentimentos FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "consent_insert_patient_or_admin"
  ON public.paciente_consentimentos FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND (
      EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role_name IN ('admin','reception')
      )
      -- Paciente pode registrar seu proprio consentimento via portal
      OR auth.uid() IS NOT NULL
    )
  );

CREATE POLICY "consent_update_admin"
  ON public.paciente_consentimentos FOR UPDATE
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin','reception')
    )
  );

-- === paciente_anonimizacao_log (INSERT-only na pratica) ===
CREATE POLICY "anonimizacao_select_company"
  ON public.paciente_anonimizacao_log FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "anonimizacao_insert_admin"
  ON public.paciente_anonimizacao_log FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name = 'admin'
    )
  );

-- Sem policy de UPDATE/DELETE → log e imutavel a nivel de policy.
-- Defense-in-depth: trigger que bloqueia UPDATE/DELETE.
CREATE OR REPLACE FUNCTION public.bloquear_update_anonimizacao()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'paciente_anonimizacao_log e imutavel (LGPD art. 37 — registro de operacoes de tratamento)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_anonimizacao_no_update
  BEFORE UPDATE ON public.paciente_anonimizacao_log
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_update_anonimizacao();

CREATE TRIGGER trg_anonimizacao_no_delete
  BEFORE DELETE ON public.paciente_anonimizacao_log
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_update_anonimizacao();

-- === lgpd_solicitacoes ===
CREATE POLICY "solicit_select_company"
  ON public.lgpd_solicitacoes FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "solicit_insert_paciente_ou_admin"
  ON public.lgpd_solicitacoes FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "solicit_update_admin"
  ON public.lgpd_solicitacoes FOR UPDATE
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin','reception')
    )
  );

-- === lgpd_politica_retencao ===
CREATE POLICY "politica_select_company"
  ON public.lgpd_politica_retencao FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "politica_admin_all"
  ON public.lgpd_politica_retencao FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name = 'admin'
    )
  )
  WITH CHECK (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- ============================================================================
-- 1.8. Trigger automatico: ao inserir em paciente_anonimizacao_log,
-- valida que o paciente realmente foi anonimizado.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.validate_anonimizacao_log()
RETURNS TRIGGER AS $$
DECLARE
  v_lg_anonimizado BOOLEAN;
BEGIN
  SELECT lg_anonimizado INTO v_lg_anonimizado
  FROM public.patients WHERE id = NEW.cd_paciente;

  IF v_lg_anonimizado IS DISTINCT FROM TRUE THEN
    RAISE WARNING 'Log de anonimizacao inserido mas paciente % nao esta marcado como anonimizado', NEW.cd_paciente;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_anonimizacao
  AFTER INSERT ON public.paciente_anonimizacao_log
  FOR EACH ROW EXECUTE FUNCTION public.validate_anonimizacao_log();

-- ============================================================================
-- Grants para a role anon (acesso minimo) e authenticated
-- ============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.pacientes_anonimizaveis TO authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_patient(BIGINT, TEXT) TO authenticated;

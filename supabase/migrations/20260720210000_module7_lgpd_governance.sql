-- Module 7: LGPD governance and consent lifecycle.
-- Additive compatibility migration for installations where the legacy LGPD
-- tables already exist with a reduced schema. No patient data is deleted.

CREATE TABLE IF NOT EXISTS public.lgpd_termos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  codigo VARCHAR(60) NOT NULL,
  versao VARCHAR(30) NOT NULL,
  titulo VARCHAR(200) NOT NULL,
  texto TEXT NOT NULL,
  texto_hash CHAR(64) NOT NULL,
  finalidade VARCHAR(30) NOT NULL DEFAULT 'CLINICA'
    CHECK (finalidade IN ('CLINICA','MARKETING','WHATSAPP','TELEMEDICINA','COMPARTILHAMENTO')),
  canais SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
  lg_ativo BOOLEAN NOT NULL DEFAULT FALSE,
  publicado_em TIMESTAMPTZ,
  publicado_por UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_lgpd_termo_company_codigo_versao UNIQUE (company_id, codigo, versao)
);

ALTER TABLE public.paciente_consentimentos
  ADD COLUMN IF NOT EXISTS cd_paciente BIGINT,
  ADD COLUMN IF NOT EXISTS cd_canal SMALLINT,
  ADD COLUMN IF NOT EXISTS lg_optin BOOLEAN,
  ADD COLUMN IF NOT EXISTS dt_optin TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS versao_termo VARCHAR(30),
  ADD COLUMN IF NOT EXISTS texto_termo_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS ip_origem INET,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS dt_revocacao TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_revocacao TEXT,
  ADD COLUMN IF NOT EXISTS finalidade VARCHAR(30) DEFAULT 'CLINICA',
  ADD COLUMN IF NOT EXISTS termo_id UUID,
  ADD COLUMN IF NOT EXISTS responsavel_id UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'paciente_consentimentos'
      AND column_name = 'patient_id'
  ) THEN
    EXECUTE 'UPDATE public.paciente_consentimentos SET cd_paciente = patient_id WHERE cd_paciente IS NULL AND patient_id IS NOT NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'paciente_consentimentos'
      AND column_name = 'patient_id'
  ) THEN
    EXECUTE 'UPDATE public.paciente_consentimentos c SET company_id = p.company_id FROM public.patients p WHERE c.company_id IS NULL AND p.id = c.patient_id';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_paciente_consentimentos_finalidade') THEN
    ALTER TABLE public.paciente_consentimentos
      ADD CONSTRAINT ck_paciente_consentimentos_finalidade
      CHECK (finalidade IN ('CLINICA','MARKETING','WHATSAPP','TELEMEDICINA','COMPARTILHAMENTO'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_paciente_consentimentos_termo') THEN
    ALTER TABLE public.paciente_consentimentos
      ADD CONSTRAINT fk_paciente_consentimentos_termo
      FOREIGN KEY (termo_id) REFERENCES public.lgpd_termos(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lgpd_termos_company_active
  ON public.lgpd_termos(company_id, codigo, lg_ativo, publicado_em DESC);
CREATE INDEX IF NOT EXISTS idx_paciente_consentimentos_scope
  ON public.paciente_consentimentos(company_id, cd_paciente, finalidade, cd_canal);

CREATE TABLE IF NOT EXISTS public.lgpd_comunicacoes (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  cd_canal SMALLINT NOT NULL CHECK (cd_canal IN (1,2,3,4)),
  finalidade VARCHAR(30) NOT NULL
    CHECK (finalidade IN ('CLINICA','MARKETING','WHATSAPP','TELEMEDICINA','COMPARTILHAMENTO')),
  consentimento_id BIGINT REFERENCES public.paciente_consentimentos(id) ON DELETE SET NULL,
  provedor VARCHAR(80),
  status VARCHAR(20) NOT NULL DEFAULT 'BLOQUEADA'
    CHECK (status IN ('BLOQUEADA','PENDENTE','ENVIADA','ENTREGUE','FALHOU')),
  motivo_bloqueio TEXT,
  solicitada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enviada_em TIMESTAMPTZ,
  responsavel_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lgpd_comunicacoes_scope
  ON public.lgpd_comunicacoes(company_id, cd_paciente, finalidade, solicitada_em DESC);

CREATE TABLE IF NOT EXISTS public.lgpd_compartilhamentos (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  destinatario VARCHAR(200) NOT NULL,
  finalidade VARCHAR(30) NOT NULL
    CHECK (finalidade IN ('CLINICA','MARKETING','WHATSAPP','TELEMEDICINA','COMPARTILHAMENTO')),
  base_legal VARCHAR(80) NOT NULL,
  consentimento_id BIGINT REFERENCES public.paciente_consentimentos(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'AUTORIZADO'
    CHECK (status IN ('AUTORIZADO','REVOGADO','BLOQUEADO')),
  compartilhado_em TIMESTAMPTZ,
  revogado_em TIMESTAMPTZ,
  responsavel_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lgpd_compartilhamentos_scope
  ON public.lgpd_compartilhamentos(company_id, cd_paciente, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.lgpd_incidentes (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  titulo VARCHAR(200) NOT NULL,
  descricao TEXT NOT NULL,
  severidade VARCHAR(20) NOT NULL DEFAULT 'MEDIA'
    CHECK (severidade IN ('BAIXA','MEDIA','ALTA','CRITICA')),
  status VARCHAR(20) NOT NULL DEFAULT 'ABERTO'
    CHECK (status IN ('ABERTO','CONTIDO','EM_ANALISE','RESOLVIDO','NOTIFICADO')),
  categorias_dados TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  afetados_estimados INTEGER CHECK (afetados_estimados IS NULL OR afetados_estimados >= 0),
  ocorrido_em TIMESTAMPTZ,
  detectado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contido_em TIMESTAMPTZ,
  resolvido_em TIMESTAMPTZ,
  notificado_em TIMESTAMPTZ,
  medidas_contencao TEXT,
  causa_raiz TEXT,
  responsavel_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lgpd_incidentes_scope
  ON public.lgpd_incidentes(company_id, status, severidade, detectado_em DESC);

ALTER TABLE public.lgpd_termos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_comunicacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_compartilhamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_incidentes ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('paciente_consentimentos','lgpd_solicitacoes','lgpd_politica_retencao','lgpd_termos','lgpd_comunicacoes','lgpd_compartilhamentos','lgpd_incidentes')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

CREATE POLICY m7_consent_read ON public.paciente_consentimentos
  FOR SELECT TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id());
CREATE POLICY m7_consent_append ON public.paciente_consentimentos
  FOR INSERT TO app_prontomedic, authenticated
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND public.audit_has_role(ARRAY['admin','dpo','gestor','recepcao','medico','enfermeiro'])
    AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id = cd_paciente AND p.company_id = company_id)
  );

CREATE POLICY m7_terms_read ON public.lgpd_termos
  FOR SELECT TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id());
CREATE POLICY m7_terms_manage ON public.lgpd_termos
  FOR ALL TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo']))
  WITH CHECK (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo']));

CREATE POLICY m7_requests_read ON public.lgpd_solicitacoes
  FOR SELECT TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor','recepcao']));
CREATE POLICY m7_requests_insert ON public.lgpd_solicitacoes
  FOR INSERT TO app_prontomedic, authenticated
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND public.audit_has_role(ARRAY['admin','dpo','gestor','recepcao'])
    AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id = cd_paciente AND p.company_id = company_id)
  );
CREATE POLICY m7_requests_update ON public.lgpd_solicitacoes
  FOR UPDATE TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']))
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id = cd_paciente AND p.company_id = company_id)
  );

CREATE POLICY m7_retention_read ON public.lgpd_politica_retencao
  FOR SELECT TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id());
CREATE POLICY m7_retention_manage ON public.lgpd_politica_retencao
  FOR ALL TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo']))
  WITH CHECK (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo']));

CREATE POLICY m7_communications_read ON public.lgpd_comunicacoes
  FOR SELECT TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor','recepcao']));
CREATE POLICY m7_communications_append ON public.lgpd_comunicacoes
  FOR INSERT TO app_prontomedic, authenticated
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND public.audit_has_role(ARRAY['admin','dpo','gestor','recepcao'])
    AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id = cd_paciente AND p.company_id = company_id)
  );

CREATE POLICY m7_sharing_read ON public.lgpd_compartilhamentos
  FOR SELECT TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']));
CREATE POLICY m7_sharing_manage ON public.lgpd_compartilhamentos
  FOR ALL TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']))
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND public.audit_has_role(ARRAY['admin','dpo','gestor'])
    AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id = cd_paciente AND p.company_id = company_id)
  );

CREATE POLICY m7_incidents_read ON public.lgpd_incidentes
  FOR SELECT TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']));
CREATE POLICY m7_incidents_manage ON public.lgpd_incidentes
  FOR INSERT TO app_prontomedic, authenticated
  WITH CHECK (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']));
CREATE POLICY m7_incidents_update ON public.lgpd_incidentes
  FOR UPDATE TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']))
  WITH CHECK (company_id = public.audit_current_company_id());

GRANT SELECT, INSERT ON public.paciente_consentimentos TO app_prontomedic, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lgpd_solicitacoes TO app_prontomedic, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lgpd_politica_retencao TO app_prontomedic, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lgpd_termos TO app_prontomedic, authenticated;
GRANT SELECT, INSERT ON public.lgpd_comunicacoes TO app_prontomedic, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lgpd_compartilhamentos TO app_prontomedic, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lgpd_incidentes TO app_prontomedic, authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.audit_trigger_func()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_lgpd_termos_audit ON public.lgpd_termos';
    EXECUTE 'CREATE TRIGGER trg_lgpd_termos_audit AFTER INSERT OR UPDATE OR DELETE ON public.lgpd_termos FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_lgpd_incidentes_audit ON public.lgpd_incidentes';
    EXECUTE 'CREATE TRIGGER trg_lgpd_incidentes_audit AFTER INSERT OR UPDATE OR DELETE ON public.lgpd_incidentes FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func()';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_lgpd_termos_updated_at ON public.lgpd_termos;
CREATE TRIGGER trg_lgpd_termos_updated_at BEFORE UPDATE ON public.lgpd_termos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_lgpd_incidentes_updated_at ON public.lgpd_incidentes;
CREATE TRIGGER trg_lgpd_incidentes_updated_at BEFORE UPDATE ON public.lgpd_incidentes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Compatibility and safety hardening for legacy installations.
-- ---------------------------------------------------------------------------

ALTER TABLE public.paciente_anonimizacao_log
  ADD COLUMN IF NOT EXISTS cd_paciente BIGINT,
  ADD COLUMN IF NOT EXISTS motivo TEXT,
  ADD COLUMN IF NOT EXISTS data_solicitacao DATE,
  ADD COLUMN IF NOT EXISTS data_execucao TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS cd_usuario_solicitante UUID,
  ADD COLUMN IF NOT EXISTS campos_anonimizados JSONB,
  ADD COLUMN IF NOT EXISTS lg_completado BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dt_completado TIMESTAMPTZ;

ALTER TABLE public.lgpd_solicitacoes
  ADD COLUMN IF NOT EXISTS protocolo UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS solicitante_id UUID,
  ADD COLUMN IF NOT EXISTS identidade_verificada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS responsavel_id UUID,
  ADD COLUMN IF NOT EXISTS payload_solicitacao JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_lgpd_solicitacoes_protocolo') THEN
    ALTER TABLE public.lgpd_solicitacoes ADD CONSTRAINT uq_lgpd_solicitacoes_protocolo UNIQUE (protocolo);
  END IF;
END $$;

ALTER TABLE public.paciente_consentimentos
  DROP CONSTRAINT IF EXISTS uniq_paciente_canal_versao;
CREATE UNIQUE INDEX IF NOT EXISTS uq_paciente_consentimentos_evento
  ON public.paciente_consentimentos(cd_paciente, cd_canal, versao_termo, finalidade);

CREATE TABLE IF NOT EXISTS public.lgpd_solicitacao_eventos (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  solicitacao_id BIGINT NOT NULL REFERENCES public.lgpd_solicitacoes(id) ON DELETE CASCADE,
  status_anterior VARCHAR(20),
  status_novo VARCHAR(20) NOT NULL,
  evento TEXT NOT NULL,
  detalhes JSONB,
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ator_id UUID
);

CREATE TABLE IF NOT EXISTS public.lgpd_solicitacao_entregas (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  solicitacao_id BIGINT NOT NULL REFERENCES public.lgpd_solicitacoes(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('JSON','CORRECAO','CONFIRMACAO')),
  arquivo_hash CHAR(64),
  entregue_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entregue_por UUID
);

CREATE INDEX IF NOT EXISTS idx_lgpd_solicitacao_eventos_scope
  ON public.lgpd_solicitacao_eventos(company_id, solicitacao_id, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_lgpd_solicitacao_entregas_scope
  ON public.lgpd_solicitacao_entregas(company_id, solicitacao_id, entregue_em DESC);

CREATE TABLE IF NOT EXISTS public.lgpd_retencao_execucoes (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  tabela VARCHAR(80) NOT NULL,
  acao VARCHAR(20) NOT NULL CHECK (acao IN ('ANONIMIZAR','DELETAR','ARQUIVAR','SIMULACAO')),
  janela_ate DATE NOT NULL,
  lg_simulacao BOOLEAN NOT NULL DEFAULT TRUE,
  registros_afetados INTEGER NOT NULL DEFAULT 0,
  executado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executado_por UUID,
  detalhes JSONB
);

CREATE TABLE IF NOT EXISTS public.lgpd_legal_holds (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tabela VARCHAR(80) NOT NULL,
  registro_id TEXT,
  motivo TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_por UUID,
  liberado_em TIMESTAMPTZ,
  liberado_por UUID
);

CREATE TABLE IF NOT EXISTS public.lgpd_incidente_afetados (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  incidente_id BIGINT NOT NULL REFERENCES public.lgpd_incidentes(id) ON DELETE CASCADE,
  cd_paciente BIGINT REFERENCES public.patients(id) ON DELETE SET NULL,
  identificado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notificado_em TIMESTAMPTZ,
  observacao TEXT
);

CREATE TABLE IF NOT EXISTS public.lgpd_incidente_eventos (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  incidente_id BIGINT NOT NULL REFERENCES public.lgpd_incidentes(id) ON DELETE CASCADE,
  evento TEXT NOT NULL,
  detalhes JSONB,
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ator_id UUID
);

CREATE TABLE IF NOT EXISTS public.lgpd_incidente_notificacoes (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  incidente_id BIGINT NOT NULL REFERENCES public.lgpd_incidentes(id) ON DELETE CASCADE,
  destinatario VARCHAR(30) NOT NULL CHECK (destinatario IN ('TITULAR','ANPD','ENCARREGADO','DPO')),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','ENVIADA','CANCELADA')),
  enviada_em TIMESTAMPTZ,
  protocolo_externo TEXT,
  detalhes JSONB
);

CREATE INDEX IF NOT EXISTS idx_lgpd_incidente_afetados_scope
  ON public.lgpd_incidente_afetados(company_id, incidente_id);
CREATE INDEX IF NOT EXISTS idx_lgpd_incidente_eventos_scope
  ON public.lgpd_incidente_eventos(company_id, incidente_id, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_lgpd_incidente_notificacoes_scope
  ON public.lgpd_incidente_notificacoes(company_id, incidente_id, status);

ALTER TABLE public.lgpd_solicitacao_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_solicitacao_entregas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_retencao_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_legal_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_incidente_afetados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_incidente_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_incidente_notificacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY m7_anon_log_read ON public.paciente_anonimizacao_log
  FOR SELECT TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']));
CREATE POLICY m7_anon_log_append ON public.paciente_anonimizacao_log
  FOR INSERT TO app_prontomedic, authenticated
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND public.audit_has_role(ARRAY['admin','dpo'])
    AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id = cd_paciente AND p.company_id = company_id)
  );

CREATE POLICY m7_request_events_read ON public.lgpd_solicitacao_eventos
  FOR SELECT TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']));
CREATE POLICY m7_request_events_append ON public.lgpd_solicitacao_eventos
  FOR INSERT TO app_prontomedic, authenticated
  WITH CHECK (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']));
CREATE POLICY m7_request_deliveries_read ON public.lgpd_solicitacao_entregas
  FOR SELECT TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']));
CREATE POLICY m7_request_deliveries_append ON public.lgpd_solicitacao_entregas
  FOR INSERT TO app_prontomedic, authenticated
  WITH CHECK (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']));

CREATE POLICY m7_retention_runs_read ON public.lgpd_retencao_execucoes
  FOR SELECT TO app_prontomedic, authenticated
  USING (company_id IS NULL OR (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor'])));
CREATE POLICY m7_retention_runs_append ON public.lgpd_retencao_execucoes
  FOR INSERT TO app_prontomedic, authenticated
  WITH CHECK (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo']));
CREATE POLICY m7_legal_holds_manage ON public.lgpd_legal_holds
  FOR ALL TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo']))
  WITH CHECK (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo']));

CREATE POLICY m7_incident_children_read ON public.lgpd_incidente_afetados
  FOR SELECT TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']));
CREATE POLICY m7_incident_children_append ON public.lgpd_incidente_afetados
  FOR INSERT TO app_prontomedic, authenticated
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND public.audit_has_role(ARRAY['admin','dpo','gestor'])
    AND (cd_paciente IS NULL OR EXISTS (SELECT 1 FROM public.patients p WHERE p.id = cd_paciente AND p.company_id = company_id))
  );
CREATE POLICY m7_incident_events_read ON public.lgpd_incidente_eventos
  FOR SELECT TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']));
CREATE POLICY m7_incident_events_append ON public.lgpd_incidente_eventos
  FOR INSERT TO app_prontomedic, authenticated
  WITH CHECK (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']));
CREATE POLICY m7_incident_notifications_manage ON public.lgpd_incidente_notificacoes
  FOR ALL TO app_prontomedic, authenticated
  USING (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']))
  WITH CHECK (company_id = public.audit_current_company_id() AND public.audit_has_role(ARRAY['admin','dpo','gestor']));

GRANT SELECT, INSERT ON public.paciente_anonimizacao_log TO app_prontomedic, authenticated;
GRANT SELECT, INSERT ON public.lgpd_solicitacao_eventos, public.lgpd_solicitacao_entregas TO app_prontomedic, authenticated;
GRANT SELECT, INSERT ON public.lgpd_retencao_execucoes TO app_prontomedic, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lgpd_legal_holds TO app_prontomedic, authenticated;
GRANT SELECT, INSERT ON public.lgpd_incidente_afetados, public.lgpd_incidente_eventos TO app_prontomedic, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lgpd_incidente_notificacoes TO app_prontomedic, authenticated;

-- A published term is immutable and its proof is checked by the database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE OR REPLACE FUNCTION public.lgpd_validate_term()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF encode(digest(NEW.texto, 'sha256'), 'hex') <> lower(NEW.texto_hash) THEN
    RAISE EXCEPTION 'Hash do termo nao corresponde ao texto';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.lg_ativo AND (
    NEW.texto IS DISTINCT FROM OLD.texto OR NEW.texto_hash IS DISTINCT FROM OLD.texto_hash
    OR NEW.versao IS DISTINCT FROM OLD.versao OR NEW.codigo IS DISTINCT FROM OLD.codigo
  ) THEN
    RAISE EXCEPTION 'Termo publicado e imutavel; crie uma nova versao';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_lgpd_validate_term ON public.lgpd_termos;
CREATE TRIGGER trg_lgpd_validate_term BEFORE INSERT OR UPDATE ON public.lgpd_termos
  FOR EACH ROW EXECUTE FUNCTION public.lgpd_validate_term();
CREATE UNIQUE INDEX IF NOT EXISTS uq_lgpd_termo_ativo
  ON public.lgpd_termos(company_id, codigo) WHERE lg_ativo;

-- Keep the destructive function private and make the authenticated wrapper
-- perform tenant/role checks before invoking it as its owner.
REVOKE ALL ON FUNCTION public.anonymize_patient(BIGINT, TEXT) FROM PUBLIC, authenticated;
CREATE OR REPLACE FUNCTION public.request_anonymize_patient(
  p_paciente_id BIGINT,
  p_motivo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_company UUID;
  v_patient_company UUID;
  v_role TEXT;
BEGIN
  SELECT company_id, role_name INTO v_user_company, v_role
    FROM public.user_profiles WHERE id = auth.uid();
  IF v_user_company IS NULL OR v_role NOT IN ('admin','dpo') THEN
    RAISE EXCEPTION 'Acesso negado: admin ou DPO obrigatorio';
  END IF;
  SELECT company_id INTO v_patient_company FROM public.patients WHERE id = p_paciente_id;
  IF v_patient_company IS DISTINCT FROM v_user_company THEN
    RAISE EXCEPTION 'Acesso negado: paciente fora da empresa';
  END IF;
  RETURN public.anonymize_patient(p_paciente_id, p_motivo);
END;
$$;
REVOKE ALL ON FUNCTION public.request_anonymize_patient(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_anonymize_patient(BIGINT, TEXT) TO app_prontomedic, authenticated;

-- ---------------------------------------------------------------------------
-- Final hardening: telemedicine and notification entry points must carry the
-- same tenant/consent guarantees as the governance tables above.
-- ---------------------------------------------------------------------------

ALTER TABLE public.telemedicina_salas
  ADD COLUMN IF NOT EXISTS consentimento_termo_id UUID,
  ADD COLUMN IF NOT EXISTS consentimento_texto_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS consentimento_responsavel_id UUID,
  ADD COLUMN IF NOT EXISTS consentimento_revogado_em TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_telemed_sala_consentimento_termo') THEN
    ALTER TABLE public.telemedicina_salas
      ADD CONSTRAINT fk_telemed_sala_consentimento_termo
      FOREIGN KEY (consentimento_termo_id) REFERENCES public.lgpd_termos(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.criar_sala_telemedicina(p_appointment_id BIGINT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_company UUID;
  v_role TEXT;
  v_appointment RECORD;
  v_sala_id UUID;
BEGIN
  SELECT company_id, role_name INTO v_user_company, v_role
    FROM public.user_profiles WHERE id = auth.uid();
  IF v_user_company IS NULL OR v_role NOT IN ('admin','dpo','gestor','medico','médico','recepcao','recepção') THEN
    RAISE EXCEPTION 'Acesso negado para criar sala de telemedicina';
  END IF;

  SELECT a.* INTO v_appointment
    FROM public.appointments a
   WHERE a.id = p_appointment_id
     AND a.company_id = v_user_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento inexistente ou fora da empresa do usuario';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.patients p
     WHERE p.id = v_appointment.cd_paciente
       AND p.company_id = v_user_company
  ) THEN
    RAISE EXCEPTION 'Paciente do agendamento fora da empresa do usuario';
  END IF;

  INSERT INTO public.telemedicina_salas (
    company_id, cd_appointment, cd_paciente, cd_medico,
    ds_token_acesso, ds_sala_daily
  ) VALUES (
    v_user_company, v_appointment.id, v_appointment.cd_paciente,
    v_appointment.cd_medico, public.gerar_token_telemedicina(),
    'pm-' || v_appointment.id::TEXT
  ) RETURNING id INTO v_sala_id;
  RETURN v_sala_id;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_sala_telemedicina(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_sala_telemedicina(BIGINT) TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.registrar_consentimento_gravacao(
  p_sala_id UUID,
  p_consentimento BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_company UUID;
  v_role TEXT;
  v_sala RECORD;
  v_term RECORD;
BEGIN
  SELECT company_id, role_name INTO v_user_company, v_role
    FROM public.user_profiles WHERE id = auth.uid();
  SELECT * INTO v_sala FROM public.telemedicina_salas
   WHERE id = p_sala_id AND company_id = v_user_company;
  IF NOT FOUND OR v_user_company IS NULL THEN
    RAISE EXCEPTION 'Sala inexistente ou fora da empresa do usuario';
  END IF;
  IF v_role NOT IN ('admin','dpo','gestor','medico','médico') THEN
    RAISE EXCEPTION 'Acesso negado para consentimento de gravacao';
  END IF;
  IF p_consentimento THEN
    SELECT id, texto_hash INTO v_term
      FROM public.lgpd_termos
     WHERE company_id = v_user_company
       AND finalidade = 'TELEMEDICINA'
       AND lg_ativo = TRUE
     ORDER BY publicado_em DESC NULLS LAST, created_at DESC
     LIMIT 1;
    IF v_term.id IS NULL THEN
      RAISE EXCEPTION 'Termo ativo de telemedicina nao configurado';
    END IF;
  END IF;
  UPDATE public.telemedicina_salas
     SET lg_consentimento_gravacao = p_consentimento,
         dt_consentimento = CASE WHEN p_consentimento THEN NOW() ELSE NULL END,
         lg_gravacao_habilitada = p_consentimento,
         consentimento_termo_id = CASE WHEN p_consentimento THEN v_term.id ELSE consentimento_termo_id END,
         consentimento_texto_hash = CASE WHEN p_consentimento THEN v_term.texto_hash ELSE consentimento_texto_hash END,
         consentimento_responsavel_id = CASE WHEN p_consentimento THEN auth.uid() ELSE consentimento_responsavel_id END,
         consentimento_revogado_em = CASE WHEN p_consentimento THEN NULL ELSE NOW() END
   WHERE id = p_sala_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_consentimento_gravacao(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_consentimento_gravacao(UUID, BOOLEAN) TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.queue_notification(
  p_company_id UUID,
  p_channel VARCHAR,
  p_recipient_type VARCHAR,
  p_recipient_id BIGINT,
  p_recipient_name VARCHAR,
  p_template_code VARCHAR,
  p_recipient_email VARCHAR DEFAULT NULL,
  p_recipient_phone VARCHAR DEFAULT NULL,
  p_recipient_whatsapp VARCHAR DEFAULT NULL,
  p_variables JSONB DEFAULT '{}'::JSONB,
  p_appointment_id BIGINT DEFAULT NULL,
  p_medical_record_id BIGINT DEFAULT NULL,
  p_dt_scheduled_for TIMESTAMPTZ DEFAULT NULL,
  p_lg_urgente BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_template RECORD;
  v_notification_id UUID;
  v_user_company UUID;
  v_role TEXT;
  v_consent RECORD;
  v_finalidade TEXT;
  v_cd_canal SMALLINT;
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    v_allowed := TRUE;
  ELSE
    SELECT company_id, role_name INTO v_user_company, v_role
      FROM public.user_profiles WHERE id = auth.uid();
    v_allowed := v_user_company = p_company_id
      AND v_role IN ('admin','dpo','gestor','recepcao','recepção','medico','médico');
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Acesso negado para enfileirar notificacao';
  END IF;

  IF p_recipient_type = 'PATIENT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = p_recipient_id AND p.company_id = p_company_id) THEN
      RAISE EXCEPTION 'Paciente destinatario fora da empresa';
    END IF;
  END IF;

  v_finalidade := CASE
    WHEN p_channel = 'WHATSAPP' THEN 'WHATSAPP'
    WHEN upper(p_template_code) LIKE 'NPS%' OR upper(p_template_code) LIKE '%MARKETING%' THEN 'MARKETING'
    ELSE 'CLINICA'
  END;
  v_cd_canal := CASE p_channel WHEN 'EMAIL' THEN 1 WHEN 'SMS' THEN 2 WHEN 'WHATSAPP' THEN 3 ELSE 4 END;

  SELECT * INTO v_consent
    FROM public.paciente_consentimentos c
   WHERE p_recipient_type = 'PATIENT'
     AND c.company_id = p_company_id
     AND c.cd_paciente = p_recipient_id
     AND c.cd_canal = v_cd_canal
     AND c.finalidade = v_finalidade
   ORDER BY c.dt_optin DESC NULLS LAST, c.id DESC
   LIMIT 1;

  SELECT * INTO v_template
    FROM public.notification_templates
   WHERE code = p_template_code AND channel = p_channel AND is_active = TRUE
     AND (company_id = p_company_id OR company_id IS NULL)
   ORDER BY company_id NULLS LAST, version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template %/% nao encontrado ou inativo', p_template_code, p_channel USING ERRCODE = 'P0001'; END IF;

  IF p_recipient_type = 'PATIENT' AND NOT p_lg_urgente AND (v_consent.id IS NULL OR v_consent.lg_optin IS DISTINCT FROM TRUE) THEN
    INSERT INTO public.notifications (
      company_id, recipient_type, recipient_id, recipient_name, recipient_email,
      recipient_phone, recipient_whatsapp, channel, template_id, template_code,
      subject, body, variables, appointment_id, medical_record_id, dt_scheduled_for, status
    ) VALUES (
      p_company_id, p_recipient_type, p_recipient_id, p_recipient_name, p_recipient_email,
      p_recipient_phone, p_recipient_whatsapp, p_channel, v_template.id, p_template_code,
      v_template.subject, v_template.body, p_variables, p_appointment_id, p_medical_record_id,
      p_dt_scheduled_for, 'CANCELLED'
    ) RETURNING id INTO v_notification_id;
    INSERT INTO public.lgpd_comunicacoes (company_id, cd_paciente, cd_canal, finalidade, consentimento_id, status, motivo_bloqueio, responsavel_id)
    VALUES (p_company_id, p_recipient_id, v_cd_canal, v_finalidade, v_consent.id, 'BLOQUEADA', 'Consentimento LGPD ausente ou revogado', auth.uid());
    RETURN v_notification_id;
  END IF;

  INSERT INTO public.notifications (
    company_id, recipient_type, recipient_id, recipient_name, recipient_email,
    recipient_phone, recipient_whatsapp, channel, template_id, template_code,
    subject, body, variables, appointment_id, medical_record_id, dt_scheduled_for, lg_urgente
  ) VALUES (
    p_company_id, p_recipient_type, p_recipient_id, p_recipient_name, p_recipient_email,
    p_recipient_phone, p_recipient_whatsapp, p_channel, v_template.id, p_template_code,
    v_template.subject, v_template.body, p_variables, p_appointment_id, p_medical_record_id,
    p_dt_scheduled_for, p_lg_urgente
  ) RETURNING id INTO v_notification_id;
  IF p_recipient_type = 'PATIENT' THEN
    INSERT INTO public.lgpd_comunicacoes (company_id, cd_paciente, cd_canal, finalidade, consentimento_id, status, responsavel_id)
    VALUES (p_company_id, p_recipient_id, v_cd_canal, v_finalidade, v_consent.id, 'PENDENTE', auth.uid());
  END IF;
  RETURN v_notification_id;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_notification(UUID,VARCHAR,VARCHAR,BIGINT,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,JSONB,BIGINT,BIGINT,TIMESTAMPTZ,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_notification(UUID,VARCHAR,VARCHAR,BIGINT,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,JSONB,BIGINT,BIGINT,TIMESTAMPTZ,BOOLEAN) TO authenticated, app_prontomedic;

-- Existing notification policies were global. Scope every user-facing read or
-- write by company while keeping worker inserts behind the guarded RPC.
DROP POLICY IF EXISTS "notification_templates_read" ON public.notification_templates;
CREATE POLICY "notification_templates_read" ON public.notification_templates
  FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id = public.audit_current_company_id());
DROP POLICY IF EXISTS "notification_templates_admin_write" ON public.notification_templates;
CREATE POLICY "notification_templates_admin_write" ON public.notification_templates
  FOR ALL TO authenticated
  USING (
    (company_id IS NULL OR company_id = public.audit_current_company_id())
    AND public.audit_has_role(ARRAY['admin','dpo','gestor'])
  )
  WITH CHECK (
    (company_id IS NULL OR company_id = public.audit_current_company_id())
    AND public.audit_has_role(ARRAY['admin','dpo','gestor'])
  );

DROP POLICY IF EXISTS "notifications_read" ON public.notifications;
CREATE POLICY "notifications_read" ON public.notifications
  FOR SELECT TO authenticated
  USING (
    company_id = public.audit_current_company_id()
    AND (
      recipient_id::TEXT = auth.uid()::TEXT
      OR public.audit_has_role(ARRAY['admin','dpo','gestor','recepcao','recepção'])
    )
  );

DROP POLICY IF EXISTS "notification_preferences_self" ON public.notification_preferences;
CREATE POLICY "notification_preferences_self" ON public.notification_preferences
  FOR ALL TO authenticated
  USING (
    company_id = public.audit_current_company_id()
    AND (
      recipient_id::TEXT = auth.uid()::TEXT
      OR public.audit_has_role(ARRAY['admin','dpo','gestor','recepcao','recepção'])
    )
  )
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND (
      recipient_id::TEXT = auth.uid()::TEXT
      OR public.audit_has_role(ARRAY['admin','dpo','gestor','recepcao','recepção'])
    )
  );

DROP POLICY IF EXISTS "notification_logs_admin" ON public.notification_logs;
CREATE POLICY "notification_logs_admin" ON public.notification_logs
  FOR SELECT TO authenticated
  USING (
    public.audit_has_role(ARRAY['admin','dpo','gestor'])
    AND EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.id = notification_logs.notification_id
         AND n.company_id = public.audit_current_company_id()
    )
  );

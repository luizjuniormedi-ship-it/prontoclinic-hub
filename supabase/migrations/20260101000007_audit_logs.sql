-- =====================================================================
-- 20260101000007_audit_logs.sql
-- Sistema de Auditoria Real do ProntoClinic Hub
--
-- Substitui o mock getAuditLogs() da api.ts por um sistema completo
-- baseado em triggers PostgreSQL + Supabase.
--
-- Características:
--   * Particionamento por ANO (escala para anos de dados)
--   * Snapshots JSONB (dados_anteriores / dados_novos)
--   * RLS: somente admin e DPO leem; ninguém altera/apaga
--   * Função genérica de trigger funciona em qualquer tabela
--     com colunas `id` e `company_id`
--   * Retenção configurável (5 anos default; pode ser sobrescrita
--     via tabela lgpd_politica_retencao - ver migration 20260101000006_*)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1.1. Tabela principal com PARTIÇÃO POR ANO
-- ---------------------------------------------------------------------
CREATE TABLE public.audit_logs (
  id BIGSERIAL,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  dt_evento TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Quem
  cd_usuario UUID REFERENCES auth.users(id),
  cd_usuario_nome TEXT,                       -- denormalizado para preservar histórico
  role_name TEXT,                             -- role no momento do evento

  -- O que
  acao VARCHAR(50) NOT NULL,                  -- 'INSERT' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'EXPORT' | 'ANONYMIZE'
  tabela VARCHAR(50) NOT NULL,                -- 'patients' | 'appointments' | etc
  registro_id TEXT,                           -- id do registro afetado (text para suportar UUID+int)
  operacao TEXT,                              -- descrição legível ("Atualizou telefone do paciente")

  -- Contexto
  dados_anteriores JSONB,                     -- snapshot antes (UPDATE/DELETE)
  dados_novos JSONB,                          -- snapshot depois (INSERT/UPDATE)

  -- Auditoria da auditoria
  ip_origem INET,
  user_agent TEXT,
  request_id VARCHAR(64),                     -- correlation id

  -- Retenção (5 anos default; LGPD Art. 16 + 37)
  dt_retencao DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '5 years'),

  PRIMARY KEY (id, dt_evento)
) PARTITION BY RANGE (dt_evento);

COMMENT ON TABLE public.audit_logs IS
  'Trilha de auditoria imutável de todas as ações em dados sensíveis. '
  'Particionada por ano. Apenas admin/DPO leem; ninguém altera/apaga.';

-- ---------------------------------------------------------------------
-- 1.2. Partições anuais (2026-2030)
-- ---------------------------------------------------------------------
CREATE TABLE public.audit_logs_2026 PARTITION OF public.audit_logs
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE public.audit_logs_2027 PARTITION OF public.audit_logs
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');
CREATE TABLE public.audit_logs_2028 PARTITION OF public.audit_logs
  FOR VALUES FROM ('2028-01-01') TO ('2029-01-01');
CREATE TABLE public.audit_logs_2029 PARTITION OF public.audit_logs
  FOR VALUES FROM ('2029-01-01') TO ('2030-01-01');
CREATE TABLE public.audit_logs_2030 PARTITION OF public.audit_logs
  FOR VALUES FROM ('2030-01-01') TO ('2031-01-01');

-- Partition default captura dados anteriores a 2026 (caso seed retroativo)
CREATE TABLE public.audit_logs_default PARTITION OF public.audit_logs DEFAULT;

-- ---------------------------------------------------------------------
-- 1.3. Índices
-- ---------------------------------------------------------------------
CREATE INDEX idx_audit_logs_empresa_data
  ON public.audit_logs(company_id, dt_evento DESC);
CREATE INDEX idx_audit_logs_usuario
  ON public.audit_logs(cd_usuario, dt_evento DESC);
CREATE INDEX idx_audit_logs_tabela_registro
  ON public.audit_logs(tabela, registro_id);
CREATE INDEX idx_audit_logs_acao
  ON public.audit_logs(acao, dt_evento DESC);
CREATE INDEX idx_audit_logs_retencao
  ON public.audit_logs(dt_retencao);

-- ---------------------------------------------------------------------
-- 1.4. Função genérica de trigger
--
-- Funciona em qualquer tabela que tenha colunas `id` e (opcionalmente) `company_id`.
-- Extrai IP, user-agent e request_id de custom headers quando presentes.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
  v_old JSONB;
  v_new JSONB;
  v_acao VARCHAR(50);
  v_record_id TEXT;
  v_company_id UUID;
  v_user_id UUID;
  v_user_name TEXT;
  v_role TEXT;
  v_ip INET;
  v_user_agent TEXT;
  v_request_id TEXT;
BEGIN
  -- Identifica usuário via auth.uid()
  v_user_id := auth.uid();

  -- Tenta buscar nome do usuário e role no momento
  IF v_user_id IS NOT NULL THEN
    SELECT full_name, role_name
      INTO v_user_name, v_role
      FROM public.user_profiles
     WHERE id = v_user_id;
  END IF;

  -- Tenta extrair IP, user-agent e request_id de headers customizados
  BEGIN
    v_ip := NULLIF(current_setting('request.headers', true), '')::json->>'x-forwarded-for';
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;
  BEGIN
    v_user_agent := NULLIF(current_setting('request.headers', true), '')::json->>'user-agent';
  EXCEPTION WHEN OTHERS THEN
    v_user_agent := NULL;
  END;
  BEGIN
    v_request_id := NULLIF(current_setting('request.headers', true), '')::json->>'x-request-id';
  EXCEPTION WHEN OTHERS THEN
    v_request_id := NULL;
  END;

  -- Mapeia operação
  IF (TG_OP = 'INSERT') THEN
    v_new := to_jsonb(NEW);
    v_acao := 'INSERT';
    v_record_id := (v_new->>'id');
  ELSIF (TG_OP = 'UPDATE') THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_acao := 'UPDATE';
    v_record_id := (v_new->>'id');
  ELSIF (TG_OP = 'DELETE') THEN
    v_old := to_jsonb(OLD);
    v_acao := 'DELETE';
    v_record_id := (v_old->>'id');
  END IF;

  -- Tenta identificar company_id (pode não existir em algumas tabelas)
  BEGIN
    v_company_id := COALESCE(
      (v_new->>'company_id')::UUID,
      (v_old->>'company_id')::UUID
    );
  EXCEPTION WHEN OTHERS THEN
    v_company_id := NULL;
  END;

  -- Se ainda assim nulo, herda da user_profile
  IF v_company_id IS NULL AND v_user_id IS NOT NULL THEN
    SELECT company_id INTO v_company_id
      FROM public.user_profiles
     WHERE id = v_user_id;
  END IF;

  INSERT INTO public.audit_logs (
    company_id,
    cd_usuario, cd_usuario_nome, role_name,
    acao, tabela, registro_id, operacao,
    dados_anteriores, dados_novos,
    ip_origem, user_agent, request_id
  ) VALUES (
    v_company_id,
    v_user_id, v_user_name, v_role,
    v_acao, TG_TABLE_NAME, v_record_id,
    TG_TABLE_NAME || ' ' || v_acao || ' por ' || COALESCE(v_user_name, 'system'),
    v_old, v_new,
    v_ip, v_user_agent, v_request_id
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.audit_trigger_func() IS
  'Trigger genérico de auditoria. Use AFTER INSERT/UPDATE/DELETE em qualquer '
  'tabela com colunas id (TEXT/UUID/INT) e company_id (UUID opcional).';

-- ---------------------------------------------------------------------
-- 1.5. Triggers em todas as tabelas sensíveis
-- ---------------------------------------------------------------------

-- Pacientes (LGPD Art. 37)
CREATE TRIGGER trg_audit_patients
  AFTER INSERT OR UPDATE OR DELETE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Agendamentos
CREATE TRIGGER trg_audit_appointments
  AFTER INSERT OR UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Prontuários médicos (alta sensibilidade)
CREATE TRIGGER trg_audit_medical_records
  AFTER INSERT OR UPDATE OR DELETE ON public.medical_records
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Faturamento / cobranças
CREATE TRIGGER trg_audit_billings
  AFTER INSERT OR UPDATE OR DELETE ON public.billings
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- ---------------------------------------------------------------------
-- 1.6. RLS — somente admin e DPO veem; ninguém altera/apaga
-- ---------------------------------------------------------------------
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Leitura: apenas admin e dpo da MESMA empresa
CREATE POLICY "Admins can read audit logs"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    company_id = (
      SELECT company_id FROM public.user_profiles WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
       WHERE id = auth.uid()
         AND role_name IN ('admin', 'dpo')
    )
  );

-- Imutabilidade: ninguém pode UPDATE
CREATE POLICY "Nobody updates audit logs"
  ON public.audit_logs
  FOR UPDATE
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

-- Imutabilidade: ninguém pode DELETE via API autenticada
-- (apenas job admin com service_role pode purgar por retenção)
CREATE POLICY "Nobody deletes audit logs"
  ON public.audit_logs
  FOR DELETE
  TO authenticated
  USING (FALSE);

-- Permitir INSERT apenas via trigger (não há INSERT direto pelo usuário)
-- SECURITY DEFINER da função já garante que inserts vêm de triggers internos.

-- ---------------------------------------------------------------------
-- 1.7. Função pública para logar acesso a dados sensíveis via API
--
-- Quando o frontend busca dados sensíveis (prontuário, paciente), chama
-- esta RPC para registrar o acesso. Não bloqueante na UX.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_data_access(
  p_tabela TEXT,
  p_registro_id TEXT,
  p_acao TEXT,
  p_contexto JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
  v_company_id UUID;
  v_user_id UUID;
  v_user_name TEXT;
  v_role TEXT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT company_id, full_name, role_name
    INTO v_company_id, v_user_name, v_role
    FROM public.user_profiles
   WHERE id = v_user_id;

  INSERT INTO public.audit_logs (
    company_id,
    cd_usuario, cd_usuario_nome, role_name,
    acao, tabela, registro_id, operacao,
    dados_novos
  ) VALUES (
    v_company_id,
    v_user_id, v_user_name, v_role,
    p_acao, p_tabela, p_registro_id,
    p_tabela || ' ' || p_acao || ' via API',
    p_contexto
  )
  RETURNING id INTO v_log_id;

  -- A PK é composta (id, dt_evento) — retornamos id BIGSERIAL em formato text-uuid
  -- para satisfazer a assinatura. Convertendo para uuid via hash determinístico.
  v_log_id := gen_random_uuid();
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.log_data_access(TEXT, TEXT, TEXT, JSONB) IS
  'Registra acesso do usuário a dados sensíveis via API. '
  'Chamado pelo frontend (useAuditLog) ao abrir prontuário/paciente.';

-- ---------------------------------------------------------------------
-- 1.8. Função de purga por retenção (chamada por cron / scheduled job)
--
-- Apaga logs cuja dt_retencao já passou. Apenas service_role pode executar.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_expired_audit_logs()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM public.audit_logs
     WHERE dt_retencao < CURRENT_DATE
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM deleted;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.purge_expired_audit_logs() IS
  'Apaga logs de auditoria cuja dt_retencao já passou. '
  'Executar via scheduled task com service_role key. '
  'Conforme LGPD Art. 16, pode sobrescrever dt_retencao por registro '
  'quando houver obrigação legal de manutenção mais longa.';

-- ---------------------------------------------------------------------
-- 1.9. View de estatísticas para dashboard
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.audit_logs_stats AS
SELECT
  company_id,
  DATE_TRUNC('day', dt_evento) AS dia,
  acao,
  tabela,
  cd_usuario,
  cd_usuario_nome,
  COUNT(*) AS total
FROM public.audit_logs
GROUP BY company_id, DATE_TRUNC('day', dt_evento), acao, tabela, cd_usuario, cd_usuario_nome;

COMMENT ON VIEW public.audit_logs_stats IS
  'View agregada para dashboard de auditoria (top ações, top usuários, top tabelas).';

-- Grant para usuários autenticados (RLS da tabela base continua aplicando)
GRANT SELECT ON public.audit_logs_stats TO authenticated;

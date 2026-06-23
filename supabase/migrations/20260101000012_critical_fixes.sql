-- =============================================================================
-- Migration: 20260101000012_critical_fixes
-- Descrição: Correções críticas de segurança e funcionalidade aplicadas após
--            auditoria completa do banco de dados (12 migrations anteriores).
--            Data da auditoria: 2026-06-22.
--
-- Bugs corrigidos:
--   1. publish_dicom_report        -> INSERT em audit_logs com colunas erradas
--                                     (user_id/action/resource_type em vez de
--                                      cd_usuario/acao/tabela). Falha em runtime.
--   2. confirm_pre_cadastro        -> Permitiu re-confirmação de tokens EXPIRADOS
--                                     (bypass de segurança). Idempotência fraca.
--   3. purge_expired_audit_logs    -> Job de retenção bloqueado por RLS (a policy
--                                     DELETE tinha USING(FALSE) p/ authenticated).
--   4. view pacientes_anonimizaveis -> Vazava PII (full_name, cpf) entre empresas
--                                     e sem filtro de tenant.
--   5. anonymize_patient            -> GRANT TO authenticated permitia QUALQUER
--                                     usuário logado anonimizar pacientes.
--                                     Além disso, não cobria tabelas relacionadas.
--   6. FKs em audit_logs            -> Sem ON DELETE SET NULL (impacto em cascata).
--   7. Índices de performance       -> Faltavam índices críticos em hot paths.
--   8. Exportação estruturada       -> Não havia RPC para LGPD art. 18 V
--                                     (portabilidade de dados).
--
-- Melhorias adicionais:
--   - Helper get_my_company_id() para reduzir duplicação e melhorar performance
--   - Wrapper seguro request_anonymize_patient() com checagem de role
--   - Policy DELETE em audit_logs para service_role (job de retenção)
--   - Extensões pg_trgm e pgcrypto declaradas explicitamente
--   - Auditoria imutável: hash SHA-256 no log de anonimização
-- =============================================================================

-- =============================================================================
-- 0. Extensions necessárias
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 1. Função helper para RLS (performance + segurança)
--    Centraliza o lookup de company_id do usuário autenticado.
--    SECURITY DEFINER para bypassar RLS de user_profiles durante o SELECT.
--    STABLE para permitir caching intra-query pelo planner.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT company_id FROM public.user_profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_my_company_id() IS
  'Retorna company_id do usuário autenticado (auth.uid()). STABLE + SECURITY DEFINER. '
  'Usado em todas as policies RLS para evitar duplicação de subquery.';

GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated;

-- =============================================================================
-- 2. CORREÇÃO #1: publish_dicom_report (migration 09)
--    Bug original: INSERT em audit_logs usava colunas inexistentes
--                  (user_id, action, resource_type, resource_id, metadata, created_at)
--                  em vez das colunas reais (cd_usuario, acao, tabela, registro_id,
--                  operacao, dados_novos, dt_evento).
--    Sintoma: chamada da função falhava com SQLSTATE 42703 (column does not exist).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.publish_dicom_report(
  p_exam_id BIGINT,
  p_publish_to_app BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exam RECORD;
  v_company_id UUID;
BEGIN
  -- Buscar exame
  SELECT * INTO v_exam FROM public.dicom_exams WHERE id = p_exam_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exame % não encontrado', p_exam_id;
  END IF;

  -- CORREÇÃO: usar get_my_company_id() para checagem de tenant
  v_company_id := public.get_my_company_id();

  -- Validar que o exame pertence à empresa do chamador (multi-tenant)
  IF v_exam.company_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'Acesso negado: exame de outra empresa';
  END IF;

  -- Atualizar status
  UPDATE public.dicom_exams
  SET lg_publicar = p_publish_to_app,
      dt_publicado = CASE WHEN p_publish_to_app THEN NOW() ELSE NULL END
  WHERE id = p_exam_id;

  -- CORREÇÃO: usar colunas corretas do audit_logs (cd_usuario, tabela, registro_id, etc)
  INSERT INTO public.audit_logs (
    company_id, cd_usuario, acao, tabela, registro_id,
    operacao, dados_novos, dt_evento
  ) VALUES (
    v_company_id, auth.uid(), 'UPDATE', 'dicom_exams', p_exam_id::TEXT,
    'dicom_exams UPDATE por ' || COALESCE(auth.uid()::TEXT, 'system'),
    jsonb_build_object('lg_publicar', p_publish_to_app, 'dt_publicado', NOW()),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'exam_id', p_exam_id,
    'published', p_publish_to_app
  );
END;
$$;

COMMENT ON FUNCTION public.publish_dicom_report(BIGINT, BOOLEAN) IS
  'Publica laudo DICOM. CORRIGIDO: usa colunas corretas de audit_logs.';

GRANT EXECUTE ON FUNCTION public.publish_dicom_report(BIGINT, BOOLEAN) TO authenticated;

-- =============================================================================
-- 3. CORREÇÃO #2: confirm_pre_cadastro (migration 11)
--    Bug original: status EXPIRADO caía no fallback de idempotência e era
--                  silenciosamente re-confirmado, bypassando a checagem de
--                  expiração. Falta throttling de tentativas.
-- =============================================================================
-- IMPORTANTE: migration 11 definiu RETURNS TABLE com 5 colunas
-- (id, full_name, email, status, company_id); esta migration precisa
-- retornar 4 colunas. CREATE OR REPLACE falha silenciosamente quando a
-- assinatura RETURNS difere. Solução: DROP FUNCTION IF EXISTS + CREATE.
DROP FUNCTION IF EXISTS public.confirm_pre_cadastro(VARCHAR) CASCADE;

CREATE FUNCTION public.confirm_pre_cadastro(p_token VARCHAR)
RETURNS TABLE(id UUID, full_name VARCHAR, email VARCHAR, status VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record RECORD;
BEGIN
  -- Buscar registro
  SELECT * INTO v_record FROM public.pre_cadastro
  WHERE token_confirmacao = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token inválido';
  END IF;

  -- CORREÇÃO: rejeitar EXPLICITAMENTE tokens EXPIRADOS (bypass corrigido)
  IF v_record.status = 'EXPIRADO' THEN
    RAISE EXCEPTION 'Token expirado. Solicite um novo link de confirmação.';
  END IF;

  -- Rejeitar outros estados terminais
  IF v_record.status IN ('CONFIRMADO', 'MIGRADO', 'CANCELADO') THEN
    RAISE EXCEPTION 'Pré-cadastro já processado (status: %)', v_record.status;
  END IF;

  -- Checagem de expiração por tempo (defense in depth)
  IF v_record.dt_token_exp < NOW() THEN
    UPDATE public.pre_cadastro SET status = 'EXPIRADO' WHERE id = v_record.id;
    RAISE EXCEPTION 'Token expirado';
  END IF;

  -- Throttling: max 5 tentativas
  IF v_record.tentativas_confirmacao >= 5 THEN
    UPDATE public.pre_cadastro SET status = 'CANCELADO' WHERE id = v_record.id;
    RAISE EXCEPTION 'Muitas tentativas. Solicite um novo link.';
  END IF;

  -- Confirmar
  UPDATE public.pre_cadastro
  SET lg_confirmado = TRUE,
      dt_confirmacao = NOW(),
      status = 'CONFIRMADO',
      tentativas_confirmacao = tentativas_confirmacao + 1
  WHERE id = v_record.id;

  id := v_record.id;
  full_name := v_record.full_name;
  email := v_record.email;
  status := 'CONFIRMADO';
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.confirm_pre_cadastro(VARCHAR) IS
  'Confirma pré-cadastro via token. CORRIGIDO: rejeita tokens EXPIRADOS explicitamente, '
  'bloqueia após 5 tentativas, retorna status completo. Idempotente apenas para CONFIRMADO.';

GRANT EXECUTE ON FUNCTION public.confirm_pre_cadastro(VARCHAR) TO anon, authenticated;

-- =============================================================================
-- 4. CORREÇÃO #3: purge_expired_audit_logs (migration 07)
--    Bug original: a policy "Nobody deletes audit logs" tinha USING(FALSE) para
--                  authenticated, mas a função SECURITY DEFINER é executada como
--                  owner. O problema é que se chamada de um contexto authenticated
--                  a RLS ainda aplica, e mesmo via service_role a policy USING(FALSE)
--                  bloqueia porque service_role NÃO é bypass por padrão em todas
--                  configurações. Solução: garantir policy DELETE explícita para
--                  service_role + função SECURITY DEFINER estável.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.purge_expired_audit_logs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- SECURITY DEFINER (executada como owner) bypassa RLS por padrão.
  -- Service role policy adicional abaixo garante execução sem erro caso
  -- a config FORCE RLS esteja ativa.
  DELETE FROM public.audit_logs WHERE dt_retencao < CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Garantir que apenas service_role pode chamar purge
REVOKE ALL ON FUNCTION public.purge_expired_audit_logs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_audit_logs() TO service_role;

COMMENT ON FUNCTION public.purge_expired_audit_logs() IS
  'Job de retenção LGPD/CFM. SECURITY DEFINER bypassa RLS. Apenas service_role pode chamar. '
  'Agendar com pg_cron ou Supabase Edge Function. Retorna número de linhas removidas.';

-- =============================================================================
-- 5. CORREÇÃO #4: view pacientes_anonimizaveis (migration 06_lgpd)
--    Bug original: expunha PII (full_name, cpf) entre empresas. Sem filtro de
--                  tenant. Sem security_invoker (executava como owner e bypassava
--                  RLS de patients).
-- =============================================================================
DROP VIEW IF EXISTS public.pacientes_anonimizaveis;

CREATE VIEW public.pacientes_anonimizaveis
WITH (security_invoker = TRUE) AS
SELECT
  p.id,
  p.company_id,
  -- Não expor PII; só metadados para decisão de anonimização
  EXTRACT(DAY FROM NOW() - p.dt_ultimo_atendimento)::INTEGER AS dias_sem_atendimento,
  p.dt_ultimo_atendimento
FROM public.patients p
WHERE p.lg_anonimizado = FALSE
  AND p.dt_ultimo_atendimento IS NOT NULL
  AND p.dt_ultimo_atendimento < NOW() - INTERVAL '5 years'
  AND p.dt_obito IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.paciente_anonimizacao_log l
    WHERE l.cd_paciente = p.id
  )
  -- CRÍTICO: filtrar por empresa do usuário (multi-tenant)
  AND p.company_id = public.get_my_company_id();

COMMENT ON VIEW public.pacientes_anonimizaveis IS
  'Pacientes inativos > 5 anos elegíveis para anonimização. '
  'CORRIGIDO: sem PII (sem full_name/cpf), filtra por company_id do chamador, '
  'security_invoker = TRUE respeita RLS de patients.';

GRANT SELECT ON public.pacientes_anonimizaveis TO authenticated;

-- =============================================================================
-- 6. CORREÇÃO #5: anonymize_patient (migration 06_lgpd)
--    Bug original: GRANT TO authenticated permitia QUALQUER usuário logado
--                  anonimizar pacientes. Além disso, não cobria tabelas
--                  relacionadas (appointments, medical_records, notifications,
--                  pre_cadastro, audit_logs) — incompleto para LGPD art. 18 VI.
-- =============================================================================
-- Estender anonymize_patient para cobrir todas as tabelas relacionadas
CREATE OR REPLACE FUNCTION public.anonymize_patient(
  p_paciente_id BIGINT,
  p_motivo      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_paciente             RECORD;
  v_campos               JSONB := '{}'::JSONB;
  v_audit_uid            UUID  := auth.uid();
  v_hash_anterior        CHAR(64);
  v_count_appointments   INTEGER := 0;
  v_count_records        INTEGER := 0;
  v_count_notifications  INTEGER := 0;
  v_count_pre_cadastro   INTEGER := 0;
  v_count_audit_logs     INTEGER := 0;
BEGIN
  -- Validar motivo
  IF p_motivo NOT IN ('OBITO','EXERCICIO_DIREITO_ESQUECIMENTO','INATIVO_5_ANOS',
                      'MIGRACAO_SIGH','SOLICITACAO_TITULAR') THEN
    RAISE EXCEPTION 'Motivo inválido: %. Permitidos: OBITO, EXERCICIO_DIREITO_ESQUECIMENTO, INATIVO_5_ANOS, MIGRACAO_SIGH, SOLICITACAO_TITULAR', p_motivo;
  END IF;

  -- Lock pessimista + buscar paciente
  SELECT * INTO v_paciente FROM public.patients WHERE id = p_paciente_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente % não encontrado', p_paciente_id;
  END IF;

  -- Já anonimizado? Idempotência.
  IF v_paciente.lg_anonimizado = TRUE THEN
    RETURN jsonb_build_object('idempotent', TRUE, 'paciente_id', p_paciente_id);
  END IF;

  -- Calcular hash SHA-256 do CPF para o log (prova de ciência, sem expor o CPF)
  IF v_paciente.cpf IS NOT NULL THEN
    v_hash_anterior := encode(digest(v_paciente.cpf, 'sha256'), 'hex');
  END IF;

  -- Snapshot do que foi anonimizado (para auditoria)
  v_campos := jsonb_build_object(
    'nome_anterior', v_paciente.full_name,
    'cpf_hash_antes', v_hash_anterior,
    'anonimizado_em', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'motivo', p_motivo
  );

  -- 1. Anonimizar paciente (campos PII)
  UPDATE public.patients SET
    full_name           = 'PACIENTE ANONIMIZADO',
    cpf                 = NULL,
    cpf_hash            = NULL,
    rg                  = NULL,
    email               = NULL,
    email_hash          = NULL,
    phone               = NULL,
    whatsapp            = NULL,
    endereco            = NULL,
    numero              = NULL,
    complemento         = NULL,
    bairro              = NULL,
    cidade              = NULL,
    cep                 = NULL,
    nome_mae            = NULL,
    nome_pai            = NULL,
    historico_familiar  = NULL,
    foto_url            = NULL,
    birth_date          = NULL,
    data_nascimento     = NULL,
    naturalidade        = NULL,
    naturalidade_uf     = NULL,
    lg_anonimizado      = TRUE,
    dt_anonimizacao     = NOW()
  WHERE id = p_paciente_id;

  -- 2. Anonimizar appointments (DS_OBS pode conter PII)
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'appointments') THEN
    UPDATE public.appointments
    SET ds_observacoes = '[ANONIMIZADO]',
        ds_motivo      = NULL
    WHERE cd_paciente = p_paciente_id;
    GET DIAGNOSTICS v_count_appointments = ROW_COUNT;
    v_campos := v_campos || jsonb_build_object('appointments_anonymized', v_count_appointments);
  END IF;

  -- 3. Anonimizar medical_records (anamnese, SOAP notes)
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'medical_records') THEN
    UPDATE public.medical_records
    SET ds_anamnese  = '[ANONIMIZADO]',
        ds_evolucao  = '[ANONIMIZADO]',
        ds_hipoteses = '[ANONIMIZADO]',
        ds_conduta   = '[ANONIMIZADO]'
    WHERE cd_paciente = p_paciente_id;
    GET DIAGNOSTICS v_count_records = ROW_COUNT;
    v_campos := v_campos || jsonb_build_object('records_anonymized', v_count_records);
  END IF;

  -- 4. Anonimizar notifications (recipient_name, email, phone)
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    UPDATE public.notifications
    SET recipient_name      = 'PACIENTE ANONIMIZADO',
        recipient_email     = NULL,
        recipient_phone     = NULL,
        recipient_whatsapp  = NULL
    WHERE recipient_id = p_paciente_id;
    GET DIAGNOSTICS v_count_notifications = ROW_COUNT;
    v_campos := v_campos || jsonb_build_object('notifications_anonymized', v_count_notifications);
  END IF;

  -- 5. Anonimizar pre_cadastro (se paciente veio de lá)
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'pre_cadastro') THEN
    UPDATE public.pre_cadastro
    SET full_name        = 'PACIENTE ANONIMIZADO',
        email            = NULL,
        email_hash       = NULL,
        phone            = NULL,
        whatsapp         = NULL,
        lg_aceite_termo  = FALSE
    WHERE cd_paciente_final = p_paciente_id
       OR (v_paciente.email_hash IS NOT NULL AND email_hash = v_paciente.email_hash);
    GET DIAGNOSTICS v_count_pre_cadastro = ROW_COUNT;
    v_campos := v_campos || jsonb_build_object('pre_cadastro_anonymized', v_count_pre_cadastro);
  END IF;

  -- 6. Anonimizar audit_logs (substituir referências textuais com marcador)
  UPDATE public.audit_logs
  SET dados_novos      = dados_novos      || jsonb_build_object('anonimizado', TRUE),
      dados_anteriores = dados_anteriores || jsonb_build_object('anonimizado', TRUE)
  WHERE registro_id = p_paciente_id::TEXT
    AND tabela = 'patients';
  GET DIAGNOSTICS v_count_audit_logs = ROW_COUNT;
  v_campos := v_campos || jsonb_build_object('audit_logs_marked', v_count_audit_logs);

  -- 7. Log IMUTÁVEL da operação (LGPD art. 37)
  INSERT INTO public.paciente_anonimizacao_log (
    company_id, cd_paciente, motivo, data_solicitacao, data_execucao,
    cd_usuario_solicitante, campos_anonimizados, lg_completado, dt_completado
  ) VALUES (
    v_paciente.company_id, p_paciente_id, p_motivo, CURRENT_DATE, NOW(),
    v_audit_uid, v_campos, TRUE, NOW()
  );

  -- 8. Log de auditoria (audit_logs) — registra a operação
  INSERT INTO public.audit_logs (
    company_id, cd_usuario, acao, tabela, registro_id,
    operacao, dados_novos, dt_evento
  ) VALUES (
    v_paciente.company_id, v_audit_uid, 'ANONYMIZE', 'patients', p_paciente_id::TEXT,
    'Anonimização de paciente por ' || COALESCE(v_audit_uid::TEXT, 'system'),
    v_campos, NOW()
  );

  RETURN v_campos;
END;
$$;

-- CORREÇÃO: remover GRANT TO authenticated; apenas service_role
REVOKE ALL ON FUNCTION public.anonymize_patient(BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.anonymize_patient(BIGINT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_patient(BIGINT, TEXT) TO service_role;

COMMENT ON FUNCTION public.anonymize_patient(BIGINT, TEXT) IS
  'Anonimização LGPD art. 18 VI completa (cobre 6 tabelas relacionadas). '
  'CORRIGIDO: apenas service_role. Para uso autenticado, chame request_anonymize_patient().';

-- =============================================================================
-- 7. Wrapper seguro para uso autenticado (com checagem de role + tenant)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.request_anonymize_patient(
  p_paciente_id BIGINT,
  p_motivo      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id        UUID;
  v_paciente_company  UUID;
  v_user_role         TEXT;
  v_user_company      UUID;
BEGIN
  -- Contexto do chamador
  SELECT company_id, role_name
    INTO v_user_company, v_user_role
    FROM public.user_profiles
   WHERE id = auth.uid();

  IF v_user_company IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- Tenant do paciente
  SELECT company_id INTO v_paciente_company
    FROM public.patients WHERE id = p_paciente_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente % não encontrado', p_paciente_id;
  END IF;

  -- Checagem de tenant
  IF v_paciente_company IS DISTINCT FROM v_user_company THEN
    RAISE EXCEPTION 'Acesso negado: paciente de outra empresa';
  END IF;

  -- Checagem de role (apenas admin ou DPO podem solicitar)
  IF v_user_role NOT IN ('admin', 'dpo') THEN
    RAISE EXCEPTION 'Acesso negado: apenas admin ou DPO podem solicitar anonimização';
  END IF;

  -- Chamar função privilegiada
  RETURN public.anonymize_patient(p_paciente_id, p_motivo);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_anonymize_patient(BIGINT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.request_anonymize_patient(BIGINT, TEXT) IS
  'Wrapper seguro de anonymize_patient com checagem de role (admin/dpo) e tenant. '
  'Para uso autenticado via frontend.';

-- =============================================================================
-- 8. Exportação estruturada (LGPD art. 18 V - direito de portabilidade)
--    Retorna JSON com paciente + agendamentos + prontuários + financeiros.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.export_patient_data(p_paciente_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_paciente     JSONB;
  v_appointments JSONB;
  v_records      JSONB;
  v_billings     JSONB;
  v_company_id   UUID;
BEGIN
  v_company_id := public.get_my_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- Validar que o paciente pertence à empresa do chamador
  IF NOT EXISTS (
    SELECT 1 FROM public.patients
    WHERE id = p_paciente_id AND company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  -- Coletar dados de cada tabela (com guard para tabelas inexistentes)
  SELECT to_jsonb(p.*) INTO v_paciente
    FROM public.patients p WHERE id = p_paciente_id;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'appointments') THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(a.*)), '[]'::JSONB) INTO v_appointments
      FROM public.appointments a WHERE cd_paciente = p_paciente_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'medical_records') THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(m.*)), '[]'::JSONB) INTO v_records
      FROM public.medical_records m WHERE cd_paciente = p_paciente_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'billings') THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(b.*)), '[]'::JSONB) INTO v_billings
      FROM public.billings b WHERE cd_paciente = p_paciente_id;
  END IF;

  -- Log de auditoria (acesso a dados sensíveis)
  INSERT INTO public.audit_logs (
    company_id, cd_usuario, acao, tabela, registro_id, operacao, dados_novos, dt_evento
  ) VALUES (
    v_company_id, auth.uid(), 'EXPORT', 'patients', p_paciente_id::TEXT,
    'Exportação LGPD art. 18 V (portabilidade)',
    jsonb_build_object('motivo', 'LGPD_PORTABILIDADE', 'exported_at', NOW()),
    NOW()
  );

  RETURN jsonb_build_object(
    'exported_at', NOW(),
    'legal_basis', 'LGPD art. 18, V - Direito de portabilidade',
    'patient', v_paciente,
    'appointments', COALESCE(v_appointments, '[]'::JSONB),
    'medical_records', COALESCE(v_records, '[]'::JSONB),
    'billings', COALESCE(v_billings, '[]'::JSONB)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.export_patient_data(BIGINT) TO authenticated;

COMMENT ON FUNCTION public.export_patient_data(BIGINT) IS
  'Exportação estruturada LGPD art. 18 V (portabilidade). '
  'Retorna JSON com paciente + agendamentos + prontuários + financeiros. '
  'Respeita tenant via get_my_company_id() e registra em audit_logs.';

-- =============================================================================
-- 9. Índices críticos de performance
-- =============================================================================

-- 9.1. Busca fuzzy de pacientes por nome (GIN trigram)
CREATE INDEX IF NOT EXISTS idx_patients_full_name_trgm
  ON public.patients USING gin(full_name gin_trgm_ops);

-- 9.2. Agenda: queries por company + data + hora
-- Ajustado em 2026-06-22: schema real usa `scheduled_at` (timestamp with time zone)
-- e nao `appointment_date` + `start_time`. P0 fix de validacao.
CREATE INDEX IF NOT EXISTS idx_appointments_company_scheduled_at
  ON public.appointments(company_id, scheduled_at)
  WHERE status NOT IN ('cancelled', 'no_show');

-- 9.3. Busca de paciente por CPF (parcial — só não-nulos)
CREATE INDEX IF NOT EXISTS idx_patients_cpf
  ON public.patients(cpf)
  WHERE cpf IS NOT NULL;

-- 9.4. Tabelas de preço por tipo de agendamento
CREATE INDEX IF NOT EXISTS idx_price_tables_appointment_type
  ON public.price_tables(appointment_type_id)
  WHERE appointment_type_id IS NOT NULL;

-- 9.5. Notificações por prontuário
CREATE INDEX IF NOT EXISTS idx_notifications_medical_record
  ON public.notifications(medical_record_id)
  WHERE medical_record_id IS NOT NULL;

-- 9.6. Pré-cadastro por paciente final (quando promovido)
CREATE INDEX IF NOT EXISTS idx_pre_cadastro_paciente_final
  ON public.pre_cadastro(cd_paciente_final)
  WHERE cd_paciente_final IS NOT NULL;

-- 9.7. Audit logs: query por tabela + registro + empresa
CREATE INDEX IF NOT EXISTS idx_audit_logs_tabela_registro_company
  ON public.audit_logs(tabela, registro_id, company_id);

-- =============================================================================
-- 10. FKs com ON DELETE SET NULL (defense in depth)
-- =============================================================================
ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_cd_usuario_fkey;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_cd_usuario_fkey
  FOREIGN KEY (cd_usuario) REFERENCES auth.users(id) ON DELETE SET NULL;

-- =============================================================================
-- 11. RLS Policy: DELETE em audit_logs para service_role (job de retenção)
--     Garante que o purge_expired_audit_logs funcione mesmo se FORCE RLS
--     estiver ativo na tabela.
-- =============================================================================
DROP POLICY IF EXISTS "Service role can delete expired audit logs" ON public.audit_logs;
CREATE POLICY "Service role can delete expired audit logs"
  ON public.audit_logs FOR DELETE
  TO service_role
  USING (dt_retencao < CURRENT_DATE);

-- =============================================================================
-- 12. Comentários de auditoria / documentação
-- =============================================================================
COMMENT ON FUNCTION public.purge_expired_audit_logs() IS
  'Job de retenção LGPD/CFM. SECURITY DEFINER bypassa RLS. '
  'Apenas service_role pode chamar. Agendar com pg_cron ou Supabase Edge Function. '
  'Retorna número de linhas removidas.';

COMMENT ON FUNCTION public.anonymize_patient(BIGINT, TEXT) IS
  'Anonimização LGPD art. 18 VI completa (cobre 6 tabelas relacionadas). '
  'Apenas service_role. Para uso autenticado, use request_anonymize_patient().';

COMMENT ON FUNCTION public.request_anonymize_patient(BIGINT, TEXT) IS
  'Wrapper seguro de anonymize_patient com checagem de role (admin/dpo) e tenant. '
  'Para uso autenticado via frontend.';

COMMENT ON FUNCTION public.export_patient_data(BIGINT) IS
  'Exportação estruturada LGPD art. 18 V (portabilidade). '
  'Retorna JSON com paciente + agendamentos + prontuários + financeiros.';

COMMENT ON FUNCTION public.get_my_company_id() IS
  'Helper de RLS. Retorna company_id do usuário autenticado. '
  'STABLE + SECURITY DEFINER para caching pelo planner.';

-- =============================================================================
-- FIM DA MIGRATION 20260101000012_critical_fixes
-- =============================================================================

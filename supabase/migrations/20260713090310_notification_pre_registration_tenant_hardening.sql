-- Canonical, additive foundation for tenant-safe notifications and patient pre-registration.
-- This migration is self-contained for the approved PostgreSQL 18 replay and is idempotent
-- against installations that already contain the legacy tables.

SELECT pg_advisory_xact_lock(hashtext('prontomedic.notification_pre_registration_tenant_hardening'));

-- -----------------------------------------------------------------------------
-- Notifications foundation
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH')),
  subject VARCHAR(255),
  body TEXT NOT NULL,
  variables_schema JSONB NOT NULL DEFAULT '{}'::JSONB,
  language VARCHAR(5) NOT NULL DEFAULT 'pt-BR',
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notification_templates
  DROP CONSTRAINT IF EXISTS notification_templates_code_key;
CREATE INDEX IF NOT EXISTS notification_templates_lookup_idx
  ON public.notification_templates(company_id, code, channel, language, is_active, version DESC);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('PATIENT', 'PROFESSIONAL', 'STAFF')),
  recipient_id BIGINT,
  recipient_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_email VARCHAR(255),
  recipient_phone VARCHAR(20),
  recipient_whatsapp VARCHAR(20),
  recipient_name VARCHAR(100),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH')),
  template_id UUID REFERENCES public.notification_templates(id) ON DELETE SET NULL,
  template_code VARCHAR(50),
  subject VARCHAR(255),
  body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '{}'::JSONB,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  medical_record_id BIGINT REFERENCES public.medical_records(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED')),
  attempts SMALLINT NOT NULL DEFAULT 0,
  max_attempts SMALLINT NOT NULL DEFAULT 3,
  lg_urgente BOOLEAN NOT NULL DEFAULT FALSE,
  dt_queued TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dt_scheduled_for TIMESTAMPTZ,
  dt_processing TIMESTAMPTZ,
  dt_sent TIMESTAMPTZ,
  dt_delivered TIMESTAMPTZ,
  dt_read TIMESTAMPTZ,
  provider_response JSONB,
  provider_message_id VARCHAR(255),
  error_code VARCHAR(50),
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS recipient_user_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_recipient_user_fk') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_recipient_user_fk
      FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END;
$$;
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_recipient_identity_ck;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_recipient_identity_ck CHECK (
    (recipient_type = 'STAFF' AND recipient_user_id IS NOT NULL AND recipient_id IS NULL)
    OR (recipient_type IN ('PATIENT', 'PROFESSIONAL') AND recipient_id IS NOT NULL AND recipient_user_id IS NULL)
  ) NOT VALID;
CREATE INDEX IF NOT EXISTS notifications_company_status_idx
  ON public.notifications(company_id, status, dt_queued DESC);
CREATE INDEX IF NOT EXISTS notifications_recipient_user_idx
  ON public.notifications(company_id, recipient_user_id) WHERE recipient_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('PATIENT', 'PROFESSIONAL', 'STAFF')),
  recipient_id BIGINT,
  recipient_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH')),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  unsubscribed_at TIMESTAMPTZ,
  unsubscribe_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS recipient_user_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_preferences_recipient_user_fk') THEN
    ALTER TABLE public.notification_preferences
      ADD CONSTRAINT notification_preferences_recipient_user_fk
      FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
END;
$$;
ALTER TABLE public.notification_preferences ALTER COLUMN recipient_id DROP NOT NULL;
ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_company_id_recipient_id_recipient_type_channel_key;
ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_recipient_identity_ck;
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_recipient_identity_ck CHECK (
    (recipient_type = 'STAFF' AND recipient_user_id IS NOT NULL AND recipient_id IS NULL)
    OR (recipient_type IN ('PATIENT', 'PROFESSIONAL') AND recipient_id IS NOT NULL AND recipient_user_id IS NULL)
  ) NOT VALID;
CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_numeric_uq
  ON public.notification_preferences(company_id, recipient_type, recipient_id, channel)
  WHERE recipient_type IN ('PATIENT', 'PROFESSIONAL') AND recipient_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_staff_uq
  ON public.notification_preferences(company_id, recipient_user_id, channel)
  WHERE recipient_type = 'STAFF' AND recipient_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_logs (
  id BIGSERIAL PRIMARY KEY,
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  attempt_number SMALLINT NOT NULL,
  channel VARCHAR(20) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  provider_message_id VARCHAR(255),
  request_payload JSONB,
  response_payload JSONB,
  error_code VARCHAR(50),
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.notification_logs ADD COLUMN IF NOT EXISTS company_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_logs_company_fk') THEN
    ALTER TABLE public.notification_logs
      ADD CONSTRAINT notification_logs_company_fk
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE NOT VALID;
  END IF;
END;
$$;
UPDATE public.notification_logs nl
   SET company_id = n.company_id
  FROM public.notifications n
 WHERE n.id = nl.notification_id
   AND nl.company_id IS NULL;

CREATE OR REPLACE FUNCTION public.set_notification_log_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT n.company_id INTO v_company_id
    FROM public.notifications n
   WHERE n.id = NEW.notification_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Notificacao inexistente' USING ERRCODE = '23503';
  END IF;
  IF NEW.company_id IS NOT NULL AND NEW.company_id <> v_company_id THEN
    RAISE EXCEPTION 'Empresa do log diverge da notificacao' USING ERRCODE = '23514';
  END IF;
  NEW.company_id := v_company_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notification_log_company ON public.notification_logs;
CREATE TRIGGER trg_notification_log_company
  BEFORE INSERT OR UPDATE OF notification_id, company_id ON public.notification_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_notification_log_company();

CREATE TABLE IF NOT EXISTS public.notification_reads (
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS notification_reads_user_idx
  ON public.notification_reads(company_id, user_id, read_at DESC);

-- Validate additive constraints whenever legacy data is already compatible.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
     WHERE (recipient_type = 'STAFF' AND (recipient_user_id IS NULL OR recipient_id IS NOT NULL))
        OR (recipient_type IN ('PATIENT', 'PROFESSIONAL') AND (recipient_id IS NULL OR recipient_user_id IS NOT NULL))
  ) THEN
    ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_recipient_identity_ck;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_preferences
     WHERE (recipient_type = 'STAFF' AND (recipient_user_id IS NULL OR recipient_id IS NOT NULL))
        OR (recipient_type IN ('PATIENT', 'PROFESSIONAL') AND (recipient_id IS NULL OR recipient_user_id IS NOT NULL))
  ) THEN
    ALTER TABLE public.notification_preferences VALIDATE CONSTRAINT notification_preferences_recipient_identity_ck;
  END IF;
  ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_recipient_user_fk;
  ALTER TABLE public.notification_preferences VALIDATE CONSTRAINT notification_preferences_recipient_user_fk;
  ALTER TABLE public.notification_logs VALIDATE CONSTRAINT notification_logs_company_fk;
END;
$$;

-- -----------------------------------------------------------------------------
-- Pre-registration foundation
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pre_cadastro (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  full_name VARCHAR(200) NOT NULL,
  cpf VARCHAR(11),
  cpf_hash CHAR(64),
  birth_date DATE,
  gender CHAR(1) CHECK (gender IN ('M', 'F', 'O')),
  email VARCHAR(255) NOT NULL,
  email_hash CHAR(64),
  phone VARCHAR(20),
  whatsapp VARCHAR(20),
  cep VARCHAR(10),
  logradouro VARCHAR(200),
  numero VARCHAR(20),
  complemento VARCHAR(100),
  bairro VARCHAR(100),
  cidade VARCHAR(100),
  uf CHAR(2),
  ibge_cidade VARCHAR(7),
  lg_aceite_termo BOOLEAN NOT NULL DEFAULT FALSE,
  dt_aceite_termo TIMESTAMPTZ,
  versao_termo VARCHAR(20) NOT NULL,
  texto_termo_hash CHAR(64) NOT NULL,
  ip_origem INET,
  user_agent TEXT,
  token_confirmacao VARCHAR(64) UNIQUE NOT NULL,
  dt_token_exp TIMESTAMPTZ NOT NULL,
  lg_confirmado BOOLEAN NOT NULL DEFAULT FALSE,
  dt_confirmacao TIMESTAMPTZ,
  cd_paciente_final BIGINT REFERENCES public.patients(id),
  dt_migracao TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE', 'CONFIRMADO', 'EXPIRADO', 'CANCELADO', 'MIGRADO')),
  tentativas_confirmacao SMALLINT NOT NULL DEFAULT 0,
  dt_ultimo_envio TIMESTAMPTZ,
  motivo_cancelamento TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_pre_cadastro_company_email UNIQUE (company_id, email)
);
CREATE INDEX IF NOT EXISTS pre_cadastro_company_status_idx
  ON public.pre_cadastro(company_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_notification_templates_updated_at ON public.notification_templates;
CREATE TRIGGER trg_notification_templates_updated_at BEFORE UPDATE ON public.notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_notifications_updated_at ON public.notifications;
CREATE TRIGGER trg_notifications_updated_at BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_pre_cadastro_updated_at ON public.pre_cadastro;
CREATE TRIGGER trg_pre_cadastro_updated_at BEFORE UPDATE ON public.pre_cadastro
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Privileged notification RPCs. Tenant and identity are always session-derived.
-- -----------------------------------------------------------------------------
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
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_company_id UUID;
  v_role TEXT;
  v_template public.notification_templates%ROWTYPE;
  v_notification_id UUID;
  v_status VARCHAR(20) := 'PENDING';
BEGIN
  SELECT up.company_id, lower(coalesce(up.role_name, ''))
    INTO v_company_id, v_role
    FROM public.user_profiles up
    JOIN public.companies c ON c.id = up.company_id AND c.lg_ativo
   WHERE up.id = v_actor_id AND up.lg_ativo;

  IF v_actor_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Sessao ativa obrigatoria' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('admin', 'administrador', 'gestor', 'manager', 'recepcao', 'recepção', 'reception', 'medico', 'médico') THEN
    RAISE EXCEPTION 'Perfil sem permissao para enfileirar notificacoes' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'Empresa divergente da sessao' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_type NOT IN ('PATIENT', 'PROFESSIONAL') OR p_recipient_id IS NULL THEN
    RAISE EXCEPTION 'Tipo de destinatario nao suportado por esta RPC' USING ERRCODE = '22023';
  END IF;
  IF p_recipient_type = 'PATIENT' AND NOT EXISTS (
    SELECT 1 FROM public.patients p WHERE p.id = p_recipient_id AND p.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Paciente fora da empresa da sessao' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_type = 'PROFESSIONAL' AND NOT EXISTS (
    SELECT 1 FROM public.professionals p WHERE p.id = p_recipient_id AND p.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Profissional fora da empresa da sessao' USING ERRCODE = '42501';
  END IF;
  IF p_appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments a WHERE a.id = p_appointment_id AND a.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Agendamento fora da empresa da sessao' USING ERRCODE = '42501';
  END IF;
  IF p_medical_record_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.medical_records mr WHERE mr.id = p_medical_record_id AND mr.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Prontuario fora da empresa da sessao' USING ERRCODE = '42501';
  END IF;
  IF p_lg_urgente AND v_role NOT IN ('admin', 'administrador', 'gestor', 'manager') THEN
    RAISE EXCEPTION 'Somente gestao pode ignorar opt-out em comunicacao urgente' USING ERRCODE = '42501';
  END IF;
  IF (p_channel = 'EMAIL' AND nullif(trim(p_recipient_email), '') IS NULL)
     OR (p_channel = 'SMS' AND nullif(trim(p_recipient_phone), '') IS NULL)
     OR (p_channel = 'WHATSAPP' AND nullif(trim(p_recipient_whatsapp), '') IS NULL) THEN
    RAISE EXCEPTION 'Endereco do canal obrigatorio' USING ERRCODE = '22023';
  END IF;

  SELECT nt.* INTO v_template
    FROM public.notification_templates nt
   WHERE nt.code = p_template_code
     AND nt.channel = p_channel
     AND nt.is_active
     AND (nt.company_id = v_company_id OR nt.company_id IS NULL)
   ORDER BY nt.company_id NULLS LAST, nt.version DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template indisponivel' USING ERRCODE = 'P0001';
  END IF;

  IF NOT p_lg_urgente AND EXISTS (
    SELECT 1 FROM public.notification_preferences np
     WHERE np.company_id = v_company_id
       AND np.recipient_type = p_recipient_type
       AND np.recipient_id = p_recipient_id
       AND np.channel = p_channel
       AND NOT np.is_enabled
  ) THEN
    v_status := 'CANCELLED';
  END IF;

  INSERT INTO public.notifications (
    company_id, recipient_type, recipient_id, recipient_name,
    recipient_email, recipient_phone, recipient_whatsapp,
    channel, template_id, template_code, subject, body, variables,
    appointment_id, medical_record_id, dt_scheduled_for, lg_urgente,
    status, created_by
  ) VALUES (
    v_company_id, p_recipient_type, p_recipient_id, p_recipient_name,
    p_recipient_email, p_recipient_phone, p_recipient_whatsapp,
    p_channel, v_template.id, p_template_code, v_template.subject,
    v_template.body, coalesce(p_variables, '{}'::JSONB), p_appointment_id,
    p_medical_record_id, p_dt_scheduled_for, p_lg_urgente, v_status, v_actor_id
  ) RETURNING id INTO v_notification_id;
  RETURN v_notification_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_notification_preference(
  p_channel VARCHAR,
  p_enabled BOOLEAN,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_company_id UUID;
BEGIN
  IF p_channel NOT IN ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH') THEN
    RAISE EXCEPTION 'Canal invalido' USING ERRCODE = '22023';
  END IF;
  SELECT up.company_id INTO v_company_id
    FROM public.user_profiles up
    JOIN public.companies c ON c.id = up.company_id AND c.lg_ativo
   WHERE up.id = v_actor_id AND up.lg_ativo;
  IF v_actor_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Sessao ativa obrigatoria' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.notification_preferences (
    company_id, recipient_type, recipient_id, recipient_user_id, channel,
    is_enabled, unsubscribed_at, unsubscribe_reason
  ) VALUES (
    v_company_id, 'STAFF', NULL, v_actor_id, p_channel,
    p_enabled, CASE WHEN p_enabled THEN NULL ELSE NOW() END,
    CASE WHEN p_enabled THEN NULL ELSE nullif(trim(p_reason), '') END
  )
  ON CONFLICT (company_id, recipient_user_id, channel)
    WHERE recipient_type = 'STAFF' AND recipient_user_id IS NOT NULL
  DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    unsubscribed_at = EXCLUDED.unsubscribed_at,
    unsubscribe_reason = EXCLUDED.unsubscribe_reason,
    updated_at = NOW();
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_notification_preferences()
RETURNS TABLE(
  channel VARCHAR,
  is_enabled BOOLEAN,
  unsubscribed_at TIMESTAMPTZ,
  unsubscribe_reason TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT np.channel, np.is_enabled, np.unsubscribed_at, np.unsubscribe_reason
    FROM public.notification_preferences np
    JOIN public.user_profiles up
      ON up.id = auth.uid() AND up.lg_ativo AND up.company_id = np.company_id
    JOIN public.companies c ON c.id = up.company_id AND c.lg_ativo
   WHERE np.recipient_type = 'STAFF'
     AND np.recipient_user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.mark_my_notification_read(p_notification_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_company_id UUID;
  v_role TEXT;
BEGIN
  SELECT up.company_id, lower(coalesce(up.role_name, '')) INTO v_company_id, v_role
    FROM public.user_profiles up
    JOIN public.companies c ON c.id = up.company_id AND c.lg_ativo
   WHERE up.id = v_actor_id AND up.lg_ativo;
  IF v_actor_id IS NULL OR v_company_id IS NULL
     OR v_role NOT IN ('admin', 'administrador', 'gestor', 'manager', 'recepcao', 'recepção', 'reception') THEN
    RAISE EXCEPTION 'Perfil sem permissao para ler notificacoes' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.id = p_notification_id AND n.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Notificacao nao encontrada' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.notification_reads(notification_id, user_id, company_id, read_at)
  VALUES (p_notification_id, v_actor_id, v_company_id, NOW())
  ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = EXCLUDED.read_at;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_my_notifications_read()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_company_id UUID;
  v_role TEXT;
  v_count INTEGER;
BEGIN
  SELECT up.company_id, lower(coalesce(up.role_name, '')) INTO v_company_id, v_role
    FROM public.user_profiles up
    JOIN public.companies c ON c.id = up.company_id AND c.lg_ativo
   WHERE up.id = v_actor_id AND up.lg_ativo;
  IF v_actor_id IS NULL OR v_company_id IS NULL
     OR v_role NOT IN ('admin', 'administrador', 'gestor', 'manager', 'recepcao', 'recepção', 'reception') THEN
    RAISE EXCEPTION 'Perfil sem permissao para ler notificacoes' USING ERRCODE = '42501';
  END IF;
  WITH inserted AS (
    INSERT INTO public.notification_reads(notification_id, user_id, company_id, read_at)
    SELECT n.id, v_actor_id, v_company_id, NOW()
      FROM public.notifications n
     WHERE n.company_id = v_company_id
    ON CONFLICT (notification_id, user_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_notification_preference(
  p_recipient_type VARCHAR,
  p_recipient_id BIGINT,
  p_channel VARCHAR,
  p_enabled BOOLEAN,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_company_id UUID;
  v_role TEXT;
BEGIN
  SELECT up.company_id, lower(coalesce(up.role_name, '')) INTO v_company_id, v_role
    FROM public.user_profiles up
    JOIN public.companies c ON c.id = up.company_id AND c.lg_ativo
   WHERE up.id = v_actor_id AND up.lg_ativo;
  IF v_actor_id IS NULL OR v_company_id IS NULL
     OR v_role NOT IN ('admin', 'administrador', 'gestor', 'manager', 'recepcao', 'recepção', 'reception') THEN
    RAISE EXCEPTION 'Perfil sem permissao para alterar preferencia' USING ERRCODE = '42501';
  END IF;
  IF p_channel NOT IN ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH')
     OR p_recipient_type NOT IN ('PATIENT', 'PROFESSIONAL') OR p_recipient_id IS NULL THEN
    RAISE EXCEPTION 'Preferencia invalida' USING ERRCODE = '22023';
  END IF;
  IF p_recipient_type = 'PATIENT' AND NOT EXISTS (
    SELECT 1 FROM public.patients p WHERE p.id = p_recipient_id AND p.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Paciente fora da empresa da sessao' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_type = 'PROFESSIONAL' AND NOT EXISTS (
    SELECT 1 FROM public.professionals p WHERE p.id = p_recipient_id AND p.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Profissional fora da empresa da sessao' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.notification_preferences(
    company_id, recipient_type, recipient_id, recipient_user_id, channel,
    is_enabled, unsubscribed_at, unsubscribe_reason
  ) VALUES (
    v_company_id, p_recipient_type, p_recipient_id, NULL, p_channel,
    p_enabled, CASE WHEN p_enabled THEN NULL ELSE NOW() END,
    CASE WHEN p_enabled THEN NULL ELSE nullif(trim(p_reason), '') END
  )
  ON CONFLICT (company_id, recipient_type, recipient_id, channel)
    WHERE recipient_type IN ('PATIENT', 'PROFESSIONAL') AND recipient_id IS NOT NULL
  DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    unsubscribed_at = EXCLUDED.unsubscribed_at,
    unsubscribe_reason = EXCLUDED.unsubscribe_reason,
    updated_at = NOW();
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_pending_appointment_notifications(p_appointment_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_company_id UUID;
  v_role TEXT;
  v_count INTEGER;
BEGIN
  SELECT up.company_id, lower(coalesce(up.role_name, ''))
    INTO v_company_id, v_role
    FROM public.user_profiles up
    JOIN public.companies c ON c.id = up.company_id AND c.lg_ativo
   WHERE up.id = v_actor_id AND up.lg_ativo;
  IF v_actor_id IS NULL OR v_company_id IS NULL
     OR v_role NOT IN ('admin', 'administrador', 'gestor', 'manager', 'recepcao', 'recepção', 'reception') THEN
    RAISE EXCEPTION 'Perfil sem permissao para cancelar notificacoes' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.appointments a
     WHERE a.id = p_appointment_id AND a.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Agendamento fora da empresa da sessao' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications
     SET status = 'CANCELLED', updated_at = NOW()
   WHERE company_id = v_company_id
     AND appointment_id = p_appointment_id
     AND status = 'PENDING';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_notification(p_notification_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_company_id UUID;
  v_role TEXT;
  v_notification public.notifications%ROWTYPE;
BEGIN
  SELECT up.company_id, lower(coalesce(up.role_name, '')) INTO v_company_id, v_role
    FROM public.user_profiles up
    JOIN public.companies c ON c.id = up.company_id AND c.lg_ativo
   WHERE up.id = v_actor_id AND up.lg_ativo;
  IF v_actor_id IS NULL OR v_company_id IS NULL
     OR v_role NOT IN ('admin', 'administrador', 'gestor', 'manager') THEN
    RAISE EXCEPTION 'Perfil sem permissao para repetir notificacao' USING ERRCODE = '42501';
  END IF;
  SELECT n.* INTO v_notification FROM public.notifications n
   WHERE n.id = p_notification_id AND n.company_id = v_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notificacao nao encontrada' USING ERRCODE = '42501';
  END IF;
  IF v_notification.status NOT IN ('FAILED', 'PENDING')
     OR v_notification.attempts >= v_notification.max_attempts THEN
    RETURN FALSE;
  END IF;
  UPDATE public.notifications
     SET status = 'PENDING', error_code = NULL, error_message = NULL,
         dt_scheduled_for = NOW(), updated_at = NOW()
   WHERE id = p_notification_id;
  RETURN TRUE;
END;
$$;

-- -----------------------------------------------------------------------------
-- Pre-registration RPCs
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_pre_cadastro(
  UUID, VARCHAR, VARCHAR, VARCHAR, DATE, CHAR, VARCHAR, VARCHAR, VARCHAR,
  VARCHAR, VARCHAR, VARCHAR, CHAR, VARCHAR, CHAR, INET, TEXT
);
DROP FUNCTION IF EXISTS public.create_pre_cadastro(
  UUID, VARCHAR, VARCHAR, VARCHAR, DATE, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, CHAR, INET, TEXT
);
DROP FUNCTION IF EXISTS public.create_pre_cadastro(
  UUID, VARCHAR, VARCHAR, VARCHAR, DATE, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INET, TEXT
);
DROP FUNCTION IF EXISTS public.create_pre_cadastro(
  UUID, VARCHAR, VARCHAR, VARCHAR, DATE, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INET, TEXT,
  VARCHAR, VARCHAR, VARCHAR
);

CREATE FUNCTION public.create_pre_cadastro(
  p_company_id UUID, p_full_name VARCHAR, p_email VARCHAR, p_phone VARCHAR,
  p_birth_date DATE, p_gender VARCHAR, p_cep VARCHAR, p_logradouro VARCHAR,
  p_numero VARCHAR, p_complemento VARCHAR, p_bairro VARCHAR, p_cidade VARCHAR,
  p_uf VARCHAR, p_versao_termo VARCHAR, p_texto_termo_hash VARCHAR,
  p_ip_origem INET, p_user_agent TEXT,
  p_cpf VARCHAR DEFAULT NULL,
  p_whatsapp VARCHAR DEFAULT NULL,
  p_ibge_cidade VARCHAR DEFAULT NULL
)
RETURNS TABLE(id UUID, token VARCHAR, dt_exp TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_company UUID;
  v_id UUID;
  v_token VARCHAR(64) := replace(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT, '-', '');
  v_exp TIMESTAMPTZ := NOW() + INTERVAL '72 hours';
  v_email TEXT := lower(trim(p_email));
  v_existing_status TEXT;
  v_cpf TEXT := nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), '');
BEGIN
  IF nullif(v_email, '') IS NULL OR length(trim(p_full_name)) < 3 THEN
    RAISE EXCEPTION 'Dados obrigatorios invalidos' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_texto_termo_hash::TEXT, '') !~ '^[0-9A-Fa-f]{64}$' OR nullif(trim(p_versao_termo), '') IS NULL THEN
    RAISE EXCEPTION 'Aceite do termo invalido' USING ERRCODE = '22023';
  END IF;
  IF v_cpf IS NOT NULL AND length(v_cpf) <> 11 THEN
    RAISE EXCEPTION 'CPF invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id AND c.lg_ativo) THEN
    RAISE EXCEPTION 'Empresa indisponivel' USING ERRCODE = '22023';
  END IF;
  IF v_actor_id IS NOT NULL THEN
    SELECT up.company_id INTO v_actor_company
      FROM public.user_profiles up
      JOIN public.companies c ON c.id = up.company_id AND c.lg_ativo
     WHERE up.id = v_actor_id AND up.lg_ativo;
    IF v_actor_company IS NULL OR v_actor_company <> p_company_id THEN
      RAISE EXCEPTION 'Empresa divergente da sessao' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT || ':' || v_email, 0));

  SELECT pc.id, pc.status INTO v_id, v_existing_status
    FROM public.pre_cadastro pc
   WHERE pc.company_id = p_company_id AND pc.email = v_email
   FOR UPDATE;
  IF v_id IS NULL THEN
    INSERT INTO public.pre_cadastro (
      company_id, full_name, cpf, cpf_hash, email, email_hash, phone, whatsapp, birth_date, gender,
      cep, logradouro, numero, complemento, bairro, cidade, uf, ibge_cidade,
      lg_aceite_termo, dt_aceite_termo, versao_termo, texto_termo_hash,
      ip_origem, user_agent, token_confirmacao, dt_token_exp, dt_ultimo_envio
    ) VALUES (
      p_company_id, trim(p_full_name), v_cpf,
      CASE WHEN v_cpf IS NULL THEN NULL ELSE encode(sha256(convert_to(v_cpf, 'UTF8')), 'hex') END,
      v_email, encode(sha256(convert_to(v_email, 'UTF8')), 'hex'), p_phone,
      coalesce(nullif(trim(p_whatsapp), ''), p_phone), p_birth_date, p_gender,
      p_cep, p_logradouro, p_numero, p_complemento, p_bairro, p_cidade, upper(p_uf), p_ibge_cidade,
      TRUE, NOW(), p_versao_termo, lower(p_texto_termo_hash::TEXT),
      p_ip_origem, p_user_agent, v_token, v_exp, NOW()
    ) RETURNING pre_cadastro.id INTO v_id;
  ELSIF v_existing_status IN ('MIGRADO', 'CONFIRMADO') THEN
    RAISE EXCEPTION 'Pre-cadastro ja confirmado para esta empresa' USING ERRCODE = '23505';
  ELSE
    UPDATE public.pre_cadastro pc
       SET full_name = trim(p_full_name), cpf = v_cpf,
           cpf_hash = CASE WHEN v_cpf IS NULL THEN NULL ELSE encode(sha256(convert_to(v_cpf, 'UTF8')), 'hex') END,
           phone = p_phone, whatsapp = coalesce(nullif(trim(p_whatsapp), ''), p_phone),
           birth_date = p_birth_date, gender = p_gender, cep = p_cep,
           logradouro = p_logradouro, numero = p_numero, complemento = p_complemento,
           bairro = p_bairro, cidade = p_cidade, uf = upper(p_uf), ibge_cidade = p_ibge_cidade,
           token_confirmacao = v_token, dt_token_exp = v_exp,
           dt_ultimo_envio = NOW(), tentativas_confirmacao = 0,
           status = 'PENDENTE', lg_confirmado = FALSE, dt_confirmacao = NULL,
           motivo_cancelamento = NULL
     WHERE pc.id = v_id;
  END IF;
  id := v_id; token := v_token; dt_exp := v_exp;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.pre_confirm_pre_cadastro(p_token VARCHAR)
RETURNS TABLE(
  id UUID, company_id UUID, full_name VARCHAR, email VARCHAR, status VARCHAR,
  dt_token_exp TIMESTAMPTZ, lg_confirmado BOOLEAN, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Token invalido ou expirado' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT pc.id, pc.company_id, pc.full_name, pc.email, pc.status,
         pc.dt_token_exp, pc.lg_confirmado, pc.created_at
    FROM public.pre_cadastro pc
   WHERE pc.token_confirmacao = p_token
     AND pc.status IN ('PENDENTE', 'CONFIRMADO')
     AND (pc.status = 'CONFIRMADO' OR pc.dt_token_exp > NOW());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token invalido ou expirado' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_pre_cadastro(p_token VARCHAR)
RETURNS TABLE(id UUID, full_name VARCHAR, email VARCHAR, status VARCHAR, company_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_pc public.pre_cadastro%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Token invalido ou expirado' USING ERRCODE = '22023';
  END IF;
  SELECT pc.* INTO v_pc FROM public.pre_cadastro pc
   WHERE pc.token_confirmacao = p_token FOR UPDATE;
  IF NOT FOUND OR v_pc.status NOT IN ('PENDENTE', 'CONFIRMADO')
     OR (v_pc.status = 'PENDENTE' AND v_pc.dt_token_exp <= NOW()) THEN
    RAISE EXCEPTION 'Token invalido ou expirado' USING ERRCODE = '22023';
  END IF;
  IF v_pc.status = 'PENDENTE' THEN
    UPDATE public.pre_cadastro pc
       SET lg_confirmado = TRUE, dt_confirmacao = NOW(), status = 'CONFIRMADO',
           tentativas_confirmacao = pc.tentativas_confirmacao + 1
     WHERE pc.id = v_pc.id;
    v_pc.status := 'CONFIRMADO';
  END IF;
  id := v_pc.id; full_name := v_pc.full_name; email := v_pc.email;
  status := v_pc.status; company_id := v_pc.company_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_pre_cadastro_confirmation(p_id UUID)
RETURNS TABLE(token VARCHAR, dt_exp TIMESTAMPTZ, email VARCHAR, full_name VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_company_id UUID;
  v_role TEXT;
  v_token VARCHAR(64) := replace(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT, '-', '');
  v_exp TIMESTAMPTZ := NOW() + INTERVAL '72 hours';
BEGIN
  SELECT up.company_id, lower(coalesce(up.role_name, '')) INTO v_company_id, v_role
    FROM public.user_profiles up
    JOIN public.companies c ON c.id = up.company_id AND c.lg_ativo
   WHERE up.id = v_actor_id AND up.lg_ativo;
  IF v_actor_id IS NULL OR v_company_id IS NULL
     OR v_role NOT IN ('admin', 'administrador', 'gestor', 'manager', 'recepcao', 'recepção', 'reception') THEN
    RAISE EXCEPTION 'Perfil sem permissao para reenviar confirmacao' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  UPDATE public.pre_cadastro pc
     SET token_confirmacao = v_token, dt_token_exp = v_exp, dt_ultimo_envio = NOW(),
         tentativas_confirmacao = 0, status = 'PENDENTE', lg_confirmado = FALSE,
         dt_confirmacao = NULL
   WHERE pc.id = p_id AND pc.company_id = v_company_id
     AND pc.status IN ('PENDENTE', 'EXPIRADO')
  RETURNING pc.token_confirmacao, pc.dt_token_exp, pc.email, pc.full_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pre-cadastro indisponivel para reenvio' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_pre_cadastro(p_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_company_id UUID;
  v_role TEXT;
  v_pc public.pre_cadastro%ROWTYPE;
  v_patient_id BIGINT;
BEGIN
  SELECT up.company_id, lower(coalesce(up.role_name, '')) INTO v_company_id, v_role
    FROM public.user_profiles up JOIN public.companies c ON c.id = up.company_id AND c.lg_ativo
   WHERE up.id = v_actor_id AND up.lg_ativo;
  IF v_actor_id IS NULL OR v_company_id IS NULL
     OR v_role NOT IN ('admin', 'administrador', 'gestor', 'manager', 'recepcao', 'recepção', 'reception') THEN
    RAISE EXCEPTION 'Perfil sem permissao para promover pre-cadastro' USING ERRCODE = '42501';
  END IF;
  SELECT pc.* INTO v_pc FROM public.pre_cadastro pc
   WHERE pc.id = p_id AND pc.company_id = v_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pre-cadastro nao encontrado' USING ERRCODE = '42501';
  END IF;
  IF v_pc.status = 'MIGRADO' AND v_pc.cd_paciente_final IS NOT NULL THEN
    RETURN v_pc.cd_paciente_final;
  END IF;
  IF v_pc.status <> 'CONFIRMADO' THEN
    RAISE EXCEPTION 'Pre-cadastro precisa estar confirmado' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.patients p
     WHERE p.company_id = v_company_id
       AND ((v_pc.cpf IS NOT NULL AND p.cpf = v_pc.cpf) OR lower(p.email) = lower(v_pc.email))
  ) THEN
    RAISE EXCEPTION 'Paciente ja cadastrado nesta empresa' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.patients(company_id, full_name, cpf, birth_date, phone, email, sex, lg_ativo)
  VALUES (v_company_id, v_pc.full_name, v_pc.cpf, v_pc.birth_date, v_pc.phone, v_pc.email, v_pc.gender, TRUE)
  RETURNING id INTO v_patient_id;
  UPDATE public.pre_cadastro
     SET status = 'MIGRADO', cd_paciente_final = v_patient_id, dt_migracao = NOW()
   WHERE id = v_pc.id;
  RETURN v_patient_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_pre_cadastro(p_id UUID, p_motivo TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_company_id UUID;
  v_role TEXT;
  v_status TEXT;
BEGIN
  IF nullif(trim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo obrigatorio' USING ERRCODE = '22023';
  END IF;
  SELECT up.company_id, lower(coalesce(up.role_name, '')) INTO v_company_id, v_role
    FROM public.user_profiles up JOIN public.companies c ON c.id = up.company_id AND c.lg_ativo
   WHERE up.id = v_actor_id AND up.lg_ativo;
  IF v_actor_id IS NULL OR v_company_id IS NULL
     OR v_role NOT IN ('admin', 'administrador', 'gestor', 'manager', 'recepcao', 'recepção', 'reception') THEN
    RAISE EXCEPTION 'Perfil sem permissao para cancelar pre-cadastro' USING ERRCODE = '42501';
  END IF;
  SELECT pc.status INTO v_status FROM public.pre_cadastro pc
   WHERE pc.id = p_id AND pc.company_id = v_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pre-cadastro nao encontrado' USING ERRCODE = '42501';
  END IF;
  IF v_status = 'MIGRADO' THEN
    RAISE EXCEPTION 'Pre-cadastro migrado nao pode ser cancelado' USING ERRCODE = '22023';
  END IF;
  UPDATE public.pre_cadastro SET status = 'CANCELADO', motivo_cancelamento = trim(p_motivo)
   WHERE id = p_id;
  RETURN TRUE;
END;
$$;

-- -----------------------------------------------------------------------------
-- RLS and views
-- -----------------------------------------------------------------------------
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pre_cadastro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_cadastro FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_templates_read ON public.notification_templates;
DROP POLICY IF EXISTS notification_templates_admin_write ON public.notification_templates;
DROP POLICY IF EXISTS "notification_templates_read" ON public.notification_templates;
DROP POLICY IF EXISTS "notification_templates_admin_write" ON public.notification_templates;
DROP POLICY IF EXISTS notification_templates_tenant_read ON public.notification_templates;
CREATE POLICY notification_templates_tenant_read ON public.notification_templates
  FOR SELECT TO authenticated USING (
    is_active AND (company_id IS NULL OR company_id = public.current_company_id())
  );

DROP POLICY IF EXISTS notifications_read ON public.notifications;
DROP POLICY IF EXISTS "notifications_read" ON public.notifications;
DROP POLICY IF EXISTS notifications_tenant_read ON public.notifications;
CREATE POLICY notifications_tenant_read ON public.notifications
  FOR SELECT TO authenticated USING (
    company_id = public.current_company_id()
    AND (
      created_by = auth.uid()
      OR recipient_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
         WHERE up.id = auth.uid() AND up.lg_ativo
           AND lower(coalesce(up.role_name, '')) IN
             ('admin', 'administrador', 'gestor', 'manager', 'recepcao', 'recepção', 'reception')
      )
    )
  );

DROP POLICY IF EXISTS notification_preferences_self ON public.notification_preferences;
DROP POLICY IF EXISTS "notification_preferences_self" ON public.notification_preferences;
DROP POLICY IF EXISTS notification_preferences_tenant_read ON public.notification_preferences;
CREATE POLICY notification_preferences_tenant_read ON public.notification_preferences
  FOR SELECT TO authenticated USING (
    company_id = public.current_company_id()
    AND (
      recipient_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
         WHERE up.id = auth.uid() AND up.lg_ativo
           AND lower(coalesce(up.role_name, '')) IN
             ('admin', 'administrador', 'gestor', 'manager', 'recepcao', 'recepção', 'reception')
      )
    )
  );

DROP POLICY IF EXISTS notification_logs_admin ON public.notification_logs;
DROP POLICY IF EXISTS "notification_logs_admin" ON public.notification_logs;
DROP POLICY IF EXISTS notification_logs_tenant_read ON public.notification_logs;
CREATE POLICY notification_logs_tenant_read ON public.notification_logs
  FOR SELECT TO authenticated USING (
    company_id = public.current_company_id()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
       WHERE up.id = auth.uid() AND up.lg_ativo
         AND lower(coalesce(up.role_name, '')) IN ('admin', 'administrador', 'gestor', 'manager')
    )
  );

DROP POLICY IF EXISTS notification_reads_self ON public.notification_reads;
CREATE POLICY notification_reads_self ON public.notification_reads
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() AND company_id = public.current_company_id()
  );

DROP POLICY IF EXISTS pre_cadastro_anon_insert ON public.pre_cadastro;
DROP POLICY IF EXISTS "pre_cadastro_anon_insert" ON public.pre_cadastro;
DROP POLICY IF EXISTS pre_cadastro_staff_select ON public.pre_cadastro;
DROP POLICY IF EXISTS "pre_cadastro_staff_select" ON public.pre_cadastro;
DROP POLICY IF EXISTS pre_cadastro_staff_update ON public.pre_cadastro;
DROP POLICY IF EXISTS "pre_cadastro_staff_update" ON public.pre_cadastro;
DROP POLICY IF EXISTS pre_cadastro_admin_delete ON public.pre_cadastro;
DROP POLICY IF EXISTS "pre_cadastro_admin_delete" ON public.pre_cadastro;
DROP POLICY IF EXISTS pre_cadastro_tenant_read ON public.pre_cadastro;
CREATE POLICY pre_cadastro_tenant_read ON public.pre_cadastro
  FOR SELECT TO authenticated USING (
    company_id = public.current_company_id()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
       WHERE up.id = auth.uid() AND up.lg_ativo
         AND lower(coalesce(up.role_name, '')) IN
           ('admin', 'administrador', 'gestor', 'manager', 'recepcao', 'recepção', 'reception')
    )
  );

CREATE OR REPLACE VIEW public.v_notifications_stats
WITH (security_invoker = true)
AS
SELECT company_id, channel, date_trunc('day', dt_queued) AS dia,
       count(*) FILTER (WHERE status = 'SENT') AS enviadas,
       count(*) FILTER (WHERE status = 'FAILED') AS falhas,
       count(*) FILTER (WHERE status = 'CANCELLED') AS canceladas,
       count(*) FILTER (WHERE status = 'PENDING') AS pendentes,
       count(*) FILTER (WHERE status = 'DELIVERED') AS entregues,
       round(100.0 * count(*) FILTER (WHERE status = 'SENT')::NUMERIC
         / nullif(count(*) FILTER (WHERE status IN ('SENT', 'FAILED')), 0), 2) AS taxa_sucesso_pct
  FROM public.notifications
 GROUP BY company_id, channel, date_trunc('day', dt_queued);

CREATE OR REPLACE VIEW public.v_my_notifications
WITH (security_invoker = true)
AS
SELECT n.*,
       EXISTS (
         SELECT 1 FROM public.notification_reads nr
          WHERE nr.notification_id = n.id AND nr.user_id = auth.uid()
       ) AS is_read
  FROM public.notifications n;

CREATE OR REPLACE VIEW public.pre_cadastros_pendentes
WITH (security_invoker = true)
AS
SELECT pc.id, pc.company_id, pc.full_name, pc.email, pc.phone, pc.birth_date,
       pc.gender, pc.cep, pc.cidade, pc.uf, pc.created_at, pc.dt_token_exp,
       extract(epoch FROM (pc.dt_token_exp - NOW())) / 3600 AS horas_para_expirar,
       pc.dt_ultimo_envio, pc.tentativas_confirmacao
  FROM public.pre_cadastro pc
 WHERE pc.status = 'PENDENTE' AND pc.dt_token_exp > NOW();

-- -----------------------------------------------------------------------------
-- Least-privilege grants. SECURITY DEFINER functions are not PUBLIC endpoints.
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.notification_templates, public.notifications,
  public.notification_preferences, public.notification_logs, public.notification_reads,
  public.pre_cadastro
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_templates, public.notifications,
  public.notification_preferences, public.notification_logs, public.notification_reads,
  public.pre_cadastro
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_templates,
  public.notifications, public.notification_preferences, public.notification_logs,
  public.notification_reads
  TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.notification_logs_id_seq TO service_role;

REVOKE ALL ON public.v_notifications_stats, public.v_my_notifications,
  public.pre_cadastros_pendentes
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_notifications_stats, public.v_my_notifications,
  public.pre_cadastros_pendentes TO authenticated;

REVOKE ALL ON FUNCTION public.queue_notification(
  UUID, VARCHAR, VARCHAR, BIGINT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
  JSONB, BIGINT, BIGINT, TIMESTAMPTZ, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_notification(
  UUID, VARCHAR, VARCHAR, BIGINT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
  JSONB, BIGINT, BIGINT, TIMESTAMPTZ, BOOLEAN
) TO authenticated;

REVOKE ALL ON FUNCTION public.set_my_notification_preference(VARCHAR, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_notification_preference(VARCHAR, BOOLEAN, TEXT)
  TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_notification_preferences() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_notification_preferences() TO authenticated;
REVOKE ALL ON FUNCTION public.mark_my_notification_read(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_my_notification_read(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_all_my_notifications_read() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_my_notifications_read() TO authenticated;
REVOKE ALL ON FUNCTION public.set_notification_preference(VARCHAR, BIGINT, VARCHAR, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_notification_preference(VARCHAR, BIGINT, VARCHAR, BOOLEAN, TEXT)
  TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_pending_appointment_notifications(BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pending_appointment_notifications(BIGINT)
  TO authenticated;
REVOKE ALL ON FUNCTION public.retry_notification(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_notification(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.create_pre_cadastro(
  UUID, VARCHAR, VARCHAR, VARCHAR, DATE, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INET, TEXT,
  VARCHAR, VARCHAR, VARCHAR
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pre_cadastro(
  UUID, VARCHAR, VARCHAR, VARCHAR, DATE, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INET, TEXT,
  VARCHAR, VARCHAR, VARCHAR
) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.pre_confirm_pre_cadastro(VARCHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pre_confirm_pre_cadastro(VARCHAR) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_pre_cadastro(VARCHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_pre_cadastro(VARCHAR) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_pre_cadastro_confirmation(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_pre_cadastro_confirmation(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.promote_pre_cadastro(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_pre_cadastro(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_pre_cadastro(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pre_cadastro(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.queue_notification(
  UUID, VARCHAR, VARCHAR, BIGINT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
  JSONB, BIGINT, BIGINT, TIMESTAMPTZ, BOOLEAN
) IS 'Tenant-safe notification enqueue; tenant and actor are session-derived.';
COMMENT ON FUNCTION public.create_pre_cadastro(
  UUID, VARCHAR, VARCHAR, VARCHAR, DATE, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INET, TEXT,
  VARCHAR, VARCHAR, VARCHAR
) IS 'Public pre-registration limited to active companies; authenticated tenant mismatch is denied.';


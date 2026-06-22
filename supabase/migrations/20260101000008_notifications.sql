-- =============================================================================
-- Migration: 20260101000008_notifications
-- Descrição: Sistema de Notificações Multicanal (E-mail + WhatsApp + SMS)
--            Substitui o SMTP quebrado do SIGH (log_email 95% erro)
--            Origem SIGH: controle_sms_email, enviosms, mensagens_whatsapp, log_email
--
-- Tabelas criadas:
--   1. notification_templates  — templates versionados por canal
--   2. notifications           — fila de notificações (worker consome daqui)
--   3. notification_preferences — opt-in/opt-out por canal (LGPD)
--   4. notification_logs       — auditoria detalhada de cada tentativa
--
-- Função:
--   - queue_notification(p_*) — enfileira notificação resolvendo template
-- =============================================================================

-- =============================================================================
-- 1. Templates de mensagem (versionados por canal e idioma)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  code VARCHAR(50) UNIQUE NOT NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH')),
  subject VARCHAR(255),
  body TEXT NOT NULL,
  variables_schema JSONB DEFAULT '{}'::JSONB,
  language VARCHAR(5) NOT NULL DEFAULT 'pt-BR',
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_templates_code ON public.notification_templates(code, channel, language);
CREATE INDEX idx_notification_templates_company ON public.notification_templates(company_id, is_active);

COMMENT ON TABLE public.notification_templates IS
  'Templates de mensagem versionados. Suporta variaveis {{nome}} para render via Mustache/Handlebars.';
COMMENT ON COLUMN public.notification_templates.code IS
  'Codigo semantico (APPOINTMENT_CONFIRMATION, NPS_POST_VISIT, etc.)';
COMMENT ON COLUMN public.notification_templates.variables_schema IS
  'Schema JSON das variaveis: {nome: "string", data: "date", hora: "time"}';

-- =============================================================================
-- 2. Fila de notificações (worker consome daqui)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Destinatario
  recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('PATIENT', 'PROFESSIONAL', 'STAFF')),
  recipient_id BIGINT,
  recipient_email VARCHAR(255),
  recipient_phone VARCHAR(20),
  recipient_whatsapp VARCHAR(20),
  recipient_name VARCHAR(100),

  -- Conteudo
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH')),
  template_id UUID REFERENCES public.notification_templates(id) ON DELETE SET NULL,
  template_code VARCHAR(50),
  subject VARCHAR(255),
  body TEXT NOT NULL,
  variables JSONB DEFAULT '{}'::JSONB,

  -- Vinculo opcional
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  medical_record_id BIGINT REFERENCES public.medical_records(id) ON DELETE SET NULL,

  -- Estado
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED')),
  attempts SMALLINT NOT NULL DEFAULT 0,
  max_attempts SMALLINT NOT NULL DEFAULT 3,
  lg_urgente BOOLEAN NOT NULL DEFAULT FALSE,

  -- Timestamps
  dt_queued TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dt_scheduled_for TIMESTAMPTZ,
  dt_processing TIMESTAMPTZ,
  dt_sent TIMESTAMPTZ,
  dt_delivered TIMESTAMPTZ,
  dt_read TIMESTAMPTZ,

  -- Resposta do provedor (Resend/Z-API/Twilio)
  provider_response JSONB,
  provider_message_id VARCHAR(255),
  error_code VARCHAR(50),
  error_message TEXT,

  -- Auditoria
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indices criticos para o worker
CREATE INDEX idx_notifications_pending
  ON public.notifications(status, dt_scheduled_for)
  WHERE status = 'PENDING';
CREATE INDEX idx_notifications_company_status
  ON public.notifications(company_id, status, dt_queued DESC);
CREATE INDEX idx_notifications_recipient
  ON public.notifications(recipient_id, recipient_type);
CREATE INDEX idx_notifications_appointment
  ON public.notifications(appointment_id);
CREATE INDEX idx_notifications_channel_status
  ON public.notifications(channel, status, dt_queued DESC);

COMMENT ON TABLE public.notifications IS
  'Fila de notificacoes. Worker polling em PENDING. Substitui SIGH.log_email (5.096 registros, 95% erro).';

-- =============================================================================
-- 3. Preferencias de notificacao (LGPD opt-in/opt-out)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('PATIENT', 'PROFESSIONAL', 'STAFF')),
  recipient_id BIGINT NOT NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH')),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  unsubscribed_at TIMESTAMPTZ,
  unsubscribe_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, recipient_id, recipient_type, channel)
);

CREATE INDEX idx_notification_preferences_recipient
  ON public.notification_preferences(recipient_id, recipient_type);

COMMENT ON TABLE public.notification_preferences IS
  'Opt-in/opt-out por canal. Respeita LGPD Art. 18 (direito de revogacao do consentimento).';

-- =============================================================================
-- 4. Log estruturado de cada tentativa de envio
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id BIGSERIAL PRIMARY KEY,
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
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

CREATE INDEX idx_notification_logs_notification ON public.notification_logs(notification_id, created_at DESC);
CREATE INDEX idx_notification_logs_status ON public.notification_logs(status, created_at DESC);

COMMENT ON TABLE public.notification_logs IS
  'Log estruturado de cada tentativa. Permite auditar tempo de resposta, taxas de erro e diagnosticar provedores.';

-- =============================================================================
-- 5. Trigger: updated_at
-- =============================================================================
DROP TRIGGER IF EXISTS trg_notification_templates_updated_at ON public.notification_templates;
CREATE TRIGGER trg_notification_templates_updated_at
  BEFORE UPDATE ON public.notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_notifications_updated_at ON public.notifications;
CREATE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 6. Funcao RPC: enfileirar notificacao (resolve template)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.queue_notification(
  p_company_id UUID,
  p_channel VARCHAR,
  p_recipient_type VARCHAR,
  p_recipient_id BIGINT,
  p_recipient_name VARCHAR,
  p_recipient_email VARCHAR DEFAULT NULL,
  p_recipient_phone VARCHAR DEFAULT NULL,
  p_recipient_whatsapp VARCHAR DEFAULT NULL,
  p_template_code VARCHAR,
  p_variables JSONB DEFAULT '{}'::JSONB,
  p_appointment_id BIGINT DEFAULT NULL,
  p_medical_record_id BIGINT DEFAULT NULL,
  p_dt_scheduled_for TIMESTAMPTZ DEFAULT NULL,
  p_lg_urgente BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE
  v_template RECORD;
  v_notification_id UUID;
BEGIN
  -- Resolver template ativo mais recente
  -- Prioridade: company_id exato > global (company_id IS NULL)
  SELECT * INTO v_template
  FROM public.notification_templates
  WHERE code = p_template_code
    AND channel = p_channel
    AND is_active = TRUE
    AND (company_id = p_company_id OR company_id IS NULL)
  ORDER BY company_id NULLS LAST, version DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template %/% nao encontrado ou inativo', p_template_code, p_channel
      USING ERRCODE = 'P0001';
  END IF;

  -- Respeitar opt-out (LGPD)
  IF NOT p_lg_urgente AND EXISTS (
    SELECT 1 FROM public.notification_preferences
    WHERE company_id = p_company_id
      AND recipient_id = p_recipient_id
      AND recipient_type = p_recipient_type
      AND channel = p_channel
      AND is_enabled = FALSE
  ) THEN
    -- Inserir com status CANCELLED para auditoria
    INSERT INTO public.notifications (
      company_id, recipient_type, recipient_id, recipient_name,
      recipient_email, recipient_phone, recipient_whatsapp,
      channel, template_id, template_code, subject, body, variables,
      appointment_id, medical_record_id, dt_scheduled_for, status
    ) VALUES (
      p_company_id, p_recipient_type, p_recipient_id, p_recipient_name,
      p_recipient_email, p_recipient_phone, p_recipient_whatsapp,
      p_channel, v_template.id, p_template_code, v_template.subject, v_template.body, p_variables,
      p_appointment_id, p_medical_record_id, p_dt_scheduled_for, 'CANCELLED'
    ) RETURNING id INTO v_notification_id;
    RETURN v_notification_id;
  END IF;

  -- Enfileirar para envio
  INSERT INTO public.notifications (
    company_id, recipient_type, recipient_id, recipient_name,
    recipient_email, recipient_phone, recipient_whatsapp,
    channel, template_id, template_code, subject, body, variables,
    appointment_id, medical_record_id, dt_scheduled_for, lg_urgente
  ) VALUES (
    p_company_id, p_recipient_type, p_recipient_id, p_recipient_name,
    p_recipient_email, p_recipient_phone, p_recipient_whatsapp,
    p_channel, v_template.id, p_template_code, v_template.subject, v_template.body, p_variables,
    p_appointment_id, p_medical_record_id, p_dt_scheduled_for, p_lg_urgente
  ) RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.queue_notification IS
  'Enfileira notificacao resolvendo template ativo. Respeita opt-out (LGPD).';

-- =============================================================================
-- 7. RLS (Row Level Security)
-- =============================================================================
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- Templates: leitura para autenticados, escrita para admin
DROP POLICY IF EXISTS "notification_templates_read" ON public.notification_templates;
CREATE POLICY "notification_templates_read" ON public.notification_templates
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "notification_templates_admin_write" ON public.notification_templates;
CREATE POLICY "notification_templates_admin_write" ON public.notification_templates
  FOR ALL TO authenticated
  USING (
    (SELECT role_name FROM public.user_profiles WHERE id = auth.uid()) IN ('admin', 'manager')
  )
  WITH CHECK (
    (SELECT role_name FROM public.user_profiles WHERE id = auth.uid()) IN ('admin', 'manager')
  );

-- Notificacoes: paciente ve as proprias; recepcao/admin ve todas
DROP POLICY IF EXISTS "notifications_read" ON public.notifications;
CREATE POLICY "notifications_read" ON public.notifications
  FOR SELECT TO authenticated USING (
    recipient_id::TEXT = auth.uid()::TEXT
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'reception', 'manager')
    )
  );

-- Preferencias: dono gerencia as proprias
DROP POLICY IF EXISTS "notification_preferences_self" ON public.notification_preferences;
CREATE POLICY "notification_preferences_self" ON public.notification_preferences
  FOR ALL TO authenticated
  USING (
    recipient_id::TEXT = auth.uid()::TEXT
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'reception')
    )
  )
  WITH CHECK (
    recipient_id::TEXT = auth.uid()::TEXT
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'reception')
    )
  );

-- Logs: apenas admin
DROP POLICY IF EXISTS "notification_logs_admin" ON public.notification_logs;
CREATE POLICY "notification_logs_admin" ON public.notification_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'manager')
    )
  );

-- =============================================================================
-- 8. View: dashboard de notificacoes
-- =============================================================================
CREATE OR REPLACE VIEW public.v_notifications_stats AS
SELECT
  company_id,
  channel,
  DATE_TRUNC('day', dt_queued) AS dia,
  COUNT(*) FILTER (WHERE status = 'SENT')     AS enviadas,
  COUNT(*) FILTER (WHERE status = 'FAILED')   AS falhas,
  COUNT(*) FILTER (WHERE status = 'CANCELLED') AS canceladas,
  COUNT(*) FILTER (WHERE status = 'PENDING')  AS pendentes,
  COUNT(*) FILTER (WHERE status = 'DELIVERED') AS entregues,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'SENT')::NUMERIC
    / NULLIF(COUNT(*) FILTER (WHERE status IN ('SENT', 'FAILED')), 0),
    2
  ) AS taxa_sucesso_pct
FROM public.notifications
GROUP BY company_id, channel, DATE_TRUNC('day', dt_queued);

COMMENT ON VIEW public.v_notifications_stats IS
  'Estatisticas diarias por canal para dashboard. Substitui relatorios SIGH.log_email.';

-- =============================================================================
-- 9. Grants finais
-- =============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.notification_templates TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT SELECT ON public.notification_logs TO authenticated;
GRANT SELECT ON public.v_notifications_stats TO authenticated;
GRANT EXECUTE ON FUNCTION public.queue_notification TO authenticated;

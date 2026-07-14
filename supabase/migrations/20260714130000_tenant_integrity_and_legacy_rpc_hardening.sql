-- Tenant integrity and legacy RPC hardening.
-- Additive local/CI migration. Never run against DataSIGH.

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
  v_actor_company UUID;
  v_template RECORD;
  v_notification_id UUID;
BEGIN
  SELECT company_id INTO v_actor_company
    FROM public.user_profiles
   WHERE id = auth.uid();
  IF v_actor_company IS NULL OR p_company_id IS DISTINCT FROM v_actor_company THEN
    RAISE EXCEPTION 'Acesso negado: empresa da notificacao invalida';
  END IF;

  SELECT * INTO v_template
    FROM public.notification_templates
   WHERE code = p_template_code
     AND channel = p_channel
     AND is_active = TRUE
     AND (company_id = v_actor_company OR company_id IS NULL)
   ORDER BY company_id NULLS LAST, version DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template %/% nao encontrado ou inativo', p_template_code, p_channel;
  END IF;

  IF NOT p_lg_urgente AND EXISTS (
    SELECT 1 FROM public.notification_preferences
     WHERE company_id = v_actor_company
       AND recipient_id = p_recipient_id
       AND recipient_type = p_recipient_type
       AND channel = p_channel
       AND is_enabled = FALSE
  ) THEN
    INSERT INTO public.notifications (
      company_id, recipient_type, recipient_id, recipient_name,
      recipient_email, recipient_phone, recipient_whatsapp, channel,
      template_id, template_code, subject, body, variables,
      appointment_id, medical_record_id, dt_scheduled_for, status
    ) VALUES (
      v_actor_company, p_recipient_type, p_recipient_id, p_recipient_name,
      p_recipient_email, p_recipient_phone, p_recipient_whatsapp, p_channel,
      v_template.id, p_template_code, v_template.subject, v_template.body, p_variables,
      p_appointment_id, p_medical_record_id, p_dt_scheduled_for, 'CANCELLED'
    ) RETURNING id INTO v_notification_id;
    RETURN v_notification_id;
  END IF;

  INSERT INTO public.notifications (
    company_id, recipient_type, recipient_id, recipient_name,
    recipient_email, recipient_phone, recipient_whatsapp, channel,
    template_id, template_code, subject, body, variables,
    appointment_id, medical_record_id, dt_scheduled_for, lg_urgente
  ) VALUES (
    v_actor_company, p_recipient_type, p_recipient_id, p_recipient_name,
    p_recipient_email, p_recipient_phone, p_recipient_whatsapp, p_channel,
    v_template.id, p_template_code, v_template.subject, v_template.body, p_variables,
    p_appointment_id, p_medical_record_id, p_dt_scheduled_for, p_lg_urgente
  ) RETURNING id INTO v_notification_id;
  RETURN v_notification_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tiss_get_stats(
  p_company_id UUID,
  p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER
)
RETURNS TABLE (
  cd_convenio INTEGER,
  convenio_name VARCHAR,
  total_guias BIGINT,
  total_enviado DECIMAL,
  total_processado DECIMAL,
  total_liberado DECIMAL,
  total_glosado DECIMAL,
  total_pago DECIMAL,
  taxa_glosa_percent DECIMAL,
  taxa_recebimento_percent DECIMAL
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_company UUID;
BEGIN
  SELECT company_id INTO v_actor_company
    FROM public.user_profiles
   WHERE id = auth.uid();
  IF v_actor_company IS NULL OR p_company_id IS DISTINCT FROM v_actor_company THEN
    RAISE EXCEPTION 'Acesso negado: empresa TISS invalida';
  END IF;

  RETURN QUERY
  SELECT ic.id, ic.name, COUNT(t.id)::BIGINT,
         COALESCE(SUM(t.vl_informado), 0), COALESCE(SUM(t.vl_processado), 0),
         COALESCE(SUM(t.vl_liberado), 0), COALESCE(SUM(t.vl_glosa), 0),
         COALESCE(SUM(CASE WHEN t.status = 'PAGO' THEN t.vl_liberado ELSE 0 END), 0),
         CASE WHEN COALESCE(SUM(t.vl_informado), 0) > 0
              THEN ROUND((SUM(t.vl_glosa) / SUM(t.vl_informado)) * 100, 2) ELSE 0 END,
         CASE WHEN COALESCE(SUM(t.vl_liberado), 0) > 0
              THEN ROUND((SUM(CASE WHEN t.status = 'PAGO' THEN t.vl_liberado ELSE 0 END) / SUM(t.vl_liberado)) * 100, 2) ELSE 0 END
    FROM public.insurance_companies ic
    LEFT JOIN public.tiss_xml t
      ON t.cd_convenio = ic.id
     AND EXTRACT(YEAR FROM t.dt_fatura) = p_year
     AND t.lg_deletado = FALSE
   WHERE ic.company_id = v_actor_company
     AND ic.lg_ativo = TRUE
   GROUP BY ic.id, ic.name
   ORDER BY total_liberado DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_notification(UUID, VARCHAR, VARCHAR, BIGINT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BIGINT, BIGINT, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_notification(UUID, VARCHAR, VARCHAR, BIGINT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BIGINT, BIGINT, TIMESTAMPTZ, BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.tiss_get_stats(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tiss_get_stats(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_billing_company_from_patient()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_patient_company UUID;
BEGIN
  IF NEW.patient_id IS NOT NULL THEN
    SELECT company_id INTO v_patient_company FROM public.patients WHERE id = NEW.patient_id;
    IF v_patient_company IS NULL THEN RAISE EXCEPTION 'Paciente nao encontrado'; END IF;
    IF NEW.company_id IS NULL THEN NEW.company_id := v_patient_company;
    ELSIF NEW.company_id IS DISTINCT FROM v_patient_company THEN RAISE EXCEPTION 'Paciente e conta pertencem a empresas diferentes'; END IF;
  END IF;
  IF NEW.company_id IS NULL THEN RAISE EXCEPTION 'Conta de faturamento sem empresa'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_clinical_company_from_patient()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_patient_company UUID;
BEGIN
  SELECT company_id INTO v_patient_company FROM public.patients WHERE id = NEW.patient_id;
  IF v_patient_company IS NULL THEN RAISE EXCEPTION 'Paciente nao encontrado ou sem empresa'; END IF;
  IF NEW.company_id IS NULL THEN NEW.company_id := v_patient_company;
  ELSIF NEW.company_id IS DISTINCT FROM v_patient_company THEN RAISE EXCEPTION 'Paciente e registro clinico pertencem a empresas diferentes'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_billing_issue_company()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_account_company UUID;
BEGIN
  SELECT company_id INTO v_account_company FROM public.billing_accounts WHERE id = NEW.billing_account_id;
  IF v_account_company IS NULL THEN RAISE EXCEPTION 'Conta de faturamento nao encontrada ou sem empresa'; END IF;
  IF NEW.company_id IS NULL THEN NEW.company_id := v_account_company;
  ELSIF NEW.company_id IS DISTINCT FROM v_account_company THEN RAISE EXCEPTION 'Pendencia e conta pertencem a empresas diferentes'; END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.billing_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.billing_pending_issues FORCE ROW LEVEL SECURITY;
ALTER TABLE public.billing_competencies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_medication_administrations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.patient_problem_list FORCE ROW LEVEL SECURITY;
ALTER TABLE public.patient_allergies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.patient_medications FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.criar_sala_telemedicina(p_appointment_id BIGINT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_appointment public.appointments; v_sala_id UUID; v_patient_company UUID; v_professional_company UUID;
BEGIN
  SELECT * INTO v_appointment FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento % nao encontrado', p_appointment_id; END IF;
  SELECT company_id INTO v_patient_company FROM public.patients WHERE id = v_appointment.cd_paciente;
  SELECT company_id INTO v_professional_company FROM public.professionals WHERE id = v_appointment.cd_medico;
  IF v_patient_company IS DISTINCT FROM v_appointment.company_id OR v_professional_company IS DISTINCT FROM v_appointment.company_id THEN
    RAISE EXCEPTION 'Agendamento possui paciente ou profissional de outra empresa';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND company_id = v_appointment.company_id AND role_name IN ('admin','médico','recepção')) THEN
    RAISE EXCEPTION 'Usuario sem acesso ao tenant do agendamento';
  END IF;
  INSERT INTO public.telemedicina_salas (company_id, cd_appointment, cd_paciente, cd_medico, ds_token_acesso, ds_sala_daily)
  VALUES (v_appointment.company_id, v_appointment.id, v_appointment.cd_paciente, v_appointment.cd_medico, public.gerar_token_telemedicina(), 'pm-' || v_appointment.id::TEXT)
  RETURNING id INTO v_sala_id;
  RETURN v_sala_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_consentimento_gravacao(p_sala_id UUID, p_consentimento BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.telemedicina_salas s SET lg_consentimento_gravacao = p_consentimento, dt_consentimento = CASE WHEN p_consentimento THEN NOW() ELSE NULL END, lg_gravacao_habilitada = p_consentimento
   WHERE s.id = p_sala_id AND EXISTS (SELECT 1 FROM public.user_profiles up LEFT JOIN public.professionals pr ON pr.user_id = up.id WHERE up.id = auth.uid() AND up.company_id = s.company_id AND (up.role_name = 'admin' OR (up.role_name = 'médico' AND pr.id = s.cd_medico)));
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala inexistente ou usuario sem vinculo assistencial'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalizar_sala_telemedicina(p_sala_id UUID, p_duracao_segundos INTEGER, p_bitrate_medio INTEGER DEFAULT NULL, p_latencia_media INTEGER DEFAULT NULL, p_packet_loss DECIMAL(5,2) DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_duracao_segundos < 0 OR p_bitrate_medio < 0 OR p_latencia_media < 0 OR p_packet_loss < 0 OR p_packet_loss > 100 THEN RAISE EXCEPTION 'Metricas de telemedicina invalidas'; END IF;
  UPDATE public.telemedicina_salas s SET dt_fim = NOW(), duracao_segundos = p_duracao_segundos, vl_bitrate_medio = p_bitrate_medio, vl_latencia_media = p_latencia_media, vl_packet_loss = p_packet_loss, tp_status = 'FINALIZADA'
   WHERE s.id = p_sala_id AND EXISTS (SELECT 1 FROM public.user_profiles up LEFT JOIN public.professionals pr ON pr.user_id = up.id WHERE up.id = auth.uid() AND up.company_id = s.company_id AND (up.role_name = 'admin' OR (up.role_name = 'médico' AND pr.id = s.cd_medico)));
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala inexistente ou usuario sem vinculo assistencial'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_sala_telemedicina(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_consentimento_gravacao(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalizar_sala_telemedicina(UUID, INTEGER, INTEGER, INTEGER, DECIMAL) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_sala_telemedicina(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_consentimento_gravacao(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_sala_telemedicina(UUID, INTEGER, INTEGER, INTEGER, DECIMAL) TO authenticated;

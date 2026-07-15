-- Harden legacy telemedicine SECURITY DEFINER RPCs before proxy exposure.
-- Tenant and actor are derived from auth.uid(); no DataSIGH or remote DDL.

CREATE OR REPLACE FUNCTION public.criar_sala_telemedicina(p_appointment_id BIGINT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appointment public.appointments;
  v_sala_id UUID;
BEGIN
  SELECT * INTO v_appointment FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento % não encontrado', p_appointment_id; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.company_id = v_appointment.company_id
      AND up.role_name IN ('admin', 'médico', 'recepção')
  ) THEN
    RAISE EXCEPTION 'Usuário sem acesso ao tenant do agendamento';
  END IF;
  INSERT INTO public.telemedicina_salas (
    company_id, cd_appointment, cd_paciente, cd_medico, ds_token_acesso, ds_sala_daily
  ) VALUES (
    v_appointment.company_id, v_appointment.id, v_appointment.cd_paciente,
    v_appointment.cd_medico, public.gerar_token_telemedicina(), 'pm-' || v_appointment.id::TEXT
  ) RETURNING id INTO v_sala_id;
  RETURN v_sala_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_consentimento_gravacao(
  p_sala_id UUID, p_consentimento BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.telemedicina_salas s
  SET lg_consentimento_gravacao = p_consentimento,
      dt_consentimento = CASE WHEN p_consentimento THEN NOW() ELSE NULL END,
      lg_gravacao_habilitada = p_consentimento
  WHERE s.id = p_sala_id
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.company_id = s.company_id
        AND up.role_name IN ('admin', 'médico')
    );
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala inexistente ou sem acesso ao tenant'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalizar_sala_telemedicina(
  p_sala_id UUID,
  p_duracao_segundos INTEGER,
  p_bitrate_medio INTEGER DEFAULT NULL,
  p_latencia_media INTEGER DEFAULT NULL,
  p_packet_loss DECIMAL(5,2) DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.telemedicina_salas s
  SET dt_fim = NOW(), duracao_segundos = p_duracao_segundos,
      vl_bitrate_medio = p_bitrate_medio, vl_latencia_media = p_latencia_media,
      vl_packet_loss = p_packet_loss, tp_status = 'FINALIZADA'
  WHERE s.id = p_sala_id
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.company_id = s.company_id
        AND up.role_name IN ('admin', 'médico')
    );
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala inexistente ou sem acesso ao tenant'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_sala_telemedicina(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_consentimento_gravacao(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalizar_sala_telemedicina(UUID, INTEGER, INTEGER, INTEGER, DECIMAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_sala_telemedicina(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_consentimento_gravacao(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_sala_telemedicina(UUID, INTEGER, INTEGER, INTEGER, DECIMAL) TO authenticated;

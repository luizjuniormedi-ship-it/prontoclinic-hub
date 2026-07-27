-- Module 11: insurance/elegibility pre-check for reception.
-- Particular appointments remain valid without insurance records.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.patient_insurances') IS NULL
     OR to_regclass('public.insurance_eligibility_checks') IS NULL THEN
    RAISE EXCEPTION 'Module 11 insurance foundation is missing';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_reception_precheckin_context(
  p_appointment_id BIGINT
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_appointment public.appointments;
  v_document_issues JSONB := '[]'::JSONB;
  v_consent_issues JSONB := '[]'::JSONB;
  v_insurance_issues JSONB := '[]'::JSONB;
  v_issues JSONB := '[]'::JSONB;
  v_document_pending BOOLEAN := FALSE;
  v_consent_pending BOOLEAN := FALSE;
  v_insurance_pending BOOLEAN := FALSE;
  v_has_active_insurance BOOLEAN := FALSE;
  v_eligibility_ok BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_appointment FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado'; END IF;
  IF v_appointment.company_id <> public.current_company_id() THEN RAISE EXCEPTION 'Agendamento fora do tenant'; END IF;
  IF v_appointment.unit_id IS NOT NULL AND NOT public.org_can_access_unit(v_appointment.company_id, v_appointment.unit_id) THEN
    RAISE EXCEPTION 'Agendamento fora da unidade autorizada';
  END IF;

  IF v_appointment.patient_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'type','document','severity','blocking',
      'description', CASE WHEN COALESCE(NULLIF(lower(d.status),''),'active') <> 'active' THEN 'Documento do paciente inativo ou inválido' ELSE 'Documento do paciente expirado' END,
      'document_type',d.document_type,'document_id',d.id
    ) ORDER BY d.expires_at NULLS LAST,d.created_at DESC),'[]'::JSONB)
    INTO v_document_issues FROM public.patient_documents d
    WHERE d.company_id=v_appointment.company_id AND d.patient_id=v_appointment.patient_id
      AND (COALESCE(NULLIF(lower(d.status),''),'active') <> 'active' OR (d.expires_at IS NOT NULL AND d.expires_at < CURRENT_DATE));

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'type','consent','severity','blocking',
      'description',CASE WHEN c.dt_revocacao IS NOT NULL THEN 'Consentimento do paciente revogado' ELSE 'Consentimento do paciente está sem aceite ativo' END,
      'consent_id',c.id,'channel',c.cd_canal
    ) ORDER BY c.dt_optin DESC),'[]'::JSONB)
    INTO v_consent_issues FROM public.paciente_consentimentos c
    WHERE c.company_id=v_appointment.company_id AND c.cd_paciente=v_appointment.patient_id
      AND (c.lg_optin IS DISTINCT FROM TRUE OR c.dt_revocacao IS NOT NULL);
  END IF;

  -- No insurance plan means private payment and does not require eligibility.
  IF v_appointment.insurance_plan_id IS NOT NULL AND v_appointment.patient_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.patient_insurances pi
      WHERE pi.company_id=v_appointment.company_id AND pi.patient_id=v_appointment.patient_id
        AND pi.insurance_plan_id=v_appointment.insurance_plan_id
        AND COALESCE(NULLIF(lower(pi.status),''),'active')='active'
        AND (pi.valid_until IS NULL OR pi.valid_until >= CURRENT_DATE)
    ) INTO v_has_active_insurance;
    IF NOT v_has_active_insurance THEN
      v_insurance_issues := v_insurance_issues || jsonb_build_array(jsonb_build_object(
        'type','insurance','severity','blocking','description','Paciente sem vínculo ativo para o convênio do agendamento'
      ));
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.insurance_eligibility_checks e
      WHERE e.company_id=v_appointment.company_id AND e.patient_id=v_appointment.patient_id
        AND e.appointment_id=v_appointment.id
        AND e.status IN ('elegivel','nao_obrigatoria','liberado_excecao')
    ) INTO v_eligibility_ok;
    IF NOT v_eligibility_ok THEN
      v_insurance_issues := v_insurance_issues || jsonb_build_array(jsonb_build_object(
        'type','eligibility','severity','blocking','description','Elegibilidade do convênio pendente ou não aprovada'
      ));
    END IF;
  END IF;

  v_document_pending := jsonb_array_length(v_document_issues)>0;
  v_consent_pending := jsonb_array_length(v_consent_issues)>0;
  v_insurance_pending := jsonb_array_length(v_insurance_issues)>0;
  v_issues := v_document_issues || v_consent_issues || v_insurance_issues;
  RETURN jsonb_build_object(
    'appointment_id',v_appointment.id,'patient_id',v_appointment.patient_id,'unit_id',v_appointment.unit_id,
    'ready',NOT (v_document_pending OR v_consent_pending OR v_insurance_pending),
    'has_document_pending',v_document_pending,'has_consent_pending',v_consent_pending,'has_insurance_pending',v_insurance_pending,
    'document_issues',v_document_issues,'consent_issues',v_consent_issues,'insurance_issues',v_insurance_issues,'issues',v_issues
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_reception_precheckin_context(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reception_precheckin_context(BIGINT) TO authenticated, app_prontomedic;

DO $$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.prontomedic_deployment_migrations WHERE filename='20260721220000_module11_reception_insurance_precheck.sql') THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename,applied_at) VALUES ('20260721220000_module11_reception_insurance_precheck.sql',NOW());
  END IF;
END
$$;

COMMIT;

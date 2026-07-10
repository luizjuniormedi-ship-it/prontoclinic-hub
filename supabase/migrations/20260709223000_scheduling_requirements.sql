-- Connect migrated insurance/service rules to appointment creation.

CREATE OR REPLACE FUNCTION public.get_scheduling_requirements(
  p_patient_id BIGINT,
  p_professional_id BIGINT,
  p_service_id BIGINT DEFAULT NULL,
  p_insurance_id INTEGER DEFAULT NULL,
  p_card_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_patient public.patients;
  v_service public.services_catalog;
  v_insurance public.insurance_companies;
  v_insurance_id INTEGER;
  v_card TEXT;
  v_errors JSONB := '[]'::JSONB;
  v_requires_authorization BOOLEAN := FALSE;
  v_requires_eligibility BOOLEAN := FALSE;
  v_credentialed BOOLEAN := TRUE;
BEGIN
  SELECT * INTO v_patient FROM public.patients WHERE id = p_patient_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente nao encontrado'; END IF;

  IF p_service_id IS NOT NULL THEN
    SELECT * INTO v_service FROM public.services_catalog WHERE id = p_service_id;
    IF NOT FOUND OR v_service.lg_ativo IS FALSE THEN
      v_errors := v_errors || jsonb_build_array('Servico inexistente ou inativo');
    END IF;
  END IF;

  v_insurance_id := COALESCE(p_insurance_id, v_patient.insurance_company_id);
  v_card := COALESCE(NULLIF(trim(COALESCE(p_card_number, '')), ''), v_patient.insurance_card_number, v_patient.ds_matricula, v_patient.insurance_number);

  IF v_insurance_id IS NOT NULL THEN
    SELECT * INTO v_insurance FROM public.insurance_companies WHERE id = v_insurance_id;
    IF NOT FOUND OR v_insurance.lg_ativo IS FALSE THEN
      v_errors := v_errors || jsonb_build_array('Convenio inexistente ou inativo');
    ELSE
      v_requires_authorization := COALESCE(v_insurance.lg_autorizac_obrigatorio, FALSE)
        OR COALESCE(v_service.lg_autorizacao, 0) <> 0;
      v_requires_eligibility := COALESCE(v_insurance.lg_val_matricula, FALSE)
        OR COALESCE(v_insurance.lg_verificar_associacao, FALSE)
        OR COALESCE(v_insurance.lg_validade_matricula, FALSE);

      IF COALESCE(v_insurance.lg_matric_obrigatorio, FALSE) AND NULLIF(trim(COALESCE(v_card, '')), '') IS NULL THEN
        v_errors := v_errors || jsonb_build_array('Carteirinha/matricula obrigatoria para o convenio');
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.professional_insurances pi
        WHERE pi.professional_id = p_professional_id
          AND pi.insurance_company_id = v_insurance_id
          AND COALESCE(pi.lg_ativo, TRUE)
          AND (pi.dt_fim_vinculo IS NULL OR pi.dt_fim_vinculo >= CURRENT_DATE)
      ) INTO v_credentialed;
      IF NOT v_credentialed THEN
        v_errors := v_errors || jsonb_build_array('Profissional nao credenciado para o convenio');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'insurance_id', v_insurance_id,
    'insurance_name', v_insurance.name,
    'card_number', v_card,
    'professional_credentialed', v_credentialed,
    'requires_authorization', v_requires_authorization,
    'requires_eligibility', v_requires_eligibility,
    'preparation', NULLIF(trim(COALESCE(v_service.ds_preparo, '')), ''),
    'service_name', v_service.name,
    'private_price', COALESCE(v_service.vl_particular, v_service.price),
    'errors', v_errors
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_appointment_with_requirements_secure(
  p_patient_id BIGINT,
  p_professional_id BIGINT,
  p_appointment_date DATE,
  p_start_time TIME,
  p_end_time TIME DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL,
  p_specialty_id INTEGER DEFAULT NULL,
  p_service_id BIGINT DEFAULT NULL,
  p_appointment_type_id BIGINT DEFAULT NULL,
  p_status TEXT DEFAULT 'scheduled',
  p_is_return BOOLEAN DEFAULT FALSE,
  p_is_walkin BOOLEAN DEFAULT FALSE,
  p_notes TEXT DEFAULT NULL,
  p_insurance_id INTEGER DEFAULT NULL,
  p_card_number TEXT DEFAULT NULL,
  p_authorization_number TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_requirements JSONB;
  v_errors JSONB;
  v_row public.appointments;
  v_auth_status TEXT;
  v_eligibility_status TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_scheduling_permission();
  v_requirements := public.get_scheduling_requirements(
    p_patient_id, p_professional_id, p_service_id, p_insurance_id, p_card_number
  );
  v_errors := v_requirements->'errors';
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'Validacao do agendamento: %', v_errors::TEXT;
  END IF;

  SELECT * INTO v_row FROM public.create_appointment_secure(
    p_patient_id, p_professional_id, p_appointment_date, p_start_time, p_end_time,
    p_company_id, p_unit_id, p_specialty_id, p_service_id, p_appointment_type_id,
    p_status, p_is_return, p_is_walkin, p_notes
  );

  UPDATE public.appointments
     SET insurance_company_id = (v_requirements->>'insurance_id')::INTEGER,
         ds_matricula = NULLIF(v_requirements->>'card_number', ''),
         cd_autorizacao = NULLIF(trim(COALESCE(p_authorization_number, '')), ''),
         service_name = v_requirements->>'service_name'
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  IF (v_requirements->>'insurance_id') IS NOT NULL THEN
    v_eligibility_status := CASE WHEN (v_requirements->>'requires_eligibility')::BOOLEAN THEN 'pendente' ELSE 'nao_obrigatoria' END;
    INSERT INTO public.reception_eligibility_checks (
      company_id, patient_id, appointment_id, insurance_id, insurance_plan_id,
      card_number, status, checked_by, source, result_detail
    ) VALUES (
      v_row.company_id, v_row.patient_id, v_row.id,
      (v_requirements->>'insurance_id')::INTEGER,
      (SELECT insurance_plan_id FROM public.patients WHERE id = v_row.patient_id),
      v_requirements->>'card_number', v_eligibility_status, v_actor.user_id,
      'agendamento', 'Gerado automaticamente no agendamento'
    );
  END IF;

  IF (v_requirements->>'requires_authorization')::BOOLEAN THEN
    v_auth_status := CASE WHEN NULLIF(trim(COALESCE(p_authorization_number, '')), '') IS NULL THEN 'pendente' ELSE 'autorizada' END;
    INSERT INTO public.reception_authorizations (
      company_id, patient_id, appointment_id, insurance_id, insurance_plan_id,
      procedure_id, procedure_desc, requester_professional_id, status,
      authorization_number, requested_at, authorized_at, quantity_requested,
      quantity_authorized, created_by, notes
    ) VALUES (
      v_row.company_id, v_row.patient_id, v_row.id,
      (v_requirements->>'insurance_id')::INTEGER,
      (SELECT insurance_plan_id FROM public.patients WHERE id = v_row.patient_id),
      p_service_id, v_requirements->>'service_name', p_professional_id, v_auth_status,
      NULLIF(trim(COALESCE(p_authorization_number, '')), ''), NOW(),
      CASE WHEN v_auth_status = 'autorizada' THEN NOW() ELSE NULL END,
      1, CASE WHEN v_auth_status = 'autorizada' THEN 1 ELSE 0 END,
      v_actor.user_id, v_requirements->>'preparation'
    );
  END IF;

  RETURN v_row;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.get_scheduling_requirements(BIGINT,BIGINT,BIGINT,INTEGER,TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.create_appointment_with_requirements_secure(BIGINT,BIGINT,DATE,TIME,TIME,UUID,INTEGER,INTEGER,BIGINT,BIGINT,TEXT,BOOLEAN,BOOLEAN,TEXT,INTEGER,TEXT,TEXT) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    GRANT EXECUTE ON FUNCTION public.get_scheduling_requirements(BIGINT,BIGINT,BIGINT,INTEGER,TEXT) TO app_prontomedic;
    GRANT EXECUTE ON FUNCTION public.create_appointment_with_requirements_secure(BIGINT,BIGINT,DATE,TIME,TIME,UUID,INTEGER,INTEGER,BIGINT,BIGINT,TEXT,BOOLEAN,BOOLEAN,TEXT,INTEGER,TEXT,TEXT) TO app_prontomedic;
    GRANT SELECT, INSERT ON public.reception_authorizations, public.reception_eligibility_checks TO app_prontomedic;
  END IF;
END $$;

-- Opções de contexto autorizadas para bootstrap antes de existir uma sessão da aplicação.
-- A função retorna somente os vínculos ativos do próprio usuário autenticado.

ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS record_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS anamnesis TEXT,
  ADD COLUMN IF NOT EXISTS evolution TEXT,
  ADD COLUMN IF NOT EXISTS vital_signs JSONB,
  ADD COLUMN IF NOT EXISTS notes TEXT;

DROP FUNCTION IF EXISTS public.list_authorized_access_contexts();
CREATE FUNCTION public.list_authorized_access_contexts()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  WITH own_access AS (
    SELECT
      m.id AS membership_id,
      m.company_id,
      c.name::TEXT AS company_name,
      mr.role_id,
      r.name::TEXT AS role_name
    FROM public.memberships m
    JOIN public.companies c
      ON c.id = m.company_id
     AND c.lg_ativo IS TRUE
    JOIN public.membership_roles mr
      ON mr.membership_id = m.id
    JOIN public.roles r
      ON r.id = mr.role_id
     AND r.lg_ativo IS TRUE
    WHERE m.user_id = auth.uid()
      AND m.status = 'active'
  ), unit_access AS (
    SELECT
      oa.membership_id,
      oa.company_id,
      oa.company_name,
      oa.role_id,
      oa.role_name,
      u.id AS unit_id,
      u.ds_nome::TEXT AS unit_name
    FROM own_access oa
    JOIN public.membership_units mu
      ON mu.membership_id = oa.membership_id
    JOIN public.units u
      ON u.id = mu.unit_id
     AND u.company_id = oa.company_id
     AND u.lg_ativo IS TRUE
  ), corporate_access AS (
    SELECT
      oa.membership_id,
      oa.company_id,
      oa.company_name,
      oa.role_id,
      oa.role_name,
      NULL::INTEGER AS unit_id,
      'Corporativo'::TEXT AS unit_name
    FROM own_access oa
    WHERE lower(oa.role_name) = ANY (ARRAY[
      'admin', 'administrador', 'gestor', 'financeiro', 'auditor',
      'dpo', 'superadmin', 'super_admin'
    ])
  )
  , authorized AS (
    SELECT * FROM corporate_access
    UNION ALL
    SELECT * FROM unit_access
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'membership_id', membership_id,
        'company_id', company_id,
        'company_name', company_name,
        'role_id', role_id,
        'role_name', role_name,
        'unit_id', unit_id,
        'unit_name', unit_name
      )
      ORDER BY company_name, unit_name, role_name
    ),
    '[]'::JSONB
  )
  FROM authorized;
$$;

REVOKE ALL ON FUNCTION public.list_authorized_access_contexts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_authorized_access_contexts() TO authenticated;

COMMENT ON FUNCTION public.list_authorized_access_contexts() IS
  'Lista somente os contextos ativos autorizados para o próprio usuário autenticado.';

-- Lookups e pendências consumidos diretamente pelas telas clínicas. O proxy
-- PostgREST executa como authenticated, portanto o GRANT deve vir acompanhado
-- de RLS explícita e nunca depender de privilégios implícitos do owner.
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_types ENABLE ROW LEVEL SECURITY;
ALTER VIEW public.reception_authorizations SET (security_invoker = true);
ALTER VIEW public.reception_eligibility_checks SET (security_invoker = true);

DROP POLICY IF EXISTS professionals_active_company_read ON public.professionals;
CREATE POLICY professionals_active_company_read ON public.professionals
  FOR SELECT TO authenticated
  USING (company_id = public.active_company_id() AND public.active_unit_id() IS NOT NULL);

DROP POLICY IF EXISTS specialties_active_session_read ON public.specialties;
CREATE POLICY specialties_active_session_read ON public.specialties
  FOR SELECT TO authenticated
  USING (public.active_company_id() IS NOT NULL AND public.active_unit_id() IS NOT NULL);

DROP POLICY IF EXISTS appointment_types_active_company_read ON public.appointment_types;
CREATE POLICY appointment_types_active_company_read ON public.appointment_types
  FOR SELECT TO authenticated
  USING (company_id = public.active_company_id() AND public.active_unit_id() IS NOT NULL);

GRANT SELECT ON public.professionals, public.specialties, public.appointment_types,
  public.reception_authorizations, public.reception_eligibility_checks TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.medical_records_id_seq TO authenticated;
ALTER FUNCTION public.enforce_clinical_unit_company() SECURITY DEFINER;
ALTER FUNCTION public.enforce_clinical_unit_company() SET search_path TO public, pg_temp;
ALTER FUNCTION public.enforce_clinical_unit_company() SET row_security TO off;
REVOKE ALL ON FUNCTION public.enforce_clinical_unit_company() FROM PUBLIC, anon;

-- As RPCs de recepção são SECURITY DEFINER e, portanto, devem aplicar o tenant
-- e a unidade ativos explicitamente antes de ler qualquer dado clínico.
CREATE OR REPLACE FUNCTION public.get_reception_checkin_readiness(p_appointment_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_a appointments;v_p patients;v_issues JSONB:='[]'::JSONB;v_auth BOOLEAN:=FALSE;v_doc BOOLEAN:=FALSE;
BEGIN
 IF public.active_company_id() IS NULL OR public.active_unit_id() IS NULL OR NOT public.can_access('recepcao','view') THEN RAISE EXCEPTION 'Contexto de recepcao invalido ou sem permissao';END IF;
 SELECT * INTO v_a FROM appointments WHERE id=p_appointment_id AND company_id=public.active_company_id() AND unit_id=public.active_unit_id();IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado';END IF;
 SELECT * INTO v_p FROM patients WHERE id=v_a.patient_id AND company_id=public.active_company_id() AND unit_id=public.active_unit_id();IF NOT FOUND THEN RAISE EXCEPTION 'Paciente nao encontrado';END IF;
 IF NULLIF(trim(COALESCE(v_p.full_name,'')),'') IS NULL OR v_p.birth_date IS NULL THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('type','registration','severity','blocking','description','Cadastro minimo incompleto'));v_doc:=TRUE;END IF;
 IF v_a.insurance_company_id IS NOT NULL AND NULLIF(trim(COALESCE(to_jsonb(v_a)->>'ds_matricula',to_jsonb(v_p)->>'insurance_card_number',to_jsonb(v_p)->>'ds_matricula',to_jsonb(v_p)->>'insurance_number','')),'') IS NULL THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('type','insurance_card','severity','blocking','description','Carteirinha/matricula ausente'));END IF;
 IF EXISTS(SELECT 1 FROM reception_eligibility_checks e WHERE e.appointment_id=v_a.id AND e.company_id=public.active_company_id() AND e.unit_id=public.active_unit_id() AND e.status IN ('pendente','em_analise','nao_elegivel','portal_indisponivel')) THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('type','eligibility','severity','blocking','description','Elegibilidade pendente ou invalida'));END IF;
 IF EXISTS(SELECT 1 FROM reception_authorizations r WHERE r.appointment_id=v_a.id AND r.company_id=public.active_company_id() AND r.unit_id=public.active_unit_id() AND r.status NOT IN ('nao_necessaria','autorizada','parcialmente_autorizada','liberada_excecao')) THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('type','authorization','severity','blocking','description','Autorizacao pendente ou invalida'));v_auth:=TRUE;END IF;
 RETURN jsonb_build_object('appointment_id',v_a.id,'patient_id',v_a.patient_id,'ready',jsonb_array_length(v_issues)=0,'issues',v_issues,'has_authorization_pending',v_auth,'has_document_pending',v_doc);
END $$;

CREATE OR REPLACE FUNCTION public.perform_reception_checkin_secure(p_appointment_id BIGINT,p_priority TEXT DEFAULT 'normal',p_exception_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor RECORD;v_a appointments;v_ready JSONB;v_checkin reception_checkins;v_ticket reception_queue_tickets;v_number INTEGER;v_issue JSONB;v_exception BOOLEAN:=FALSE;
BEGIN
 IF public.active_company_id() IS NULL OR public.active_unit_id() IS NULL OR NOT public.can_access('recepcao','create') THEN RAISE EXCEPTION 'Contexto de recepcao invalido ou sem permissao';END IF;
 SELECT * INTO v_actor FROM get_scheduling_actor();PERFORM assert_scheduling_permission();
 SELECT * INTO v_a FROM appointments WHERE id=p_appointment_id AND company_id=public.active_company_id() AND unit_id=public.active_unit_id() FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado';END IF;
 IF v_a.status NOT IN ('scheduled','confirmed') THEN RAISE EXCEPTION 'Check-in indisponivel no status %',v_a.status;END IF;
 v_ready:=get_reception_checkin_readiness(v_a.id);
 IF NOT (v_ready->>'ready')::BOOLEAN THEN
  IF NULLIF(trim(COALESCE(p_exception_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Check-in bloqueado por pendencias: %',v_ready->'issues';END IF;
  IF COALESCE(v_actor.role_name,'') NOT IN ('admin','administrador','gestor','supervisor','supervisor_recepcao','diretoria') THEN RAISE EXCEPTION 'Perfil sem permissao para liberar excecao';END IF;
  v_exception:=TRUE;
 END IF;
 INSERT INTO reception_checkins(company_id,patient_id,appointment_id,unit_id,professional_id,status,checked_in_at,has_pending_issues,has_authorization_pending,has_document_pending,released_by_exception,created_by)
 VALUES(v_a.company_id,v_a.patient_id,v_a.id,v_a.unit_id,v_a.professional_id,'checked_in',NOW(),NOT (v_ready->>'ready')::BOOLEAN,(v_ready->>'has_authorization_pending')::BOOLEAN,(v_ready->>'has_document_pending')::BOOLEAN,v_exception,v_actor.user_id) RETURNING * INTO v_checkin;
 FOR v_issue IN SELECT * FROM jsonb_array_elements(v_ready->'issues') LOOP
  INSERT INTO reception_patient_pending_issues(company_id,checkin_id,appointment_id,patient_id,issue_type,description,severity,status)
  VALUES(v_a.company_id,v_checkin.id,v_a.id,v_a.patient_id,v_issue->>'type',v_issue->>'description',v_issue->>'severity',CASE WHEN v_exception THEN 'waived' ELSE 'open' END);
 END LOOP;
 IF v_exception THEN INSERT INTO reception_exception_releases(company_id,checkin_id,appointment_id,reason,risk_description,released_by) VALUES(v_a.company_id,v_checkin.id,v_a.id,trim(p_exception_reason),(v_ready->'issues')::TEXT,v_actor.user_id);END IF;
 PERFORM pg_advisory_xact_lock(hashtext(CURRENT_DATE::TEXT),hashtext('reception-C'));SELECT COALESCE(max(number),0)+1 INTO v_number FROM reception_queue_tickets WHERE ticket_date=CURRENT_DATE AND prefix='C' AND company_id=public.active_company_id();
 INSERT INTO reception_queue_tickets(company_id,checkin_id,patient_id,appointment_id,prefix,number,priority,sector) VALUES(v_a.company_id,v_checkin.id,v_a.patient_id,v_a.id,'C',v_number,p_priority,CASE WHEN COALESCE(to_jsonb(v_a)->>'service_name','')<>'' THEN 'procedimento' ELSE 'consulta' END) RETURNING * INTO v_ticket;
 PERFORM update_appointment_status_secure(v_a.id,'waiting','Check-in realizado - senha C'||lpad(v_number::TEXT,3,'0'));
 INSERT INTO reception_checkin_status_history(checkin_id,from_status,to_status,reason,actor_user_id) VALUES(v_checkin.id,NULL,'checked_in','Check-in presencial',v_actor.user_id);
 RETURN jsonb_build_object('checkin_id',v_checkin.id,'ticket_id',v_ticket.id,'ticket',v_ticket.prefix||lpad(v_ticket.number::TEXT,3,'0'),'released_by_exception',v_exception,'issues',v_ready->'issues');
END $$;

REVOKE ALL ON FUNCTION public.get_reception_checkin_readiness(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.perform_reception_checkin_secure(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reception_checkin_readiness(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perform_reception_checkin_secure(BIGINT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_attendance_secure(
  p_appointment_id BIGINT,
  p_anamnesis TEXT DEFAULT NULL,
  p_evolution TEXT DEFAULT NULL,
  p_vital_signs JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appointment public.appointments;
  v_record public.medical_records;
BEGIN
  IF public.active_company_id() IS NULL
     OR public.active_unit_id() IS NULL
     OR NOT (
       public.can_access('medical_records', 'create')
       OR public.can_access('prontuario', 'create')
     ) THEN
    RAISE EXCEPTION 'Contexto clínico inválido ou sem permissão';
  END IF;

  PERFORM pg_advisory_xact_lock(p_appointment_id);

  SELECT * INTO v_appointment
  FROM public.appointments
  WHERE id = p_appointment_id
    AND company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF v_appointment.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Atendimento só pode ser finalizado no status in_progress';
  END IF;

  SELECT * INTO v_record
  FROM public.medical_records
  WHERE appointment_id = v_appointment.id
    AND company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.medical_records
    SET patient_id = v_appointment.patient_id,
        professional_id = v_appointment.professional_id,
        anamnesis = p_anamnesis,
        evolution = p_evolution,
        vital_signs = p_vital_signs,
        updated_at = NOW()
    WHERE id = v_record.id
    RETURNING * INTO v_record;
  ELSE
    INSERT INTO public.medical_records (
      company_id, unit_id, patient_id, professional_id, appointment_id,
      record_date, anamnesis, evolution, vital_signs
    ) VALUES (
      v_appointment.company_id, v_appointment.unit_id, v_appointment.patient_id,
      v_appointment.professional_id, v_appointment.id, NOW(),
      p_anamnesis, p_evolution, p_vital_signs
    )
    RETURNING * INTO v_record;
  END IF;

  PERFORM public.update_appointment_status_secure(
    v_appointment.id,
    'completed',
    'Atendimento finalizado com prontuário'
  );

  RETURN to_jsonb(v_record);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_attendance_secure(BIGINT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_attendance_secure(BIGINT, TEXT, TEXT, JSONB)
  TO authenticated;

-- Fecha helpers legados sobre o contexto autorizado da sessão. As policies
-- antigas deixam de consultar company_id/role_name estáticos do perfil.
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT CASE
    WHEN public.current_application_session_is_active()
      THEN public.active_company_id()
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT public.get_my_company_id();
$$;

CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT COALESCE(
    p_user_id = auth.uid()
    AND public.current_application_session_is_active()
    AND public.current_context_is_company_admin(public.active_company_id()),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT COALESCE(
    p_user_id = auth.uid()
    AND public.current_application_session_is_active()
    AND public.active_company_id() IS NOT NULL,
    FALSE
  );
$$;

COMMENT ON FUNCTION public.get_my_company_id() IS
  'Compatibilidade legada: retorna somente a empresa do contexto AAL2 com sessão ativa.';
COMMENT ON FUNCTION public.current_company_id() IS
  'Alias de get_my_company_id(), fechado sobre o contexto ativo.';
COMMENT ON FUNCTION public.is_admin(UUID) IS
  'Valida o papel administrativo selecionado no contexto AAL2 e a sessão ativa.';
COMMENT ON FUNCTION public.is_staff(UUID) IS
  'Valida identidade, vínculo, contexto AAL2 e sessão ativa.';

REVOKE ALL ON FUNCTION public.get_my_company_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_company_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(UUID) TO authenticated;

-- Invariante final: nenhuma função SECURITY DEFINER do schema público pode
-- herdar EXECUTE de PUBLIC/anon. RPCs de browser precisam de GRANT explícito
-- para authenticated e de validação interna de contexto.
DO $$
DECLARE
  v_function RECORD;
BEGIN
  FOR v_function IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prokind = 'f'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon',
      v_function.schema_name,
      v_function.function_name,
      v_function.identity_arguments
    );
  END LOOP;
END;
$$;

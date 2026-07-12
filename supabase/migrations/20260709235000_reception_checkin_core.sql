CREATE TABLE IF NOT EXISTS public.reception_checkins (
 id BIGSERIAL PRIMARY KEY, company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
 patient_id BIGINT NOT NULL REFERENCES public.patients(id), appointment_id BIGINT UNIQUE REFERENCES public.appointments(id),
 unit_id INTEGER REFERENCES public.units(id), professional_id BIGINT REFERENCES public.professionals(id),
 status VARCHAR(30) NOT NULL DEFAULT 'checked_in', arrived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), checked_in_at TIMESTAMPTZ,
 forwarded_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, has_pending_issues BOOLEAN NOT NULL DEFAULT FALSE,
 has_authorization_pending BOOLEAN NOT NULL DEFAULT FALSE, has_document_pending BOOLEAN NOT NULL DEFAULT FALSE,
 has_payment_pending BOOLEAN NOT NULL DEFAULT FALSE, released_by_exception BOOLEAN NOT NULL DEFAULT FALSE,
 created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT reception_checkins_status_chk CHECK(status IN ('pre_checkin','checked_in','waiting_triage','waiting_care','in_care','completed','cancelled'))
);
CREATE TABLE IF NOT EXISTS public.reception_checkin_status_history (
 id BIGSERIAL PRIMARY KEY,checkin_id BIGINT NOT NULL REFERENCES public.reception_checkins(id) ON DELETE CASCADE,
 from_status VARCHAR(30),to_status VARCHAR(30) NOT NULL,reason TEXT,actor_user_id UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.reception_queue_tickets (
 id BIGSERIAL PRIMARY KEY,company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,checkin_id BIGINT NOT NULL UNIQUE REFERENCES public.reception_checkins(id) ON DELETE CASCADE,
 patient_id BIGINT REFERENCES public.patients(id),appointment_id BIGINT REFERENCES public.appointments(id),ticket_date DATE NOT NULL DEFAULT CURRENT_DATE,
 prefix VARCHAR(8) NOT NULL DEFAULT 'C',number INTEGER NOT NULL,priority VARCHAR(20) NOT NULL DEFAULT 'normal',sector VARCHAR(30) NOT NULL DEFAULT 'consulta',
 status VARCHAR(20) NOT NULL DEFAULT 'waiting',issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),called_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,
 CONSTRAINT reception_queue_priority_chk CHECK(priority IN ('normal','legal','urgent')),
 CONSTRAINT reception_queue_status_chk CHECK(status IN ('waiting','called','transferred','completed','cancelled','no_show')),UNIQUE(ticket_date,prefix,number)
);
CREATE TABLE IF NOT EXISTS public.reception_patient_pending_issues (
 id BIGSERIAL PRIMARY KEY,company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,checkin_id BIGINT REFERENCES public.reception_checkins(id) ON DELETE CASCADE,
 appointment_id BIGINT REFERENCES public.appointments(id),patient_id BIGINT REFERENCES public.patients(id),issue_type VARCHAR(40) NOT NULL,
 description TEXT NOT NULL,severity VARCHAR(20) NOT NULL DEFAULT 'blocking',status VARCHAR(20) NOT NULL DEFAULT 'open',resolved_at TIMESTAMPTZ,resolved_by UUID,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT reception_issue_severity_chk CHECK(severity IN ('warning','blocking')),
 CONSTRAINT reception_issue_status_chk CHECK(status IN ('open','resolved','waived'))
);
CREATE TABLE IF NOT EXISTS public.reception_exception_releases (
 id BIGSERIAL PRIMARY KEY,company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,checkin_id BIGINT NOT NULL REFERENCES public.reception_checkins(id),
 appointment_id BIGINT REFERENCES public.appointments(id),reason TEXT NOT NULL,risk_description TEXT,released_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reception_checkins_day ON public.reception_checkins(checked_in_at,status);
CREATE INDEX IF NOT EXISTS idx_reception_queue_waiting ON public.reception_queue_tickets(ticket_date,status,priority,issued_at);
CREATE INDEX IF NOT EXISTS idx_reception_issues_open ON public.reception_patient_pending_issues(status,severity,created_at);
DROP TRIGGER IF EXISTS trg_reception_checkins_updated_at ON public.reception_checkins;
CREATE TRIGGER trg_reception_checkins_updated_at BEFORE UPDATE ON public.reception_checkins FOR EACH ROW EXECUTE FUNCTION public.touch_scheduling_updated_at();

CREATE OR REPLACE FUNCTION public.get_reception_checkin_readiness(p_appointment_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_a appointments;v_p patients;v_a_json JSONB;v_p_json JSONB;v_issues JSONB:='[]'::JSONB;v_auth BOOLEAN:=FALSE;v_doc BOOLEAN:=FALSE;
BEGIN
 SELECT * INTO v_a FROM appointments WHERE id=p_appointment_id;IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado';END IF;
 SELECT * INTO v_p FROM patients WHERE id=v_a.patient_id;IF NOT FOUND THEN RAISE EXCEPTION 'Paciente nao encontrado';END IF;
 v_a_json:=to_jsonb(v_a);v_p_json:=to_jsonb(v_p);
 IF NULLIF(trim(COALESCE(v_p_json->>'full_name','')),'') IS NULL OR NULLIF(v_p_json->>'birth_date','') IS NULL THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('type','registration','severity','blocking','description','Cadastro minimo incompleto'));v_doc:=TRUE;END IF;
 IF NULLIF(v_a_json->>'insurance_company_id','') IS NOT NULL AND NULLIF(trim(COALESCE(v_a_json->>'ds_matricula',v_p_json->>'insurance_card_number',v_p_json->>'ds_matricula','')),'') IS NULL THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('type','insurance_card','severity','blocking','description','Carteirinha/matricula ausente'));END IF;
 IF EXISTS(SELECT 1 FROM reception_eligibility_checks e WHERE e.appointment_id=v_a.id AND e.status IN ('pendente','em_analise','nao_elegivel','portal_indisponivel')) THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('type','eligibility','severity','blocking','description','Elegibilidade pendente ou invalida'));END IF;
 IF EXISTS(SELECT 1 FROM reception_authorizations r WHERE r.appointment_id=v_a.id AND r.status NOT IN ('nao_necessaria','autorizada','parcialmente_autorizada','liberada_excecao')) THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('type','authorization','severity','blocking','description','Autorizacao pendente ou invalida'));v_auth:=TRUE;END IF;
 RETURN jsonb_build_object('appointment_id',v_a.id,'patient_id',v_a.patient_id,'ready',jsonb_array_length(v_issues)=0,'issues',v_issues,'has_authorization_pending',v_auth,'has_document_pending',v_doc);
END $$;

CREATE OR REPLACE FUNCTION public.perform_reception_checkin_secure(p_appointment_id BIGINT,p_priority TEXT DEFAULT 'normal',p_exception_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor RECORD;v_a appointments;v_ready JSONB;v_checkin reception_checkins;v_ticket reception_queue_tickets;v_number INTEGER;v_issue JSONB;v_exception BOOLEAN:=FALSE;
BEGIN
 SELECT * INTO v_actor FROM get_scheduling_actor();PERFORM assert_scheduling_permission();
 SELECT * INTO v_a FROM appointments WHERE id=p_appointment_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado';END IF;
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
 PERFORM pg_advisory_xact_lock(hashtext(CURRENT_DATE::TEXT),hashtext('reception-C'));SELECT COALESCE(max(number),0)+1 INTO v_number FROM reception_queue_tickets WHERE ticket_date=CURRENT_DATE AND prefix='C';
 INSERT INTO reception_queue_tickets(company_id,checkin_id,patient_id,appointment_id,prefix,number,priority,sector) VALUES(v_a.company_id,v_checkin.id,v_a.patient_id,v_a.id,'C',v_number,p_priority,CASE WHEN COALESCE(v_a.service_name,'')<>'' THEN 'procedimento' ELSE 'consulta' END) RETURNING * INTO v_ticket;
 PERFORM update_appointment_status_secure(v_a.id,'waiting','Check-in realizado - senha C'||lpad(v_number::TEXT,3,'0'));
 INSERT INTO reception_checkin_status_history(checkin_id,from_status,to_status,reason,actor_user_id) VALUES(v_checkin.id,NULL,'checked_in','Check-in presencial',v_actor.user_id);
 RETURN jsonb_build_object('checkin_id',v_checkin.id,'ticket_id',v_ticket.id,'ticket',v_ticket.prefix||lpad(v_ticket.number::TEXT,3,'0'),'released_by_exception',v_exception,'issues',v_ready->'issues');
END $$;

ALTER TABLE reception_checkins ENABLE ROW LEVEL SECURITY;ALTER TABLE reception_checkin_status_history ENABLE ROW LEVEL SECURITY;ALTER TABLE reception_queue_tickets ENABLE ROW LEVEL SECURITY;ALTER TABLE reception_patient_pending_issues ENABLE ROW LEVEL SECURITY;ALTER TABLE reception_exception_releases ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_prontomedic') THEN
 GRANT SELECT ON reception_checkins,reception_checkin_status_history,reception_queue_tickets,reception_patient_pending_issues,reception_exception_releases TO app_prontomedic;
 GRANT USAGE,SELECT ON SEQUENCE reception_checkins_id_seq,reception_checkin_status_history_id_seq,reception_queue_tickets_id_seq,reception_patient_pending_issues_id_seq,reception_exception_releases_id_seq TO app_prontomedic;
 GRANT EXECUTE ON FUNCTION get_reception_checkin_readiness(BIGINT),perform_reception_checkin_secure(BIGINT,TEXT,TEXT) TO app_prontomedic;
END IF;END $$;

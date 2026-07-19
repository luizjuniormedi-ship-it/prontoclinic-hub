-- P0 reception/insurance foundation.
-- Canonical storage is insurance_*; reception_* are read-only compatibility
-- projections for the existing frontend query contract.
-- This migration intentionally fails when legacy reception tables already hold
-- data. No implicit rename, backfill, or destructive reconciliation is allowed.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.reception_authorizations') IS NOT NULL
     AND (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.reception_authorizations')) = 'r' THEN
    RAISE EXCEPTION 'Legacy table public.reception_authorizations detected; reconcile manually before canonical migration';
  END IF;
  IF to_regclass('public.reception_eligibility_checks') IS NOT NULL
     AND (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.reception_eligibility_checks')) = 'r' THEN
    RAISE EXCEPTION 'Legacy table public.reception_eligibility_checks detected; reconcile manually before canonical migration';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.insurance_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE SET NULL,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  insurance_id INTEGER,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE SET NULL,
  procedure_id BIGINT,
  procedure_desc TEXT,
  requester_professional_id BIGINT,
  status VARCHAR(40) NOT NULL DEFAULT 'pendente',
  protocol_number VARCHAR(120),
  authorization_number VARCHAR(120),
  password_number VARCHAR(120),
  valid_until DATE,
  quantity_requested INTEGER NOT NULL DEFAULT 1,
  quantity_authorized INTEGER NOT NULL DEFAULT 0,
  quantity_used INTEGER NOT NULL DEFAULT 0,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  authorized_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ,
  denial_reason TEXT,
  notes TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT insurance_authorizations_status_chk CHECK (status IN (
    'pendente','solicitada','em_analise','autorizada','parcialmente_autorizada',
    'negada','vencida','cancelada','reenviada','liberada_excecao','nao_necessaria'
  )),
  CONSTRAINT insurance_authorizations_quantity_chk CHECK (
    quantity_requested >= 0 AND quantity_authorized >= 0 AND quantity_used >= 0
  )
);

CREATE TABLE IF NOT EXISTS public.insurance_eligibility_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE SET NULL,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  insurance_id INTEGER,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE SET NULL,
  card_number VARCHAR(120),
  status VARCHAR(40) NOT NULL DEFAULT 'pendente',
  protocol_number VARCHAR(120),
  source VARCHAR(40),
  result_detail TEXT,
  checked_at TIMESTAMPTZ,
  checked_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT insurance_eligibility_status_chk CHECK (status IN (
    'elegivel','nao_elegivel','pendente','em_analise','portal_indisponivel',
    'nao_obrigatoria','liberado_excecao'
  ))
);

CREATE INDEX IF NOT EXISTS idx_insurance_authorizations_company_status
  ON public.insurance_authorizations(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_authorizations_appointment
  ON public.insurance_authorizations(appointment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_eligibility_company_status
  ON public.insurance_eligibility_checks(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_eligibility_appointment
  ON public.insurance_eligibility_checks(appointment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.reception_checkins (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id),
  appointment_id BIGINT NOT NULL UNIQUE REFERENCES public.appointments(id),
  status VARCHAR(30) NOT NULL DEFAULT 'checked_in',
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  released_by_exception BOOLEAN NOT NULL DEFAULT FALSE,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reception_checkins_status_chk CHECK (status IN ('checked_in','waiting','in_care','completed','cancelled')),
  CONSTRAINT reception_checkins_priority_chk CHECK (priority IN ('normal','legal','urgent'))
);

CREATE TABLE IF NOT EXISTS public.reception_queue_tickets (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  checkin_id BIGINT NOT NULL UNIQUE REFERENCES public.reception_checkins(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  ticket_date DATE NOT NULL DEFAULT CURRENT_DATE,
  prefix VARCHAR(8) NOT NULL DEFAULT 'C',
  number INTEGER NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ticket_date, prefix, number)
);

CREATE TABLE IF NOT EXISTS public.reception_admin_history (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type VARCHAR(40) NOT NULL,
  entity_id TEXT NOT NULL,
  appointment_id BIGINT REFERENCES public.appointments(id),
  from_status VARCHAR(40),
  to_status VARCHAR(40) NOT NULL,
  reason TEXT,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Compatibility names used by existing reception/scheduling queries.
CREATE OR REPLACE VIEW public.reception_authorizations
WITH (security_invoker = true) AS
SELECT * FROM public.insurance_authorizations;

CREATE OR REPLACE VIEW public.reception_eligibility_checks
WITH (security_invoker = true) AS
SELECT * FROM public.insurance_eligibility_checks;

ALTER TABLE public.insurance_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_eligibility_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_queue_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_admin_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS insurance_authorizations_tenant ON public.insurance_authorizations;
CREATE POLICY insurance_authorizations_tenant ON public.insurance_authorizations
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS insurance_eligibility_tenant ON public.insurance_eligibility_checks;
CREATE POLICY insurance_eligibility_tenant ON public.insurance_eligibility_checks
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS reception_checkins_tenant ON public.reception_checkins;
CREATE POLICY reception_checkins_tenant ON public.reception_checkins
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS reception_queue_tenant ON public.reception_queue_tickets;
CREATE POLICY reception_queue_tenant ON public.reception_queue_tickets
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS reception_admin_history_tenant ON public.reception_admin_history;
CREATE POLICY reception_admin_history_tenant ON public.reception_admin_history
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

REVOKE ALL ON public.reception_authorizations, public.reception_eligibility_checks FROM PUBLIC, anon;
GRANT SELECT ON public.reception_authorizations, public.reception_eligibility_checks TO authenticated;
REVOKE ALL ON public.reception_admin_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reception_admin_history TO authenticated;

CREATE OR REPLACE FUNCTION public.get_reception_checkin_readiness(p_appointment_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_appointment public.appointments;
  v_issues JSONB := '[]'::JSONB;
  v_auth_pending BOOLEAN;
BEGIN
  SELECT * INTO v_appointment FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado'; END IF;
  IF v_appointment.company_id <> public.get_my_company_id() THEN
    RAISE EXCEPTION 'Agendamento fora do tenant';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.insurance_authorizations a
    WHERE a.appointment_id = p_appointment_id
      AND a.status NOT IN ('nao_necessaria','autorizada','parcialmente_autorizada','liberada_excecao')
  ) INTO v_auth_pending;
  IF v_auth_pending THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'type','authorization','severity','blocking','description','Autorizacao pendente ou invalida'
    ));
  END IF;
  RETURN jsonb_build_object(
    'appointment_id', v_appointment.id,
    'patient_id', v_appointment.patient_id,
    'ready', jsonb_array_length(v_issues) = 0,
    'issues', v_issues,
    'has_authorization_pending', v_auth_pending,
    'has_document_pending', FALSE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.perform_reception_checkin_secure(
  p_appointment_id BIGINT,
  p_priority TEXT DEFAULT 'normal',
  p_exception_reason TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_appointment public.appointments;
  v_readiness JSONB;
  v_checkin public.reception_checkins;
  v_ticket public.reception_queue_tickets;
  v_number INTEGER;
  v_actor RECORD;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  SELECT * INTO v_appointment FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado'; END IF;
  IF v_appointment.company_id <> public.get_my_company_id() THEN RAISE EXCEPTION 'Agendamento fora do tenant'; END IF;
  IF p_priority NOT IN ('normal','legal','urgent') THEN RAISE EXCEPTION 'Prioridade invalida'; END IF;
  v_readiness := public.get_reception_checkin_readiness(p_appointment_id);
  IF NOT (v_readiness->>'ready')::BOOLEAN AND NULLIF(trim(COALESCE(p_exception_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Check-in bloqueado por pendencias';
  END IF;
  INSERT INTO public.reception_checkins(company_id,patient_id,appointment_id,status,priority,released_by_exception,created_by)
  VALUES(v_appointment.company_id,v_appointment.patient_id,v_appointment.id,'checked_in',p_priority,
    NOT (v_readiness->>'ready')::BOOLEAN,v_actor.user_id)
  RETURNING * INTO v_checkin;
  PERFORM pg_advisory_xact_lock(hashtext(CURRENT_DATE::TEXT), hashtext('reception-C'));
  SELECT COALESCE(max(number),0)+1 INTO v_number
    FROM public.reception_queue_tickets WHERE ticket_date = CURRENT_DATE AND prefix = 'C';
  INSERT INTO public.reception_queue_tickets(company_id,checkin_id,patient_id,appointment_id,number,priority)
  VALUES(v_appointment.company_id,v_checkin.id,v_appointment.patient_id,v_appointment.id,v_number,p_priority)
  RETURNING * INTO v_ticket;
  IF to_regprocedure('public.update_appointment_status_secure(bigint,text,text)') IS NOT NULL THEN
    PERFORM public.update_appointment_status_secure(v_appointment.id, 'waiting', 'Check-in realizado');
  END IF;
  RETURN jsonb_build_object('checkin_id',v_checkin.id,'ticket_id',v_ticket.id,
    'ticket',v_ticket.prefix || lpad(v_ticket.number::TEXT,3,'0'),
    'released_by_exception',v_checkin.released_by_exception,'issues',v_readiness->'issues');
END;
$$;

CREATE OR REPLACE FUNCTION public.update_reception_authorization_secure(
  p_authorization_id UUID, p_status TEXT, p_protocol_number TEXT DEFAULT NULL,
  p_authorization_number TEXT DEFAULT NULL, p_password_number TEXT DEFAULT NULL,
  p_valid_until DATE DEFAULT NULL, p_quantity_authorized INTEGER DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old public.insurance_authorizations; v_new public.insurance_authorizations; v_actor RECORD;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  SELECT * INTO v_old FROM public.insurance_authorizations WHERE id = p_authorization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Autorizacao nao encontrada'; END IF;
  IF v_old.company_id <> public.get_my_company_id() THEN RAISE EXCEPTION 'Autorizacao fora do tenant'; END IF;
  IF p_status NOT IN ('pendente','solicitada','em_analise','autorizada','parcialmente_autorizada','negada','vencida','cancelada','reenviada','liberada_excecao','nao_necessaria') THEN RAISE EXCEPTION 'Status de autorizacao invalido'; END IF;
  IF p_status IN ('autorizada','parcialmente_autorizada') AND NULLIF(trim(COALESCE(p_authorization_number,'')), '') IS NULL THEN RAISE EXCEPTION 'Numero da autorizacao e obrigatorio'; END IF;
  IF p_status = 'negada' AND NULLIF(trim(COALESCE(p_reason,'')), '') IS NULL THEN RAISE EXCEPTION 'Motivo da negativa e obrigatorio'; END IF;
  UPDATE public.insurance_authorizations SET status=p_status,
    protocol_number=COALESCE(NULLIF(trim(COALESCE(p_protocol_number,'')),''),protocol_number),
    authorization_number=COALESCE(NULLIF(trim(COALESCE(p_authorization_number,'')),''),authorization_number),
    password_number=COALESCE(NULLIF(trim(COALESCE(p_password_number,'')),''),password_number),
    valid_until=COALESCE(p_valid_until,valid_until),
    quantity_authorized=COALESCE(p_quantity_authorized,quantity_authorized),
    authorized_at=CASE WHEN p_status IN ('autorizada','parcialmente_autorizada','liberada_excecao') THEN NOW() ELSE authorized_at END,
    denied_at=CASE WHEN p_status='negada' THEN NOW() ELSE denied_at END,
    denial_reason=CASE WHEN p_status='negada' THEN p_reason ELSE denial_reason END,
    notes=concat_ws(E'\n',notes,NULLIF(trim(COALESCE(p_reason,'')),'')),updated_by=v_actor.user_id,updated_at=NOW()
    WHERE id=p_authorization_id RETURNING * INTO v_new;
  INSERT INTO public.reception_admin_history(company_id,entity_type,entity_id,appointment_id,from_status,to_status,reason,actor_user_id)
  VALUES(v_new.company_id,'authorization',v_new.id::TEXT,v_new.appointment_id,v_old.status,v_new.status,p_reason,v_actor.user_id);
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_reception_eligibility_secure(
  p_eligibility_id UUID, p_status TEXT, p_protocol_number TEXT DEFAULT NULL,
  p_result_detail TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old public.insurance_eligibility_checks; v_new public.insurance_eligibility_checks; v_actor RECORD;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  SELECT * INTO v_old FROM public.insurance_eligibility_checks WHERE id=p_eligibility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Elegibilidade nao encontrada'; END IF;
  IF v_old.company_id <> public.get_my_company_id() THEN RAISE EXCEPTION 'Elegibilidade fora do tenant'; END IF;
  IF p_status NOT IN ('elegivel','nao_elegivel','pendente','em_analise','portal_indisponivel','nao_obrigatoria','liberado_excecao') THEN RAISE EXCEPTION 'Status de elegibilidade invalido'; END IF;
  UPDATE public.insurance_eligibility_checks SET status=p_status,
    protocol_number=COALESCE(NULLIF(trim(COALESCE(p_protocol_number,'')),''),protocol_number),
    result_detail=COALESCE(NULLIF(trim(COALESCE(p_result_detail,'')),''),result_detail),
    checked_at=CASE WHEN p_status NOT IN ('pendente','em_analise') THEN NOW() ELSE checked_at END,
    checked_by=v_actor.user_id,updated_at=NOW() WHERE id=p_eligibility_id RETURNING * INTO v_new;
  INSERT INTO public.reception_admin_history(company_id,entity_type,entity_id,appointment_id,from_status,to_status,reason,actor_user_id)
  VALUES(v_new.company_id,'eligibility',v_new.id::TEXT,v_new.appointment_id,v_old.status,v_new.status,p_result_detail,v_actor.user_id);
  RETURN to_jsonb(v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.get_reception_checkin_readiness(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.perform_reception_checkin_secure(BIGINT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_reception_authorization_secure(UUID,TEXT,TEXT,TEXT,TEXT,DATE,INTEGER,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_reception_eligibility_secure(UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reception_checkin_readiness(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perform_reception_checkin_secure(BIGINT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_reception_authorization_secure(UUID,TEXT,TEXT,TEXT,TEXT,DATE,INTEGER,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_reception_eligibility_secure(UUID,TEXT,TEXT,TEXT) TO authenticated;

COMMIT;

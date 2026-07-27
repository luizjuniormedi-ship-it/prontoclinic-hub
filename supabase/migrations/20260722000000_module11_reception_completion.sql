-- Module 11: complete reception operations.
-- Additive only. DataSIGH is not referenced.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.appointments') IS NULL
     OR to_regclass('public.reception_checkins') IS NULL
     OR to_regclass('public.reception_admin_history') IS NULL THEN
    RAISE EXCEPTION 'Module 11 reception foundation is missing';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.reception_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE RESTRICT,
  checkin_id BIGINT REFERENCES public.reception_checkins(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  payment_method VARCHAR(30) NOT NULL CHECK (payment_method IN ('cash','debit','credit','pix','transfer','other')),
  payment_type VARCHAR(20) NOT NULL DEFAULT 'copayment' CHECK (payment_type IN ('copayment','private','refund')),
  status VARCHAR(20) NOT NULL DEFAULT 'paid' CHECK (status IN ('pending','paid','voided')),
  receipt_number VARCHAR(80),
  notes TEXT,
  paid_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reception_term_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE RESTRICT,
  term_code VARCHAR(80) NOT NULL,
  term_version VARCHAR(30) NOT NULL,
  content_hash VARCHAR(128) NOT NULL,
  accepted_by UUID REFERENCES auth.users(id),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  signature_reference VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reception_document_pickups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE RESTRICT,
  document_type VARCHAR(60) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','ready','released','cancelled')),
  recipient_name VARCHAR(200),
  recipient_cpf VARCHAR(14),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  released_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.reception_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_term_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_document_pickups ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_reception_payments_scope
  ON public.reception_payments(company_id, unit_id, appointment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reception_terms_scope
  ON public.reception_term_acceptances(company_id, patient_id, term_code, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_reception_pickups_scope
  ON public.reception_document_pickups(company_id, unit_id, status, requested_at DESC);

DROP POLICY IF EXISTS m11_reception_payments_read ON public.reception_payments;
DROP POLICY IF EXISTS m11_reception_terms_read ON public.reception_term_acceptances;
DROP POLICY IF EXISTS m11_reception_pickups_read ON public.reception_document_pickups;
CREATE POLICY m11_reception_payments_read ON public.reception_payments
  FOR SELECT TO authenticated, app_prontomedic
  USING (company_id = public.current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id)));
CREATE POLICY m11_reception_terms_read ON public.reception_term_acceptances
  FOR SELECT TO authenticated, app_prontomedic
  USING (company_id = public.current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id)));
CREATE POLICY m11_reception_pickups_read ON public.reception_document_pickups
  FOR SELECT TO authenticated, app_prontomedic
  USING (company_id = public.current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id)));

REVOKE INSERT, UPDATE, DELETE ON public.reception_payments,
  public.reception_term_acceptances, public.reception_document_pickups
  FROM authenticated, app_prontomedic;
GRANT SELECT ON public.reception_payments,
  public.reception_term_acceptances, public.reception_document_pickups
  TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.m11_reception_assert_appointment(
  p_appointment_id BIGINT,
  OUT v_company_id UUID,
  OUT v_unit_id INTEGER,
  OUT v_patient_id BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_appointment public.appointments;
BEGIN
  SELECT * INTO v_appointment FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado'; END IF;
  v_company_id := v_appointment.company_id;
  v_unit_id := v_appointment.unit_id;
  v_patient_id := v_appointment.patient_id;
  IF v_company_id <> public.current_company_id() THEN RAISE EXCEPTION 'Agendamento fora do tenant'; END IF;
  IF v_unit_id IS NOT NULL AND NOT public.org_can_access_unit(v_company_id, v_unit_id) THEN
    RAISE EXCEPTION 'Agendamento fora da unidade autorizada';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.m11_reception_assert_appointment(BIGINT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.record_reception_payment_secure(
  p_appointment_id BIGINT,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_payment_type TEXT DEFAULT 'copayment',
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company UUID;
  v_unit INTEGER;
  v_patient BIGINT;
  v_id UUID;
  v_actor RECORD;
BEGIN
  IF NOT public.audit_has_role(ARRAY['admin','gestor','recepcao','billing','financial']::TEXT[]) THEN
    RAISE EXCEPTION 'Perfil sem permissao para registrar pagamento';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'Valor de pagamento invalido'; END IF;
  IF p_payment_method NOT IN ('cash','debit','credit','pix','transfer','other') THEN RAISE EXCEPTION 'Metodo de pagamento invalido'; END IF;
  IF p_payment_type NOT IN ('copayment','private','refund') THEN RAISE EXCEPTION 'Tipo de pagamento invalido'; END IF;
  SELECT v_company_id, v_unit_id, v_patient_id INTO v_company, v_unit, v_patient
    FROM public.m11_reception_assert_appointment(p_appointment_id);
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  INSERT INTO public.reception_payments(company_id,unit_id,patient_id,appointment_id,amount,payment_method,payment_type,status,notes,paid_at,created_by)
  VALUES (v_company,v_unit,v_patient,p_appointment_id,p_amount,p_payment_method,p_payment_type,'paid',NULLIF(btrim(p_notes),''),NOW(),v_actor.user_id)
  RETURNING id INTO v_id;
  INSERT INTO public.reception_admin_history(company_id,unit_id,entity_type,entity_id,appointment_id,from_status,to_status,reason,details,actor_user_id)
  VALUES (v_company,v_unit,'payment',v_id::TEXT,p_appointment_id,'pending','paid','Pagamento registrado',jsonb_build_object('amount',p_amount,'method',p_payment_method,'type',p_payment_type),v_actor.user_id);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_reception_payment_secure(BIGINT,NUMERIC,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_reception_payment_secure(BIGINT,NUMERIC,TEXT,TEXT,TEXT) TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.record_reception_term_acceptance_secure(
  p_patient_id BIGINT,
  p_term_code TEXT,
  p_term_version TEXT,
  p_content_hash TEXT,
  p_appointment_id BIGINT DEFAULT NULL,
  p_signature_reference TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company UUID := public.current_company_id();
  v_unit INTEGER;
  v_id UUID;
  v_actor UUID := NULLIF(current_setting('request.jwt.claim.sub', true),'')::UUID;
BEGIN
  IF NOT public.audit_has_role(ARRAY['admin','gestor','recepcao','billing','financial','medico','enfermeiro']::TEXT[]) THEN RAISE EXCEPTION 'Perfil sem permissao para aceitar termo'; END IF;
  IF v_company IS NULL OR p_patient_id IS NULL OR NULLIF(btrim(p_term_code),'') IS NULL OR NULLIF(btrim(p_term_version),'') IS NULL OR NULLIF(btrim(p_content_hash),'') IS NULL THEN
    RAISE EXCEPTION 'Paciente, termo, versao e hash sao obrigatorios';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id=p_patient_id AND company_id=v_company) THEN RAISE EXCEPTION 'Paciente fora do tenant'; END IF;
  IF p_appointment_id IS NOT NULL THEN
    SELECT unit_id INTO v_unit FROM public.appointments WHERE id=p_appointment_id AND patient_id=p_patient_id AND company_id=v_company;
    IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento invalido para o paciente'; END IF;
  END IF;
  INSERT INTO public.reception_term_acceptances(company_id,unit_id,patient_id,appointment_id,term_code,term_version,content_hash,accepted_by,signature_reference)
  VALUES(v_company,v_unit,p_patient_id,p_appointment_id,btrim(p_term_code),btrim(p_term_version),btrim(p_content_hash),v_actor,NULLIF(btrim(p_signature_reference),''))
  RETURNING id INTO v_id;
  INSERT INTO public.reception_admin_history(company_id,unit_id,entity_type,entity_id,appointment_id,from_status,to_status,reason,details,actor_user_id)
  VALUES(v_company,v_unit,'term_acceptance',v_id::TEXT,p_appointment_id,NULL,'accepted','Termo aceito',jsonb_build_object('term_code',btrim(p_term_code),'term_version',btrim(p_term_version),'content_hash',btrim(p_content_hash)),v_actor);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_reception_term_acceptance_secure(BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_reception_term_acceptance_secure(BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT) TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.create_reception_document_pickup_secure(
  p_patient_id BIGINT,
  p_document_type TEXT,
  p_appointment_id BIGINT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company UUID := public.current_company_id();
  v_unit INTEGER;
  v_id UUID;
  v_actor UUID := NULLIF(current_setting('request.jwt.claim.sub', true),'')::UUID;
BEGIN
  IF NOT public.audit_has_role(ARRAY['admin','gestor','recepcao','billing']::TEXT[]) THEN RAISE EXCEPTION 'Perfil sem permissao para retirada'; END IF;
  IF NULLIF(btrim(p_document_type),'') IS NULL THEN RAISE EXCEPTION 'Tipo de documento obrigatorio'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id=p_patient_id AND company_id=v_company) THEN RAISE EXCEPTION 'Paciente fora do tenant'; END IF;
  IF p_appointment_id IS NOT NULL THEN
    SELECT unit_id INTO v_unit FROM public.appointments WHERE id=p_appointment_id AND patient_id=p_patient_id AND company_id=v_company;
    IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento invalido para o paciente'; END IF;
  END IF;
  INSERT INTO public.reception_document_pickups(company_id,unit_id,patient_id,appointment_id,document_type,notes,created_by)
  VALUES(v_company,v_unit,p_patient_id,p_appointment_id,btrim(p_document_type),NULLIF(btrim(p_notes),''),v_actor)
  RETURNING id INTO v_id;
  INSERT INTO public.reception_admin_history(company_id,unit_id,entity_type,entity_id,appointment_id,from_status,to_status,reason,details,actor_user_id)
  VALUES(v_company,v_unit,'document_pickup',v_id::TEXT,p_appointment_id,NULL,'requested','Retirada solicitada',jsonb_build_object('document_type',btrim(p_document_type)),v_actor);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_reception_document_pickup_secure(BIGINT,TEXT,BIGINT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_reception_document_pickup_secure(BIGINT,TEXT,BIGINT,TEXT) TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.release_reception_document_pickup_secure(
  p_pickup_id UUID,
  p_recipient_name TEXT,
  p_recipient_cpf TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pickup public.reception_document_pickups;
  v_actor UUID := NULLIF(current_setting('request.jwt.claim.sub', true),'')::UUID;
BEGIN
  IF NOT public.audit_has_role(ARRAY['admin','gestor','recepcao']::TEXT[]) THEN RAISE EXCEPTION 'Perfil sem permissao para liberar documento'; END IF;
  SELECT * INTO v_pickup FROM public.reception_document_pickups WHERE id=p_pickup_id FOR UPDATE;
  IF NOT FOUND OR v_pickup.company_id <> public.current_company_id() THEN RAISE EXCEPTION 'Retirada fora do tenant'; END IF;
  IF v_pickup.unit_id IS NOT NULL AND NOT public.org_can_access_unit(v_pickup.company_id,v_pickup.unit_id) THEN RAISE EXCEPTION 'Retirada fora da unidade autorizada'; END IF;
  IF v_pickup.status NOT IN ('requested','ready') THEN RAISE EXCEPTION 'Retirada nao esta pendente'; END IF;
  IF NULLIF(btrim(p_recipient_name),'') IS NULL OR NULLIF(btrim(p_recipient_cpf),'') IS NULL THEN RAISE EXCEPTION 'Nome e CPF do recebedor sao obrigatorios'; END IF;
  UPDATE public.reception_document_pickups SET status='released',recipient_name=btrim(p_recipient_name),recipient_cpf=regexp_replace(p_recipient_cpf,'[^0-9]','','g'),released_at=NOW(),released_by=v_actor,updated_at=NOW() WHERE id=p_pickup_id;
  INSERT INTO public.reception_admin_history(company_id,unit_id,entity_type,entity_id,appointment_id,from_status,to_status,reason,details,actor_user_id)
  VALUES(v_pickup.company_id,v_pickup.unit_id,'document_pickup',p_pickup_id::TEXT,v_pickup.appointment_id,v_pickup.status,'released','Documento entregue',jsonb_build_object('recipient_name',btrim(p_recipient_name),'recipient_cpf',regexp_replace(p_recipient_cpf,'[^0-9]','','g')),v_actor);
END;
$$;
REVOKE ALL ON FUNCTION public.release_reception_document_pickup_secure(UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_reception_document_pickup_secure(UUID,TEXT,TEXT) TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.create_reception_walkin_secure(
  p_patient_id BIGINT,
  p_unit_id INTEGER,
  p_appointment_type_id BIGINT DEFAULT NULL,
  p_professional_id BIGINT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company UUID := public.current_company_id();
  v_id BIGINT;
  v_actor UUID := NULLIF(current_setting('request.jwt.claim.sub', true),'')::UUID;
BEGIN
  PERFORM public.assert_scheduling_permission();
  IF NOT public.audit_has_role(ARRAY['admin','gestor','recepcao']::TEXT[]) THEN RAISE EXCEPTION 'Perfil sem permissao para atendimento espontaneo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id=p_patient_id AND company_id=v_company) THEN RAISE EXCEPTION 'Paciente fora do tenant'; END IF;
  IF p_unit_id IS NULL OR NOT public.org_can_access_unit(v_company,p_unit_id) THEN RAISE EXCEPTION 'Unidade fora do escopo'; END IF;
  INSERT INTO public.appointments(company_id,patient_id,unit_id,appointment_type_id,professional_id,appointment_date,start_time,end_time,status,notes,is_walkin)
  VALUES(v_company,p_patient_id,p_unit_id,p_appointment_type_id,p_professional_id,CURRENT_DATE,LOCALTIME(0)::TIME,LOCALTIME(0)::TIME + INTERVAL '30 minutes','scheduled',NULLIF(btrim(p_notes),''),TRUE)
  RETURNING id INTO v_id;
  INSERT INTO public.reception_admin_history(company_id,unit_id,entity_type,entity_id,appointment_id,from_status,to_status,reason,details,actor_user_id)
  VALUES(v_company,p_unit_id,'walkin',v_id::TEXT,v_id,NULL,'scheduled','Atendimento espontaneo criado',jsonb_build_object('patient_id',p_patient_id),v_actor);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_reception_walkin_secure(BIGINT,INTEGER,BIGINT,BIGINT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_reception_walkin_secure(BIGINT,INTEGER,BIGINT,BIGINT,TEXT) TO authenticated, app_prontomedic;

DO $$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.prontomedic_deployment_migrations WHERE filename='20260722000000_module11_reception_completion.sql') THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260722000000_module11_reception_completion.sql', NOW());
  END IF;
END
$$;

COMMIT;

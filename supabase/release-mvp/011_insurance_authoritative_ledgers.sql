-- MVP release baseline: immutable insurance ledgers.
-- No backfill, merge or approximate reconciliation is performed here.

CREATE TABLE public.insurance_authorization_history (
  id BIGSERIAL PRIMARY KEY,
  source_authorization_id UUID NOT NULL REFERENCES public.insurance_authorizations(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  insurance_id INTEGER REFERENCES public.insurance_companies(id),
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE SET NULL,
  procedure_id BIGINT,
  previous_status VARCHAR(40),
  status VARCHAR(40) NOT NULL,
  protocol_number VARCHAR,
  authorization_number VARCHAR,
  password_number VARCHAR,
  valid_until DATE,
  quantity_requested INTEGER,
  quantity_authorized INTEGER,
  quantity_used INTEGER,
  denial_reason TEXT,
  notes TEXT,
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_authorization_id, version)
);

CREATE TABLE public.insurance_eligibility_history (
  id BIGSERIAL PRIMARY KEY,
  source_eligibility_id UUID NOT NULL REFERENCES public.insurance_eligibility_checks(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  insurance_id INTEGER REFERENCES public.insurance_companies(id),
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE SET NULL,
  card_number VARCHAR,
  previous_status VARCHAR(40),
  status VARCHAR(40) NOT NULL,
  protocol_number VARCHAR,
  result_detail TEXT,
  source VARCHAR,
  checked_at TIMESTAMPTZ,
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_eligibility_id, version)
);

CREATE INDEX insurance_authorization_history_appointment_idx
  ON public.insurance_authorization_history(appointment_id, changed_at DESC);
CREATE INDEX insurance_eligibility_history_appointment_idx
  ON public.insurance_eligibility_history(appointment_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.capture_insurance_authorization_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
  FROM public.insurance_authorization_history WHERE source_authorization_id = NEW.id;
  INSERT INTO public.insurance_authorization_history(
    source_authorization_id, version, company_id, patient_id, appointment_id,
    insurance_id, insurance_plan_id, procedure_id, previous_status, status,
    protocol_number, authorization_number, password_number, valid_until,
    quantity_requested, quantity_authorized, quantity_used, denial_reason,
    notes, changed_by
  ) VALUES (
    NEW.id, v_version, NEW.company_id, NEW.patient_id, NEW.appointment_id,
    NEW.insurance_id, NEW.insurance_plan_id, NEW.procedure_id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END, NEW.status,
    NEW.protocol_number, NEW.authorization_number, NEW.password_number,
    NEW.valid_until, NEW.quantity_requested, NEW.quantity_authorized,
    NEW.quantity_used, NEW.denial_reason, NEW.notes, COALESCE(NEW.updated_by, NEW.created_by)
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.capture_insurance_eligibility_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
  FROM public.insurance_eligibility_history WHERE source_eligibility_id = NEW.id;
  INSERT INTO public.insurance_eligibility_history(
    source_eligibility_id, version, company_id, patient_id, appointment_id,
    insurance_id, insurance_plan_id, card_number, previous_status, status,
    protocol_number, result_detail, source, checked_at, changed_by
  ) VALUES (
    NEW.id, v_version, NEW.company_id, NEW.patient_id, NEW.appointment_id,
    NEW.insurance_id, NEW.insurance_plan_id, NEW.card_number,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END, NEW.status,
    NEW.protocol_number, NEW.result_detail, NEW.source, NEW.checked_at, NEW.checked_by
  );
  RETURN NEW;
END $$;

CREATE TRIGGER capture_insurance_authorization_history_after_write
  AFTER INSERT OR UPDATE ON public.insurance_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.capture_insurance_authorization_history();
CREATE TRIGGER capture_insurance_eligibility_history_after_write
  AFTER INSERT OR UPDATE ON public.insurance_eligibility_checks
  FOR EACH ROW EXECUTE FUNCTION public.capture_insurance_eligibility_history();

CREATE OR REPLACE FUNCTION public.prevent_insurance_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Historico oficial de convenios e imutavel';
END $$;

CREATE TRIGGER prevent_insurance_authorization_history_mutation
  BEFORE UPDATE OR DELETE ON public.insurance_authorization_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_insurance_history_mutation();
CREATE TRIGGER prevent_insurance_eligibility_history_mutation
  BEFORE UPDATE OR DELETE ON public.insurance_eligibility_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_insurance_history_mutation();

ALTER TABLE public.insurance_authorization_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_eligibility_history ENABLE ROW LEVEL SECURITY;


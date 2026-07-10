-- Convênios is the authoritative owner of eligibility/authorization history.
-- Reception tables remain operational workflow projections.

CREATE TABLE IF NOT EXISTS public.insurance_authorization_history (
 id BIGSERIAL PRIMARY KEY,source_authorization_id UUID NOT NULL REFERENCES public.reception_authorizations(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL,company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,patient_id BIGINT REFERENCES public.patients(id),
 appointment_id BIGINT REFERENCES public.appointments(id),insurance_id INTEGER REFERENCES public.insurance_companies(id),insurance_plan_id VARCHAR,
 procedure_id BIGINT,previous_status VARCHAR(40),status VARCHAR(40) NOT NULL,protocol_number VARCHAR,authorization_number VARCHAR,
 password_number VARCHAR,valid_until DATE,quantity_requested INTEGER,quantity_authorized INTEGER,quantity_used INTEGER,
 denial_reason TEXT,notes TEXT,changed_by UUID,changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(source_authorization_id,version)
);
CREATE TABLE IF NOT EXISTS public.insurance_eligibility_history (
 id BIGSERIAL PRIMARY KEY,source_eligibility_id UUID NOT NULL REFERENCES public.reception_eligibility_checks(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL,company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,patient_id BIGINT REFERENCES public.patients(id),
 appointment_id BIGINT REFERENCES public.appointments(id),insurance_id INTEGER REFERENCES public.insurance_companies(id),insurance_plan_id VARCHAR,
 card_number VARCHAR,previous_status VARCHAR(40),status VARCHAR(40) NOT NULL,protocol_number VARCHAR,result_detail TEXT,source VARCHAR,
 checked_at TIMESTAMPTZ,changed_by UUID,changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(source_eligibility_id,version)
);
CREATE INDEX IF NOT EXISTS idx_insurance_auth_history_appointment ON public.insurance_authorization_history(appointment_id,changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_auth_history_insurance ON public.insurance_authorization_history(insurance_id,status,changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_elig_history_appointment ON public.insurance_eligibility_history(appointment_id,changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_elig_history_insurance ON public.insurance_eligibility_history(insurance_id,status,changed_at DESC);

CREATE OR REPLACE FUNCTION public.capture_insurance_authorization_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_version INTEGER;
BEGIN
 SELECT COALESCE(max(version),0)+1 INTO v_version FROM insurance_authorization_history WHERE source_authorization_id=NEW.id;
 INSERT INTO insurance_authorization_history(source_authorization_id,version,company_id,patient_id,appointment_id,insurance_id,insurance_plan_id,procedure_id,
 previous_status,status,protocol_number,authorization_number,password_number,valid_until,quantity_requested,quantity_authorized,quantity_used,denial_reason,notes,changed_by)
 VALUES(NEW.id,v_version,NEW.company_id,NEW.patient_id,NEW.appointment_id,NEW.insurance_id,NEW.insurance_plan_id,NEW.procedure_id,
 CASE WHEN TG_OP='UPDATE' THEN OLD.status ELSE NULL END,NEW.status,NEW.protocol_number,NEW.authorization_number,NEW.password_number,NEW.valid_until,
 NEW.quantity_requested,NEW.quantity_authorized,NEW.quantity_used,NEW.denial_reason,NEW.notes,COALESCE(NEW.updated_by,NEW.created_by));
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.capture_insurance_eligibility_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_version INTEGER;
BEGIN
 SELECT COALESCE(max(version),0)+1 INTO v_version FROM insurance_eligibility_history WHERE source_eligibility_id=NEW.id;
 INSERT INTO insurance_eligibility_history(source_eligibility_id,version,company_id,patient_id,appointment_id,insurance_id,insurance_plan_id,card_number,
 previous_status,status,protocol_number,result_detail,source,checked_at,changed_by)
 VALUES(NEW.id,v_version,NEW.company_id,NEW.patient_id,NEW.appointment_id,NEW.insurance_id,NEW.insurance_plan_id,NEW.card_number,
 CASE WHEN TG_OP='UPDATE' THEN OLD.status ELSE NULL END,NEW.status,NEW.protocol_number,NEW.result_detail,NEW.source,NEW.checked_at,NEW.checked_by);
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_capture_insurance_authorization_history ON public.reception_authorizations;
CREATE TRIGGER trg_capture_insurance_authorization_history AFTER INSERT OR UPDATE ON public.reception_authorizations
FOR EACH ROW EXECUTE FUNCTION public.capture_insurance_authorization_history();
DROP TRIGGER IF EXISTS trg_capture_insurance_eligibility_history ON public.reception_eligibility_checks;
CREATE TRIGGER trg_capture_insurance_eligibility_history AFTER INSERT OR UPDATE ON public.reception_eligibility_checks
FOR EACH ROW EXECUTE FUNCTION public.capture_insurance_eligibility_history();

CREATE OR REPLACE FUNCTION public.prevent_insurance_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Historico oficial de convenios e imutavel';END $$;
DROP TRIGGER IF EXISTS trg_prevent_authorization_history_mutation ON public.insurance_authorization_history;
CREATE TRIGGER trg_prevent_authorization_history_mutation BEFORE UPDATE OR DELETE ON public.insurance_authorization_history
FOR EACH ROW EXECUTE FUNCTION public.prevent_insurance_history_mutation();
DROP TRIGGER IF EXISTS trg_prevent_eligibility_history_mutation ON public.insurance_eligibility_history;
CREATE TRIGGER trg_prevent_eligibility_history_mutation BEFORE UPDATE OR DELETE ON public.insurance_eligibility_history
FOR EACH ROW EXECUTE FUNCTION public.prevent_insurance_history_mutation();

INSERT INTO insurance_authorization_history(source_authorization_id,version,company_id,patient_id,appointment_id,insurance_id,insurance_plan_id,procedure_id,
 status,protocol_number,authorization_number,password_number,valid_until,quantity_requested,quantity_authorized,quantity_used,denial_reason,notes,changed_by,changed_at)
SELECT r.id,1,r.company_id,r.patient_id,r.appointment_id,r.insurance_id,r.insurance_plan_id,r.procedure_id,r.status,r.protocol_number,r.authorization_number,
 r.password_number,r.valid_until,r.quantity_requested,r.quantity_authorized,r.quantity_used,r.denial_reason,r.notes,COALESCE(r.updated_by,r.created_by),COALESCE(r.updated_at,r.created_at,NOW())
FROM reception_authorizations r ON CONFLICT(source_authorization_id,version) DO NOTHING;
INSERT INTO insurance_eligibility_history(source_eligibility_id,version,company_id,patient_id,appointment_id,insurance_id,insurance_plan_id,card_number,
 status,protocol_number,result_detail,source,checked_at,changed_by,changed_at)
SELECT e.id,1,e.company_id,e.patient_id,e.appointment_id,e.insurance_id,e.insurance_plan_id,e.card_number,e.status,e.protocol_number,e.result_detail,e.source,
 e.checked_at,e.checked_by,COALESCE(e.checked_at,e.created_at,NOW()) FROM reception_eligibility_checks e ON CONFLICT(source_eligibility_id,version) DO NOTHING;

ALTER TABLE insurance_authorization_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_eligibility_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_prontomedic') THEN
 GRANT SELECT ON insurance_authorization_history,insurance_eligibility_history TO app_prontomedic;
 GRANT USAGE,SELECT ON SEQUENCE insurance_authorization_history_id_seq,insurance_eligibility_history_id_seq TO app_prontomedic;
END IF;END $$;

COMMENT ON TABLE public.insurance_authorization_history IS 'Fonte oficial imutavel do dominio Convenios para historico, protocolos, validade e quantidades autorizadas.';
COMMENT ON TABLE public.insurance_eligibility_history IS 'Fonte oficial imutavel do dominio Convenios para resultados e protocolos de elegibilidade.';

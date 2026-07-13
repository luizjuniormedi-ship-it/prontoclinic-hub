-- Authoritative operational records consumed by scheduling and reception.
-- They are renamed to insurance_* ledgers by the later centralization migration.
CREATE TABLE IF NOT EXISTS public.reception_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  insurance_id INTEGER REFERENCES public.insurance_companies(id),
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id),
  procedure_id BIGINT,
  procedure_desc TEXT,
  requester_professional_id BIGINT REFERENCES public.professionals(id),
  status VARCHAR(40) NOT NULL DEFAULT 'pendente',
  protocol_number VARCHAR(100),
  authorization_number VARCHAR(100),
  password_number VARCHAR(100),
  valid_until DATE,
  quantity_requested INTEGER NOT NULL DEFAULT 1,
  quantity_authorized INTEGER NOT NULL DEFAULT 0,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  authorized_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ,
  denial_reason TEXT,
  created_by UUID,
  updated_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reception_eligibility_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  insurance_id INTEGER REFERENCES public.insurance_companies(id),
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id),
  card_number VARCHAR(100),
  status VARCHAR(40) NOT NULL DEFAULT 'pendente',
  protocol_number VARCHAR(100),
  result_detail TEXT,
  source VARCHAR(40),
  checked_at TIMESTAMPTZ,
  checked_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reception_authorizations_appointment
  ON public.reception_authorizations(appointment_id, status);
CREATE INDEX IF NOT EXISTS idx_reception_eligibility_appointment
  ON public.reception_eligibility_checks(appointment_id, status);

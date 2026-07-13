-- MVP release baseline: canonical physical insurance tables.
-- This is a clean-baseline artifact, not a remote migration.
CREATE TABLE public.insurance_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE SET NULL,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  insurance_id INTEGER REFERENCES public.insurance_companies(id) ON DELETE SET NULL,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE SET NULL,
  procedure_id BIGINT,
  status VARCHAR(40) NOT NULL DEFAULT 'pendente',
  protocol_number VARCHAR(120), authorization_number VARCHAR(120), password_number VARCHAR(120),
  valid_until DATE, quantity_requested INTEGER NOT NULL DEFAULT 1,
  quantity_authorized INTEGER NOT NULL DEFAULT 0, quantity_used INTEGER NOT NULL DEFAULT 0,
  denial_reason TEXT, notes TEXT, authorized_at TIMESTAMPTZ, denied_at TIMESTAMPTZ, created_by UUID, updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.insurance_eligibility_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE SET NULL,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  insurance_id INTEGER REFERENCES public.insurance_companies(id) ON DELETE SET NULL,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE SET NULL,
  card_number VARCHAR(120), status VARCHAR(40) NOT NULL DEFAULT 'pendente',
  protocol_number VARCHAR(120), source VARCHAR(40), result_detail TEXT,
  checked_at TIMESTAMPTZ, checked_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE VIEW public.reception_authorizations WITH (security_invoker = true) AS
  SELECT * FROM public.insurance_authorizations;
CREATE VIEW public.reception_eligibility_checks WITH (security_invoker = true) AS
  SELECT * FROM public.insurance_eligibility_checks;


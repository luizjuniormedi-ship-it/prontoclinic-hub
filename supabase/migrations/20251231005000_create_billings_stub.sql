-- Stub billings table needed by 20260101000007_audit_logs.sql triggers
CREATE TABLE IF NOT EXISTS public.billings (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  amount NUMERIC(12,2),
  status VARCHAR(20),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billings_company ON public.billings(company_id);
CREATE INDEX IF NOT EXISTS idx_billings_patient ON public.billings(patient_id);

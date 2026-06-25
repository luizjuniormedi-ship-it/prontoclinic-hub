-- Stub medical_records table needed by 20260101000007_audit_logs.sql triggers
CREATE TABLE IF NOT EXISTS public.medical_records (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id BIGINT REFERENCES public.professionals(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  chief_complaint TEXT,
  history_present_illness TEXT,
  physical_examination TEXT,
  diagnosis TEXT,
  treatment_plan TEXT,
  prescriptions TEXT,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_medical_records_patient ON public.medical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_company ON public.medical_records(company_id);

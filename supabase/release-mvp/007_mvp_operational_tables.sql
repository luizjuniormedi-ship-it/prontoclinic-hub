-- MVP clean baseline: physical operational tables required by consumers.
-- This is a baseline artifact, not a copy of the 20251231 legacy stubs.
-- No backfill, merge, DROP or destructive operation is permitted here.

CREATE TABLE public.medical_records (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id BIGINT REFERENCES public.professionals(id) ON DELETE SET NULL,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  chief_complaint TEXT,
  diagnosis TEXT,
  prescription TEXT,
  notes TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.appointments
  ALTER COLUMN company_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.appointments'::regclass
      AND conname = 'appointments_company_id_id_key'
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_company_id_id_key UNIQUE (company_id, id);
  END IF;
END
$$;

CREATE TABLE public.billings (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  appointment_id BIGINT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  guide_number VARCHAR(120),
  tiss_status VARCHAR(40),
  dt_vencimento DATE,
  dt_pagamento DATE,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billings_company_appointment_key UNIQUE (company_id, appointment_id),
  CONSTRAINT billings_company_appointment_fkey
    FOREIGN KEY (company_id, appointment_id)
    REFERENCES public.appointments (company_id, id)
);

CREATE INDEX billings_company_idx ON public.billings(company_id);
CREATE INDEX medical_records_company_idx ON public.medical_records(company_id);


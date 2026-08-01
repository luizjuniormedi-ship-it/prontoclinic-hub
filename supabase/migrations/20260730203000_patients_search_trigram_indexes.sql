-- Keep the existing patient search contract responsive when any searchable
-- field participates in the OR expression used by Agenda and Reception.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_patients_cpf_trgm
  ON public.patients USING gin (cpf gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_patients_phone_trgm
  ON public.patients USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_patients_email_trgm
  ON public.patients USING gin (email gin_trgm_ops);

ANALYZE public.patients;

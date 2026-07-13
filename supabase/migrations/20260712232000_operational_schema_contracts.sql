-- Restore operational columns on their canonical physical tables.
-- Additive only: no table recreation, data backfill, policy, or grant changes.

ALTER TABLE public.insurance_authorizations
  ADD COLUMN IF NOT EXISTS procedure_desc VARCHAR(200);

ALTER TABLE public.tiss_xml
  ADD COLUMN IF NOT EXISTS cd_fatura BIGINT;

-- SELECT * in a PostgreSQL view is expanded when the view is created. Refresh
-- the compatibility projection so procedure_desc is exposed after the ALTER.
CREATE OR REPLACE VIEW public.reception_authorizations
WITH (security_invoker = true) AS
SELECT *
FROM public.insurance_authorizations;

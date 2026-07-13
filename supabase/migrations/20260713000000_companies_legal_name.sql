-- Preserve the legal name separately from the trade name used by the UI.
-- Safe for existing databases and existing companies.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS ds_razao_social VARCHAR(200);

UPDATE public.companies
SET ds_razao_social = name
WHERE ds_razao_social IS NULL;

COMMENT ON COLUMN public.companies.ds_razao_social IS
  'Razao social da empresa; name permanece como nome fantasia.';

ALTER TABLE public.professional_insurances ADD COLUMN IF NOT EXISTS cd_origem_sigh BIGINT;
ALTER TABLE public.professional_insurances ADD COLUMN IF NOT EXISTS cd_medico BIGINT;
ALTER TABLE public.professional_insurances ADD COLUMN IF NOT EXISTS cd_convenio INTEGER;
ALTER TABLE public.insurance_plans ADD COLUMN IF NOT EXISTS cd_convenio INTEGER;

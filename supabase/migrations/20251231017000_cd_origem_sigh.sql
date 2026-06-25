ALTER TABLE public.units ADD COLUMN IF NOT EXISTS cd_origem_sigh INTEGER;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS cd_origem_sigh INTEGER;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS cd_origem_sigh BIGINT;
ALTER TABLE public.professionals ADD COLUMN IF NOT EXISTS cd_origem_sigh BIGINT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cd_origem_sigh BIGINT;
ALTER TABLE public.insurance_companies ADD COLUMN IF NOT EXISTS cd_origem_sigh INTEGER;
ALTER TABLE public.insurance_plans ADD COLUMN IF NOT EXISTS cd_origem_sigh INTEGER;
ALTER TABLE public.specialties ADD COLUMN IF NOT EXISTS cd_origem_sigh INTEGER;

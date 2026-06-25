-- Add columns missing from base tables to align with later migrations
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS appointment_date DATE;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS payment_source_id INTEGER;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS insurance_company_id INTEGER;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS insurance_plan_id INTEGER;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cd_convenio INTEGER;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cd_paciente BIGINT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cd_medico BIGINT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS tipo VARCHAR(50);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS lg_confirmado BOOLEAN DEFAULT FALSE;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS lg_checkin BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_at ON public.appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_cd_paciente ON public.appointments(cd_paciente);
CREATE INDEX IF NOT EXISTS idx_appointments_cd_medico ON public.appointments(cd_medico);

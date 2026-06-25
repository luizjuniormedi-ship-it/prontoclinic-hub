-- Adds LGPD-related columns to patients needed by 20260101000006_lgpd.sql
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS dt_ultimo_atendimento TIMESTAMPTZ;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS dt_obito DATE;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS lg_anonimizado BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS dt_anonimizacao TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_patients_dt_ultimo_atendimento ON public.patients(dt_ultimo_atendimento);
CREATE INDEX IF NOT EXISTS idx_patients_lg_anonimizado ON public.patients(lg_anonimizado);

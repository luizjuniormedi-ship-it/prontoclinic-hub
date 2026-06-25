-- Force cleanup of LGPD stubs before migration reapplies
DROP TABLE IF EXISTS public.paciente_consentimentos CASCADE;
DROP TABLE IF EXISTS public.paciente_anonimizacao_log CASCADE;
DROP TABLE IF EXISTS public.lgpd_solicitacoes CASCADE;
DROP TABLE IF EXISTS public.lgpd_politica_retencao CASCADE;
DROP VIEW IF EXISTS public.pacientes_anonimizaveis CASCADE;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS dt_ultimo_atendimento TIMESTAMPTZ;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS dt_obito DATE;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS lg_anonimizado BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS dt_anonimizacao TIMESTAMPTZ;

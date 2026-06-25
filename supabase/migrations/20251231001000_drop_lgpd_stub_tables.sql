-- Drop stub LGPD tables from 00000_base_tables.sql so that 00006_lgpd.sql can recreate with full schema
DROP TABLE IF EXISTS public.paciente_consentimentos CASCADE;
DROP TABLE IF EXISTS public.paciente_anonimizacao_log CASCADE;

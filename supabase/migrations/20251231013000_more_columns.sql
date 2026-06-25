ALTER TABLE public.salas_cirurgicas ADD COLUMN IF NOT EXISTS lg_ativa BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cd_paciente_old BIGINT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cd_medico_old BIGINT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS tp_status VARCHAR(20);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ds_observacoes TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS vl_consulta NUMERIC(12,2);
ALTER TABLE public.insurance_plans ADD COLUMN IF NOT EXISTS cd_convenio INTEGER;
ALTER TABLE public.insurance_plans ADD COLUMN IF NOT EXISTS ds_plano VARCHAR(200);
ALTER TABLE public.insurance_plans ADD COLUMN IF NOT EXISTS tp_cobertura VARCHAR(50);

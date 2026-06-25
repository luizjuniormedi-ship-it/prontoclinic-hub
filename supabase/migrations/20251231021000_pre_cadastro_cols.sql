ALTER TABLE public.pre_cadastro ADD COLUMN IF NOT EXISTS nm_paciente VARCHAR(200);
ALTER TABLE public.pre_cadastro ADD COLUMN IF NOT EXISTS nr_cpf VARCHAR(14);
ALTER TABLE public.pre_cadastro ADD COLUMN IF NOT EXISTS ds_email VARCHAR(200);
ALTER TABLE public.pre_cadastro ADD COLUMN IF NOT EXISTS cd_paciente_origem BIGINT;

ALTER TABLE public.billings ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.billings ADD COLUMN IF NOT EXISTS cd_convenio INTEGER;
ALTER TABLE public.billings ADD COLUMN IF NOT EXISTS cd_paciente BIGINT;
ALTER TABLE public.billings ADD COLUMN IF NOT EXISTS cd_fonte_pagadora INTEGER;
ALTER TABLE public.insurance_companies ADD COLUMN IF NOT EXISTS name VARCHAR(200);
UPDATE public.insurance_companies SET name = razao_social WHERE name IS NULL;

-- Adicionar UNIQUE constraints em cd_origem_sigh para suportar upsert
DO $$
BEGIN
  -- units
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'units_cd_origem_sigh_key') THEN
    ALTER TABLE public.units ADD CONSTRAINT units_cd_origem_sigh_key UNIQUE (cd_origem_sigh);
  END IF;
  -- specialties
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialties_cd_origem_sigh_key') THEN
    ALTER TABLE public.specialties ADD CONSTRAINT specialties_cd_origem_sigh_key UNIQUE (cd_origem_sigh);
  END IF;
  -- professionals
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professionals_cd_origem_sigh_key') THEN
    ALTER TABLE public.professionals ADD CONSTRAINT professionals_cd_origem_sigh_key UNIQUE (cd_origem_sigh);
  END IF;
  -- insurance_companies
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_companies_cd_origem_sigh_key') THEN
    ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_cd_origem_sigh_key UNIQUE (cd_origem_sigh);
  END IF;
  -- insurance_plans
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_plans_cd_origem_sigh_key') THEN
    ALTER TABLE public.insurance_plans ADD CONSTRAINT insurance_plans_cd_origem_sigh_key UNIQUE (cd_origem_sigh);
  END IF;
  -- payment_sources
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_sources_cd_origem_sigh_key') THEN
    ALTER TABLE public.payment_sources ADD CONSTRAINT payment_sources_cd_origem_sigh_key UNIQUE (cd_origem_sigh);
  END IF;
  -- fornecedores
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fornecedores_cd_origem_sigh_key') THEN
    ALTER TABLE public.fornecedores ADD CONSTRAINT fornecedores_cd_origem_sigh_key UNIQUE (cd_origem_sigh);
  END IF;
  -- professional_insurances
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professional_insurances_cd_origem_sigh_key') THEN
    ALTER TABLE public.professional_insurances ADD CONSTRAINT professional_insurances_cd_origem_sigh_key UNIQUE (cd_origem_sigh);
  END IF;
  -- patients
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patients_cd_origem_sigh_key') THEN
    ALTER TABLE public.patients ADD CONSTRAINT patients_cd_origem_sigh_key UNIQUE (cd_origem_sigh);
  END IF;
  -- appointments
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_cd_origem_sigh_key') THEN
    ALTER TABLE public.appointments ADD CONSTRAINT appointments_cd_origem_sigh_key UNIQUE (cd_origem_sigh);
  END IF;
  -- tiss_xml
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tiss_xml_cd_origem_sigh_key') THEN
    ALTER TABLE public.tiss_xml ADD CONSTRAINT tiss_xml_cd_origem_sigh_key UNIQUE (cd_origem_sigh);
  END IF;
END $$;

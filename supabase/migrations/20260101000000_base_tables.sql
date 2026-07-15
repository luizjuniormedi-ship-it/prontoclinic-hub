-- =============================================================================
-- Migration: 20260101000000_base_tables (PRIMEIRA - ordem alfabética)
-- Descrição: Tabelas base mínimas que outras migrations dependem.
--            Estas tabelas são criadas pelo Lovable mas não tem migration.
--            Solução: criar aqui para evitar 'relation does not exist'.
-- =============================================================================

-- Empresas (multi-tenant)
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  cnpj VARCHAR(14),
  phone VARCHAR(20),
  email VARCHAR(200),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User profiles (extensão de auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY,
  full_name VARCHAR(200) NOT NULL,
  email VARCHAR(200),
  role_id INTEGER,
  role_name VARCHAR(50),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  primary_unit_id INTEGER,
  phone VARCHAR(20),
  cpf VARCHAR(14),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pacientes
CREATE TABLE IF NOT EXISTS public.patients (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  full_name VARCHAR(200) NOT NULL,
  cpf VARCHAR(14),
  birth_date DATE,
  phone VARCHAR(20),
  email VARCHAR(200),
  sex VARCHAR(1) CHECK (sex IN ('F','M','O')),
  rg VARCHAR(30),
  whatsapp VARCHAR(20),
  endereco TEXT,
  numero VARCHAR(20),
  complemento VARCHAR(100),
  bairro VARCHAR(100),
  cidade VARCHAR(100),
  cep VARCHAR(10),
  nome_mae VARCHAR(200),
  nome_pai VARCHAR(200),
  historico_familiar TEXT,
  foto_url TEXT,
  lg_anonimizado BOOLEAN NOT NULL DEFAULT FALSE,
  dt_anonimizacao TIMESTAMPTZ,
  dt_obito DATE,
  dt_ultimo_atendimento TIMESTAMPTZ,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Profissionais
CREATE TABLE IF NOT EXISTS public.professionals (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID,
  full_name VARCHAR(200) NOT NULL,
  crm VARCHAR(20),
  specialty VARCHAR(100),
  phone VARCHAR(20),
  email VARCHAR(200),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unidades
CREATE TABLE IF NOT EXISTS public.units (
  id SERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_codigo VARCHAR(20) NOT NULL,
  ds_nome VARCHAR(100) NOT NULL,
  lg_principal BOOLEAN DEFAULT FALSE,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Appointments (necessário para FK em outras tabelas)
CREATE TABLE IF NOT EXISTS public.appointments (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id),
  professional_id BIGINT REFERENCES public.professionals(id),
  specialty_id INTEGER,
  appointment_type_id BIGINT,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  scheduled_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'agendado',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Specialties (catálogo)
CREATE TABLE IF NOT EXISTS public.specialties (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Appointment Types
CREATE TABLE IF NOT EXISTS public.appointment_types (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  default_duration INTEGER DEFAULT 30,
  category VARCHAR(50),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_companies_ativo ON public.companies(lg_ativo);
CREATE INDEX IF NOT EXISTS idx_user_profiles_company ON public.user_profiles(company_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles(role_name);
CREATE INDEX IF NOT EXISTS idx_patients_company ON public.patients(company_id);
CREATE INDEX IF NOT EXISTS idx_patients_cpf ON public.patients(cpf);
CREATE INDEX IF NOT EXISTS idx_professionals_company ON public.professionals(company_id);
CREATE INDEX IF NOT EXISTS idx_professionals_user ON public.professionals(user_id);
CREATE INDEX IF NOT EXISTS idx_units_company ON public.units(company_id);
CREATE INDEX IF NOT EXISTS idx_appointments_company ON public.appointments(company_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON public.appointments(appointment_date);

COMMENT ON TABLE public.companies IS 'Tabela base de empresas (multi-tenant). Migration 00000.';
COMMENT ON TABLE public.user_profiles IS 'Perfis estendidos de auth.users. Migration 00000.';
COMMENT ON TABLE public.patients IS 'Tabela base de pacientes. Migration 00000.';
COMMENT ON TABLE public.professionals IS 'Tabela base de profissionais. Migration 00000.';
COMMENT ON TABLE public.units IS 'Tabela base de unidades. Migration 00000.';
COMMENT ON TABLE public.appointments IS 'Tabela base de agendamentos. Migration 00000.';
-- Prontuários (necessário para triggers de auditoria)
CREATE TABLE IF NOT EXISTS public.medical_records (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id BIGINT REFERENCES public.professionals(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  chief_complaint TEXT,
  history_present_illness TEXT,
  physical_examination TEXT,
  diagnosis TEXT,
  treatment_plan TEXT,
  prescriptions TEXT,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_medical_records_patient ON public.medical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_company ON public.medical_records(company_id);

-- Faturamento (necessário para triggers de auditoria)
CREATE TABLE IF NOT EXISTS public.billings (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE CASCADE,
  appointment_id BIGINT REFERENCES public.appointments(id),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  dt_vencimento DATE,
  dt_pagamento DATE,
  dt_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billings_company ON public.billings(company_id);
CREATE INDEX IF NOT EXISTS idx_billings_patient ON public.billings(patient_id);

-- Services Catalog (catálogo de serviços)
CREATE TABLE IF NOT EXISTS public.services_catalog (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  code VARCHAR(50),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  price DECIMAL(10,2),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_services_catalog_company ON public.services_catalog(company_id);

-- TISS schema is owned by 20260101000010_tiss.sql.

-- LGPD tables are owned by 20260101000006_lgpd.sql.

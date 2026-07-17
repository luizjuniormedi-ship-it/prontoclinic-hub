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
  nr_cnpj VARCHAR(20),
  cd_cnpj VARCHAR(20),
  cd_origem_sigh INTEGER,
  phone VARCHAR(20),
  email VARCHAR(200),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User profiles (extensão de auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  user_id UUID,
  nr_cpf VARCHAR(14),
  cd_cpf VARCHAR(14),
  ds_email VARCHAR(200),
  nr_telefone VARCHAR(20),
  dt_nascimento DATE,
  cd_sexo VARCHAR(1),
  ds_endereco TEXT,
  dt_ultimo_atendimento TIMESTAMPTZ,
  dt_obito DATE,
  lg_anonimizado BOOLEAN NOT NULL DEFAULT FALSE,
  dt_anonimizacao TIMESTAMPTZ,
  cd_origem_sigh BIGINT,
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
  cd_origem_sigh BIGINT,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unidades
CREATE TABLE IF NOT EXISTS public.units (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_codigo VARCHAR(20) NOT NULL,
  ds_nome VARCHAR(100) NOT NULL,
  ds_razao_social VARCHAR(200),
  nr_cnpj VARCHAR(20),
  tp_unidade VARCHAR(30) CHECK (tp_unidade IN (
    'HOSPITAL', 'CLINICA', 'UPA', 'UBS', 'LABORATORIO', 'CONSULTORIO', 'MATRIZ', 'FILIAL'
  )) DEFAULT 'MATRIZ',
  ds_endereco VARCHAR(200),
  nr_endereco VARCHAR(20),
  ds_complemento VARCHAR(100),
  ds_bairro VARCHAR(100),
  ds_cidade VARCHAR(100),
  ds_uf VARCHAR(2),
  nr_cep VARCHAR(8),
  nr_telefone VARCHAR(20),
  ds_email VARCHAR(200),
  cd_ibge_municipio VARCHAR(7),
  lg_principal BOOLEAN DEFAULT FALSE,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_unit_codigo UNIQUE(company_id, cd_codigo),
  CONSTRAINT uniq_unit_cnpj UNIQUE(company_id, nr_cnpj)
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
  duration_minutes INTEGER,
  payment_source_id INTEGER,
  insurance_company_id INTEGER,
  insurance_plan_id INTEGER,
  cd_convenio INTEGER,
  cd_paciente BIGINT,
  cd_medico BIGINT,
  cd_paciente_old BIGINT,
  cd_medico_old BIGINT,
  tipo VARCHAR(50),
  tp_status VARCHAR(20),
  ds_observacoes TEXT,
  vl_consulta NUMERIC(12,2),
  lg_confirmado BOOLEAN DEFAULT FALSE,
  lg_checkin BOOLEAN DEFAULT FALSE,
  cd_origem_sigh BIGINT,
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
  cd_origem_sigh INTEGER,
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
CREATE INDEX IF NOT EXISTS idx_patients_dt_ultimo_atendimento ON public.patients(dt_ultimo_atendimento);
CREATE INDEX IF NOT EXISTS idx_patients_lg_anonimizado ON public.patients(lg_anonimizado);
CREATE INDEX IF NOT EXISTS idx_professionals_company ON public.professionals(company_id);
CREATE INDEX IF NOT EXISTS idx_professionals_user ON public.professionals(user_id);
CREATE INDEX IF NOT EXISTS idx_units_company ON public.units(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_units_company_codigo_unique ON public.units(company_id, cd_codigo);
CREATE INDEX IF NOT EXISTS idx_appointments_company ON public.appointments(company_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON public.appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_at ON public.appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_cd_paciente ON public.appointments(cd_paciente);
CREATE INDEX IF NOT EXISTS idx_appointments_cd_medico ON public.appointments(cd_medico);

COMMENT ON TABLE public.companies IS 'Tabela base de empresas (multi-tenant). Migration 00000.';
COMMENT ON TABLE public.user_profiles IS 'Perfis estendidos de auth.users. Migration 00000.';
COMMENT ON TABLE public.patients IS 'Tabela base de pacientes. Migration 00000.';
COMMENT ON TABLE public.professionals IS 'Tabela base de profissionais. Migration 00000.';
COMMENT ON TABLE public.units IS 'Tabela base de unidades. Migration 00000.';
COMMENT ON TABLE public.appointments IS 'Tabela base de agendamentos. Migration 00000.';
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

-- Estruturas fundamentais referenciadas pela auditoria e pelos módulos seguintes.
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

CREATE TABLE IF NOT EXISTS public.billings (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  amount NUMERIC(12,2),
  paid_amount NUMERIC(12,2) DEFAULT 0,
  cd_convenio INTEGER,
  cd_paciente BIGINT,
  cd_fonte_pagadora INTEGER,
  status VARCHAR(20),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billings_company ON public.billings(company_id);
CREATE INDEX IF NOT EXISTS idx_billings_patient ON public.billings(patient_id);

-- O schema TISS definitivo é criado em 20260101000010_tiss.sql.
-- As tabelas LGPD são criadas com o schema completo em 20260101000006_lgpd.sql.
-- Não criar stubs aqui: em replay cronológico eles impedem CREATE TABLE IF NOT EXISTS
-- de materializar as colunas e constraints definitivas.

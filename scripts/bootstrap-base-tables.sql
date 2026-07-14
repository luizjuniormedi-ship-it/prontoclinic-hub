-- =============================================================================
-- bootstrap-base-tables.sql (v3 - mixed types matching migrations)
-- companies.id = UUID (migrations expect)
-- entity IDs (professionals, patients, etc) = BIGINT (migrations expect)
-- =============================================================================

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Roles Supabase
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN BYPASSRLS; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Schema auth + função uid()
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY, email VARCHAR(200), raw_user_meta_data JSONB, raw_app_meta_data JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ LANGUAGE SQL STABLE;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$ LANGUAGE SQL STABLE;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$ LANGUAGE SQL STABLE;

-- companies: UUID (migrations referem como company_id UUID)
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  cnpj VARCHAR(14) UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  dt_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user_profiles: id UUID
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  full_name VARCHAR(200),
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  role_name VARCHAR(50) NOT NULL DEFAULT 'user',
  email VARCHAR(200),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  dt_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- professionals: BIGINT id, company_id UUID
CREATE TABLE IF NOT EXISTS public.professionals (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID,
  name VARCHAR(200) NOT NULL,
  crm VARCHAR(20),
  crm_uf CHAR(2),
  specialty VARCHAR(100),
  phone VARCHAR(20),
  email VARCHAR(200),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  dt_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- patients: BIGINT id, company_id UUID
CREATE TABLE IF NOT EXISTS public.patients (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  full_name VARCHAR(200) GENERATED ALWAYS AS (name) STORED,
  cpf VARCHAR(11) UNIQUE,
  birth_date DATE,
  gender VARCHAR(20),
  phone VARCHAR(20),
  email VARCHAR(200),
  address TEXT,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  lg_anonimizado BOOLEAN NOT NULL DEFAULT FALSE,
  dt_anonimizacao TIMESTAMPTZ,
  dt_ultimo_atendimento TIMESTAMPTZ,
  dt_obito DATE,
  dt_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- appointments: BIGINT id, FKs BIGINT
CREATE TABLE IF NOT EXISTS public.appointments (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id BIGINT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  dt_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- services_catalog: BIGINT id
CREATE TABLE IF NOT EXISTS public.services_catalog (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code VARCHAR(20),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  duration_minutes INTEGER DEFAULT 30,
  price DECIMAL(10,2),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  dt_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- appointment_types: BIGINT id
CREATE TABLE IF NOT EXISTS public.appointment_types (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  color VARCHAR(20),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  dt_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- medical_records: BIGINT id
CREATE TABLE IF NOT EXISTS public.medical_records (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id BIGINT REFERENCES public.professionals(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  chief_complaint TEXT,
  diagnosis TEXT,
  prescription TEXT,
  notes TEXT,
  dt_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- billings: BIGINT id
CREATE TABLE IF NOT EXISTS public.billings (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  appointment_id BIGINT REFERENCES public.appointments(id),
  amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  dt_vencimento DATE,
  dt_pagamento DATE,
  dt_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- Patch idempotente: dropar funções que mudam tipo de retorno
DROP FUNCTION IF EXISTS public.confirm_pre_cadastro(character varying) CASCADE;

SELECT 'Bootstrap v3 (UUID company + BIGINT entities) OK' AS status;

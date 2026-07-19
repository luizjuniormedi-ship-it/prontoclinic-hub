-- =============================================================================
-- Migration: 20260711090000_base_tables_rls_tenant_hardening
-- Objetivo: corrigir o P0 de isolamento cross-tenant nas tabelas-base PHI.
--
-- Escopo confirmado nas migrations anteriores:
--   companies, user_profiles, patients, professionals, units,
--   appointments, appointment_types, services_catalog, tiss_xml,
--   paciente_consentimentos, paciente_anonimizacao_log,
--   medical_records e billings.
--
-- Não altera dados. O service_role continua com bypassrls conforme o modelo
-- do Supabase. A identidade tenant-aware usa get_scheduling_actor(), já criada
-- em 20260708090000_scheduling_phase1, e get_my_company_id() como fallback
-- documentado nas migrations de hardening anteriores.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Remover acesso de tabela amplo. RLS continua sendo a autorização de linha.
-- -----------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.companies,
  public.user_profiles,
  public.patients,
  public.professionals,
  public.units,
  public.appointments,
  public.appointment_types,
  public.services_catalog,
  public.tiss_xml,
  public.paciente_consentimentos,
  public.paciente_anonimizacao_log,
  public.medical_records,
  public.billings
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.companies,
  public.user_profiles,
  public.patients,
  public.professionals,
  public.units,
  public.appointments,
  public.appointment_types,
  public.services_catalog,
  public.tiss_xml,
  public.paciente_consentimentos,
  public.medical_records,
  public.billings
TO authenticated;

-- O log LGPD é imutável: somente leitura e inserção são concedidas.
GRANT SELECT, INSERT ON TABLE public.paciente_anonimizacao_log TO authenticated;

-- As tabelas usam BIGSERIAL/SERIAL em versões diferentes do bootstrap.
-- Descobrir apenas sequências pertencentes às tabelas deste schema evita
-- depender de nomes que podem não existir em um ambiente efêmero.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT seq_ns.nspname AS sequence_schema, seq.relname AS sequence_name
    FROM pg_class seq
    JOIN pg_namespace seq_ns ON seq_ns.oid = seq.relnamespace
    WHERE seq.relkind = 'S'
      AND seq_ns.nspname = 'public'
      AND EXISTS (
        SELECT 1
        FROM pg_depend dep
        JOIN pg_class tbl ON tbl.oid = dep.refobjid
        JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
        WHERE dep.objid = seq.oid
          AND dep.deptype IN ('a', 'i')
          AND tbl_ns.nspname = 'public'
          AND tbl.relname IN (
            'user_profiles', 'patients', 'professionals', 'units',
            'appointments', 'appointment_types', 'services_catalog',
            'tiss_xml', 'paciente_consentimentos',
            'paciente_anonimizacao_log', 'medical_records', 'billings'
          )
      )
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %I.%I FROM PUBLIC, anon, authenticated', r.sequence_schema, r.sequence_name);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I.%I TO authenticated', r.sequence_schema, r.sequence_name);
  END LOOP;
END
$$;

-- Helpers tenant-aware: ambiguidade de perfis deve negar acesso, nunca
-- escolher uma empresa arbitrariamente. A identidade por id/user_id cobre os
-- dois vínculos existentes no schema legado.
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH candidates AS (
    SELECT up.company_id
    FROM public.user_profiles up
    WHERE (up.id = auth.uid() OR up.user_id = auth.uid())
      AND up.company_id IS NOT NULL
  )
  SELECT c.company_id
  FROM candidates c
  GROUP BY c.company_id
  HAVING (SELECT count(DISTINCT company_id) FROM candidates) = 1
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_my_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_scheduling_actor()
RETURNS TABLE(user_id UUID, company_id UUID, role_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH candidates AS (
    SELECT up.id AS user_id, up.company_id, lower(coalesce(up.role_name, '')) AS role_name
    FROM public.user_profiles up
    WHERE (up.id = auth.uid() OR up.user_id = auth.uid())
      AND up.company_id IS NOT NULL
  )
  SELECT c.user_id, c.company_id, c.role_name
  FROM candidates c
  WHERE (SELECT count(DISTINCT company_id) FROM candidates) = 1
  ORDER BY (c.user_id = auth.uid()) DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_scheduling_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_scheduling_actor() TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Habilitar RLS também nas tabelas que não tinham política própria.
-- -----------------------------------------------------------------------------
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_xml ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paciente_consentimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paciente_anonimizacao_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billings ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 3. Tenant da sessão.
--    get_scheduling_actor() cobre os dois vínculos existentes (id/user_id).
--    O COALESCE mantém compatibilidade com perfis legados cujo id = auth.uid().
-- -----------------------------------------------------------------------------
-- Remove os nomes da migration RLS duplicada anterior. Sem isto, policies
-- permissivas combinariam por OR durante uma aplicação incremental.
DO $$
DECLARE
  table_name TEXT;
  policy_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'user_profiles', 'patients', 'professionals', 'units',
    'appointments', 'appointment_types', 'services_catalog',
    'medical_records', 'billings', 'tiss_xml',
    'paciente_consentimentos', 'paciente_anonimizacao_log'
  ] LOOP
    FOREACH policy_name IN ARRAY ARRAY[
      'base_tenant_select', 'base_tenant_insert',
      'base_tenant_update', 'base_tenant_delete'
    ] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, table_name);
    END LOOP;
  END LOOP;
END
$$;

DROP POLICY IF EXISTS base_companies_select_tenant ON public.companies;
CREATE POLICY base_companies_select_tenant
  ON public.companies
  FOR SELECT TO authenticated
  USING (
    id = COALESCE(
      (SELECT company_id FROM public.get_scheduling_actor()),
      public.get_my_company_id()
    )
  );

DROP POLICY IF EXISTS base_companies_admin_write ON public.companies;
CREATE POLICY base_companies_admin_write
  ON public.companies
  FOR ALL TO authenticated
  USING (
    id = COALESCE(
      (SELECT company_id FROM public.get_scheduling_actor()),
      public.get_my_company_id()
    )
    AND lower(COALESCE((SELECT role_name FROM public.get_scheduling_actor()), ''))
      IN ('admin', 'administrador')
  )
  WITH CHECK (
    id = COALESCE(
      (SELECT company_id FROM public.get_scheduling_actor()),
      public.get_my_company_id()
    )
    AND lower(COALESCE((SELECT role_name FROM public.get_scheduling_actor()), ''))
      IN ('admin', 'administrador')
  );

-- -----------------------------------------------------------------------------
-- 4. Perfis: leitura tenant-aware; mutação limitada a administradores para
--    impedir autoelevação por alteração de role_name/user_id.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS base_user_profiles_select_tenant ON public.user_profiles;
CREATE POLICY base_user_profiles_select_tenant
  ON public.user_profiles
  FOR SELECT TO authenticated
  USING (
    company_id = COALESCE(
      (SELECT company_id FROM public.get_scheduling_actor()),
      public.get_my_company_id()
    )
  );

DROP POLICY IF EXISTS base_user_profiles_insert_admin ON public.user_profiles;
CREATE POLICY base_user_profiles_insert_admin
  ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = COALESCE(
      (SELECT company_id FROM public.get_scheduling_actor()),
      public.get_my_company_id()
    )
    AND lower(COALESCE((SELECT role_name FROM public.get_scheduling_actor()), ''))
      IN ('admin', 'administrador')
  );

DROP POLICY IF EXISTS base_user_profiles_update_admin ON public.user_profiles;
CREATE POLICY base_user_profiles_update_admin
  ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (
    company_id = COALESCE(
      (SELECT company_id FROM public.get_scheduling_actor()),
      public.get_my_company_id()
    )
    AND lower(COALESCE((SELECT role_name FROM public.get_scheduling_actor()), ''))
      IN ('admin', 'administrador')
  )
  WITH CHECK (
    company_id = COALESCE(
      (SELECT company_id FROM public.get_scheduling_actor()),
      public.get_my_company_id()
    )
    AND lower(COALESCE((SELECT role_name FROM public.get_scheduling_actor()), ''))
      IN ('admin', 'administrador')
  );

DROP POLICY IF EXISTS base_user_profiles_delete_admin ON public.user_profiles;
CREATE POLICY base_user_profiles_delete_admin
  ON public.user_profiles
  FOR DELETE TO authenticated
  USING (
    company_id = COALESCE(
      (SELECT company_id FROM public.get_scheduling_actor()),
      public.get_my_company_id()
    )
    AND lower(COALESCE((SELECT role_name FROM public.get_scheduling_actor()), ''))
      IN ('admin', 'administrador')
  );

-- -----------------------------------------------------------------------------
-- 5. Tabelas tenant-owned. O mesmo tenant é exigido para leitura e mutação.
--    Isso evita tanto SELECT cross-tenant quanto INSERT/UPDATE de company_id.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS base_patients_tenant_all ON public.patients;
CREATE POLICY base_patients_tenant_all
  ON public.patients
  FOR ALL TO authenticated
  USING (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()))
  WITH CHECK (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()));

DROP POLICY IF EXISTS base_professionals_tenant_all ON public.professionals;
CREATE POLICY base_professionals_tenant_all
  ON public.professionals
  FOR ALL TO authenticated
  USING (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()))
  WITH CHECK (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()));

DROP POLICY IF EXISTS base_units_tenant_all ON public.units;
CREATE POLICY base_units_tenant_all
  ON public.units
  FOR ALL TO authenticated
  USING (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()))
  WITH CHECK (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()));

DROP POLICY IF EXISTS base_appointments_tenant_all ON public.appointments;
CREATE POLICY base_appointments_tenant_all
  ON public.appointments
  FOR ALL TO authenticated
  USING (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()))
  WITH CHECK (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()));

DROP POLICY IF EXISTS base_appointment_types_tenant_all ON public.appointment_types;
CREATE POLICY base_appointment_types_tenant_all
  ON public.appointment_types
  FOR ALL TO authenticated
  USING (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()))
  WITH CHECK (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()));

DROP POLICY IF EXISTS base_services_catalog_tenant_all ON public.services_catalog;
CREATE POLICY base_services_catalog_tenant_all
  ON public.services_catalog
  FOR ALL TO authenticated
  USING (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()))
  WITH CHECK (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()));

DROP POLICY IF EXISTS base_medical_records_tenant_all ON public.medical_records;
CREATE POLICY base_medical_records_tenant_all
  ON public.medical_records
  FOR ALL TO authenticated
  USING (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()))
  WITH CHECK (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()));

DROP POLICY IF EXISTS base_billings_tenant_all ON public.billings;
CREATE POLICY base_billings_tenant_all
  ON public.billings
  FOR ALL TO authenticated
  USING (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()))
  WITH CHECK (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()));

-- TISS e consentimentos mantêm as restrições de papel das migrations de
-- domínio; estas policies somente garantem tenant no caminho de leitura.
DROP POLICY IF EXISTS base_tiss_xml_tenant_select ON public.tiss_xml;
CREATE POLICY base_tiss_xml_tenant_select
  ON public.tiss_xml
  FOR SELECT TO authenticated
  USING (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()));

DROP POLICY IF EXISTS base_consentimentos_tenant_select ON public.paciente_consentimentos;
CREATE POLICY base_consentimentos_tenant_select
  ON public.paciente_consentimentos
  FOR SELECT TO authenticated
  USING (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()));

-- O log LGPD continua INSERT-only e mantém a policy de admin da migration de
-- domínio; não criar FOR ALL aqui evita ampliar a capacidade de escrita.
DROP POLICY IF EXISTS base_anonimizacao_tenant_select ON public.paciente_anonimizacao_log;
CREATE POLICY base_anonimizacao_tenant_select
  ON public.paciente_anonimizacao_log
  FOR SELECT TO authenticated
  USING (company_id = COALESCE((SELECT company_id FROM public.get_scheduling_actor()), public.get_my_company_id()));

COMMIT;

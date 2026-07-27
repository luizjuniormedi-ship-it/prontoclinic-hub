\set ON_ERROR_STOP on

BEGIN;

-- Feche funções internas legadas que nunca devem compor a API anônima.
DO $$
BEGIN
  IF to_regprocedure('public.evaluate_audit_alerts()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.evaluate_audit_alerts() FROM PUBLIC, anon';
  END IF;
  IF to_regprocedure('public.m15_authorization_audit()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.m15_authorization_audit() FROM PUBLIC, anon';
  END IF;
END;
$$;

-- insurance_companies contains provider portal credentials. Browser roles get
-- only the operational catalog columns required by Agenda, Reception and TISS.
ALTER TABLE public.insurance_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_companies FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.insurance_companies FROM anon;
REVOKE ALL ON public.insurance_companies FROM authenticated;

GRANT SELECT (
  id,
  company_id,
  payment_source_id,
  name,
  registro_ans,
  cnpj,
  razao_social,
  telefone1,
  telefone2,
  percentual_desconto,
  lg_ativo,
  lg_guia_obrigatoria,
  lg_cid_obrigatorio,
  lg_matric_obrigatorio,
  lg_autorizac_obrigatorio,
  cd_origem_sigh,
  created_at,
  updated_at
) ON public.insurance_companies TO authenticated;

GRANT INSERT (
  company_id,
  payment_source_id,
  name,
  registro_ans,
  cnpj,
  razao_social,
  telefone1,
  telefone2,
  percentual_desconto,
  lg_ativo,
  lg_guia_obrigatoria,
  lg_cid_obrigatorio,
  lg_matric_obrigatorio,
  lg_autorizac_obrigatorio,
  cd_origem_sigh
) ON public.insurance_companies TO authenticated;

GRANT UPDATE (
  payment_source_id,
  name,
  registro_ans,
  cnpj,
  razao_social,
  telefone1,
  telefone2,
  percentual_desconto,
  lg_ativo,
  lg_guia_obrigatoria,
  lg_cid_obrigatorio,
  lg_matric_obrigatorio,
  lg_autorizac_obrigatorio,
  cd_origem_sigh
) ON public.insurance_companies TO authenticated;

GRANT USAGE, SELECT
  ON SEQUENCE public.insurance_companies_id_seq
  TO authenticated;

DROP POLICY IF EXISTS "Users can read insurance_companies from their company"
  ON public.insurance_companies;
DROP POLICY IF EXISTS "Admins and reception can manage insurance_companies"
  ON public.insurance_companies;
DROP POLICY IF EXISTS insurance_companies_authenticated_select
  ON public.insurance_companies;
DROP POLICY IF EXISTS insurance_companies_authenticated_insert
  ON public.insurance_companies;
DROP POLICY IF EXISTS insurance_companies_authenticated_update
  ON public.insurance_companies;

CREATE POLICY insurance_companies_authenticated_select
  ON public.insurance_companies
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.active_company_id()
    AND (
      public.can_access('insurance_companies', 'view')
      OR public.can_access('convenios', 'view')
      OR public.can_access('faturamento', 'view')
      OR public.can_access('patients', 'view')
      OR public.can_access('pacientes', 'view')
      OR public.can_access('agenda', 'view')
      OR public.can_access('recepcao', 'view')
    )
  );

CREATE POLICY insurance_companies_authenticated_insert
  ON public.insurance_companies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.active_company_id()
    AND (
      public.can_access('insurance_companies', 'create')
      OR public.can_access('convenios', 'create')
      OR public.can_access('faturamento', 'create')
    )
  );

CREATE POLICY insurance_companies_authenticated_update
  ON public.insurance_companies
  FOR UPDATE
  TO authenticated
  USING (
    company_id = public.active_company_id()
    AND (
      public.can_access('insurance_companies', 'edit')
      OR public.can_access('convenios', 'edit')
      OR public.can_access('faturamento', 'edit')
    )
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND (
      public.can_access('insurance_companies', 'edit')
      OR public.can_access('convenios', 'edit')
      OR public.can_access('faturamento', 'edit')
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    EXECUTE 'REVOKE ALL ON public.insurance_companies FROM app_prontomedic';
    EXECUTE 'GRANT SELECT (
      id,
      company_id,
      payment_source_id,
      name,
      registro_ans,
      cnpj,
      razao_social,
      telefone1,
      telefone2,
      percentual_desconto,
      lg_ativo,
      lg_guia_obrigatoria,
      lg_cid_obrigatorio,
      lg_matric_obrigatorio,
      lg_autorizac_obrigatorio,
      cd_origem_sigh,
      created_at,
      updated_at
    ) ON public.insurance_companies TO app_prontomedic';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_tiss_rpc_owner') THEN
    EXECUTE 'REVOKE ALL ON public.insurance_companies FROM prontomedic_tiss_rpc_owner';
    EXECUTE 'GRANT SELECT (
      id,
      company_id,
      name,
      registro_ans,
      lg_ativo
    ) ON public.insurance_companies TO prontomedic_tiss_rpc_owner';
  END IF;
END;
$$;

-- services_catalog has no credentials, but it was exposed without RLS. Limit
-- it to the active company and read-only access required by operational flows.
ALTER TABLE public.services_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services_catalog FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.services_catalog FROM anon;
REVOKE ALL ON public.services_catalog FROM authenticated;
GRANT SELECT ON public.services_catalog TO authenticated;

DROP POLICY IF EXISTS services_catalog_authenticated_select
  ON public.services_catalog;
DROP POLICY IF EXISTS services_catalog_app_runtime_select
  ON public.services_catalog;

CREATE POLICY services_catalog_authenticated_select
  ON public.services_catalog
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.active_company_id()
    AND (
      public.can_access('agenda', 'view')
      OR public.can_access('recepcao', 'view')
      OR public.can_access('faturamento', 'view')
      OR public.can_access('patients', 'view')
      OR public.can_access('pacientes', 'view')
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    EXECUTE 'REVOKE ALL ON public.services_catalog FROM app_prontomedic';
    EXECUTE 'GRANT SELECT ON public.services_catalog TO app_prontomedic';
    EXECUTE 'CREATE POLICY services_catalog_app_runtime_select
      ON public.services_catalog
      FOR SELECT
      TO app_prontomedic
      USING (company_id = public.current_company_id())';
  END IF;
END;
$$;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260727043431_secure_operational_catalog_reads.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

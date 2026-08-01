\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE public.insurance_companies
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_companies
  FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON public.insurance_companies
      FROM app_prontomedic;
    GRANT SELECT
      ON public.insurance_companies
      TO app_prontomedic;
  END IF;
END;
$$;

DROP POLICY IF EXISTS insurance_companies_app_runtime_select
  ON public.insurance_companies;
CREATE POLICY insurance_companies_app_runtime_select
  ON public.insurance_companies
  FOR SELECT
  TO app_prontomedic
  USING (company_id = public.current_company_id());

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260726192000_module11_reception_insurance_catalog_runtime_acl.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

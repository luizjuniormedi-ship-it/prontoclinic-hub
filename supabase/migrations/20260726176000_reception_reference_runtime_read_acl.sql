\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE public.insurance_plans
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_plans
  FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON public.specialties, public.insurance_plans
      FROM app_prontomedic;
    GRANT SELECT
      ON public.specialties, public.insurance_plans
      TO app_prontomedic;
  END IF;
END;
$$;

DROP POLICY IF EXISTS insurance_plans_app_runtime_select
  ON public.insurance_plans;
CREATE POLICY insurance_plans_app_runtime_select
  ON public.insurance_plans
  FOR SELECT
  TO app_prontomedic
  USING (company_id = public.current_company_id());

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260726176000_reception_reference_runtime_read_acl.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

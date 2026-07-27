\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE public.price_tables
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_tables
  FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON public.price_tables
      FROM app_prontomedic;
    GRANT SELECT
      ON public.price_tables
      TO app_prontomedic;
  END IF;
END;
$$;

DROP POLICY IF EXISTS price_tables_app_runtime_select
  ON public.price_tables;
CREATE POLICY price_tables_app_runtime_select
  ON public.price_tables
  FOR SELECT
  TO app_prontomedic
  USING (company_id = public.current_company_id());

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260726177000_reception_price_lookup_runtime_acl.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

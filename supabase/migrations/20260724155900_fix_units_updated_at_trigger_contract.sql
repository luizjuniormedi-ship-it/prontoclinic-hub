BEGIN;

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $fn$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_units_updated_at ON public.units;
CREATE TRIGGER trg_units_updated_at
  BEFORE UPDATE ON public.units
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units FORCE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.units.updated_at IS
  'Timestamp maintained by trg_units_updated_at for unit configuration changes.';

DO $ledger$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260724155900_fix_units_updated_at_trigger_contract.sql', NOW())
    ON CONFLICT (filename) DO NOTHING;
  END IF;
END
$ledger$;

COMMIT;

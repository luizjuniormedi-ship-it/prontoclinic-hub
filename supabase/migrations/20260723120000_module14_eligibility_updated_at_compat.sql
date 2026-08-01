-- Module 14 compatibility: older VPS baselines omitted updated_at.
-- Additive and idempotent; no external provider or DataSIGH access.
BEGIN;

ALTER TABLE public.insurance_eligibility_checks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260723120000_module14_eligibility_updated_at_compat.sql', NOW())
    ON CONFLICT (filename) DO NOTHING;
  END IF;
END
$$;

COMMIT;

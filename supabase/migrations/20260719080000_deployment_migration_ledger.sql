-- Durable ledger used by runtime migrations to record idempotent application.
-- It contains migration metadata only; no secrets or clinical data.

BEGIN;

CREATE TABLE IF NOT EXISTS public.prontomedic_deployment_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON public.prontomedic_deployment_migrations FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.prontomedic_deployment_migrations TO authenticated;

COMMIT;

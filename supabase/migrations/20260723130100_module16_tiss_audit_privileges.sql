-- M16 follow-up: audit events are trigger-owned and append-only.
BEGIN;

REVOKE INSERT, UPDATE, DELETE
  ON public.tiss_guide_events
  FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT SELECT ON public.tiss_guide_events TO authenticated, app_prontomedic;

DO $fn$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260723130100_module16_tiss_audit_privileges.sql', NOW())
    ON CONFLICT (filename) DO NOTHING;
  END IF;
END
$fn$;

COMMIT;

-- Module 1 runtime hardening for self-service sessions and security events.
-- The local API role owns parts of this schema, so FORCE RLS is required to
-- make the existing per-user policies effective for every proxy query.
-- DataSIGH is not accessed by this migration.

BEGIN;

ALTER TABLE public.auth_session_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_session_devices FORCE ROW LEVEL SECURITY;

ALTER TABLE public.auth_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_security_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA private TO app_prontomedic';
    EXECUTE 'GRANT EXECUTE ON FUNCTION private.is_module_admin() TO app_prontomedic';

    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_session_devices TO app_prontomedic';
    EXECUTE 'GRANT SELECT, INSERT ON public.auth_security_events TO app_prontomedic';
    EXECUTE 'REVOKE UPDATE, DELETE ON public.auth_security_events FROM app_prontomedic';

    EXECUTE 'DROP POLICY IF EXISTS module1_devices_proxy ON public.auth_session_devices';
    EXECUTE 'DROP POLICY IF EXISTS module1_session_devices_proxy ON public.auth_session_devices';
    EXECUTE 'CREATE POLICY module1_session_devices_proxy ON public.auth_session_devices FOR ALL TO app_prontomedic
      USING (user_id = (SELECT auth.uid()) OR private.is_module_admin())
      WITH CHECK (user_id = (SELECT auth.uid()) OR private.is_module_admin())';

    EXECUTE 'DROP POLICY IF EXISTS module1_events_proxy ON public.auth_security_events';
    EXECUTE 'DROP POLICY IF EXISTS module1_security_events_proxy ON public.auth_security_events';
    EXECUTE 'CREATE POLICY module1_security_events_proxy ON public.auth_security_events FOR ALL TO app_prontomedic
      USING (user_id = (SELECT auth.uid()) OR private.is_module_admin())
      WITH CHECK (user_id = (SELECT auth.uid()) OR private.is_module_admin())';
  END IF;
END;
$$;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260725000521_auth_self_service_security_tables.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

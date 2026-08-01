-- Module 1 runtime parity: the VPS auth gateway uses app_prontomedic as its
-- database role, so its trusted proxy requests need explicit, scoped RLS.
-- This does not touch DataSIGH or clinical data.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_session_devices TO app_prontomedic';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_security_events TO app_prontomedic';

    EXECUTE 'DROP POLICY IF EXISTS module1_devices_proxy ON public.auth_session_devices';
    EXECUTE 'CREATE POLICY module1_devices_proxy ON public.auth_session_devices FOR ALL TO app_prontomedic
      USING (user_id = (SELECT auth.uid()) OR private.is_module_admin())
      WITH CHECK (user_id = (SELECT auth.uid()) OR private.is_module_admin())';

    EXECUTE 'DROP POLICY IF EXISTS module1_events_proxy ON public.auth_security_events';
    EXECUTE 'CREATE POLICY module1_events_proxy ON public.auth_security_events FOR ALL TO app_prontomedic
      USING (user_id = (SELECT auth.uid()) OR private.is_module_admin())
      WITH CHECK (user_id = (SELECT auth.uid()) OR private.is_module_admin())';
  END IF;
END;
$$;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260719173000_auth_module1_runtime_proxy_role.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

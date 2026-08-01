-- Module 1 runtime parity: the trusted VPS gateway also owns session, MFA
-- factor and account-security writes. Keep RLS scoped to the authenticated
-- subject or the existing module-admin predicate.
-- This does not touch DataSIGH or clinical data.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_sessions TO app_prontomedic';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_mfa_factors TO app_prontomedic';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_account_security TO app_prontomedic';

    EXECUTE 'DROP POLICY IF EXISTS module1_sessions_proxy ON public.auth_sessions';
    EXECUTE 'CREATE POLICY module1_sessions_proxy ON public.auth_sessions FOR ALL TO app_prontomedic
      USING (user_id = (SELECT auth.uid()) OR private.is_module_admin())
      WITH CHECK (user_id = (SELECT auth.uid()) OR private.is_module_admin())';

    EXECUTE 'DROP POLICY IF EXISTS module1_mfa_proxy ON public.auth_mfa_factors';
    EXECUTE 'CREATE POLICY module1_mfa_proxy ON public.auth_mfa_factors FOR ALL TO app_prontomedic
      USING (user_id = (SELECT auth.uid()) OR private.is_module_admin())
      WITH CHECK (user_id = (SELECT auth.uid()) OR private.is_module_admin())';

    EXECUTE 'DROP POLICY IF EXISTS module1_security_proxy ON public.auth_account_security';
    EXECUTE 'CREATE POLICY module1_security_proxy ON public.auth_account_security FOR ALL TO app_prontomedic
      USING (user_id = (SELECT auth.uid()) OR private.is_module_admin())
      WITH CHECK (user_id = (SELECT auth.uid()) OR private.is_module_admin())';
  END IF;
END;
$$;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260719174500_auth_module1_runtime_auth_state_role.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

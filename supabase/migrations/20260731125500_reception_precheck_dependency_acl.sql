-- Module 11: restore the least-privilege dependency required by the
-- reception exception-capability RPC after the pre-check wrapper was added.

BEGIN;

GRANT EXECUTE ON FUNCTION public.get_reception_precheckin_context(BIGINT)
  TO prontomedic_reception_rpc_owner;

DO $$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.prontomedic_deployment_migrations
        WHERE filename = '20260731125500_reception_precheck_dependency_acl.sql'
     ) THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260731125500_reception_precheck_dependency_acl.sql', NOW());
  END IF;
END
$$;

COMMIT;

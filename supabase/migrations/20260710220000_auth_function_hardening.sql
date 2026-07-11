-- Harden privileged authentication helpers for the custom backend deployment.
DO $$
BEGIN
  IF to_regprocedure('public.create_password_reset(uuid,integer,inet)') IS NOT NULL THEN
    ALTER FUNCTION public.create_password_reset(UUID, INTEGER, INET)
      SET search_path = public, pg_temp;

    REVOKE ALL ON FUNCTION public.create_password_reset(UUID, INTEGER, INET) FROM PUBLIC;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON FUNCTION public.create_password_reset(UUID, INTEGER, INET) FROM authenticated;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
      GRANT EXECUTE ON FUNCTION public.create_password_reset(UUID, INTEGER, INET) TO app_prontomedic;
    END IF;

    COMMENT ON FUNCTION public.create_password_reset(UUID, INTEGER, INET)
    IS 'Privileged password-reset token creation; execute is revoked from PUBLIC and authenticated users.';
  END IF;
END $$;

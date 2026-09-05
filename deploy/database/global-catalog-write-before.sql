\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF to_regclass('public.notification_templates') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
     OR to_regclass('public.password_resets') IS NULL THEN
    RAISE EXCEPTION 'Baseline dos catalogos globais ausente';
  END IF;
END;
$smoke$;

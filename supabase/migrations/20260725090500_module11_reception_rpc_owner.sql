-- Module 11: isolated owner for reception workflow RPCs.
-- This role must never bypass RLS and must not be shared with other modules.

BEGIN;

DO $owner$
DECLARE
  v_executor_is_superuser BOOLEAN;
BEGIN
  SELECT rolsuper
    INTO v_executor_is_superuser
    FROM pg_roles
   WHERE rolname = CURRENT_USER;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = 'prontomedic_reception_rpc_owner'
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION
        'Module 11 requires a superuser to create prontomedic_reception_rpc_owner';
    END IF;

    EXECUTE
      'CREATE ROLE prontomedic_reception_rpc_owner NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  ELSIF EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = 'prontomedic_reception_rpc_owner'
       AND (
         rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper
         OR rolcreatedb OR rolcreaterole OR rolreplication
       )
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION
        'Module 11 cannot harden prontomedic_reception_rpc_owner without a superuser';
    END IF;

    EXECUTE
      'ALTER ROLE prontomedic_reception_rpc_owner NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  END IF;
END
$owner$;

COMMIT;

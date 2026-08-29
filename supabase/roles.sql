-- Runtime role required by the self-hosted ProntoMedic API.
-- Supabase CLI loads this file before applying migrations.
DO $roles$
DECLARE
  v_role TEXT;
BEGIN
  IF to_regrole('app_prontomedic') IS NULL THEN
    CREATE ROLE app_prontomedic
      NOLOGIN
      NOINHERIT
      NOCREATEDB
      NOCREATEROLE
      NOSUPERUSER
      NOBYPASSRLS;
  END IF;

  IF to_regrole('prontomedic_rpc_owner') IS NULL THEN
    CREATE ROLE prontomedic_rpc_owner
      NOLOGIN NOINHERIT BYPASSRLS NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;

  FOREACH v_role IN ARRAY ARRAY[
    'prontomedic_reception_rpc_owner',
    'prontomedic_patient_portal_rpc_owner',
    'prontomedic_tiss_rpc_owner',
    'prontomedic_tiss_gateway',
    'prontomedic_lis_rpc_owner',
    'prontomedic_worklist_rpc_owner',
    'prontomedic_financial_rpc_owner',
    'prontomedic_billing_authz_trigger_owner'
  ] LOOP
    IF to_regrole(v_role) IS NULL THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
        v_role
      );
    END IF;
    EXECUTE format('GRANT %I TO postgres', v_role);
  END LOOP;

  GRANT app_prontomedic, prontomedic_rpc_owner TO postgres;

END
$roles$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS m9_private;
CREATE SCHEMA IF NOT EXISTS m22_private;
CREATE SCHEMA IF NOT EXISTS m23_private;
REVOKE ALL ON SCHEMA m9_private, m22_private, m23_private FROM PUBLIC;

GRANT USAGE, CREATE ON SCHEMA private TO
  prontomedic_rpc_owner,
  prontomedic_reception_rpc_owner,
  prontomedic_patient_portal_rpc_owner,
  prontomedic_tiss_rpc_owner,
  prontomedic_lis_rpc_owner,
  prontomedic_worklist_rpc_owner,
  prontomedic_financial_rpc_owner,
  prontomedic_billing_authz_trigger_owner;

GRANT USAGE, CREATE ON SCHEMA public TO
  prontomedic_rpc_owner,
  prontomedic_reception_rpc_owner,
  prontomedic_patient_portal_rpc_owner,
  prontomedic_tiss_rpc_owner,
  prontomedic_lis_rpc_owner,
  prontomedic_worklist_rpc_owner,
  prontomedic_financial_rpc_owner,
  prontomedic_billing_authz_trigger_owner;

GRANT USAGE, CREATE ON SCHEMA m9_private, m22_private, m23_private
  TO prontomedic_rpc_owner;

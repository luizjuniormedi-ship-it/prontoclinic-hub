\set ON_ERROR_STOP on

DO $audit$
DECLARE
  missing_columns integer;
BEGIN
  IF to_regclass('private.local_auth_challenges') IS NULL THEN
    RAISE EXCEPTION 'private.local_auth_challenges ausente';
  END IF;

  SELECT count(*) INTO missing_columns
    FROM unnest(ARRAY[
      'id','user_id','token_hash','type','redirect_to','expires_at',
      'consumed_at','session_id','password_updated_at','created_at'
    ]) expected(column_name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns actual
      WHERE actual.table_schema = 'private'
        AND actual.table_name = 'local_auth_challenges'
        AND actual.column_name = expected.column_name
   );
  IF missing_columns <> 0 THEN
    RAISE EXCEPTION 'colunas do challenge incompletas: %', missing_columns;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'banned_until'
  ) THEN
    RAISE EXCEPTION 'auth.users.banned_until ausente';
  END IF;

  IF NOT has_table_privilege('service_role', 'private.local_auth_challenges', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'service_role sem ACL completa no challenge';
  END IF;
  IF has_table_privilege('authenticated', 'private.local_auth_challenges', 'SELECT')
     OR has_table_privilege('anon', 'private.local_auth_challenges', 'SELECT') THEN
    RAISE EXCEPTION 'challenge exposto a role de navegador';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.prontomedic_deployment_migrations
     WHERE filename = '20260802183000_local_auth_admin_contract.sql'
  ) THEN
    RAISE EXCEPTION 'migration auth-admin nao registrada';
  END IF;
END
$audit$;

SELECT 'LOCAL_AUTH_ADMIN_DATABASE_CONTRACT_OK' AS result;

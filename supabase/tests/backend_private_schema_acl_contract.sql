\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'Backend ACL contract failed: schema private is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'app_prontomedic'
  ) THEN
    RAISE EXCEPTION 'Backend ACL contract failed: role app_prontomedic is missing';
  END IF;

  IF NOT has_schema_privilege('app_prontomedic', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'Backend ACL contract failed: app_prontomedic lacks USAGE on private';
  END IF;

  IF has_schema_privilege('app_prontomedic', 'private', 'CREATE') THEN
    RAISE EXCEPTION 'Backend ACL contract failed: app_prontomedic can CREATE in private';
  END IF;

  IF has_schema_privilege('anon', 'private', 'USAGE')
     OR has_schema_privilege('authenticated', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'Backend ACL contract failed: client roles can access private';
  END IF;

  IF has_schema_privilege('anon', 'private', 'CREATE')
     OR has_schema_privilege('authenticated', 'private', 'CREATE') THEN
    RAISE EXCEPTION 'Backend ACL contract failed: client roles can create in private';
  END IF;

  IF to_regprocedure('private.lookup_auth_user(text)') IS NULL THEN
    RAISE EXCEPTION 'Backend ACL contract failed: lookup_auth_user is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS function_record
    JOIN pg_roles AS owner_role
      ON owner_role.oid = function_record.proowner
    WHERE function_record.oid =
      'private.lookup_auth_user(text)'::REGPROCEDURE
      AND function_record.prosecdef
      AND owner_role.rolname = 'postgres'
      AND function_record.proconfig @>
        ARRAY['search_path=pg_catalog, auth, public, private']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'Backend ACL contract failed: lookup_auth_user hardening is incomplete';
  END IF;

  IF NOT has_function_privilege(
    'app_prontomedic',
    'private.lookup_auth_user(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Backend ACL contract failed: backend cannot execute lookup_auth_user';
  END IF;

  IF has_function_privilege(
       'anon',
       'private.lookup_auth_user(text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'private.lookup_auth_user(text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Backend ACL contract failed: client roles can execute lookup_auth_user';
  END IF;

  IF (
    SELECT count(*)
    FROM private.lookup_auth_user(
      'codex-auth-contract-does-not-exist@invalid.local'
    )
  ) <> 0 THEN
    RAISE EXCEPTION 'Backend ACL contract failed: unknown identifier returned users';
  END IF;

  IF (
    SELECT count(*)
    FROM private.lookup_auth_user('---')
  ) <> 0 THEN
    RAISE EXCEPTION 'Backend ACL contract failed: empty normalized CPF returned users';
  END IF;
END;
$$;

SELECT 'backend_private_schema_acl_contract_ok' AS result;

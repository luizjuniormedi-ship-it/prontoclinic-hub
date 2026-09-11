BEGIN;

DO $$
DECLARE
  create_function OID := to_regprocedure(
    'public.create_pre_cadastro(uuid,character varying,character varying,character varying,date,character varying,character varying,character varying,character varying,character varying,character varying,character varying,character varying,character varying,character,inet,text)');
  confirm_function OID := to_regprocedure(
    'public.confirm_pre_cadastro(character varying)');
BEGIN
  IF create_function IS NULL OR confirm_function IS NULL THEN
    RAISE EXCEPTION 'assinaturas canonicas do pre-cadastro ausentes';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('create_pre_cadastro', 'confirm_pre_cadastro')
      AND p.oid <> ALL (ARRAY[create_function, confirm_function])
  ) THEN
    RAISE EXCEPTION 'overload legado desconhecido impede retirada segura';
  END IF;
END $$;

-- Contract phase: Edge and frontend must already be active at this commit.
-- Enumerating pg_proc closes every historical overload, not only one signature.
DO $$
DECLARE legacy_function RECORD;
BEGIN
  FOR legacy_function IN
    SELECT n.nspname, p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('create_pre_cadastro', 'confirm_pre_cadastro')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      legacy_function.nspname,
      legacy_function.proname,
      legacy_function.identity_args
    );
  END LOOP;
END $$;

COMMIT;

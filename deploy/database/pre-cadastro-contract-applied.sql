DO $edge_prerequisite$
DECLARE
  edge_function RECORD;
  function_count INTEGER := 0;
BEGIN
  FOR edge_function IN
    SELECT oid FROM pg_catalog.pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (
        'pre_cadastro_edge_request', 'pre_cadastro_edge_confirm',
        'pre_cadastro_edge_status', 'pre_cadastro_edge_resend'
      )
  LOOP
    function_count := function_count + 1;
    IF has_function_privilege('anon', edge_function.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', edge_function.oid, 'EXECUTE')
      OR NOT has_function_privilege('service_role', edge_function.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'privilegios Edge divergentes em %', edge_function.oid::regprocedure;
    END IF;
  END LOOP;
  IF function_count <> 4 THEN
    RAISE EXCEPTION 'contrato Edge predecessor incompleto';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260910223000'
  ) THEN
    RAISE EXCEPTION 'migration Edge predecessora ausente';
  END IF;
END
$edge_prerequisite$;

DO $smoke$
DECLARE
  legacy_function RECORD;
  target_role TEXT;
BEGIN
  FOR legacy_function IN
    SELECT oid FROM pg_catalog.pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('create_pre_cadastro', 'confirm_pre_cadastro')
  LOOP
    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(target_role, legacy_function.oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% ainda executa RPC legado %', target_role,
          legacy_function.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260910224500'
  ) THEN
    RAISE EXCEPTION 'ledger da retirada dos RPCs legados ausente';
  END IF;
END
$smoke$;

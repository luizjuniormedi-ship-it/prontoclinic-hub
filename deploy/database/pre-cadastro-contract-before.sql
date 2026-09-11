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
  create_function OID := to_regprocedure(
    'public.create_pre_cadastro(uuid,character varying,character varying,character varying,date,character varying,character varying,character varying,character varying,character varying,character varying,character varying,character varying,character varying,character,inet,text)');
  confirm_function OID := to_regprocedure(
    'public.confirm_pre_cadastro(character varying)');
BEGIN
  IF create_function IS NULL OR confirm_function IS NULL
    OR NOT has_function_privilege('anon', create_function, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', create_function, 'EXECUTE')
    OR NOT has_function_privilege('anon', confirm_function, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', confirm_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'contrato legado canonico indisponivel antes da migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('create_pre_cadastro', 'confirm_pre_cadastro')
      AND p.oid <> ALL (ARRAY[create_function, confirm_function])
  ) THEN
    RAISE EXCEPTION 'overload legado desconhecido antes da migration';
  END IF;
END
$smoke$;

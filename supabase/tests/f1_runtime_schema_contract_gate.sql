-- F1 operational schema contract gate. Catalog-only and rollback-safe.
BEGIN;

DO $f1$
DECLARE
  v_tiss_rls_enabled BOOLEAN;
  v_tiss_rls_forced BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = 'insurance_authorizations'
       AND relation.relkind IN ('r', 'p')
  ) THEN
    RAISE EXCEPTION
      'F1 schema contract requires physical public.insurance_authorizations';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'insurance_authorizations'
       AND column_name = 'procedure_desc'
       AND data_type = 'character varying'
       AND character_maximum_length = 200
  ) THEN
    RAISE EXCEPTION
      'F1 schema contract requires insurance_authorizations.procedure_desc VARCHAR(200)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = 'reception_authorizations'
       AND relation.relkind = 'v'
  ) THEN
    RAISE EXCEPTION
      'F1 schema contract requires reception_authorizations compatibility view';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'reception_authorizations'
       AND column_name = 'procedure_desc'
       AND data_type = 'character varying'
       AND character_maximum_length = 200
  ) THEN
    RAISE EXCEPTION
      'F1 schema contract requires reception_authorizations.procedure_desc projection';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'tiss_xml'
       AND column_name = 'cd_fatura'
       AND data_type = 'bigint'
  ) THEN
    RAISE EXCEPTION
      'F1 schema contract requires tiss_xml.cd_fatura BIGINT';
  END IF;

  SELECT relation.relrowsecurity, relation.relforcerowsecurity
    INTO v_tiss_rls_enabled, v_tiss_rls_forced
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relname = 'tiss_xml'
     AND relation.relkind IN ('r', 'p');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'F1 schema contract requires physical public.tiss_xml';
  END IF;

  IF v_tiss_rls_enabled IS NOT TRUE OR v_tiss_rls_forced IS NOT TRUE THEN
    RAISE EXCEPTION
      'F1 schema contract requires ENABLE and FORCE RLS on tiss_xml';
  END IF;
END
$f1$;

ROLLBACK;

SELECT 'F1_RUNTIME_SCHEMA_CONTRACT_GATE=PASS' AS result;

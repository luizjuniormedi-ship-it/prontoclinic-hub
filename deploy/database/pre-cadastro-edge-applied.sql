DO $smoke$
DECLARE
  v_function regprocedure;
  v_role text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.pre_cadastro'::regclass
      AND attname = 'token_confirmacao_hash'
      AND atttypid = 'character'::regtype
      AND atttypmod = 68
      AND attnum > 0
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.pre_cadastro'::regclass
      AND attname = 'confirmation_request_key'
      AND atttypid = 'uuid'::regtype
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'colunas do contrato Edge de pre-cadastro ausentes ou divergentes';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pre_cadastro
    WHERE token_confirmacao IS NOT NULL
      AND token_confirmacao_hash IS DISTINCT FROM
        encode(public.digest(token_confirmacao, 'sha256'), 'hex')
  ) THEN
    RAISE EXCEPTION 'token legado sem hash correspondente';
  END IF;
  IF to_regclass('public.idx_pre_cadastro_token_hash') IS NULL
    OR to_regclass('public.idx_pre_cadastro_company_email_normalized') IS NULL THEN
    RAISE EXCEPTION 'indices do contrato Edge de pre-cadastro ausentes';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.pre_cadastro'::regclass) THEN
    RAISE EXCEPTION 'RLS de pre_cadastro desativado';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'pre_cadastro') <> 2
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'pre_cadastro'
        AND policyname NOT IN ('pre_cadastro_staff_select', 'pre_cadastro_admin_delete')
    ) THEN
    RAISE EXCEPTION 'policies de pre_cadastro divergentes do contrato seguro';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.pre_cadastros_pendentes'::regclass
      AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION 'view pre_cadastros_pendentes nao respeita RLS do invocador';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    to_regprocedure('public.pre_cadastro_edge_request(uuid,uuid,character,character varying,character varying,character varying,character varying,character varying,date,character,character varying,character varying,character varying,character varying,character varying,character varying,character,character varying,character varying,character,inet,text)'),
    to_regprocedure('public.pre_cadastro_edge_status(character)'),
    to_regprocedure('public.pre_cadastro_edge_confirm(character)'),
    to_regprocedure('public.pre_cadastro_edge_resend(uuid,uuid,text,uuid,uuid,character)')
  ] LOOP
    IF v_function IS NULL THEN
      RAISE EXCEPTION 'RPC Edge de pre-cadastro ausente';
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, v_function, 'EXECUTE') THEN
        RAISE EXCEPTION '% ainda executa RPC Edge restrita %', v_role, v_function;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role sem EXECUTE em %', v_function;
    END IF;
  END LOOP;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(v_role, 'public.pre_cadastro', 'INSERT')
      OR has_table_privilege(v_role, 'public.pre_cadastro', 'UPDATE')
      OR has_any_column_privilege(v_role, 'public.pre_cadastro', 'INSERT')
      OR has_any_column_privilege(v_role, 'public.pre_cadastro', 'UPDATE') THEN
      RAISE EXCEPTION '% ainda escreve diretamente em pre_cadastro', v_role;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260910223000'
  ) THEN
    RAISE EXCEPTION 'ledger da migration de pre-cadastro ausente';
  END IF;
END
$smoke$;

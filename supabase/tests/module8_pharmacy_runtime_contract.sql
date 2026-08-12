-- Module 8 catalog and privilege contract. Disposable database only.
BEGIN;

DO $contract$
DECLARE
  v_table TEXT;
  v_function TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'medicamentos', 'materiais', 'almoxarifados', 'lotes',
    'movimentacoes_estoque', 'dispensacoes', 'dispensacao_itens',
    'receitas_controladas'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_table
        AND c.relrowsecurity
        AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'M8 contract: RLS/FORCE RLS missing on public.%', v_table;
    END IF;
  END LOOP;

  FOREACH v_function IN ARRAY ARRAY[
    'registrar_movimentacao_estoque',
    'calcular_valor_estoque',
    'dispensar_estoque_atomic'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_function
        AND p.prosecdef
        AND pg_get_userbyid(p.proowner) = 'prontomedic_rpc_owner'
    ) THEN
      RAISE EXCEPTION 'M8 contract: secure owner missing for RPC %', v_function;
    END IF;
  END LOOP;

  IF has_function_privilege(
    'anon',
    'public.dispensar_estoque_atomic(uuid,bigint,bigint,bigint,uuid,text,jsonb)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.calcular_valor_estoque(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'M8 contract: anonymous RPC execution remains open';
  END IF;

  IF has_table_privilege('authenticated', 'public.dispensacoes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.dispensacao_itens', 'INSERT')
     OR has_table_privilege('authenticated', 'public.movimentacoes_estoque', 'INSERT')
  THEN
    RAISE EXCEPTION 'M8 contract: direct dispensing writes remain granted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'dispensacoes_company_operation_uq'
      AND indexdef ILIKE '%company_id, operation_id%'
  ) THEN
    RAISE EXCEPTION 'M8 contract: tenant idempotency index missing';
  END IF;
END;
$contract$;

ROLLBACK;

DO $$
DECLARE
  v_forced INTEGER;
BEGIN
  IF to_regprocedure('public.dispensar_estoque_atomic(uuid,bigint,bigint,bigint,uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'RPC atomica da Farmacia ausente';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.dispensar_estoque_atomic(uuid,bigint,bigint,bigint,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sem EXECUTE na dispensacao atomica';
  END IF;
  IF has_function_privilege('anon', 'public.dispensar_estoque_atomic(uuid,bigint,bigint,bigint,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon possui EXECUTE na dispensacao atomica';
  END IF;
  SELECT count(*) INTO v_forced FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN (
    'medicamentos', 'materiais', 'almoxarifados', 'lotes',
    'movimentacoes_estoque', 'dispensacoes', 'dispensacao_itens',
    'receitas_controladas'
  ) AND c.relrowsecurity AND c.relforcerowsecurity;
  IF v_forced <> 8 THEN
    RAISE EXCEPTION 'FORCE RLS incompleto na Farmacia: %', v_forced;
  END IF;
  IF to_regclass('public.dispensacoes_company_operation_uq') IS NULL
     OR to_regclass('public.dispensacao_itens_prescription_item_idx') IS NULL THEN
    RAISE EXCEPTION 'indices atomicos da Farmacia ausentes';
  END IF;
END
$$;

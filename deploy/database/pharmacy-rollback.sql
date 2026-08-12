DO $$
BEGIN
  IF to_regprocedure('public.dispensar_estoque_atomic(uuid,bigint,bigint,bigint,uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'rollback operacional removeu a RPC e perdeu o contrato auditavel';
  END IF;
  IF has_function_privilege('authenticated', 'public.dispensar_estoque_atomic(uuid,bigint,bigint,bigint,uuid,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('app_prontomedic', 'public.dispensar_estoque_atomic(uuid,bigint,bigint,bigint,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rollback operacional nao bloqueou a dispensacao atomica';
  END IF;
  IF to_regclass('public.dispensacoes_company_operation_uq') IS NULL
     OR to_regclass('public.dispensacao_itens_prescription_item_idx') IS NULL THEN
    RAISE EXCEPTION 'rollback operacional removeu rastreabilidade da Farmacia';
  END IF;
END
$$;

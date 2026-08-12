DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dispensacoes'
      AND column_name = 'operation_id'
  ) THEN
    RAISE EXCEPTION 'contrato atomico da Farmacia ja existe antes da migration';
  END IF;
  IF to_regprocedure('public.dispensar_estoque_atomic(uuid,bigint,bigint,bigint,uuid,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'RPC atomica da Farmacia ja existe antes da migration';
  END IF;
END
$$;

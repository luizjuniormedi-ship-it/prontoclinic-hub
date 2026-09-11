DO $smoke$
BEGIN
  IF to_regclass('public.pre_cadastro') IS NULL THEN
    RAISE EXCEPTION 'tabela predecessora pre_cadastro ausente';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.pre_cadastro'::regclass
      AND attname IN ('token_confirmacao_hash', 'confirmation_request_key')
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'contrato Edge de pre-cadastro parcialmente aplicado';
  END IF;
  IF to_regprocedure('public.pre_cadastro_edge_request(uuid,uuid,character,character varying,character varying,character varying,character varying,character varying,date,character,character varying,character varying,character varying,character varying,character varying,character varying,character,character varying,character varying,character,inet,text)') IS NOT NULL
    OR to_regprocedure('public.pre_cadastro_edge_status(character)') IS NOT NULL
    OR to_regprocedure('public.pre_cadastro_edge_confirm(character)') IS NOT NULL
    OR to_regprocedure('public.pre_cadastro_edge_resend(uuid,uuid,text,uuid,uuid,character)') IS NOT NULL THEN
    RAISE EXCEPTION 'RPC Edge de pre-cadastro ja existe antes da migration';
  END IF;
END
$smoke$;

DO $cleanup_before$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.pre_cadastro
    WHERE token_confirmacao IS NOT NULL
      AND token_confirmacao_hash IS NOT NULL
      AND token_confirmacao_hash IS DISTINCT FROM
        encode(public.digest(token_confirmacao, 'sha256'), 'hex')
  ) THEN
    RAISE EXCEPTION 'plaintext legado com hash divergente antes da limpeza';
  END IF;
END
$cleanup_before$;

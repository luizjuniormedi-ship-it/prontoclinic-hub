BEGIN;

-- The predecessor committed the ACL revocation. This lock now waits for every
-- legacy RPC transaction that was authorized before that commit to finish.
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('prontomedic:pre-cadastro:legacy-drain', 0));

LOCK TABLE public.pre_cadastro IN SHARE ROW EXCLUSIVE MODE;

UPDATE public.pre_cadastro
SET token_confirmacao_hash = encode(public.digest(token_confirmacao, 'sha256'), 'hex')
WHERE token_confirmacao IS NOT NULL
  AND token_confirmacao_hash IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.pre_cadastro
    WHERE token_confirmacao IS NOT NULL
      AND token_confirmacao_hash IS DISTINCT FROM
        encode(public.digest(token_confirmacao, 'sha256'), 'hex')
  ) THEN
    RAISE EXCEPTION 'token plaintext sem hash equivalente impede retirada segura';
  END IF;
END $$;

UPDATE public.pre_cadastro
SET token_confirmacao = NULL
WHERE token_confirmacao IS NOT NULL;

COMMIT;

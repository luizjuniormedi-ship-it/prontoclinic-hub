DO $cleanup_applied$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pre_cadastro WHERE token_confirmacao IS NOT NULL) THEN
    RAISE EXCEPTION 'plaintext legado permaneceu apos limpeza';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260910230000'
  ) THEN
    RAISE EXCEPTION 'ledger da limpeza de plaintext ausente';
  END IF;
END
$cleanup_applied$;

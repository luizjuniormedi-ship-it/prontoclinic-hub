DO $cleanup_rollback$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pre_cadastro WHERE token_confirmacao IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback preserve_schema reintroduziu plaintext';
  END IF;
  -- preserve_schema smoke runs before the coordinator removes this ledger row.
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260910230000'
  ) OR NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260910224500'
  ) THEN
    RAISE EXCEPTION 'ledger divergente apos rollback da limpeza';
  END IF;
END
$cleanup_rollback$;

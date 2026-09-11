BEGIN;

-- Restore only the two canonical signatures exposed by the expand phase.
-- Unknown overloads, if introduced later by drift, remain unavailable.
GRANT EXECUTE ON FUNCTION public.create_pre_cadastro(
  UUID, VARCHAR, VARCHAR, VARCHAR, DATE, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, CHAR, INET, TEXT
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_pre_cadastro(VARCHAR)
  TO anon, authenticated;

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260910224500';

COMMIT;

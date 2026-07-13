-- Compatibility layer for clean PostgreSQL replays outside Supabase.
-- On Supabase, auth.users already exists and both statements are no-ops.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY
);

-- Supabase provides auth.uid(); keep an inert compatibility function for
-- clean PostgreSQL replays without replacing an existing implementation.
DO $$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    EXECUTE 'CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS ''SELECT NULL::uuid''';
  END IF;
END
$$;

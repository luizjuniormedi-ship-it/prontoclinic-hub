-- Compatibility layer for clean PostgreSQL replays outside Supabase.
-- On Supabase, auth.users already exists and both statements are no-ops.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY
);

-- Shared schema for restricted owner-RPC helpers.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, app_prontomedic;

COMMIT;

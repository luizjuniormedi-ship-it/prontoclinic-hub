-- Forward-only security hardening. Recreating the superseded permissive policies
-- would reopen cross-unit access. Application rollback must preserve this schema.
BEGIN;
SELECT 1;
COMMIT;

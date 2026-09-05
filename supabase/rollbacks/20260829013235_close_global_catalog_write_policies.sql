-- Forward-only security closure. Restoring permissive catalog policies or
-- direct DML grants would reopen cross-tenant write surfaces.
BEGIN;
SELECT 1;
COMMIT;

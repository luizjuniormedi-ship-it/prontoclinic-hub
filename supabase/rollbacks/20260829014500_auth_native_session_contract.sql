-- Validation-only migration. The native GoTrue schema is auth-owned and is
-- intentionally left unchanged by logical rollback.
BEGIN;
SELECT 1;
COMMIT;

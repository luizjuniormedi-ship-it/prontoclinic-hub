-- Expand migration: preserving the additive schema keeps both the previous
-- application release and the Edge-mediated release operational during rollback.
BEGIN;
DO $rollback$
BEGIN
  RAISE NOTICE 'PRESERVE_SCHEMA: application rollback remains compatible';
END
$rollback$;
COMMIT;

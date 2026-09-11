BEGIN;

DO $$
BEGIN
  RAISE NOTICE 'PRESERVE_SCHEMA: hashed pre-registration credentials remain compatible';
END $$;

COMMIT;

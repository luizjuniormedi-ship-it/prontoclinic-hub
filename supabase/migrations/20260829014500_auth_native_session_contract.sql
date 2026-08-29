-- Validate the native GoTrue session contract consumed by the local auth bridge.
-- Auth-owned tables are deliberately not modified by application migrations.
BEGIN;

DO $contract$
BEGIN
  IF to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION 'auth.sessions is required by the local auth bridge';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'auth'
       AND table_name = 'refresh_tokens'
       AND column_name = 'session_id'
       AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'auth.refresh_tokens.session_id UUID is required by the local auth bridge';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint AS constraint_record
     WHERE constraint_record.conrelid = 'auth.refresh_tokens'::regclass
       AND constraint_record.contype = 'f'
       AND constraint_record.confrelid = 'auth.sessions'::regclass
       AND ARRAY(
         SELECT attribute.attname
           FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, ordinal_position)
           JOIN pg_attribute AS attribute
             ON attribute.attrelid = constraint_record.conrelid
            AND attribute.attnum = key_column.attnum
          ORDER BY key_column.ordinal_position
       ) = ARRAY['session_id']::NAME[]
  ) THEN
    RAISE EXCEPTION 'auth.refresh_tokens.session_id must reference auth.sessions(id)';
  END IF;
END
$contract$;

COMMIT;

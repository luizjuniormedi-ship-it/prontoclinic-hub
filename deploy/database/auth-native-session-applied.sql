\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint constraint_record
     WHERE constraint_record.conrelid = 'auth.refresh_tokens'::regclass
       AND constraint_record.contype = 'f'
       AND constraint_record.confrelid = 'auth.sessions'::regclass
  ) THEN
    RAISE EXCEPTION 'FK de refresh token para sessao nativa ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'refresh_tokens'
       AND column_name = 'session_id' AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'auth.refresh_tokens.session_id UUID ausente';
  END IF;
END;
$smoke$;

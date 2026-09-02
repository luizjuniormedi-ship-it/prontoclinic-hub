\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF to_regclass('auth.sessions') IS NULL
     OR to_regclass('auth.refresh_tokens') IS NULL THEN
    RAISE EXCEPTION 'Tabelas nativas de sessao ausentes';
  END IF;
END;
$smoke$;

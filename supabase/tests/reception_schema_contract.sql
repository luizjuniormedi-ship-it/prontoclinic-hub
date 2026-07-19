-- P0 reception schema contract. Catalog-only assertions; no DML.
BEGIN;

DO $$
DECLARE
  relation_kind CHAR;
  required_name TEXT;
  required_tables CONSTANT TEXT[] := ARRAY[
    'insurance_authorizations', 'insurance_eligibility_checks',
    'reception_checkins', 'reception_queue_tickets', 'reception_admin_history'
  ];
  required_views CONSTANT TEXT[] := ARRAY[
    'reception_authorizations', 'reception_eligibility_checks'
  ];
  required_functions CONSTANT TEXT[] := ARRAY[
    'get_reception_checkin_readiness', 'perform_reception_checkin_secure',
    'update_reception_authorization_secure', 'update_reception_eligibility_secure'
  ];
BEGIN
  FOREACH required_name IN ARRAY required_tables LOOP
    SELECT c.relkind INTO relation_kind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = required_name;
    IF relation_kind IS DISTINCT FROM 'r' THEN
      RAISE EXCEPTION 'Relacao canonica ausente ou nao e tabela: public.%', required_name;
    END IF;
  END LOOP;

  FOREACH required_name IN ARRAY required_views LOOP
    SELECT c.relkind INTO relation_kind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = required_name;
    IF relation_kind IS DISTINCT FROM 'v' THEN
      RAISE EXCEPTION 'Projecao reception_* ausente ou nao e view: public.%', required_name;
    END IF;
  END LOOP;

  FOREACH required_name IN ARRAY required_functions LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = required_name AND p.prosecdef
    ) THEN
      RAISE EXCEPTION 'RPC de recepcao ausente: public.%', required_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('reception_authorizations','reception_eligibility_checks')
      AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'Duplicidade: reception_authorizations/eligibility ainda sao tabelas fisicas';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class target ON target.oid = c.confrelid
    JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
    WHERE c.contype = 'f' AND target_ns.nspname = 'public'
      AND target.relname IN ('reception_authorizations', 'reception_eligibility_checks')
  ) THEN
    RAISE EXCEPTION 'FK de historico ainda aponta para view reception_*';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class source ON source.oid = t.tgrelid
    JOIN pg_namespace source_ns ON source_ns.oid = source.relnamespace
    WHERE NOT t.tgisinternal AND source_ns.nspname = 'public'
      AND source.relname = 'insurance_authorizations'
      AND t.tgname = 'trg_capture_insurance_authorization_history'
  ) THEN
    RAISE EXCEPTION 'Trigger de historico ausente na tabela canonica insurance_authorizations';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class source ON source.oid = t.tgrelid
    JOIN pg_namespace source_ns ON source_ns.oid = source.relnamespace
    WHERE NOT t.tgisinternal AND source_ns.nspname = 'public'
      AND source.relname = 'insurance_eligibility_checks'
      AND t.tgname = 'trg_capture_insurance_eligibility_history'
  ) THEN
    RAISE EXCEPTION 'Trigger de historico ausente na tabela canonica insurance_eligibility_checks';
  END IF;
END
$$;

ROLLBACK;

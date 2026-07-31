-- Keep the Reception pre-account compatible with both deployed baselines:
-- legacy VARCHAR(7) competence and canonical DATE competence.

BEGIN;

DO $migration$
DECLARE
  v_signature REGPROCEDURE :=
    'private.m11_ensure_billing_preaccount(uuid,text,text,bigint,numeric)'::REGPROCEDURE;
  v_definition TEXT;
  v_patched_definition TEXT;
  v_competence_type TEXT;
  v_target_expression TEXT;
BEGIN
  SELECT data_type
  INTO v_competence_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'billing_accounts'
    AND column_name = 'competence_month';

  IF v_competence_type IS NULL THEN
    RAISE EXCEPTION 'billing_accounts.competence_month nao foi encontrada';
  END IF;

  v_target_expression := CASE
    WHEN v_competence_type = 'date'
      THEN 'date_trunc(''month'', CURRENT_DATE)::DATE'
    WHEN v_competence_type = 'character varying'
      THEN 'to_char(CURRENT_DATE, ''YYYY-MM'')'
    ELSE NULL
  END;

  IF v_target_expression IS NULL THEN
    RAISE EXCEPTION
      'Tipo de billing_accounts.competence_month nao suportado: %',
      v_competence_type;
  END IF;

  SELECT pg_get_functiondef(v_signature)
  INTO v_definition;

  v_patched_definition := replace(
    replace(
      v_definition,
      'date_trunc(''month'', CURRENT_DATE)::DATE',
      v_target_expression
    ),
    'to_char(CURRENT_DATE, ''YYYY-MM'')',
    v_target_expression
  );

  IF position(v_target_expression IN v_patched_definition) = 0 THEN
    RAISE EXCEPTION
      'Nao foi possivel alinhar a competencia do helper da Recepcao';
  END IF;

  EXECUTE v_patched_definition;
END;
$migration$;

ALTER FUNCTION private.m11_ensure_billing_preaccount(
  UUID, TEXT, TEXT, BIGINT, NUMERIC
) OWNER TO prontomedic_reception_rpc_owner;
REVOKE ALL ON FUNCTION private.m11_ensure_billing_preaccount(
  UUID, TEXT, TEXT, BIGINT, NUMERIC
) FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.m11_ensure_billing_preaccount(
  UUID, TEXT, TEXT, BIGINT, NUMERIC
) TO prontomedic_reception_rpc_owner;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260731040000_reception_preaccount_competence_runtime_compatibility.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

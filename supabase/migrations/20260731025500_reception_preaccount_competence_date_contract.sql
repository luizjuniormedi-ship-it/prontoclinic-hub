-- Keep the reception pre-account helper aligned with the canonical DATE column.
-- The previous compatibility migration emitted YYYY-MM text, which fails on a
-- clean replay after the billing closure module normalizes competence_month.

BEGIN;

DO $migration$
DECLARE
  v_signature REGPROCEDURE :=
    'private.m11_ensure_billing_preaccount(uuid,text,text,bigint,numeric)'::REGPROCEDURE;
  v_definition TEXT;
  v_patched_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(v_signature)
  INTO v_definition;

  v_patched_definition := replace(
    v_definition,
    'to_char(CURRENT_DATE, ''YYYY-MM'')',
    'date_trunc(''month'', CURRENT_DATE)::DATE'
  );

  IF v_patched_definition = v_definition THEN
    IF position(
      'date_trunc(''month'', CURRENT_DATE)::DATE'
      IN v_definition
    ) = 0 THEN
      RAISE EXCEPTION
        'Nao foi possivel localizar a atribuicao de competence_month no helper da recepcao';
    END IF;
  ELSE
    EXECUTE v_patched_definition;
  END IF;
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
VALUES ('20260731025500_reception_preaccount_competence_date_contract.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

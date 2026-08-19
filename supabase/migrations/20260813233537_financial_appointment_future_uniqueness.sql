-- Preserve historical financial duplicates while preventing new active rows
-- from reusing an appointment in the same ledger.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $requirements$
BEGIN
  IF to_regclass('public.billing_accounts') IS NULL
     OR to_regclass('public.billings') IS NULL THEN
    RAISE EXCEPTION
      'Financial appointment uniqueness requires billing_accounts and billings';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'billing_accounts'
      AND column_name IN ('appointment_id', 'deleted_at')
    GROUP BY table_schema, table_name
    HAVING count(*) = 2
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'billings'
      AND column_name IN ('appointment_id', 'lg_ativo')
    GROUP BY table_schema, table_name
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'Financial appointment uniqueness dependencies are incomplete';
  END IF;
END
$requirements$;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE VIEW private.financial_appointment_duplicate_audit
WITH (security_invoker = true)
AS
SELECT
  'billing_accounts'::TEXT AS ledger,
  account.appointment_id,
  count(*)::BIGINT AS row_count,
  count(*) FILTER (WHERE account.deleted_at IS NULL)::BIGINT AS active_count,
  array_agg(account.id::TEXT ORDER BY account.created_at, account.id)::TEXT[] AS row_ids,
  min(account.created_at) AS first_created_at,
  max(account.created_at) AS last_created_at
FROM public.billing_accounts account
WHERE account.appointment_id IS NOT NULL
GROUP BY account.appointment_id
HAVING count(*) > 1

UNION ALL

SELECT
  'billings'::TEXT AS ledger,
  billing.appointment_id,
  count(*)::BIGINT AS row_count,
  count(*) FILTER (WHERE COALESCE(billing.lg_ativo, TRUE))::BIGINT AS active_count,
  array_agg(billing.id::TEXT ORDER BY billing.created_at, billing.id)::TEXT[] AS row_ids,
  min(billing.created_at) AS first_created_at,
  max(billing.created_at) AS last_created_at
FROM public.billings billing
WHERE billing.appointment_id IS NOT NULL
GROUP BY billing.appointment_id
HAVING count(*) > 1;

REVOKE ALL ON private.financial_appointment_duplicate_audit
  FROM PUBLIC, anon, authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION private.enforce_financial_appointment_uniqueness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_conflict_id TEXT;
BEGIN
  IF NEW.appointment_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'billing_accounts' THEN
    IF NEW.deleted_at IS NOT NULL THEN
      RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.appointment_id IS NOT DISTINCT FROM NEW.appointment_id
       AND OLD.deleted_at IS NULL
       AND NEW.deleted_at IS NULL THEN
      RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended('billing_accounts:' || NEW.appointment_id::TEXT, 0)
    );

    SELECT account.id::TEXT
      INTO v_conflict_id
      FROM public.billing_accounts account
     WHERE account.appointment_id = NEW.appointment_id
       AND account.deleted_at IS NULL
       AND account.id IS DISTINCT FROM NEW.id
     ORDER BY account.created_at, account.id
     LIMIT 1;
  ELSIF TG_TABLE_NAME = 'billings' THEN
    IF NOT COALESCE(NEW.lg_ativo, TRUE) THEN
      RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.appointment_id IS NOT DISTINCT FROM NEW.appointment_id
       AND COALESCE(OLD.lg_ativo, TRUE)
       AND COALESCE(NEW.lg_ativo, TRUE) THEN
      RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended('billings:' || NEW.appointment_id::TEXT, 0)
    );

    SELECT billing.id::TEXT
      INTO v_conflict_id
      FROM public.billings billing
     WHERE billing.appointment_id = NEW.appointment_id
       AND COALESCE(billing.lg_ativo, TRUE)
       AND billing.id IS DISTINCT FROM NEW.id
     ORDER BY billing.created_at, billing.id
     LIMIT 1;
  ELSE
    RAISE EXCEPTION 'Unsupported financial ledger: %', TG_TABLE_NAME;
  END IF;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format(
        'Active %s row already exists for appointment_id %s',
        TG_TABLE_NAME,
        NEW.appointment_id
      ),
      DETAIL = format('Conflicting row id: %s', v_conflict_id),
      CONSTRAINT = format('%s_appointment_active_uq', TG_TABLE_NAME);
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.enforce_financial_appointment_uniqueness()
  FROM PUBLIC, anon, authenticated, app_prontomedic;

DROP TRIGGER IF EXISTS trg_financial_appointment_uniqueness
  ON public.billing_accounts;
DROP TRIGGER IF EXISTS trg_zz_financial_appointment_uniqueness
  ON public.billing_accounts;
CREATE TRIGGER trg_zz_financial_appointment_uniqueness
  BEFORE INSERT OR UPDATE OF appointment_id, deleted_at
  ON public.billing_accounts
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_financial_appointment_uniqueness();

DROP TRIGGER IF EXISTS trg_financial_appointment_uniqueness
  ON public.billings;
DROP TRIGGER IF EXISTS trg_zz_financial_appointment_uniqueness
  ON public.billings;
CREATE TRIGGER trg_zz_financial_appointment_uniqueness
  BEFORE INSERT OR UPDATE OF appointment_id, lg_ativo
  ON public.billings
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_financial_appointment_uniqueness();

COMMENT ON VIEW private.financial_appointment_duplicate_audit IS
  'Read-only detection of historical appointment duplicates; no rows are deleted or reconciled.';
COMMENT ON FUNCTION private.enforce_financial_appointment_uniqueness() IS
  'Prevents future active duplicates per appointment and ledger without rewriting historical data.';

COMMIT;

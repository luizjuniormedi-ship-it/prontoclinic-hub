BEGIN;

CREATE OR REPLACE FUNCTION private.enforce_reception_preaccount_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_request JSONB;
BEGIN
  IF NEW.checkin_operation IS DISTINCT FROM 'billing_preaccount'
     OR COALESCE(NEW.total_gross_amount, 0) > 0 THEN
    RETURN NEW;
  END IF;

  SELECT workflow.request_payload
    INTO v_request
  FROM public.reception_checkin_workflows workflow
  WHERE workflow.company_id = NEW.company_id
    AND workflow.appointment_id = NEW.appointment_id
    AND workflow.idempotency_key = NEW.checkin_idempotency_key
  LIMIT 1;

  IF v_request IS NULL
     OR v_request->>'priority' IS DISTINCT FROM 'legal'
     OR length(btrim(COALESCE(v_request->>'exception_reason', ''))) < 10 THEN
    RAISE EXCEPTION
      'Pre-conta deve ter valor positivo ou gratuidade formal registrada no workflow.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_reception_preaccount_value() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.enforce_reception_preaccount_value() FROM anon;
REVOKE ALL ON FUNCTION private.enforce_reception_preaccount_value() FROM authenticated;
REVOKE ALL ON FUNCTION private.enforce_reception_preaccount_value() FROM app_prontomedic;

DROP TRIGGER IF EXISTS trg_reception_preaccount_value_guard
  ON public.billing_accounts;
CREATE TRIGGER trg_reception_preaccount_value_guard
BEFORE INSERT OR UPDATE OF
  total_gross_amount,
  checkin_operation,
  checkin_idempotency_key
ON public.billing_accounts
FOR EACH ROW
EXECUTE FUNCTION private.enforce_reception_preaccount_value();

COMMIT;

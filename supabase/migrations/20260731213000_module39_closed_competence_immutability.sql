BEGIN;

DO $requirements$
BEGIN
  IF to_regclass('public.billing_accounts') IS NULL
     OR to_regclass('public.billing_competence_closures') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL
     OR to_regprocedure('public.active_unit_id()') IS NULL
     OR to_regrole('prontomedic_financial_rpc_owner') IS NULL THEN
    RAISE EXCEPTION 'Module 39 closed competence dependencies are missing';
  END IF;
END
$requirements$;

CREATE OR REPLACE FUNCTION public.m39_enforce_open_billing_competence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = on
AS $function$
DECLARE
  v_company_id UUID;
  v_unit_id INTEGER;
  v_competence_month DATE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_company_id := OLD.company_id;
    v_unit_id := OLD.unit_id;
    v_competence_month := OLD.competence_month;

    IF OLD.deleted_at IS NULL
       AND v_competence_month IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM public.billing_competence_closures closure
         WHERE closure.company_id = v_company_id
           AND closure.unit_id = v_unit_id
           AND closure.competence_month =
             date_trunc('month', v_competence_month)::DATE
           AND closure.status = 'closed'
       ) THEN
      RAISE EXCEPTION
        'Conta de competência fechada é imutável; reabra a competência primeiro';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.competence_month IS NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS DISTINCT FROM public.current_company_id()
     OR NEW.unit_id IS DISTINCT FROM public.active_unit_id() THEN
    RAISE EXCEPTION
      'Inclusão ou alteração de competência exige empresa e unidade ativas correspondentes'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.billing_competence_closures closure
    WHERE closure.company_id = NEW.company_id
      AND closure.unit_id = NEW.unit_id
      AND closure.competence_month =
        date_trunc('month', NEW.competence_month)::DATE
      AND closure.status = 'closed'
  ) THEN
    RAISE EXCEPTION 'Competência de faturamento está fechada';
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.m39_enforce_open_billing_competence()
  OWNER TO prontomedic_financial_rpc_owner;
REVOKE ALL ON FUNCTION public.m39_enforce_open_billing_competence()
  FROM PUBLIC, anon, authenticated, app_prontomedic;

DROP TRIGGER IF EXISTS trg_enforce_open_billing_competence
  ON public.billing_accounts;
CREATE TRIGGER trg_enforce_open_billing_competence
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.billing_accounts
  FOR EACH ROW EXECUTE FUNCTION public.m39_enforce_open_billing_competence();

COMMIT;


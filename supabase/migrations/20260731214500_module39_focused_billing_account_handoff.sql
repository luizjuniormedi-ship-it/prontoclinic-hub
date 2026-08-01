BEGIN;

DO $requirements$
BEGIN
  IF to_regclass('public.billing_accounts') IS NULL
     OR to_regclass('public.patients') IS NULL
     OR to_regprocedure('public.m39_billing_readiness(public.billing_accounts)') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL
     OR to_regprocedure('public.active_unit_id()') IS NULL
     OR to_regrole('prontomedic_financial_rpc_owner') IS NULL THEN
    RAISE EXCEPTION 'Module 39 focused handoff dependencies are missing';
  END IF;
END
$requirements$;

CREATE OR REPLACE FUNCTION public.m39_get_billing_account_secure(
  p_account_id UUID DEFAULT NULL,
  p_appointment_id BIGINT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = on
AS $function$
DECLARE
  v_company_id UUID := public.current_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_account public.billing_accounts%ROWTYPE;
  v_patient_name TEXT;
BEGIN
  IF auth.uid() IS NULL OR v_company_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Contexto financeiro exige usuário, empresa e unidade ativas'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access('faturamento', 'view') THEN
    RAISE EXCEPTION 'Permissão de visualização do faturamento é obrigatória'
      USING ERRCODE = '42501';
  END IF;
  IF p_account_id IS NULL AND p_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Conta ou agendamento é obrigatório';
  END IF;

  SELECT account.* INTO STRICT v_account
  FROM public.billing_accounts account
  WHERE account.company_id = v_company_id
    AND account.unit_id = v_unit_id
    AND account.deleted_at IS NULL
    AND (p_account_id IS NULL OR account.id = p_account_id)
    AND (p_appointment_id IS NULL OR account.appointment_id = p_appointment_id);

  SELECT patient.full_name::TEXT INTO v_patient_name
  FROM public.patients patient
  WHERE patient.id = v_account.patient_id
    AND patient.company_id = v_account.company_id;

  RETURN jsonb_build_object(
    'id', v_account.id,
    'appointment_id', v_account.appointment_id,
    'patient_id', v_account.patient_id,
    'patient_name', v_patient_name,
    'insurance_id', v_account.insurance_id,
    'billing_type', v_account.billing_type,
    'account_type', v_account.account_type,
    'status', v_account.status,
    'competence_month', v_account.competence_month,
    'total_gross_amount', v_account.total_gross_amount,
    'total_net_amount', v_account.total_net_amount,
    'total_paid_amount', v_account.total_paid_amount,
    'total_pending_amount', v_account.total_pending_amount,
    'authorization_number', v_account.authorization_number,
    'guide_number', v_account.guide_number,
    'has_pending_issues', v_account.has_pending_issues,
    'has_denial', v_account.has_denial,
    'is_reopened', v_account.is_reopened,
    'opened_at', v_account.opened_at,
    'paid_at', v_account.paid_at,
    'version', v_account.version,
    'readiness', public.m39_billing_readiness(v_account)
  );
EXCEPTION
  WHEN no_data_found THEN
    RAISE EXCEPTION 'Conta da recepção não localizada no contexto ativo'
      USING ERRCODE = 'P0002';
  WHEN too_many_rows THEN
    RAISE EXCEPTION 'Mais de uma conta corresponde ao agendamento informado';
END
$function$;

ALTER FUNCTION public.m39_get_billing_account_secure(UUID, BIGINT)
  OWNER TO prontomedic_financial_rpc_owner;
REVOKE ALL ON FUNCTION public.m39_get_billing_account_secure(UUID, BIGINT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m39_get_billing_account_secure(UUID, BIGINT)
  TO authenticated, app_prontomedic;

COMMENT ON FUNCTION public.m39_get_billing_account_secure(UUID, BIGINT) IS
  'Resolves the exact Reception billing handoff inside the active company and unit.';

COMMIT;


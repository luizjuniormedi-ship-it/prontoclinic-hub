-- billing_accounts.competence_month stores the canonical YYYY-MM value.

CREATE OR REPLACE FUNCTION private.m11_ensure_billing_preaccount(
  p_workflow_id UUID,
  p_billing_type TEXT,
  p_account_type TEXT,
  p_insurance_id BIGINT,
  p_total_gross_amount NUMERIC
)
RETURNS public.billing_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_actor UUID;
  v_workflow public.reception_checkin_workflows;
  v_account public.billing_accounts;
  v_payload JSONB;
  v_hash TEXT;
  v_idempotent BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_workflow
  FROM public.reception_checkin_workflows workflow
  WHERE workflow.id = p_workflow_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workflow de check-in nao encontrado'; END IF;

  v_actor := private.m11_assert_actor(
    v_workflow.company_id,
    v_workflow.unit_id,
    ARRAY['admin','gestor','recepcao','faturista']::TEXT[]
  );
  IF v_workflow.status <> 'in_progress' OR v_workflow.current_step <> 'billing' THEN
    RAISE EXCEPTION 'Workflow nao esta na etapa de faturamento';
  END IF;
  IF p_billing_type NOT IN ('particular','convenio') THEN
    RAISE EXCEPTION 'Tipo de faturamento invalido';
  END IF;
  IF NULLIF(btrim(COALESCE(p_account_type, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Tipo de conta obrigatorio';
  END IF;
  IF COALESCE(p_total_gross_amount, 0) < 0 THEN
    RAISE EXCEPTION 'Valor da pre-conta invalido';
  END IF;
  IF p_billing_type = 'convenio' AND p_insurance_id IS NULL THEN
    RAISE EXCEPTION 'Convenio obrigatorio';
  END IF;
  IF p_billing_type = 'particular' AND p_insurance_id IS NOT NULL THEN
    RAISE EXCEPTION 'Conta particular nao aceita convenio';
  END IF;

  v_payload := jsonb_build_object(
    'billing_type', p_billing_type,
    'account_type', btrim(p_account_type),
    'insurance_id', p_insurance_id,
    'total_gross_amount', COALESCE(p_total_gross_amount, 0)
  );
  v_hash := private.m11_request_hash(v_payload);

  SELECT * INTO v_account
  FROM public.billing_accounts account
  WHERE account.company_id = v_workflow.company_id
    AND account.checkin_operation = 'billing_preaccount'
    AND account.checkin_idempotency_key = v_workflow.idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    v_idempotent := TRUE;
    IF v_account.checkin_request_hash <> v_hash
       OR v_account.unit_id IS DISTINCT FROM v_workflow.unit_id
       OR v_account.patient_id <> v_workflow.patient_id
       OR v_account.appointment_id <> v_workflow.appointment_id
       OR v_account.billing_type <> p_billing_type
       OR v_account.account_type <> btrim(p_account_type)
       OR v_account.insurance_id IS DISTINCT FROM p_insurance_id
       OR COALESCE(v_account.total_gross_amount, 0) <> COALESCE(p_total_gross_amount, 0)
       OR v_account.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Retry da pre-conta possui campos divergentes';
    END IF;
  ELSE
    SELECT * INTO v_account
    FROM public.billing_accounts account
    WHERE account.company_id = v_workflow.company_id
      AND account.appointment_id = v_workflow.appointment_id
      AND account.deleted_at IS NULL
    ORDER BY account.created_at, account.id
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      IF v_account.checkin_idempotency_key IS NOT NULL
         AND (
           v_account.checkin_operation <> 'billing_preaccount'
           OR v_account.checkin_idempotency_key <> v_workflow.idempotency_key
         ) THEN
        RAISE EXCEPTION 'Agendamento possui pre-conta com outra chave';
      END IF;
      IF v_account.unit_id IS DISTINCT FROM v_workflow.unit_id
         OR v_account.patient_id <> v_workflow.patient_id
         OR v_account.billing_type <> p_billing_type
         OR v_account.account_type <> btrim(p_account_type)
         OR v_account.insurance_id IS DISTINCT FROM p_insurance_id
         OR COALESCE(v_account.total_gross_amount, 0) <> COALESCE(p_total_gross_amount, 0) THEN
        RAISE EXCEPTION 'Pre-conta existente nao corresponde ao workflow';
      END IF;
      UPDATE public.billing_accounts
      SET checkin_operation = 'billing_preaccount',
          checkin_idempotency_key = v_workflow.idempotency_key,
          checkin_request_hash = v_hash,
          updated_at = NOW()
      WHERE id = v_account.id
      RETURNING * INTO v_account;
    ELSE
      INSERT INTO public.billing_accounts(
        company_id, unit_id, appointment_id, patient_id, insurance_id,
        billing_type, account_type, status, competence_month,
        total_gross_amount, total_net_amount, total_pending_amount,
        checkin_operation, checkin_idempotency_key, checkin_request_hash
      ) VALUES (
        v_workflow.company_id,
        v_workflow.unit_id,
        v_workflow.appointment_id,
        v_workflow.patient_id,
        p_insurance_id,
        p_billing_type,
        btrim(p_account_type),
        CASE WHEN p_billing_type = 'particular' THEN 'particular_pendente' ELSE 'aberta' END,
        to_char(CURRENT_DATE, 'YYYY-MM'),
        COALESCE(p_total_gross_amount, 0),
        COALESCE(p_total_gross_amount, 0),
        COALESCE(p_total_gross_amount, 0),
        'billing_preaccount',
        v_workflow.idempotency_key,
        v_hash
      )
      RETURNING * INTO v_account;
    END IF;
  END IF;

  v_workflow.updated_by := v_actor;
  PERFORM private.m11_append_audit(
    v_workflow,
    'billing_account',
    v_account.id::TEXT,
    NULL,
    'preaccount_ready',
    'billing_preaccount',
    jsonb_build_object(
      'owner_operation', 'billing_preaccount',
      'owner_request_hash', v_hash,
      'idempotent', v_idempotent
    )
  );
  RETURN v_account;
END;
$function$;

ALTER FUNCTION private.m11_ensure_billing_preaccount(
  UUID, TEXT, TEXT, BIGINT, NUMERIC
) OWNER TO prontomedic_reception_rpc_owner;
REVOKE ALL ON FUNCTION private.m11_ensure_billing_preaccount(
  UUID, TEXT, TEXT, BIGINT, NUMERIC
) FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.m11_ensure_billing_preaccount(
  UUID, TEXT, TEXT, BIGINT, NUMERIC
) TO prontomedic_reception_rpc_owner;


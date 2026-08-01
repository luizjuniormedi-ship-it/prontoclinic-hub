BEGIN;

-- A conta aberta na Recepção é o agregado canônico. A tabela billings é
-- preservada como lançamento legado, mas sempre vinculada à mesma conta.
ALTER TABLE public.billings
  ADD COLUMN IF NOT EXISTS professional_id BIGINT,
  ADD COLUMN IF NOT EXISTS billing_type TEXT,
  ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS billing_account_id UUID;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.billings'::regclass
      AND conname = 'billings_billing_account_id_fkey'
  ) THEN
    ALTER TABLE public.billings
      ADD CONSTRAINT billings_billing_account_id_fkey
      FOREIGN KEY (billing_account_id)
      REFERENCES public.billing_accounts(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END
$constraints$;

CREATE INDEX IF NOT EXISTS idx_billings_billing_account
  ON public.billings(company_id, billing_account_id)
  WHERE billing_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_accounts_appointment
  ON public.billing_accounts(company_id, appointment_id)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.sync_completed_appointment_billing_secure(
  p_appointment_id BIGINT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.current_company_id();
  v_appointment public.appointments;
  v_patient public.patients;
  v_account public.billing_accounts;
  v_billing public.billings;
  v_plan_id INTEGER;
  v_insurance_id INTEGER;
  v_billing_type TEXT;
  v_price RECORD;
  v_price_found BOOLEAN := FALSE;
  v_calculated_amount NUMERIC(12,2) := 0;
  v_effective_amount NUMERIC(12,2) := 0;
BEGIN
  IF p_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento obrigatório';
  END IF;
  IF v_company IS NULL OR NOT public.m18_can_edit_attendance() THEN
    RAISE EXCEPTION 'Usuário sem permissão para concluir o faturamento do atendimento';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_company::TEXT || ':' || p_appointment_id::TEXT, 0)
  );

  SELECT *
    INTO v_appointment
    FROM public.appointments appointment
   WHERE appointment.id = p_appointment_id
     AND appointment.company_id = v_company
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF v_appointment.patient_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento sem paciente vinculado';
  END IF;
  IF lower(COALESCE(v_appointment.status, '')) NOT IN ('completed','finalizado','concluido','concluído') THEN
    RAISE EXCEPTION 'Finalize o atendimento antes de consolidar a conta';
  END IF;

  SELECT *
    INTO v_patient
    FROM public.patients patient
   WHERE patient.id = v_appointment.patient_id
     AND patient.company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente do atendimento não encontrado'; END IF;

  v_plan_id := COALESCE(v_appointment.insurance_plan_id, v_patient.insurance_plan_id);
  v_insurance_id := v_appointment.insurance_company_id;
  IF v_insurance_id IS NULL AND v_plan_id IS NOT NULL THEN
    SELECT plan.insurance_company_id
      INTO v_insurance_id
      FROM public.insurance_plans plan
     WHERE plan.id = v_plan_id
     LIMIT 1;
  END IF;
  v_billing_type := CASE WHEN v_insurance_id IS NULL THEN 'particular' ELSE 'convenio' END;

  SELECT price.*
    INTO v_price
    FROM public.price_tables price
   WHERE price.company_id = v_company
     AND price.active = TRUE
     AND price.dt_inicio <= CURRENT_DATE
     AND (price.dt_fim IS NULL OR price.dt_fim >= CURRENT_DATE)
     AND (
       (v_appointment.service_id IS NOT NULL AND price.service_id = v_appointment.service_id)
       OR price.service_id IS NULL
     )
     AND (
       (v_appointment.appointment_type_id IS NOT NULL
        AND price.appointment_type_id = v_appointment.appointment_type_id)
       OR price.appointment_type_id IS NULL
     )
     AND (
       (v_plan_id IS NOT NULL AND price.insurance_plan_id = v_plan_id)
       OR price.insurance_plan_id IS NULL
     )
   ORDER BY
     (price.insurance_plan_id = v_plan_id) DESC NULLS LAST,
     (price.service_id = v_appointment.service_id) DESC NULLS LAST,
     (price.appointment_type_id = v_appointment.appointment_type_id) DESC NULLS LAST,
     price.dt_inicio DESC,
     price.id DESC
   LIMIT 1;

  IF FOUND THEN
    v_price_found := TRUE;
    v_calculated_amount := GREATEST(
      0,
      CASE WHEN v_billing_type = 'convenio'
        THEN COALESCE(v_price.vl_convenio, 0)
        ELSE COALESCE(v_price.vl_particular, 0)
      END
      + COALESCE(v_price.vl_material, 0)
      + COALESCE(v_price.vl_medicamento, 0)
      + COALESCE(v_price.vl_taxa, 0)
      + COALESCE(v_price.vl_diaria, 0)
      + COALESCE(v_price.vl_gases, 0)
    );
  END IF;

  SELECT *
    INTO v_account
    FROM public.billing_accounts account
   WHERE account.company_id = v_company
     AND account.appointment_id = p_appointment_id
     AND account.deleted_at IS NULL
   ORDER BY account.created_at, account.id
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF v_account.patient_id IS DISTINCT FROM v_appointment.patient_id
       OR v_account.unit_id IS DISTINCT FROM v_appointment.unit_id THEN
      RAISE EXCEPTION 'Conta existente não corresponde ao paciente e à unidade do atendimento';
    END IF;
    IF v_account.status IN ('cancelada','baixada') THEN
      RAISE EXCEPTION 'Conta encerrada não pode receber lançamentos do atendimento';
    END IF;
    v_effective_amount := CASE
      WHEN v_price_found AND v_calculated_amount > 0 THEN v_calculated_amount
      ELSE COALESCE(v_account.total_gross_amount, 0)
    END;
    IF v_effective_amount < COALESCE(v_account.total_paid_amount, 0) THEN
      RAISE EXCEPTION 'Valor calculado é menor que o valor já recebido';
    END IF;
    UPDATE public.billing_accounts
       SET insurance_id = v_insurance_id,
           billing_type = v_billing_type,
           total_gross_amount = v_effective_amount,
           total_net_amount = v_effective_amount,
           total_pending_amount = GREATEST(
             v_effective_amount - COALESCE(total_paid_amount, 0),
             0
           ),
           updated_at = NOW()
     WHERE id = v_account.id
     RETURNING * INTO v_account;
  ELSE
    v_effective_amount := v_calculated_amount;
    INSERT INTO public.billing_accounts(
      company_id, unit_id, appointment_id, patient_id, insurance_id,
      billing_type, account_type, status, competence_month,
      total_gross_amount, total_net_amount, total_pending_amount
    ) VALUES (
      v_company, v_appointment.unit_id, p_appointment_id, v_appointment.patient_id,
      v_insurance_id, v_billing_type, 'ambulatorial',
      CASE WHEN v_billing_type = 'particular' THEN 'particular_pendente' ELSE 'aberta' END,
      date_trunc('month', CURRENT_DATE)::DATE,
      v_effective_amount, v_effective_amount, v_effective_amount
    )
    RETURNING * INTO v_account;
  END IF;

  SELECT *
    INTO v_billing
    FROM public.billings billing
   WHERE billing.company_id = v_company
     AND billing.appointment_id = p_appointment_id
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.billings
       SET unit_id = v_appointment.unit_id,
           patient_id = v_appointment.patient_id,
           professional_id = v_appointment.professional_id,
           billing_type = v_billing_type,
           amount = v_effective_amount,
           discount = 0,
           total = v_effective_amount,
           billing_account_id = v_account.id,
           notes = COALESCE(NULLIF(btrim(p_notes), ''), notes),
           status = COALESCE(NULLIF(status, ''), 'em_aberto')
     WHERE id = v_billing.id
     RETURNING * INTO v_billing;
  ELSE
    INSERT INTO public.billings(
      company_id, unit_id, patient_id, professional_id, appointment_id,
      billing_type, amount, discount, total, status, notes, billing_account_id
    ) VALUES (
      v_company, v_appointment.unit_id, v_appointment.patient_id,
      v_appointment.professional_id, p_appointment_id, v_billing_type,
      v_effective_amount, 0, v_effective_amount, 'em_aberto',
      NULLIF(btrim(p_notes), ''), v_account.id
    )
    RETURNING * INTO v_billing;
  END IF;

  RETURN jsonb_build_object(
    'billing_id', v_billing.id,
    'billing_account_id', v_account.id,
    'billing_type', v_billing_type,
    'gross_amount', v_effective_amount,
    'price_found', v_price_found
  );
END
$function$;

ALTER FUNCTION public.sync_completed_appointment_billing_secure(BIGINT, TEXT)
  OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.sync_completed_appointment_billing_secure(BIGINT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_completed_appointment_billing_secure(BIGINT, TEXT)
  TO authenticated, app_prontomedic;

GRANT SELECT, INSERT, UPDATE ON public.billings, public.billing_accounts
  TO prontomedic_reception_rpc_owner;
GRANT SELECT ON public.appointments, public.patients, public.insurance_plans,
  public.price_tables TO prontomedic_reception_rpc_owner;

DO $billings_sequence$
DECLARE
  v_sequence TEXT;
BEGIN
  SELECT pg_get_serial_sequence('public.billings', 'id') INTO v_sequence;
  IF v_sequence IS NOT NULL THEN
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE %s TO prontomedic_reception_rpc_owner',
      v_sequence
    );
  END IF;
END
$billings_sequence$;

COMMIT;

-- =============================================================================
-- ProntoMedic — Checkout transacional da Recepção
-- =============================================================================

CREATE OR REPLACE FUNCTION public.assert_reception_financial_permission()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  v_role := public.active_role_name();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Contexto AAL2 ativo é obrigatório' USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN (
    'admin','administrador','gestor','recepcao','recepção',
    'supervisor','supervisor_recepcao','financeiro'
  ) THEN
    RAISE EXCEPTION 'Perfil sem permissão para operar o checkout da recepção'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_reception_appointment_scope(p_appointment_id BIGINT)
RETURNS public.appointments
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_appointment public.appointments;
  v_company_id UUID;
  v_unit_id INTEGER;
BEGIN
  PERFORM public.assert_reception_financial_permission();
  SELECT * INTO v_appointment FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    v_company_id := public.active_company_id();
    v_unit_id := public.active_unit_id();
    IF v_company_id IS NULL
       OR v_appointment.company_id IS DISTINCT FROM v_company_id
       OR (v_unit_id IS NOT NULL AND v_appointment.unit_id IS DISTINCT FROM v_unit_id) THEN
      RAISE EXCEPTION 'Agendamento fora do contexto ativo' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN v_appointment;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_reception_checkout_summary(p_appointment_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_a public.appointments;
  v_p public.patients;
  v_account public.billing_accounts;
  v_service public.services_catalog;
  v_plan public.insurance_plans;
  v_guide public.reception_tiss_guides;
  v_receivable public.financial_transactions;
  v_account_exists BOOLEAN := FALSE;
  v_guide_exists BOOLEAN := FALSE;
  v_receivable_exists BOOLEAN := FALSE;
  v_payer_type TEXT;
  v_collection_policy TEXT;
  v_gross NUMERIC(14,2) := 0;
  v_discount NUMERIC(14,2) := 0;
  v_net NUMERIC(14,2) := 0;
  v_copay NUMERIC(14,2) := 0;
  v_patient_amount NUMERIC(14,2) := 0;
  v_insurance_amount NUMERIC(14,2) := 0;
  v_paid NUMERIC(14,2) := 0;
  v_patient_pending NUMERIC(14,2) := 0;
  v_requires_tiss BOOLEAN := FALSE;
  v_requires_signature BOOLEAN := TRUE;
  v_active_versions JSONB := '[]'::jsonb;
  v_cash_session_open BOOLEAN := FALSE;
  v_authorization_number TEXT;
  v_guide_type TEXT := 'consulta';
BEGIN
  v_a := public.assert_reception_appointment_scope(p_appointment_id);
  SELECT * INTO v_p FROM public.patients WHERE id = v_a.patient_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;

  IF v_a.service_id IS NOT NULL THEN
    SELECT * INTO v_service FROM public.services_catalog WHERE id = v_a.service_id;
  END IF;
  IF v_p.insurance_plan_id IS NOT NULL THEN
    SELECT * INTO v_plan FROM public.insurance_plans WHERE id = v_p.insurance_plan_id;
  END IF;

  SELECT * INTO v_account
  FROM public.billing_accounts
  WHERE company_id = v_a.company_id
    AND appointment_id = v_a.id
    AND deleted_at IS NULL
  ORDER BY opened_at DESC
  LIMIT 1;
  v_account_exists := FOUND;

  IF v_account_exists THEN
    v_payer_type := v_account.billing_type;
    v_collection_policy := v_account.collection_policy;
    v_gross := v_account.total_gross_amount;
    v_discount := v_account.total_discount_amount;
    v_net := v_account.total_net_amount;
    v_copay := v_account.total_copay_amount;
    v_patient_amount := v_account.patient_responsibility_amount;
    v_insurance_amount := v_account.insurance_responsibility_amount;
    v_authorization_number := v_account.authorization_number;
  ELSE
    v_payer_type := CASE WHEN v_a.insurance_company_id IS NULL THEN 'particular' ELSE 'convenio' END;
    v_gross := COALESCE(v_service.price, v_a.vl_consulta, 0);
    v_net := v_gross;

    IF v_a.insurance_company_id IS NOT NULL THEN
      SELECT CASE model
        WHEN 'valor_fixo' THEN COALESCE(fixed_amount, 0)
        WHEN 'percentual' THEN ROUND(v_net * COALESCE(percentage, 0) / 100, 2)
        WHEN 'percentual_com_teto' THEN LEAST(
          ROUND(v_net * COALESCE(percentage, 0) / 100, 2),
          COALESCE(cap_amount, v_net)
        )
        WHEN 'percentual_com_piso' THEN GREATEST(
          ROUND(v_net * COALESCE(percentage, 0) / 100, 2),
          COALESCE(floor_amount, 0)
        )
        ELSE 0
      END
      INTO v_copay
      FROM public.insurance_copay_rules rule
      WHERE rule.company_id = v_a.company_id
        AND rule.insurance_company_id = v_a.insurance_company_id
        AND (rule.insurance_plan_id IS NULL OR rule.insurance_plan_id = v_p.insurance_plan_id)
        AND (rule.service_id IS NULL OR rule.service_id = v_a.service_id)
        AND rule.status = 'ativo'
        AND rule.valid_from <= CURRENT_DATE
        AND (rule.valid_until IS NULL OR rule.valid_until >= CURRENT_DATE)
      ORDER BY
        (rule.insurance_plan_id IS NOT NULL)::INTEGER DESC,
        (rule.service_id IS NOT NULL)::INTEGER DESC,
        rule.valid_from DESC
      LIMIT 1;

      IF v_copay IS NULL AND COALESCE(v_plan.lg_coparticipacao, FALSE) THEN
        v_copay := CASE
          WHEN COALESCE(v_plan.valor_coparticipacao, 0) > 0
            THEN v_plan.valor_coparticipacao
          ELSE ROUND(v_net * COALESCE(v_plan.percentual_coparticipacao, 0) / 100, 2)
        END;
      END IF;

      v_copay := LEAST(COALESCE(v_copay, 0), v_net);
      v_patient_amount := v_copay;
      v_insurance_amount := GREATEST(v_net - v_copay, 0);
    ELSE
      v_patient_amount := v_net;
      v_insurance_amount := 0;
    END IF;

    v_collection_policy := CASE WHEN v_patient_amount > 0 THEN 'before_checkin' ELSE 'waived' END;
  END IF;

  IF v_account_exists THEN
    SELECT COALESCE(SUM(ft.amount), 0)
      INTO v_paid
    FROM public.financial_transactions ft
    WHERE ft.billing_account_id = v_account.id
      AND ft.transaction_type = 'payment'
      AND ft.payer_type = 'patient'
      AND ft.status IN ('captured','confirmed','paid','reconciled');

    SELECT * INTO v_receivable
    FROM public.financial_transactions ft
    WHERE ft.billing_account_id = v_account.id
      AND ft.transaction_type = 'receivable'
      AND ft.payer_type = 'patient'
    ORDER BY ft.created_at DESC
    LIMIT 1;
    v_receivable_exists := FOUND;
  END IF;

  v_patient_pending := GREATEST(v_patient_amount - v_paid, 0);

  IF v_a.insurance_company_id IS NOT NULL THEN
    SELECT coverage.requires_tiss_guide
      INTO v_requires_tiss
    FROM public.insurance_coverage_rules coverage
    WHERE coverage.company_id = v_a.company_id
      AND coverage.insurance_company_id = v_a.insurance_company_id
      AND (coverage.insurance_plan_id IS NULL OR coverage.insurance_plan_id = v_p.insurance_plan_id)
      AND (coverage.service_id IS NULL OR coverage.service_id = v_a.service_id)
      AND coverage.status IN ('permitido','apenas_com_autorizacao')
      AND coverage.valid_from <= CURRENT_DATE
      AND (coverage.valid_until IS NULL OR coverage.valid_until >= CURRENT_DATE)
    ORDER BY
      (coverage.insurance_plan_id IS NOT NULL)::INTEGER DESC,
      (coverage.service_id IS NOT NULL)::INTEGER DESC,
      coverage.valid_from DESC
    LIMIT 1;

    IF v_requires_tiss IS NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.insurance_tiss_guide_rules rule
        WHERE rule.company_id = v_a.company_id
          AND rule.insurance_company_id = v_a.insurance_company_id
          AND (rule.insurance_plan_id IS NULL OR rule.insurance_plan_id = v_p.insurance_plan_id)
          AND rule.active = TRUE
          AND rule.valid_from <= CURRENT_DATE
          AND (rule.valid_until IS NULL OR rule.valid_until >= CURRENT_DATE)
      ) INTO v_requires_tiss;
      IF NOT v_requires_tiss THEN v_requires_tiss := TRUE; END IF;
    END IF;

    SELECT rule.requires_signature, rule.guide_type
      INTO v_requires_signature, v_guide_type
    FROM public.insurance_tiss_guide_rules rule
    WHERE rule.company_id = v_a.company_id
      AND rule.insurance_company_id = v_a.insurance_company_id
      AND (rule.insurance_plan_id IS NULL OR rule.insurance_plan_id = v_p.insurance_plan_id)
      AND rule.active = TRUE
      AND rule.valid_from <= CURRENT_DATE
      AND (rule.valid_until IS NULL OR rule.valid_until >= CURRENT_DATE)
    ORDER BY (rule.insurance_plan_id IS NOT NULL)::INTEGER DESC, rule.valid_from DESC
    LIMIT 1;

    v_requires_signature := COALESCE(v_requires_signature, TRUE);
    v_guide_type := COALESCE(NULLIF(v_guide_type, ''), 'consulta');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', version.id,
      'version', version.version,
      'scope', version.scope,
      'effective_from', version.effective_from,
      'effective_until', version.effective_until
    ) ORDER BY version.effective_from DESC
  ), '[]'::jsonb)
  INTO v_active_versions
  FROM public.tiss_schema_versions version
  WHERE version.company_id = v_a.company_id
    AND version.scope = 'prestador_operadora'
    AND version.status = 'active'
    AND version.effective_from <= CURRENT_DATE
    AND (version.effective_until IS NULL OR version.effective_until >= CURRENT_DATE);

  IF v_account_exists THEN
    SELECT * INTO v_guide
    FROM public.reception_tiss_guides guide
    WHERE guide.billing_account_id = v_account.id
      AND guide.status NOT IN ('cancelled','replaced')
    ORDER BY guide.created_at DESC
    LIMIT 1;
    v_guide_exists := FOUND;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.cash_sessions session
    WHERE session.company_id = v_a.company_id
      AND session.unit_id = v_a.unit_id
      AND session.opened_by = auth.uid()
      AND session.status = 'open'
  ) INTO v_cash_session_open;

  SELECT COALESCE(
    (
      SELECT NULLIF(authorization_row.authorization_number, '')
      FROM public.reception_authorizations authorization_row
      WHERE authorization_row.appointment_id = v_a.id
        AND authorization_row.status IN ('autorizada','parcialmente_autorizada','liberada_excecao')
      ORDER BY authorization_row.authorized_at DESC NULLS LAST, authorization_row.created_at DESC
      LIMIT 1
    ),
    v_authorization_number
  ) INTO v_authorization_number;

  RETURN jsonb_build_object(
    'appointment_id', v_a.id,
    'patient_id', v_a.patient_id,
    'company_id', v_a.company_id,
    'unit_id', v_a.unit_id,
    'account_id', CASE WHEN v_account_exists THEN v_account.id ELSE NULL END,
    'prepared', v_account_exists,
    'payer_type', v_payer_type,
    'collection_policy', v_collection_policy,
    'insurance_id', v_a.insurance_company_id,
    'insurance_plan_id', v_p.insurance_plan_id,
    'service_id', v_a.service_id,
    'service_name', COALESCE(v_service.name, 'Atendimento'),
    'gross_amount', v_gross,
    'discount_amount', v_discount,
    'net_amount', v_net,
    'copay_amount', v_copay,
    'patient_responsibility_amount', v_patient_amount,
    'insurance_responsibility_amount', v_insurance_amount,
    'patient_paid_amount', v_paid,
    'patient_pending_amount', v_patient_pending,
    'authorization_number', v_authorization_number,
    'requires_tiss_guide', v_requires_tiss,
    'requires_tiss_signature', v_requires_signature,
    'suggested_guide_type', v_guide_type,
    'guide', CASE WHEN v_guide_exists THEN jsonb_build_object(
      'id', v_guide.id,
      'number', v_guide.guide_number,
      'type', v_guide.guide_type,
      'status', v_guide.status,
      'version', v_guide.tiss_version,
      'requires_signature', v_guide.requires_signature,
      'patient_signed_at', v_guide.patient_signed_at,
      'validation_errors', v_guide.validation_errors
    ) ELSE NULL END,
    'active_tiss_versions', v_active_versions,
    'cash_session_open', v_cash_session_open,
    'receivable', CASE WHEN v_receivable_exists THEN jsonb_build_object(
      'id', v_receivable.id,
      'status', v_receivable.status,
      'amount', v_receivable.amount,
      'due_date', v_receivable.due_date
    ) ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_reception_checkout_secure(
  p_appointment_id BIGINT,
  p_payer_type TEXT,
  p_gross_amount NUMERIC,
  p_discount_amount NUMERIC,
  p_patient_responsibility NUMERIC,
  p_insurance_responsibility NUMERIC,
  p_collection_policy TEXT,
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_a public.appointments;
  v_p public.patients;
  v_account public.billing_accounts;
  v_existing_summary JSONB;
  v_net NUMERIC(14,2);
  v_paid NUMERIC(14,2) := 0;
  v_authorization_number TEXT;
  v_description TEXT;
  v_receivable_key TEXT;
BEGIN
  v_a := public.assert_reception_appointment_scope(p_appointment_id);
  SELECT * INTO v_p FROM public.patients WHERE id = v_a.patient_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;

  p_payer_type := lower(trim(COALESCE(p_payer_type, '')));
  p_collection_policy := lower(trim(COALESCE(p_collection_policy, '')));
  v_net := ROUND(COALESCE(p_gross_amount, 0) - COALESCE(p_discount_amount, 0), 2);

  IF p_payer_type NOT IN ('particular','convenio','misto','pacote','cortesia','empresa') THEN
    RAISE EXCEPTION 'Tipo de pagador inválido';
  END IF;
  IF p_collection_policy NOT IN ('before_checkin','accounts_receivable','waived') THEN
    RAISE EXCEPTION 'Política de cobrança inválida';
  END IF;
  IF COALESCE(p_gross_amount, 0) < 0 OR COALESCE(p_discount_amount, 0) < 0 OR v_net < 0 THEN
    RAISE EXCEPTION 'Valores não podem ser negativos';
  END IF;
  IF COALESCE(p_discount_amount, 0) > COALESCE(p_gross_amount, 0) THEN
    RAISE EXCEPTION 'Desconto não pode superar o valor bruto';
  END IF;
  IF COALESCE(p_patient_responsibility, 0) < 0 OR COALESCE(p_insurance_responsibility, 0) < 0 THEN
    RAISE EXCEPTION 'Responsabilidades não podem ser negativas';
  END IF;
  IF abs((COALESCE(p_patient_responsibility, 0) + COALESCE(p_insurance_responsibility, 0)) - v_net) > 0.01 THEN
    RAISE EXCEPTION 'A soma das responsabilidades deve ser igual ao valor líquido';
  END IF;
  IF p_payer_type IN ('convenio','misto') AND v_a.insurance_company_id IS NULL THEN
    RAISE EXCEPTION 'Convênio é obrigatório para o pagador selecionado';
  END IF;
  IF p_payer_type = 'particular' AND COALESCE(p_insurance_responsibility, 0) > 0 THEN
    RAISE EXCEPTION 'Atendimento particular não pode atribuir valor ao convênio';
  END IF;
  IF p_collection_policy = 'waived' AND COALESCE(p_patient_responsibility, 0) > 0 THEN
    RAISE EXCEPTION 'Cobrança dispensada exige responsabilidade do paciente igual a zero';
  END IF;

  v_existing_summary := public.get_reception_checkout_summary(p_appointment_id);
  v_paid := COALESCE((v_existing_summary->>'patient_paid_amount')::NUMERIC, 0);
  IF COALESCE(p_patient_responsibility, 0) + 0.01 < v_paid THEN
    RAISE EXCEPTION 'Responsabilidade do paciente não pode ser menor que o valor já pago';
  END IF;

  SELECT COALESCE(
    (
      SELECT NULLIF(authorization_row.authorization_number, '')
      FROM public.reception_authorizations authorization_row
      WHERE authorization_row.appointment_id = v_a.id
        AND authorization_row.status IN ('autorizada','parcialmente_autorizada','liberada_excecao')
      ORDER BY authorization_row.authorized_at DESC NULLS LAST, authorization_row.created_at DESC
      LIMIT 1
    )
  ) INTO v_authorization_number;

  v_description := COALESCE(
    (SELECT name FROM public.services_catalog WHERE id = v_a.service_id),
    'Atendimento ambulatorial'
  );

  INSERT INTO public.billing_accounts (
    company_id, unit_id, patient_id, appointment_id, professional_id,
    insurance_id, insurance_plan_id, billing_type, account_type, status,
    collection_policy, competence_month, total_gross_amount,
    total_discount_amount, total_copay_amount, patient_responsibility_amount,
    insurance_responsibility_amount, total_net_amount, total_paid_amount,
    total_pending_amount, authorization_number, payer_snapshot, price_snapshot,
    source_module, source_record_id, created_by, updated_by, notes
  ) VALUES (
    v_a.company_id, v_a.unit_id, v_a.patient_id, v_a.id, v_a.professional_id,
    v_a.insurance_company_id, v_p.insurance_plan_id, p_payer_type, 'ambulatorial',
    CASE WHEN COALESCE(p_patient_responsibility, 0) > v_paid THEN 'particular_pendente' ELSE 'aberta' END,
    p_collection_policy, to_char(v_a.appointment_date, 'YYYY-MM'),
    ROUND(COALESCE(p_gross_amount, 0), 2), ROUND(COALESCE(p_discount_amount, 0), 2),
    CASE WHEN p_payer_type IN ('convenio','misto') THEN ROUND(COALESCE(p_patient_responsibility, 0), 2) ELSE 0 END,
    ROUND(COALESCE(p_patient_responsibility, 0), 2),
    ROUND(COALESCE(p_insurance_responsibility, 0), 2), v_net, v_paid,
    GREATEST(v_net - v_paid, 0), v_authorization_number,
    jsonb_build_object(
      'payer_type', p_payer_type,
      'insurance_id', v_a.insurance_company_id,
      'insurance_plan_id', v_p.insurance_plan_id,
      'card_number', COALESCE(v_p.insurance_card_number, to_jsonb(v_p)->>'ds_matricula', to_jsonb(v_p)->>'insurance_number')
    ),
    jsonb_build_object(
      'gross_amount', ROUND(COALESCE(p_gross_amount, 0), 2),
      'discount_amount', ROUND(COALESCE(p_discount_amount, 0), 2),
      'captured_at', NOW(),
      'source', 'reception_checkout'
    ),
    'reception', v_a.id::TEXT, auth.uid(), auth.uid(), NULLIF(trim(COALESCE(p_notes, '')), '')
  )
  ON CONFLICT (company_id, source_module, source_record_id) DO UPDATE SET
    unit_id = EXCLUDED.unit_id,
    patient_id = EXCLUDED.patient_id,
    professional_id = EXCLUDED.professional_id,
    insurance_id = EXCLUDED.insurance_id,
    insurance_plan_id = EXCLUDED.insurance_plan_id,
    billing_type = EXCLUDED.billing_type,
    collection_policy = EXCLUDED.collection_policy,
    competence_month = EXCLUDED.competence_month,
    total_gross_amount = EXCLUDED.total_gross_amount,
    total_discount_amount = EXCLUDED.total_discount_amount,
    total_copay_amount = EXCLUDED.total_copay_amount,
    patient_responsibility_amount = EXCLUDED.patient_responsibility_amount,
    insurance_responsibility_amount = EXCLUDED.insurance_responsibility_amount,
    total_net_amount = EXCLUDED.total_net_amount,
    total_paid_amount = EXCLUDED.total_paid_amount,
    total_pending_amount = EXCLUDED.total_pending_amount,
    authorization_number = EXCLUDED.authorization_number,
    payer_snapshot = EXCLUDED.payer_snapshot,
    price_snapshot = EXCLUDED.price_snapshot,
    status = EXCLUDED.status,
    notes = EXCLUDED.notes,
    updated_by = auth.uid(),
    updated_at = NOW()
  RETURNING * INTO v_account;

  INSERT INTO public.billing_account_items (
    company_id, billing_account_id, source_module, source_record_id, item_type,
    service_id, description, quantity, unit_price, gross_amount, discount_amount,
    net_amount, patient_amount, insurance_amount, status, execution_date,
    metadata, created_by
  ) VALUES (
    v_a.company_id, v_account.id, 'agenda', v_a.id::TEXT,
    CASE WHEN v_a.service_id IS NULL THEN 'consulta' ELSE 'servico_agendado' END,
    v_a.service_id, v_description, 1, ROUND(COALESCE(p_gross_amount, 0), 2),
    ROUND(COALESCE(p_gross_amount, 0), 2), ROUND(COALESCE(p_discount_amount, 0), 2),
    v_net, ROUND(COALESCE(p_patient_responsibility, 0), 2),
    ROUND(COALESCE(p_insurance_responsibility, 0), 2), 'previsto',
    v_a.appointment_date, jsonb_build_object('appointment_status', v_a.status), auth.uid()
  )
  ON CONFLICT (billing_account_id, source_module, source_record_id, item_type) DO UPDATE SET
    service_id = EXCLUDED.service_id,
    description = EXCLUDED.description,
    unit_price = EXCLUDED.unit_price,
    gross_amount = EXCLUDED.gross_amount,
    discount_amount = EXCLUDED.discount_amount,
    net_amount = EXCLUDED.net_amount,
    patient_amount = EXCLUDED.patient_amount,
    insurance_amount = EXCLUDED.insurance_amount,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();

  v_receivable_key := 'reception:' || v_a.id::TEXT || ':patient-receivable';
  IF COALESCE(p_patient_responsibility, 0) > 0 THEN
    INSERT INTO public.financial_transactions (
      company_id, unit_id, patient_id, billing_account_id, billing_id,
      professional_id, appointment_id, transaction_type, payer_type, amount,
      payment_method, status, due_date, idempotency_key, notes, metadata, created_by
    ) VALUES (
      v_a.company_id, v_a.unit_id, v_a.patient_id, v_account.id, v_account.id,
      v_a.professional_id, v_a.id, 'receivable', 'patient',
      ROUND(COALESCE(p_patient_responsibility, 0), 2), NULL,
      CASE WHEN v_paid >= COALESCE(p_patient_responsibility, 0) THEN 'paid'
           WHEN v_paid > 0 THEN 'partial' ELSE 'open' END,
      COALESCE(p_due_date, CASE WHEN p_collection_policy = 'accounts_receivable' THEN CURRENT_DATE + 30 ELSE CURRENT_DATE END),
      v_receivable_key, 'Responsabilidade do paciente no atendimento',
      jsonb_build_object('collection_policy', p_collection_policy), auth.uid()
    )
    ON CONFLICT (company_id, idempotency_key) DO UPDATE SET
      amount = EXCLUDED.amount,
      due_date = EXCLUDED.due_date,
      status = CASE
        WHEN public.financial_transactions.status IN ('paid','reconciled') THEN public.financial_transactions.status
        WHEN v_paid >= EXCLUDED.amount THEN 'paid'
        WHEN v_paid > 0 THEN 'partial'
        ELSE 'open'
      END,
      notes = EXCLUDED.notes,
      metadata = EXCLUDED.metadata,
      updated_at = NOW();
  ELSE
    UPDATE public.financial_transactions
       SET status = 'cancelled', updated_at = NOW()
     WHERE company_id = v_a.company_id
       AND idempotency_key = v_receivable_key
       AND transaction_type = 'receivable'
       AND status NOT IN ('paid','reconciled');
  END IF;

  UPDATE public.reception_checkins
     SET billing_account_id = v_account.id,
         payer_type = p_payer_type,
         patient_due_amount = ROUND(COALESCE(p_patient_responsibility, 0), 2),
         patient_paid_amount = v_paid,
         has_payment_pending = COALESCE(p_patient_responsibility, 0) > v_paid,
         updated_at = NOW()
   WHERE appointment_id = v_a.id;

  RETURN public.get_reception_checkout_summary(v_a.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.open_reception_cash_session_secure(
  p_opening_balance NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_session public.cash_sessions;
  v_company_id UUID;
  v_unit_id INTEGER;
BEGIN
  PERFORM public.assert_reception_financial_permission();
  v_company_id := public.active_company_id();
  v_unit_id := public.active_unit_id();
  IF v_company_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Empresa e unidade ativas são obrigatórias para abrir o caixa';
  END IF;
  IF COALESCE(p_opening_balance, 0) < 0 THEN
    RAISE EXCEPTION 'Saldo inicial não pode ser negativo';
  END IF;

  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE company_id = v_company_id
    AND unit_id = v_unit_id
    AND opened_by = auth.uid()
    AND status = 'open'
  FOR UPDATE;

  IF FOUND THEN RETURN v_session; END IF;

  INSERT INTO public.cash_sessions (
    company_id, unit_id, opened_by, opening_balance, notes
  ) VALUES (
    v_company_id, v_unit_id, auth.uid(), COALESCE(p_opening_balance, 0),
    NULLIF(trim(COALESCE(p_notes, '')), '')
  ) RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_reception_cash_session_secure(
  p_cash_session_id BIGINT,
  p_closing_balance NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_session public.cash_sessions;
BEGIN
  PERFORM public.assert_reception_financial_permission();
  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE id = p_cash_session_id
    AND company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND opened_by = auth.uid()
    AND status = 'open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caixa aberto não encontrado'; END IF;

  UPDATE public.cash_sessions
     SET status = 'closed',
         closing_balance = p_closing_balance,
         closed_at = NOW(),
         closed_by = auth.uid(),
         notes = COALESCE(NULLIF(trim(COALESCE(p_notes, '')), ''), notes)
   WHERE id = v_session.id
   RETURNING * INTO v_session;
  RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_reception_payment_secure(
  p_appointment_id BIGINT,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_idempotency_key TEXT,
  p_external_reference TEXT DEFAULT NULL,
  p_installment_count INTEGER DEFAULT 1,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_a public.appointments;
  v_account public.billing_accounts;
  v_payment public.financial_transactions;
  v_receivable public.financial_transactions;
  v_cash_session public.cash_sessions;
  v_summary JSONB;
  v_pending NUMERIC(14,2);
  v_total_paid NUMERIC(14,2);
  v_allocated NUMERIC(14,2);
  v_installments INTEGER;
  v_index INTEGER;
  v_installment_amount NUMERIC(14,2);
  v_last_amount NUMERIC(14,2);
BEGIN
  v_a := public.assert_reception_appointment_scope(p_appointment_id);
  p_payment_method := lower(trim(COALESCE(p_payment_method, '')));
  p_idempotency_key := trim(COALESCE(p_idempotency_key, ''));

  IF p_payment_method NOT IN ('dinheiro','pix','debito','credito','boleto','outro') THEN
    RAISE EXCEPTION 'Forma de pagamento inválida';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'Valor do pagamento deve ser positivo'; END IF;
  IF p_idempotency_key = '' THEN RAISE EXCEPTION 'Chave de idempotência é obrigatória'; END IF;
  IF p_payment_method <> 'dinheiro' AND NULLIF(trim(COALESCE(p_external_reference, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Comprovante, NSU ou referência externa é obrigatório para esta forma de pagamento';
  END IF;

  SELECT * INTO v_account
  FROM public.billing_accounts
  WHERE company_id = v_a.company_id
    AND appointment_id = v_a.id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prepare a cobrança antes de registrar o pagamento'; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM public.financial_transactions
  WHERE billing_account_id = v_account.id
    AND transaction_type = 'payment'
    AND payer_type = 'patient'
    AND status IN ('captured','confirmed','paid','reconciled');

  v_pending := GREATEST(v_account.patient_responsibility_amount - v_total_paid, 0);
  IF p_amount > v_pending + 0.01 THEN
    RAISE EXCEPTION 'Pagamento supera o saldo devido pelo paciente';
  END IF;

  IF p_payment_method = 'dinheiro' THEN
    SELECT * INTO v_cash_session
    FROM public.cash_sessions
    WHERE company_id = v_a.company_id
      AND unit_id = v_a.unit_id
      AND opened_by = auth.uid()
      AND status = 'open'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Abra o caixa antes de receber em dinheiro'; END IF;
  END IF;

  INSERT INTO public.financial_transactions (
    company_id, unit_id, patient_id, billing_account_id, billing_id,
    professional_id, appointment_id, transaction_type, payer_type, amount,
    payment_method, status, payment_date, external_reference,
    installment_count, idempotency_key, notes, metadata, created_by
  ) VALUES (
    v_a.company_id, v_a.unit_id, v_a.patient_id, v_account.id, v_account.id,
    v_a.professional_id, v_a.id, 'payment', 'patient', ROUND(p_amount, 2),
    p_payment_method, 'confirmed', CURRENT_DATE,
    NULLIF(trim(COALESCE(p_external_reference, '')), ''),
    GREATEST(COALESCE(p_installment_count, 1), 1), p_idempotency_key,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    jsonb_build_object('origin', 'reception', 'registered_at', NOW()), auth.uid()
  )
  ON CONFLICT (company_id, idempotency_key) DO NOTHING
  RETURNING * INTO v_payment;

  IF NOT FOUND THEN
    SELECT * INTO v_payment
    FROM public.financial_transactions
    WHERE company_id = v_a.company_id
      AND idempotency_key = p_idempotency_key;
    IF v_payment.billing_account_id IS DISTINCT FROM v_account.id
       OR v_payment.amount IS DISTINCT FROM ROUND(p_amount, 2)
       OR v_payment.payment_method IS DISTINCT FROM p_payment_method THEN
      RAISE EXCEPTION 'Chave de idempotência já utilizada com dados diferentes';
    END IF;
    RETURN public.get_reception_checkout_summary(v_a.id);
  END IF;

  SELECT * INTO v_receivable
  FROM public.financial_transactions
  WHERE billing_account_id = v_account.id
    AND transaction_type = 'receivable'
    AND payer_type = 'patient'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Título do paciente não encontrado'; END IF;

  INSERT INTO public.financial_transaction_allocations (
    company_id, payment_transaction_id, receivable_transaction_id, amount, created_by
  ) VALUES (
    v_a.company_id, v_payment.id, v_receivable.id, ROUND(p_amount, 2), auth.uid()
  ) ON CONFLICT (payment_transaction_id, receivable_transaction_id) DO NOTHING;

  IF p_payment_method = 'dinheiro' THEN
    INSERT INTO public.cash_movements (
      company_id, unit_id, cash_session_id, financial_transaction_id,
      movement_type, amount, reason, created_by
    ) VALUES (
      v_a.company_id, v_a.unit_id, v_cash_session.id, v_payment.id,
      'receipt', ROUND(p_amount, 2), 'Recebimento no check-in', auth.uid()
    );
  END IF;

  IF p_payment_method IN ('debito','credito') THEN
    v_installments := CASE WHEN p_payment_method = 'debito' THEN 1 ELSE LEAST(GREATEST(COALESCE(p_installment_count, 1), 1), 24) END;
    v_installment_amount := ROUND(p_amount / v_installments, 2);
    v_last_amount := ROUND(p_amount - (v_installment_amount * (v_installments - 1)), 2);

    FOR v_index IN 1..v_installments LOOP
      INSERT INTO public.financial_transactions (
        company_id, unit_id, patient_id, billing_account_id, billing_id,
        appointment_id, parent_transaction_id, transaction_type, payer_type,
        amount, payment_method, status, due_date, external_reference,
        installment_number, installment_count, idempotency_key, notes, metadata, created_by
      ) VALUES (
        v_a.company_id, v_a.unit_id, v_a.patient_id, v_account.id, v_account.id,
        v_a.id, v_payment.id, 'acquirer_receivable', 'acquirer',
        CASE WHEN v_index = v_installments THEN v_last_amount ELSE v_installment_amount END,
        p_payment_method, 'open',
        (CURRENT_DATE + (v_index * INTERVAL '30 days'))::DATE,
        NULLIF(trim(COALESCE(p_external_reference, '')), ''),
        v_index, v_installments, p_idempotency_key || ':acquirer:' || v_index,
        'Recebível da adquirente', jsonb_build_object('gross_payment_id', v_payment.id), auth.uid()
      ) ON CONFLICT (company_id, idempotency_key) DO NOTHING;
    END LOOP;
  END IF;

  SELECT COALESCE(SUM(allocation.amount), 0) INTO v_allocated
  FROM public.financial_transaction_allocations allocation
  WHERE allocation.receivable_transaction_id = v_receivable.id;

  UPDATE public.financial_transactions
     SET status = CASE
       WHEN v_allocated + 0.01 >= amount THEN 'paid'
       WHEN v_allocated > 0 THEN 'partial'
       ELSE 'open'
     END,
     payment_date = CASE WHEN v_allocated + 0.01 >= amount THEN CURRENT_DATE ELSE payment_date END,
     updated_at = NOW()
   WHERE id = v_receivable.id;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM public.financial_transactions
  WHERE billing_account_id = v_account.id
    AND transaction_type = 'payment'
    AND payer_type = 'patient'
    AND status IN ('captured','confirmed','paid','reconciled');

  UPDATE public.billing_accounts
     SET total_paid_amount = v_total_paid,
         total_pending_amount = GREATEST(total_net_amount - v_total_paid, 0),
         status = CASE
           WHEN billing_type IN ('particular','cortesia')
                AND v_total_paid + 0.01 >= patient_responsibility_amount
             THEN 'particular_paga'
           WHEN v_total_paid + 0.01 < patient_responsibility_amount
             THEN 'particular_pendente'
           ELSE 'aberta'
         END,
         paid_at = CASE WHEN v_total_paid + 0.01 >= patient_responsibility_amount THEN NOW() ELSE paid_at END,
         updated_by = auth.uid()
   WHERE id = v_account.id;

  UPDATE public.reception_checkins
     SET patient_paid_amount = v_total_paid,
         has_payment_pending = v_total_paid + 0.01 < v_account.patient_responsibility_amount,
         updated_at = NOW()
   WHERE appointment_id = v_a.id;

  v_summary := public.get_reception_checkout_summary(v_a.id);
  RETURN v_summary;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_reception_tiss_guide_secure(
  p_appointment_id BIGINT,
  p_guide_type TEXT DEFAULT NULL,
  p_tiss_version_id BIGINT DEFAULT NULL,
  p_manual_guide_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_a public.appointments;
  v_p public.patients;
  v_account public.billing_accounts;
  v_version public.tiss_schema_versions;
  v_guide public.reception_tiss_guides;
  v_requires_signature BOOLEAN := TRUE;
  v_rule_type TEXT;
  v_guide_type TEXT;
  v_guide_number TEXT;
BEGIN
  v_a := public.assert_reception_appointment_scope(p_appointment_id);
  SELECT * INTO v_p FROM public.patients WHERE id = v_a.patient_id;
  SELECT * INTO v_account
  FROM public.billing_accounts
  WHERE company_id = v_a.company_id AND appointment_id = v_a.id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Prepare a cobrança antes de gerar a guia'; END IF;
  IF v_a.insurance_company_id IS NULL THEN RAISE EXCEPTION 'Guia TISS exige convênio no agendamento'; END IF;

  IF p_tiss_version_id IS NOT NULL THEN
    SELECT * INTO v_version
    FROM public.tiss_schema_versions
    WHERE id = p_tiss_version_id
      AND company_id = v_a.company_id
      AND scope = 'prestador_operadora'
      AND status = 'active'
      AND effective_from <= CURRENT_DATE
      AND (effective_until IS NULL OR effective_until >= CURRENT_DATE);
  ELSE
    SELECT * INTO v_version
    FROM public.tiss_schema_versions
    WHERE company_id = v_a.company_id
      AND scope = 'prestador_operadora'
      AND status = 'active'
      AND effective_from <= CURRENT_DATE
      AND (effective_until IS NULL OR effective_until >= CURRENT_DATE)
    ORDER BY effective_from DESC, id DESC
    LIMIT 1;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nenhuma versão TISS ativa está configurada'; END IF;

  SELECT rule.requires_signature, rule.guide_type
    INTO v_requires_signature, v_rule_type
  FROM public.insurance_tiss_guide_rules rule
  WHERE rule.company_id = v_a.company_id
    AND rule.insurance_company_id = v_a.insurance_company_id
    AND (rule.insurance_plan_id IS NULL OR rule.insurance_plan_id = v_p.insurance_plan_id)
    AND rule.active = TRUE
    AND rule.valid_from <= CURRENT_DATE
    AND (rule.valid_until IS NULL OR rule.valid_until >= CURRENT_DATE)
  ORDER BY (rule.insurance_plan_id IS NOT NULL)::INTEGER DESC, rule.valid_from DESC
  LIMIT 1;

  v_requires_signature := COALESCE(v_requires_signature, TRUE);
  v_guide_type := lower(trim(COALESCE(NULLIF(p_guide_type, ''), NULLIF(v_rule_type, ''), 'consulta')));
  IF v_guide_type NOT IN ('consulta','sp_sadt','internacao','honorario','outras_despesas') THEN
    RAISE EXCEPTION 'Tipo de guia inválido';
  END IF;

  SELECT * INTO v_guide
  FROM public.reception_tiss_guides
  WHERE company_id = v_a.company_id
    AND appointment_id = v_a.id
    AND guide_type = v_guide_type
    AND status NOT IN ('cancelled','replaced')
  FOR UPDATE;

  IF FOUND THEN
    RETURN public.get_reception_checkout_summary(v_a.id);
  END IF;

  INSERT INTO public.reception_tiss_guides (
    company_id, unit_id, patient_id, appointment_id, billing_account_id,
    insurance_id, insurance_plan_id, tiss_version_id, tiss_version,
    guide_type, guide_number, status, requires_signature,
    authorization_number, payload_snapshot, created_by, updated_by
  ) VALUES (
    v_a.company_id, v_a.unit_id, v_a.patient_id, v_a.id, v_account.id,
    v_a.insurance_company_id, v_p.insurance_plan_id, v_version.id, v_version.version,
    v_guide_type, NULLIF(trim(COALESCE(p_manual_guide_number, '')), ''),
    'generated', v_requires_signature, v_account.authorization_number,
    jsonb_build_object(
      'patient_id', v_a.patient_id,
      'patient_name', v_p.full_name,
      'card_number', COALESCE(v_p.insurance_card_number, to_jsonb(v_p)->>'ds_matricula', to_jsonb(v_p)->>'insurance_number'),
      'appointment_id', v_a.id,
      'appointment_date', v_a.appointment_date,
      'professional_id', v_a.professional_id,
      'service_id', v_a.service_id,
      'service_name', (SELECT name FROM public.services_catalog WHERE id = v_a.service_id),
      'insurance_id', v_a.insurance_company_id,
      'insurance_plan_id', v_p.insurance_plan_id,
      'authorization_number', v_account.authorization_number,
      'gross_amount', v_account.total_gross_amount,
      'patient_amount', v_account.patient_responsibility_amount,
      'insurance_amount', v_account.insurance_responsibility_amount,
      'tiss_version', v_version.version,
      'generated_at', NOW()
    ), auth.uid(), auth.uid()
  ) RETURNING * INTO v_guide;

  v_guide_number := COALESCE(
    v_guide.guide_number,
    'PM-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || lpad(v_guide.id::TEXT, 10, '0')
  );

  UPDATE public.reception_tiss_guides
     SET guide_number = v_guide_number, updated_by = auth.uid()
   WHERE id = v_guide.id;

  UPDATE public.billing_accounts
     SET guide_number = v_guide_number, updated_by = auth.uid()
   WHERE id = v_account.id;

  UPDATE public.reception_checkins
     SET tiss_guide_id = v_guide.id,
         has_tiss_guide = TRUE,
         updated_at = NOW()
   WHERE appointment_id = v_a.id;

  RETURN public.get_reception_checkout_summary(v_a.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_reception_tiss_guide_secure(p_guide_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_guide public.reception_tiss_guides;
  v_errors JSONB := '[]'::jsonb;
BEGIN
  PERFORM public.assert_reception_financial_permission();
  SELECT * INTO v_guide
  FROM public.reception_tiss_guides
  WHERE id = p_guide_id
    AND company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Guia não encontrada no contexto ativo'; END IF;

  IF NULLIF(v_guide.guide_number, '') IS NULL THEN
    v_errors := v_errors || jsonb_build_array('Número da guia não informado');
  END IF;
  IF NULLIF(v_guide.tiss_version, '') IS NULL THEN
    v_errors := v_errors || jsonb_build_array('Versão TISS não informada');
  END IF;
  IF v_guide.patient_id IS NULL THEN
    v_errors := v_errors || jsonb_build_array('Paciente não vinculado');
  END IF;
  IF v_guide.insurance_id IS NULL THEN
    v_errors := v_errors || jsonb_build_array('Convênio não vinculado');
  END IF;
  IF v_guide.billing_account_id IS NULL THEN
    v_errors := v_errors || jsonb_build_array('Conta não vinculada');
  END IF;

  UPDATE public.reception_tiss_guides
     SET validation_errors = v_errors,
         status = CASE WHEN jsonb_array_length(v_errors) = 0 THEN 'validated' ELSE 'generated' END,
         updated_by = auth.uid()
   WHERE id = v_guide.id;

  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'Guia possui pendências: %', v_errors::TEXT;
  END IF;

  RETURN public.get_reception_checkout_summary(v_guide.appointment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.sign_reception_tiss_guide_secure(
  p_guide_id BIGINT,
  p_signature_method TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_guide public.reception_tiss_guides;
BEGIN
  PERFORM public.assert_reception_financial_permission();
  p_signature_method := lower(trim(COALESCE(p_signature_method, '')));
  IF p_signature_method NOT IN ('tablet','digital','physical','biometric') THEN
    RAISE EXCEPTION 'Método de assinatura inválido';
  END IF;

  SELECT * INTO v_guide
  FROM public.reception_tiss_guides
  WHERE id = p_guide_id
    AND company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Guia não encontrada no contexto ativo'; END IF;
  IF v_guide.status <> 'validated' OR jsonb_array_length(v_guide.validation_errors) > 0 THEN
    RAISE EXCEPTION 'Valide a guia antes de coletar a assinatura';
  END IF;

  UPDATE public.reception_tiss_guides
     SET status = 'signed',
         signature_method = p_signature_method,
         patient_signed_at = NOW(),
         signed_by = auth.uid(),
         updated_by = auth.uid()
   WHERE id = v_guide.id;

  RETURN public.get_reception_checkout_summary(v_guide.appointment_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- Readiness completo: cadastro + convênio + checkout + TISS + pagamento.
-- Warnings não bloqueiam; somente severity=blocking altera ready.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reception_checkin_readiness(p_appointment_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_a public.appointments;
  v_p public.patients;
  v_summary JSONB;
  v_issues JSONB := '[]'::jsonb;
  v_auth BOOLEAN := FALSE;
  v_doc BOOLEAN := FALSE;
  v_payment BOOLEAN := FALSE;
  v_tiss BOOLEAN := FALSE;
  v_blocking_count INTEGER := 0;
  v_guide_status TEXT;
BEGIN
  v_a := public.assert_reception_appointment_scope(p_appointment_id);
  SELECT * INTO v_p FROM public.patients WHERE id = v_a.patient_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;

  IF NULLIF(trim(COALESCE(v_p.full_name, '')), '') IS NULL OR v_p.birth_date IS NULL THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'type','registration','severity','blocking','description','Cadastro mínimo incompleto'
    ));
    v_doc := TRUE;
  END IF;

  IF v_a.insurance_company_id IS NOT NULL
     AND NULLIF(trim(COALESCE(v_p.insurance_card_number, to_jsonb(v_p)->>'ds_matricula', to_jsonb(v_p)->>'insurance_number', '')), '') IS NULL THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'type','insurance_card','severity','blocking','description','Carteirinha ou matrícula ausente'
    ));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reception_eligibility_checks eligibility
    WHERE eligibility.appointment_id = v_a.id
      AND eligibility.status IN ('pendente','em_analise','nao_elegivel','portal_indisponivel')
  ) THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'type','eligibility','severity','blocking','description','Elegibilidade pendente ou inválida'
    ));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reception_authorizations authorization_row
    WHERE authorization_row.appointment_id = v_a.id
      AND authorization_row.status NOT IN ('nao_necessaria','autorizada','parcialmente_autorizada','liberada_excecao')
  ) THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'type','authorization','severity','blocking','description','Autorização pendente ou inválida'
    ));
    v_auth := TRUE;
  END IF;

  v_summary := public.get_reception_checkout_summary(v_a.id);
  IF NOT COALESCE((v_summary->>'prepared')::BOOLEAN, FALSE) THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'type','billing','severity','blocking',
      'description','Defina o pagador e prepare a cobrança antes do check-in'
    ));
  ELSE
    IF COALESCE((v_summary->>'requires_tiss_guide')::BOOLEAN, FALSE) THEN
      v_guide_status := v_summary->'guide'->>'status';
      IF v_summary->'guide' IS NULL
         OR (COALESCE((v_summary->>'requires_tiss_signature')::BOOLEAN, TRUE) AND v_guide_status <> 'signed')
         OR (NOT COALESCE((v_summary->>'requires_tiss_signature')::BOOLEAN, TRUE) AND v_guide_status NOT IN ('validated','signed')) THEN
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'type','tiss_guide','severity','blocking',
          'description', CASE
            WHEN v_summary->'guide' IS NULL THEN 'Guia TISS ainda não foi gerada'
            WHEN COALESCE((v_summary->>'requires_tiss_signature')::BOOLEAN, TRUE) THEN 'Guia TISS ainda não foi validada e assinada'
            ELSE 'Guia TISS ainda não foi validada'
          END
        ));
        v_tiss := TRUE;
      END IF;
    END IF;

    IF COALESCE((v_summary->>'patient_pending_amount')::NUMERIC, 0) > 0 THEN
      v_payment := TRUE;
      IF v_summary->>'collection_policy' = 'before_checkin' THEN
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'type','payment','severity','blocking',
          'description','Pagamento do paciente pendente para concluir o check-in'
        ));
      ELSIF v_summary->>'collection_policy' = 'accounts_receivable' THEN
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'type','payment','severity','warning',
          'description','Saldo enviado ao Contas a Receber conforme a política selecionada'
        ));
      END IF;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_blocking_count
  FROM jsonb_array_elements(v_issues) issue
  WHERE issue->>'severity' = 'blocking';

  RETURN jsonb_build_object(
    'appointment_id', v_a.id,
    'patient_id', v_a.patient_id,
    'ready', v_blocking_count = 0,
    'issues', v_issues,
    'has_authorization_pending', v_auth,
    'has_document_pending', v_doc,
    'has_payment_pending', v_payment,
    'has_tiss_pending', v_tiss,
    'checkout', v_summary
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.perform_reception_checkin_secure(
  p_appointment_id BIGINT,
  p_priority TEXT DEFAULT 'normal',
  p_exception_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_actor RECORD;
  v_a public.appointments;
  v_ready JSONB;
  v_checkout JSONB;
  v_checkin public.reception_checkins;
  v_ticket public.reception_queue_tickets;
  v_number INTEGER;
  v_issue JSONB;
  v_exception BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_reception_financial_permission();
  v_a := public.assert_reception_appointment_scope(p_appointment_id);

  SELECT * INTO v_a FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF v_a.status NOT IN ('scheduled','confirmed') THEN
    RAISE EXCEPTION 'Check-in indisponível no status %', v_a.status;
  END IF;
  IF p_priority NOT IN ('normal','legal','urgent') THEN
    RAISE EXCEPTION 'Prioridade inválida';
  END IF;

  v_ready := public.get_reception_checkin_readiness(v_a.id);
  v_checkout := v_ready->'checkout';
  IF NOT (v_ready->>'ready')::BOOLEAN THEN
    IF NULLIF(trim(COALESCE(p_exception_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Check-in bloqueado por pendências: %', v_ready->'issues';
    END IF;
    IF COALESCE(v_actor.role_name, '') NOT IN (
      'admin','administrador','gestor','supervisor','supervisor_recepcao','diretoria'
    ) THEN
      RAISE EXCEPTION 'Perfil sem permissão para liberar exceção' USING ERRCODE = '42501';
    END IF;
    v_exception := TRUE;
  END IF;

  INSERT INTO public.reception_checkins (
    company_id, patient_id, appointment_id, unit_id, professional_id,
    status, checked_in_at, has_pending_issues, has_authorization_pending,
    has_document_pending, has_payment_pending, released_by_exception,
    created_by, billing_account_id, tiss_guide_id, payer_type,
    patient_due_amount, patient_paid_amount, has_tiss_guide
  ) VALUES (
    v_a.company_id, v_a.patient_id, v_a.id, v_a.unit_id, v_a.professional_id,
    'checked_in', NOW(), jsonb_array_length(v_ready->'issues') > 0,
    (v_ready->>'has_authorization_pending')::BOOLEAN,
    (v_ready->>'has_document_pending')::BOOLEAN,
    COALESCE((v_ready->>'has_payment_pending')::BOOLEAN, FALSE),
    v_exception, v_actor.user_id,
    NULLIF(v_checkout->>'account_id', '')::BIGINT,
    NULLIF(v_checkout->'guide'->>'id', '')::BIGINT,
    v_checkout->>'payer_type',
    COALESCE((v_checkout->>'patient_responsibility_amount')::NUMERIC, 0),
    COALESCE((v_checkout->>'patient_paid_amount')::NUMERIC, 0),
    v_checkout->'guide' IS NOT NULL
  )
  ON CONFLICT (appointment_id) DO UPDATE SET
    status = 'checked_in',
    checked_in_at = NOW(),
    has_pending_issues = EXCLUDED.has_pending_issues,
    has_authorization_pending = EXCLUDED.has_authorization_pending,
    has_document_pending = EXCLUDED.has_document_pending,
    has_payment_pending = EXCLUDED.has_payment_pending,
    released_by_exception = EXCLUDED.released_by_exception,
    billing_account_id = EXCLUDED.billing_account_id,
    tiss_guide_id = EXCLUDED.tiss_guide_id,
    payer_type = EXCLUDED.payer_type,
    patient_due_amount = EXCLUDED.patient_due_amount,
    patient_paid_amount = EXCLUDED.patient_paid_amount,
    has_tiss_guide = EXCLUDED.has_tiss_guide,
    updated_at = NOW()
  RETURNING * INTO v_checkin;

  FOR v_issue IN SELECT * FROM jsonb_array_elements(v_ready->'issues') LOOP
    INSERT INTO public.reception_patient_pending_issues (
      company_id, checkin_id, appointment_id, patient_id,
      issue_type, description, severity, status
    ) VALUES (
      v_a.company_id, v_checkin.id, v_a.id, v_a.patient_id,
      v_issue->>'type', v_issue->>'description', v_issue->>'severity',
      CASE WHEN v_exception AND v_issue->>'severity' = 'blocking' THEN 'waived' ELSE 'open' END
    );
  END LOOP;

  IF v_exception THEN
    INSERT INTO public.reception_exception_releases (
      company_id, checkin_id, appointment_id, reason, risk_description, released_by
    ) VALUES (
      v_a.company_id, v_checkin.id, v_a.id, trim(p_exception_reason),
      (v_ready->'issues')::TEXT, v_actor.user_id
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(CURRENT_DATE::TEXT), hashtext('reception-C'));
  SELECT COALESCE(MAX(number), 0) + 1 INTO v_number
  FROM public.reception_queue_tickets
  WHERE ticket_date = CURRENT_DATE AND prefix = 'C';

  INSERT INTO public.reception_queue_tickets (
    company_id, checkin_id, patient_id, appointment_id,
    prefix, number, priority, sector
  ) VALUES (
    v_a.company_id, v_checkin.id, v_a.patient_id, v_a.id,
    'C', v_number, p_priority,
    CASE WHEN v_a.service_id IS NOT NULL THEN 'procedimento' ELSE 'consulta' END
  )
  ON CONFLICT (checkin_id) DO UPDATE SET
    priority = EXCLUDED.priority,
    status = 'waiting'
  RETURNING * INTO v_ticket;

  PERFORM public.update_appointment_status_secure(
    v_a.id, 'waiting', 'Check-in realizado - senha C' || lpad(v_number::TEXT, 3, '0')
  );

  INSERT INTO public.reception_checkin_status_history (
    checkin_id, from_status, to_status, reason, actor_user_id
  ) VALUES (
    v_checkin.id, NULL, 'checked_in', 'Check-in presencial', v_actor.user_id
  );

  RETURN jsonb_build_object(
    'checkin_id', v_checkin.id,
    'ticket_id', v_ticket.id,
    'ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
    'billing_account_id', v_checkin.billing_account_id,
    'tiss_guide_id', v_checkin.tiss_guide_id,
    'released_by_exception', v_exception,
    'issues', v_ready->'issues'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.assert_reception_financial_permission() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_reception_appointment_scope(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_reception_checkout_summary(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_reception_checkout_secure(BIGINT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,DATE,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_reception_cash_session_secure(NUMERIC,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_reception_cash_session_secure(BIGINT,NUMERIC,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_reception_payment_secure(BIGINT,NUMERIC,TEXT,TEXT,TEXT,INTEGER,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_reception_tiss_guide_secure(BIGINT,TEXT,BIGINT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_reception_tiss_guide_secure(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sign_reception_tiss_guide_secure(BIGINT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_reception_checkin_readiness(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.perform_reception_checkin_secure(BIGINT,TEXT,TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.assert_reception_financial_permission() TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_reception_appointment_scope(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reception_checkout_summary(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_reception_checkout_secure(BIGINT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,DATE,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_reception_cash_session_secure(NUMERIC,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_reception_cash_session_secure(BIGINT,NUMERIC,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_reception_payment_secure(BIGINT,NUMERIC,TEXT,TEXT,TEXT,INTEGER,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_reception_tiss_guide_secure(BIGINT,TEXT,BIGINT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_reception_tiss_guide_secure(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sign_reception_tiss_guide_secure(BIGINT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reception_checkin_readiness(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perform_reception_checkin_secure(BIGINT,TEXT,TEXT) TO authenticated;

COMMENT ON FUNCTION public.prepare_reception_checkout_secure(BIGINT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,DATE,TEXT) IS
  'Abre ou atualiza idempotentemente a pré-conta e o título do paciente no check-in.';
COMMENT ON FUNCTION public.register_reception_payment_secure(BIGINT,NUMERIC,TEXT,TEXT,TEXT,INTEGER,TEXT) IS
  'Registra pagamento idempotente, aloca ao título, movimenta caixa ou cria recebível da adquirente.';
COMMENT ON FUNCTION public.generate_reception_tiss_guide_secure(BIGINT,TEXT,BIGINT,TEXT) IS
  'Gera a guia individual versionada; não gera lote/XML de intercâmbio.';

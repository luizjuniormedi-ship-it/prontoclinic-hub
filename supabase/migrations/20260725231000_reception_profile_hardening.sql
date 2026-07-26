-- Harden the reception lifecycle and add the missing operational profiles.
-- Incremental and tenant-aware: no legacy/DataSIGH source is accessed.

INSERT INTO public.roles (name, description, lg_ativo)
VALUES
  ('faturamento', 'Equipe de faturamento e intercâmbio TISS', TRUE),
  ('call_center', 'Equipe de atendimento e agendamento remoto', TRUE)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  lg_ativo = TRUE,
  updated_at = NOW();

WITH desired(role_name, module, can_view, can_create, can_edit, can_delete, can_export) AS (
  VALUES
    ('faturamento', 'faturamento', TRUE, TRUE, TRUE, FALSE, TRUE),
    ('call_center', 'agenda', TRUE, TRUE, FALSE, FALSE, FALSE),
    ('call_center', 'recepcao', TRUE, TRUE, TRUE, FALSE, FALSE),
    ('call_center', 'pacientes', TRUE, TRUE, FALSE, FALSE, FALSE)
)
INSERT INTO public.role_permissions (
  company_id, role_id, module,
  can_view, can_create, can_edit, can_delete, can_export
)
SELECT
  company.id, role_row.id, desired.module,
  desired.can_view, desired.can_create, desired.can_edit,
  desired.can_delete, desired.can_export
FROM public.companies company
JOIN desired ON TRUE
JOIN public.roles role_row ON role_row.name = desired.role_name
WHERE company.lg_ativo IS TRUE
ON CONFLICT (company_id, role_id, module) DO UPDATE SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete,
  can_export = EXCLUDED.can_export,
  updated_at = NOW();

ALTER TABLE public.reception_queue_tickets
  ADD COLUMN IF NOT EXISTS unit_id INTEGER;

UPDATE public.reception_queue_tickets ticket
SET unit_id = appointment.unit_id
FROM public.appointments appointment
WHERE ticket.appointment_id = appointment.id
  AND ticket.unit_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.reception_queue_tickets
    WHERE unit_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'RECEPTION_QUEUE_PREFLIGHT: tickets sem unidade; reconciliação manual obrigatória';
  END IF;
END;
$$;

ALTER TABLE public.reception_queue_tickets
  ALTER COLUMN unit_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.reception_queue_tickets'::regclass
      AND conname = 'reception_queue_tickets_unit_id_fkey'
  ) THEN
    ALTER TABLE public.reception_queue_tickets
      ADD CONSTRAINT reception_queue_tickets_unit_id_fkey
      FOREIGN KEY (unit_id) REFERENCES public.units(id);
  END IF;
END;
$$;

ALTER TABLE public.reception_queue_tickets
  DROP CONSTRAINT IF EXISTS reception_queue_tickets_ticket_date_prefix_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS reception_queue_company_unit_ticket_unique_idx
  ON public.reception_queue_tickets (
    company_id, unit_id, ticket_date, prefix, number
  );

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
    RAISE EXCEPTION 'Usuário autenticado é obrigatório para operar o checkout da recepção'
      USING ERRCODE = '42501';
  END IF;

  v_role := public.active_role_name();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Contexto AAL2 ativo é obrigatório' USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN (
    'admin','administrador','gestor','recepcao','recepção',
    'supervisor','supervisor_recepcao','financeiro','faturamento'
  ) THEN
    RAISE EXCEPTION 'Perfil sem permissão para operar o checkout da recepção'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_clinical_unit_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $reception_guard$
DECLARE
  v_module TEXT := TG_TABLE_NAME;
  v_alt_module TEXT := CASE TG_TABLE_NAME
    WHEN 'patients' THEN 'pacientes'
    WHEN 'appointments' THEN 'agenda'
    WHEN 'medical_records' THEN 'prontuario'
  END;
  v_action TEXT := CASE TG_OP
    WHEN 'INSERT' THEN 'create'
    WHEN 'UPDATE' THEN 'edit'
  END;
  v_reception_checkin_transition BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    NEW.company_id := COALESCE(NEW.company_id, public.active_company_id());
    NEW.unit_id := COALESCE(NEW.unit_id, public.active_unit_id());
  END IF;

  IF NEW.company_id IS NULL OR NEW.unit_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.units unit_row
    WHERE unit_row.id = NEW.unit_id
      AND unit_row.company_id = NEW.company_id
      AND unit_row.lg_ativo IS TRUE
  ) THEN
    RAISE EXCEPTION 'Empresa e unidade clínica devem ser válidas e consistentes'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'appointments' AND TG_OP = 'UPDATE' THEN
    v_reception_checkin_transition :=
      NEW.company_id = public.active_company_id()
      AND NEW.unit_id = public.active_unit_id()
      AND COALESCE(public.can_access('recepcao', 'create'), FALSE)
      AND to_jsonb(OLD)->>'status' IN ('scheduled', 'confirmed')
      AND to_jsonb(NEW)->>'status' = 'waiting'
      AND COALESCE(to_jsonb(NEW)->>'notes', '') ~ '^Check-in realizado - senha C[0-9]+$'
      AND (to_jsonb(NEW)->>'updated_at')::TIMESTAMPTZ = NOW()
      AND EXISTS (
        SELECT 1
        FROM public.reception_checkins checkin
        JOIN public.reception_queue_tickets ticket
          ON ticket.checkin_id = checkin.id
        WHERE checkin.appointment_id = OLD.id
          AND checkin.company_id = OLD.company_id
          AND ticket.appointment_id = OLD.id
          AND ticket.unit_id = OLD.unit_id
          AND checkin.status = 'checked_in'
          AND ticket.status = 'waiting'
      )
      AND (
        to_jsonb(NEW) - ARRAY['status', 'notes', 'updated_at']::TEXT[]
        = to_jsonb(OLD) - ARRAY['status', 'notes', 'updated_at']::TEXT[]
      );
  END IF;

  IF auth.uid() IS NOT NULL AND (
    NEW.company_id IS DISTINCT FROM public.active_company_id()
    OR NEW.unit_id IS DISTINCT FROM public.active_unit_id()
    OR NOT (
      public.can_access(v_module, v_action)
      OR public.can_access(v_alt_module, v_action)
      OR v_reception_checkin_transition
    )
  ) THEN
    RAISE EXCEPTION 'Escrita clínica fora do contexto ativo ou sem permissão'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$reception_guard$;

CREATE OR REPLACE FUNCTION public.update_appointment_status_secure(
  p_appointment_id BIGINT,
  p_new_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_old public.appointments%ROWTYPE;
  v_row public.appointments%ROWTYPE;
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_reception_transition BOOLEAN := FALSE;
BEGIN
  IF v_company_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION
      'Contexto AAL2, sessão ou unidade inválidos'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_old
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company_id
    AND appointment.unit_id = v_unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Agendamento não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  v_reception_transition :=
    COALESCE(public.can_access('recepcao', 'create'), FALSE)
    AND v_old.status IN ('scheduled', 'confirmed')
    AND p_new_status = 'waiting'
    AND COALESCE(v_reason, '') ~ '^Check-in realizado - senha C[0-9]+$'
    AND EXISTS (
      SELECT 1
      FROM public.reception_checkins checkin
      JOIN public.reception_queue_tickets ticket
        ON ticket.checkin_id = checkin.id
      WHERE checkin.appointment_id = v_old.id
        AND checkin.company_id = v_old.company_id
        AND ticket.appointment_id = v_old.id
        AND ticket.unit_id = v_old.unit_id
        AND checkin.status = 'checked_in'
        AND ticket.status = 'waiting'
    );

  IF NOT COALESCE(public.can_access('agenda', 'edit'), FALSE)
     AND NOT v_reception_transition THEN
    RAISE EXCEPTION
      'Contexto AAL2, sessão, unidade ou permissão de agenda inválidos'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_transition_appointment_status(v_old.status, p_new_status) THEN
    RAISE EXCEPTION 'Transição inválida: % para %', v_old.status, p_new_status;
  END IF;

  IF p_new_status IN ('cancelled', 'no_show') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Motivo é obrigatório para cancelar ou registrar falta';
  END IF;

  UPDATE public.appointments appointment
  SET status = p_new_status,
      notes = COALESCE(v_reason, appointment.notes),
      updated_at = NOW()
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company_id
    AND appointment.unit_id = v_unit_id
  RETURNING * INTO v_row;

  INSERT INTO public.scheduling_status_history (
    company_id, appointment_id, from_status, to_status, reason, actor_user_id
  ) VALUES (
    v_company_id, v_row.id, v_old.status, v_row.status, v_reason, auth.uid()
  );

  IF p_new_status = 'cancelled' THEN
    INSERT INTO public.scheduling_cancellations (
      company_id, appointment_id, reason, cancelled_by
    ) VALUES (
      v_company_id, v_row.id, v_reason, auth.uid()
    );
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.build_reception_readiness_issue(
  p_type TEXT,
  p_severity TEXT,
  p_description TEXT,
  p_step TEXT,
  p_resolution_action TEXT,
  p_owner TEXT
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'type', p_type,
    'severity', p_severity,
    'description', p_description,
    'step', p_step,
    'blocking', p_severity = 'blocking',
    'resolution_action', p_resolution_action,
    'owner', p_owner,
    'impact', CASE
      WHEN p_severity = 'blocking' THEN 'checkin_blocked'
      ELSE 'operational_warning'
    END
  );
$$;

CREATE OR REPLACE FUNCTION public.get_reception_checkin_readiness(
  p_appointment_id BIGINT
)
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
  v_tiss_issue_type TEXT;
BEGIN
  v_a := public.assert_reception_appointment_scope(p_appointment_id);
  SELECT * INTO v_p FROM public.patients WHERE id = v_a.patient_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;

  IF NULLIF(trim(COALESCE(v_p.full_name, '')), '') IS NULL
     OR v_p.birth_date IS NULL THEN
    v_issues := v_issues || jsonb_build_array(
      public.build_reception_readiness_issue(
        'registration_incomplete', 'blocking', 'Cadastro mínimo incompleto',
        'registration', 'update_registration', 'reception'
      )
    );
    v_doc := TRUE;
  END IF;

  IF v_a.insurance_company_id IS NOT NULL
     AND NULLIF(trim(COALESCE(
       v_p.insurance_card_number,
       to_jsonb(v_p)->>'ds_matricula',
       to_jsonb(v_p)->>'insurance_number',
       ''
     )), '') IS NULL THEN
    v_issues := v_issues || jsonb_build_array(
      public.build_reception_readiness_issue(
        'insurance_card_missing', 'blocking', 'Carteirinha ou matrícula ausente',
        'registration', 'update_insurance_card', 'reception'
      )
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reception_eligibility_checks eligibility
    WHERE eligibility.appointment_id = v_a.id
      AND eligibility.status IN (
        'pendente','em_analise','nao_elegivel','portal_indisponivel'
      )
  ) THEN
    v_issues := v_issues || jsonb_build_array(
      public.build_reception_readiness_issue(
        'eligibility_invalid', 'blocking', 'Elegibilidade pendente ou inválida',
        'eligibility', 'resolve_eligibility', 'reception'
      )
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reception_authorizations authorization_row
    WHERE authorization_row.appointment_id = v_a.id
      AND authorization_row.status NOT IN (
        'nao_necessaria','autorizada','parcialmente_autorizada','liberada_excecao'
      )
  ) THEN
    v_issues := v_issues || jsonb_build_array(
      public.build_reception_readiness_issue(
        'authorization_invalid', 'blocking', 'Autorização pendente ou inválida',
        'authorization', 'resolve_authorization', 'reception'
      )
    );
    v_auth := TRUE;
  END IF;

  v_summary := public.get_reception_checkout_summary(v_a.id);
  IF NOT COALESCE((v_summary->>'prepared')::BOOLEAN, FALSE) THEN
    v_issues := v_issues || jsonb_build_array(
      public.build_reception_readiness_issue(
        'billing_not_prepared', 'blocking',
        'Defina o pagador e prepare a cobrança antes do check-in',
        'billing', 'prepare_checkout', 'reception'
      )
    );
  ELSE
    IF COALESCE((v_summary->>'requires_tiss_guide')::BOOLEAN, FALSE) THEN
      v_guide_status := v_summary->'guide'->>'status';
      IF NULLIF(v_summary->'guide'->>'id', '') IS NULL
         OR (
           COALESCE((v_summary->>'requires_tiss_signature')::BOOLEAN, TRUE)
           AND v_guide_status <> 'signed'
         )
         OR (
           NOT COALESCE((v_summary->>'requires_tiss_signature')::BOOLEAN, TRUE)
           AND v_guide_status NOT IN ('validated','signed')
         ) THEN
        v_tiss_issue_type := CASE
          WHEN NULLIF(v_summary->'guide'->>'id', '') IS NULL
            THEN 'tiss_guide_missing'
          WHEN jsonb_array_length(COALESCE(
            v_summary->'guide'->'validation_errors', '[]'::jsonb
          )) > 0 THEN 'tiss_guide_invalid'
          WHEN COALESCE(
            (v_summary->>'requires_tiss_signature')::BOOLEAN, TRUE
          ) THEN 'tiss_signature_missing'
          ELSE 'tiss_guide_invalid'
        END;
        v_issues := v_issues || jsonb_build_array(
          public.build_reception_readiness_issue(
            v_tiss_issue_type, 'blocking',
            CASE
              WHEN NULLIF(v_summary->'guide'->>'id', '') IS NULL
                THEN 'Guia TISS ainda não foi gerada'
              WHEN COALESCE(
                (v_summary->>'requires_tiss_signature')::BOOLEAN, TRUE
              ) THEN 'Guia TISS ainda não foi validada e assinada'
              ELSE 'Guia TISS ainda não foi validada'
            END,
            'tiss', CASE
              WHEN NULLIF(v_summary->'guide'->>'id', '') IS NULL
                THEN 'generate_tiss_guide'
              WHEN v_tiss_issue_type = 'tiss_signature_missing'
                THEN 'sign_tiss_guide'
              ELSE 'validate_tiss_guide'
            END,
            'reception'
          )
        );
        v_tiss := TRUE;
      END IF;
    END IF;

    IF COALESCE((v_summary->>'patient_pending_amount')::NUMERIC, 0) > 0 THEN
      v_payment := TRUE;
      IF v_summary->>'collection_policy' = 'before_checkin' THEN
        v_issues := v_issues || jsonb_build_array(
          public.build_reception_readiness_issue(
            'payment_pending', 'blocking',
            'Pagamento do paciente pendente para concluir o check-in',
            'payment', 'register_payment', 'reception'
          )
        );
      ELSIF v_summary->>'collection_policy' = 'accounts_receivable' THEN
        v_issues := v_issues || jsonb_build_array(
          public.build_reception_readiness_issue(
            'payment_pending', 'warning',
            'Saldo enviado ao Contas a Receber conforme a política selecionada',
            'payment', 'review_receivable', 'billing'
          )
        );
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
  v_reason TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_reception_financial_permission();
  v_a := public.assert_reception_appointment_scope(p_appointment_id);

  SELECT *
  INTO v_a
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
  FOR UPDATE;

  IF v_a.status = 'waiting' THEN
    SELECT *
    INTO v_checkin
    FROM public.reception_checkins checkin
    WHERE checkin.appointment_id = v_a.id
      AND checkin.company_id = v_a.company_id
      AND checkin.status = 'checked_in';

    SELECT *
    INTO v_ticket
    FROM public.reception_queue_tickets ticket
    WHERE ticket.appointment_id = v_a.id
      AND ticket.company_id = v_a.company_id
      AND ticket.unit_id = v_a.unit_id
      AND ticket.checkin_id = v_checkin.id;

    IF v_checkin.id IS NULL OR v_ticket.id IS NULL THEN
      RAISE EXCEPTION 'Agendamento em espera sem check-in íntegro';
    END IF;

    RETURN jsonb_build_object(
      'checkin_id', v_checkin.id,
      'ticket_id', v_ticket.id,
      'ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
      'billing_account_id', v_checkin.billing_account_id,
      'tiss_guide_id', v_checkin.tiss_guide_id,
      'released_by_exception', v_checkin.released_by_exception,
      'issues', '[]'::jsonb,
      'idempotent_replay', TRUE
    );
  END IF;

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
      'admin','administrador','gestor','supervisor',
      'supervisor_recepcao','diretoria'
    ) THEN
      RAISE EXCEPTION 'Perfil sem permissão para liberar exceção'
        USING ERRCODE = '42501';
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
    NULLIF(v_checkout->'guide'->>'id', '') IS NOT NULL
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
      CASE
        WHEN v_exception AND v_issue->>'severity' = 'blocking' THEN 'waived'
        ELSE 'open'
      END
    );
  END LOOP;

  IF v_exception THEN
    INSERT INTO public.reception_exception_releases (
      company_id, checkin_id, appointment_id,
      reason, risk_description, released_by
    ) VALUES (
      v_a.company_id, v_checkin.id, v_a.id, trim(p_exception_reason),
      (v_ready->'issues')::TEXT, v_actor.user_id
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(v_a.company_id::TEXT || ':' || v_a.unit_id::TEXT),
    hashtext(CURRENT_DATE::TEXT || ':reception-C')
  );

  SELECT COALESCE(MAX(ticket.number), 0) + 1
  INTO v_number
  FROM public.reception_queue_tickets ticket
  WHERE ticket.company_id = v_a.company_id
    AND ticket.unit_id = v_a.unit_id
    AND ticket.ticket_date = CURRENT_DATE
    AND ticket.prefix = 'C';

  INSERT INTO public.reception_queue_tickets (
    company_id, unit_id, checkin_id, patient_id, appointment_id,
    prefix, number, priority, sector
  ) VALUES (
    v_a.company_id, v_a.unit_id, v_checkin.id, v_a.patient_id, v_a.id,
    'C', v_number, p_priority,
    CASE WHEN v_a.service_id IS NOT NULL THEN 'procedimento' ELSE 'consulta' END
  )
  ON CONFLICT (checkin_id) DO UPDATE SET
    priority = EXCLUDED.priority,
    status = 'waiting'
  RETURNING * INTO v_ticket;

  v_reason := 'Check-in realizado - senha C' || lpad(v_number::TEXT, 3, '0');
  PERFORM public.update_appointment_status_secure(v_a.id, 'waiting', v_reason);

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
    'issues', v_ready->'issues',
    'idempotent_replay', FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.build_reception_readiness_issue(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_appointment_status_secure(
  BIGINT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_reception_checkin_readiness(BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.perform_reception_checkin_secure(
  BIGINT, TEXT, TEXT
) FROM PUBLIC, anon;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    REVOKE ALL ON FUNCTION public.build_reception_readiness_issue(
      TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
    ) FROM app_prontomedic;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_appointment_status_secure(
  BIGINT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reception_checkin_readiness(BIGINT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.perform_reception_checkin_secure(
  BIGINT, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.perform_reception_checkin_secure(
  BIGINT, TEXT, TEXT
) IS
  'Check-in idempotente e transacional; usa o ciclo oficial de status da agenda.';

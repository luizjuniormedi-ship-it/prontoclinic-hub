-- Module 11: close the reception workflow owner/RLS boundary at runtime.
-- Additive hardening only. DataSIGH is not involved.

BEGIN;

DO $prerequisites$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = 'prontomedic_reception_rpc_owner'
       AND NOT rolcanlogin
       AND NOT rolsuper
       AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION
      'prontomedic_reception_rpc_owner must exist without LOGIN, SUPERUSER or BYPASSRLS';
  END IF;

  IF to_regclass('public.reception_checkin_workflows') IS NULL
     OR to_regclass('public.reception_admin_history') IS NULL
     OR to_regprocedure(
       'public.start_reception_checkin_workflow_secure(bigint,text,jsonb)'
     ) IS NULL
     OR to_regprocedure(
       'public.advance_reception_checkin_workflow_secure(uuid,integer,text,text,uuid,uuid,bigint,bigint,jsonb,text,text)'
     ) IS NULL
     OR to_regprocedure(
       'private.m11_start_workflow(bigint,text,jsonb)'
     ) IS NULL
     OR to_regprocedure(
       'private.m11_advance_workflow(uuid,integer,text,text,uuid,uuid,bigint,bigint,jsonb,text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Module 11 reception workflow dependencies are missing';
  END IF;
END
$prerequisites$;

CREATE OR REPLACE FUNCTION public.get_scheduling_actor()
RETURNS TABLE(user_id UUID, company_id UUID, role_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_uid UUID;
BEGIN
  BEGIN
    v_uid := NULLIF(
      current_setting('request.jwt.claim.sub', TRUE),
      ''
    )::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    v_uid := NULL;
  END;
  v_uid := COALESCE(v_uid, auth.uid());

  RETURN QUERY
  SELECT
    v_uid,
    profile.company_id,
    lower(COALESCE(profile.role_name, ''))
  FROM public.user_profiles profile
  WHERE profile.id = v_uid OR profile.user_id = v_uid
  ORDER BY
    (profile.user_id = v_uid) DESC,
    (profile.id = v_uid) DESC
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_scheduling_actor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_scheduling_actor()
  TO authenticated, app_prontomedic, prontomedic_reception_rpc_owner;

CREATE OR REPLACE FUNCTION private.m11_start_workflow(
  p_appointment_id BIGINT,
  p_idempotency_key TEXT,
  p_request_payload JSONB
)
RETURNS public.reception_checkin_workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_company UUID;
  v_actor UUID;
  v_appointment public.appointments;
  v_workflow public.reception_checkin_workflows;
  v_hash TEXT;
  v_requires_tiss BOOLEAN;
  v_requires_financial BOOLEAN;
BEGIN
  IF p_idempotency_key IS NULL
     OR length(p_idempotency_key) NOT BETWEEN 8 AND 120
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'Chave de idempotencia invalida';
  END IF;
  IF p_request_payload IS NULL
     OR jsonb_typeof(p_request_payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload do workflow deve ser um objeto JSON';
  END IF;
  IF octet_length(p_request_payload::TEXT) > 8192 THEN
    RAISE EXCEPTION 'Payload do workflow excede o limite';
  END IF;

  v_company := COALESCE(
    NULLIF(
      current_setting('request.jwt.claim.company_id', TRUE),
      ''
    )::UUID,
    NULLIF(
      NULLIF(
        current_setting('request.jwt.claims', TRUE),
        ''
      )::JSONB->>'company_id',
      ''
    )::UUID
  );
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Claim de empresa ausente';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('reception_checkin:' || p_appointment_id::TEXT, 0)
  );

  SELECT * INTO v_appointment
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado no tenant';
  END IF;
  IF v_appointment.unit_id IS NULL OR v_appointment.patient_id IS NULL THEN
    RAISE EXCEPTION
      'Agendamento sem unidade ou paciente nao pode iniciar check-in';
  END IF;

  v_actor := private.m11_assert_actor(
    v_company,
    v_appointment.unit_id,
    ARRAY['admin','gestor','recepcao','faturista','financeiro']::TEXT[]
  );
  v_hash := private.m11_request_hash(p_request_payload);
  v_requires_tiss := COALESCE(
    (p_request_payload->>'requires_tiss')::BOOLEAN,
    FALSE
  );
  v_requires_financial := COALESCE(
    (p_request_payload->>'requires_financial')::BOOLEAN,
    FALSE
  );

  SELECT * INTO v_workflow
  FROM public.reception_checkin_workflows workflow
  WHERE workflow.company_id = v_company
    AND workflow.operation = 'reception_checkin'
    AND workflow.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_workflow.appointment_id <> p_appointment_id
       OR v_workflow.request_hash <> v_hash
       OR v_workflow.request_payload IS DISTINCT FROM p_request_payload THEN
      RAISE EXCEPTION
        'Mesma chave de idempotencia com operacao ou payload diferente';
    END IF;
    UPDATE public.reception_checkin_workflows
    SET attempt_count = attempt_count + 1,
        version = version + 1,
        status = CASE
          WHEN status IN ('blocked','failed') THEN 'in_progress'
          ELSE status
        END,
        error_code = NULL,
        error_message = NULL,
        updated_by = v_actor,
        updated_at = NOW(),
        last_attempt_at = NOW()
    WHERE id = v_workflow.id
    RETURNING * INTO v_workflow;
    RETURN v_workflow;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reception_checkin_workflows workflow
    WHERE workflow.company_id = v_company
      AND workflow.appointment_id = p_appointment_id
      AND (
        workflow.operation <> 'reception_checkin'
        OR workflow.idempotency_key <> p_idempotency_key
      )
  ) THEN
    RAISE EXCEPTION 'Agendamento ja possui workflow com outra chave';
  END IF;

  INSERT INTO public.reception_checkin_workflows(
    company_id,
    unit_id,
    appointment_id,
    patient_id,
    operation,
    idempotency_key,
    request_hash,
    request_payload,
    requires_tiss,
    requires_financial,
    created_by,
    updated_by
  ) VALUES (
    v_company,
    v_appointment.unit_id,
    v_appointment.id,
    v_appointment.patient_id,
    'reception_checkin',
    p_idempotency_key,
    v_hash,
    p_request_payload,
    v_requires_tiss,
    v_requires_financial,
    v_actor,
    v_actor
  )
  RETURNING * INTO v_workflow;

  RETURN v_workflow;
END;
$function$;

CREATE OR REPLACE FUNCTION private.m11_advance_workflow(
  p_workflow_id UUID,
  p_expected_version INTEGER,
  p_next_step TEXT,
  p_status TEXT,
  p_billing_account_id UUID,
  p_tiss_guide_id UUID,
  p_financial_transaction_id BIGINT,
  p_checkin_id BIGINT,
  p_result_payload JSONB,
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS public.reception_checkin_workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_actor UUID;
  v_workflow public.reception_checkin_workflows;
  v_expected_next TEXT;
  v_billing_account_id UUID;
  v_tiss_guide_id UUID;
  v_financial_transaction_id BIGINT;
  v_checkin_id BIGINT;
BEGIN
  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'Versao esperada do workflow e obrigatoria';
  END IF;
  IF p_status NOT IN ('in_progress','blocked','failed','completed') THEN
    RAISE EXCEPTION 'Status de workflow invalido';
  END IF;
  IF p_next_step NOT IN ('precheck','billing','tiss','financial','checkin','completed') THEN
    RAISE EXCEPTION 'Etapa de workflow invalida';
  END IF;
  IF p_result_payload IS NOT NULL
     AND jsonb_typeof(p_result_payload) <> 'object' THEN
    RAISE EXCEPTION 'Resultado do workflow deve ser um objeto JSON';
  END IF;

  SELECT * INTO v_workflow
  FROM public.reception_checkin_workflows workflow
  WHERE workflow.id = p_workflow_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow de check-in nao encontrado';
  END IF;

  v_actor := private.m11_assert_actor(
    v_workflow.company_id,
    v_workflow.unit_id,
    ARRAY['admin','gestor','recepcao','faturista','financeiro']::TEXT[]
  );
  IF v_workflow.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Workflow alterado por outra sessao';
  END IF;
  IF v_workflow.status = 'completed' THEN
    RAISE EXCEPTION 'Workflow concluido nao pode ser alterado';
  END IF;

  IF p_status IN ('blocked','failed') THEN
    IF p_next_step <> v_workflow.current_step
       OR p_billing_account_id IS NOT NULL
       OR p_tiss_guide_id IS NOT NULL
       OR p_financial_transaction_id IS NOT NULL
       OR p_checkin_id IS NOT NULL THEN
      RAISE EXCEPTION
        'Bloqueio ou falha nao pode saltar etapa nem anexar artefato';
    END IF;
  ELSE
    v_expected_next := CASE v_workflow.current_step
      WHEN 'precheck' THEN 'billing'
      WHEN 'billing' THEN CASE
        WHEN v_workflow.requires_tiss THEN 'tiss'
        WHEN v_workflow.requires_financial THEN 'financial'
        ELSE 'checkin'
      END
      WHEN 'tiss' THEN CASE
        WHEN v_workflow.requires_financial THEN 'financial'
        ELSE 'checkin'
      END
      WHEN 'financial' THEN 'checkin'
      WHEN 'checkin' THEN 'completed'
      ELSE NULL
    END;

    IF p_next_step IS DISTINCT FROM v_expected_next THEN
      RAISE EXCEPTION 'Transicao de workflow invalida';
    END IF;
    IF (p_next_step = 'completed')
       IS DISTINCT FROM (p_status = 'completed') THEN
      RAISE EXCEPTION
        'Status completed deve coincidir com a etapa completed';
    END IF;

    IF v_workflow.current_step = 'precheck'
       AND (
         p_billing_account_id IS NOT NULL
         OR p_tiss_guide_id IS NOT NULL
         OR p_financial_transaction_id IS NOT NULL
         OR p_checkin_id IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'Precheck nao pode anexar artefatos';
    ELSIF v_workflow.current_step = 'billing'
       AND (
         p_billing_account_id IS NULL
         OR p_tiss_guide_id IS NOT NULL
         OR p_financial_transaction_id IS NOT NULL
         OR p_checkin_id IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'Etapa billing exige somente a pre-conta';
    ELSIF v_workflow.current_step = 'tiss'
       AND (
         p_tiss_guide_id IS NULL
         OR p_billing_account_id IS NOT NULL
         OR p_financial_transaction_id IS NOT NULL
         OR p_checkin_id IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'Etapa TISS exige somente a guia';
    ELSIF v_workflow.current_step = 'financial'
       AND (
         p_financial_transaction_id IS NULL
         OR p_billing_account_id IS NOT NULL
         OR p_tiss_guide_id IS NOT NULL
         OR p_checkin_id IS NOT NULL
       ) THEN
      RAISE EXCEPTION
        'Etapa financeira exige somente o titulo pendente';
    ELSIF v_workflow.current_step = 'checkin'
       AND (
         p_checkin_id IS NULL
         OR p_billing_account_id IS NOT NULL
         OR p_tiss_guide_id IS NOT NULL
         OR p_financial_transaction_id IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'Etapa check-in exige somente o check-in';
    END IF;
  END IF;

  v_billing_account_id := COALESCE(
    v_workflow.billing_account_id,
    p_billing_account_id
  );
  v_tiss_guide_id := COALESCE(
    v_workflow.tiss_guide_id,
    p_tiss_guide_id
  );
  v_financial_transaction_id := COALESCE(
    v_workflow.financial_transaction_id,
    p_financial_transaction_id
  );
  v_checkin_id := COALESCE(v_workflow.checkin_id, p_checkin_id);

  PERFORM private.m11_validate_artifacts(
    v_workflow,
    v_billing_account_id,
    v_tiss_guide_id,
    v_financial_transaction_id,
    v_checkin_id
  );

  UPDATE public.reception_checkin_workflows
  SET current_step = p_next_step,
      status = p_status,
      billing_account_id = v_billing_account_id,
      tiss_guide_id = v_tiss_guide_id,
      financial_transaction_id = v_financial_transaction_id,
      checkin_id = v_checkin_id,
      result_payload = result_payload
        || COALESCE(p_result_payload, '{}'::JSONB),
      error_code = CASE
        WHEN p_status IN ('blocked','failed')
          THEN left(NULLIF(p_error_code, ''), 100)
        ELSE NULL
      END,
      error_message = CASE
        WHEN p_status IN ('blocked','failed')
          THEN left(NULLIF(p_error_message, ''), 500)
        ELSE NULL
      END,
      completed_at = CASE
        WHEN p_status = 'completed' THEN NOW()
        ELSE completed_at
      END,
      updated_by = v_actor,
      updated_at = NOW(),
      version = version + 1
  WHERE id = v_workflow.id
  RETURNING * INTO v_workflow;

  RETURN v_workflow;
END;
$function$;

ALTER TABLE public.reception_checkin_workflows
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_checkin_workflows
  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointments_reception_rpc_select
  ON public.appointments;
CREATE POLICY appointments_reception_rpc_select
  ON public.appointments
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

DROP POLICY IF EXISTS reception_workflow_rpc_select
  ON public.reception_checkin_workflows;
DROP POLICY IF EXISTS reception_workflow_rpc_insert
  ON public.reception_checkin_workflows;
DROP POLICY IF EXISTS reception_workflow_rpc_update
  ON public.reception_checkin_workflows;

CREATE POLICY reception_workflow_rpc_select
  ON public.reception_checkin_workflows
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND private.reception_actor_can_access_unit(company_id, unit_id)
  );

CREATE POLICY reception_workflow_rpc_insert
  ON public.reception_checkin_workflows
  FOR INSERT TO prontomedic_reception_rpc_owner
  WITH CHECK (
    company_id = public.current_company_id()
    AND private.reception_actor_can_access_unit(company_id, unit_id)
  );

CREATE POLICY reception_workflow_rpc_update
  ON public.reception_checkin_workflows
  FOR UPDATE TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND private.reception_actor_can_access_unit(company_id, unit_id)
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND private.reception_actor_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS billing_accounts_reception_rpc_access
  ON public.billing_accounts;
CREATE POLICY billing_accounts_reception_rpc_access
  ON public.billing_accounts
  FOR ALL TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

DROP POLICY IF EXISTS tiss_guides_reception_rpc_access
  ON public.tiss_guides;
CREATE POLICY tiss_guides_reception_rpc_access
  ON public.tiss_guides
  FOR ALL TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

DROP POLICY IF EXISTS financial_transactions_reception_rpc_access
  ON public.financial_transactions;
CREATE POLICY financial_transactions_reception_rpc_access
  ON public.financial_transactions
  FOR ALL TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

DROP POLICY IF EXISTS m11_checkin_workflow_select
  ON public.reception_checkin_workflows;
CREATE POLICY m11_checkin_workflow_select
  ON public.reception_checkin_workflows
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.audit_has_role(ARRAY[
      'admin',
      'administrador',
      'gestor',
      'recepcao',
      'recepção',
      'supervisor_recepcao',
      'billing',
      'faturista',
      'financial',
      'financeiro'
    ]::TEXT[])
  );

ALTER FUNCTION private.m11_append_audit(
  public.reception_checkin_workflows,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION private.m11_audit_workflow_transition()
  OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION private.m11_start_workflow(BIGINT, TEXT, JSONB)
  OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION private.m11_advance_workflow(
  UUID,
  INTEGER,
  TEXT,
  TEXT,
  UUID,
  UUID,
  BIGINT,
  BIGINT,
  JSONB,
  TEXT,
  TEXT
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.start_reception_checkin_workflow_secure(
  BIGINT,
  TEXT,
  JSONB
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.advance_reception_checkin_workflow_secure(
  UUID,
  INTEGER,
  TEXT,
  TEXT,
  UUID,
  UUID,
  BIGINT,
  BIGINT,
  JSONB,
  TEXT,
  TEXT
) OWNER TO prontomedic_reception_rpc_owner;

GRANT USAGE ON SCHEMA public, private, auth
  TO prontomedic_reception_rpc_owner;
GRANT SELECT, INSERT, UPDATE
  ON public.reception_checkin_workflows
  TO prontomedic_reception_rpc_owner;
GRANT SELECT ON public.appointments
  TO prontomedic_reception_rpc_owner;
GRANT INSERT ON public.reception_admin_history
  TO prontomedic_reception_rpc_owner;

GRANT EXECUTE ON FUNCTION private.m11_request_hash(JSONB)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_normalize_role(TEXT)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_assert_actor(UUID, INTEGER, TEXT[])
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.reception_actor_can_access_unit(UUID, INTEGER)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_validate_artifacts(
  public.reception_checkin_workflows,
  UUID,
  UUID,
  BIGINT,
  BIGINT
) TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_append_audit(
  public.reception_checkin_workflows,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB
) TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_start_workflow(
  BIGINT,
  TEXT,
  JSONB
) TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_advance_workflow(
  UUID,
  INTEGER,
  TEXT,
  TEXT,
  UUID,
  UUID,
  BIGINT,
  BIGINT,
  JSONB,
  TEXT,
  TEXT
) TO prontomedic_reception_rpc_owner;

DO $legacy_owner_lockdown$
BEGIN
  IF to_regrole('prontomedic_rpc_owner') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION private.m11_start_workflow(
      BIGINT,
      TEXT,
      JSONB
    ) FROM prontomedic_rpc_owner;
    REVOKE EXECUTE ON FUNCTION private.m11_advance_workflow(
      UUID,
      INTEGER,
      TEXT,
      TEXT,
      UUID,
      UUID,
      BIGINT,
      BIGINT,
      JSONB,
      TEXT,
      TEXT
    ) FROM prontomedic_rpc_owner;
  END IF;
END
$legacy_owner_lockdown$;

REVOKE ALL ON FUNCTION public.start_reception_checkin_workflow_secure(
  BIGINT,
  TEXT,
  JSONB
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.advance_reception_checkin_workflow_secure(
  UUID,
  INTEGER,
  TEXT,
  TEXT,
  UUID,
  UUID,
  BIGINT,
  BIGINT,
  JSONB,
  TEXT,
  TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_reception_checkin_workflow_secure(
  BIGINT,
  TEXT,
  JSONB
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.advance_reception_checkin_workflow_secure(
  UUID,
  INTEGER,
  TEXT,
  TEXT,
  UUID,
  UUID,
  BIGINT,
  BIGINT,
  JSONB,
  TEXT,
  TEXT
) TO authenticated, app_prontomedic;

DO $ledger$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.prontomedic_deployment_migrations
        WHERE filename =
          '20260726121000_module11_reception_runtime_owner_closure.sql'
     ) THEN
    INSERT INTO public.prontomedic_deployment_migrations(
      filename,
      applied_at
    ) VALUES (
      '20260726121000_module11_reception_runtime_owner_closure.sql',
      NOW()
    );
  END IF;
END
$ledger$;

COMMIT;

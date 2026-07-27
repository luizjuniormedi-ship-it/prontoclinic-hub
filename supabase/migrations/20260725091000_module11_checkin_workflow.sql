-- Module 11: resumable, tenant-scoped and idempotent reception check-in.
-- Reception orchestrates. Billing owns the pre-account/TISS draft. Financial
-- owns the pending patient receivable. This slice never confirms a payment.

BEGIN;

DO $requirements$
BEGIN
  IF to_regclass('public.appointments') IS NULL
     OR to_regclass('public.reception_checkins') IS NULL
     OR to_regclass('public.reception_admin_history') IS NULL
     OR to_regclass('public.billing_accounts') IS NULL
     OR to_regclass('public.tiss_guides') IS NULL
     OR to_regclass('public.financial_transactions') IS NULL THEN
    RAISE EXCEPTION 'Module 11 workflow dependencies are missing';
  END IF;
  IF to_regprocedure('public.perform_reception_checkin_secure(bigint,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Secure reception check-in RPC is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_reception_rpc_owner') THEN
    RAISE EXCEPTION 'Role prontomedic_reception_rpc_owner is required';
  END IF;
END
$requirements$;

CREATE SCHEMA IF NOT EXISTS private;

ALTER TABLE public.billing_accounts
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT,
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS checkin_operation TEXT,
  ADD COLUMN IF NOT EXISTS checkin_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS checkin_request_hash TEXT;

ALTER TABLE public.tiss_guides
  ADD COLUMN IF NOT EXISTS checkin_operation TEXT,
  ADD COLUMN IF NOT EXISTS checkin_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS checkin_request_hash TEXT;

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS checkin_operation TEXT,
  ADD COLUMN IF NOT EXISTS checkin_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS checkin_request_hash TEXT;

DO $owner_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.billing_accounts'::REGCLASS
      AND conname = 'billing_accounts_checkin_key_chk'
  ) THEN
    ALTER TABLE public.billing_accounts
      ADD CONSTRAINT billing_accounts_checkin_key_chk CHECK (
        checkin_idempotency_key IS NULL
        OR (
          checkin_operation IS NOT NULL
          AND checkin_request_hash ~ '^[0-9a-f]{64}$'
          AND length(checkin_idempotency_key) BETWEEN 8 AND 120
          AND checkin_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
        )
      ) NOT VALID;
    ALTER TABLE public.billing_accounts
      VALIDATE CONSTRAINT billing_accounts_checkin_key_chk;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tiss_guides'::REGCLASS
      AND conname = 'tiss_guides_checkin_key_chk'
  ) THEN
    ALTER TABLE public.tiss_guides
      ADD CONSTRAINT tiss_guides_checkin_key_chk CHECK (
        checkin_idempotency_key IS NULL
        OR (
          checkin_operation IS NOT NULL
          AND checkin_request_hash ~ '^[0-9a-f]{64}$'
          AND length(checkin_idempotency_key) BETWEEN 8 AND 120
          AND checkin_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
        )
      ) NOT VALID;
    ALTER TABLE public.tiss_guides
      VALIDATE CONSTRAINT tiss_guides_checkin_key_chk;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financial_transactions'::REGCLASS
      AND conname = 'financial_transactions_checkin_key_chk'
  ) THEN
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_checkin_key_chk CHECK (
        checkin_idempotency_key IS NULL
        OR (
          checkin_operation IS NOT NULL
          AND checkin_request_hash ~ '^[0-9a-f]{64}$'
          AND length(checkin_idempotency_key) BETWEEN 8 AND 120
          AND checkin_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
        )
      ) NOT VALID;
    ALTER TABLE public.financial_transactions
      VALIDATE CONSTRAINT financial_transactions_checkin_key_chk;
  END IF;
END
$owner_constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS billing_accounts_checkin_operation_key_uq
  ON public.billing_accounts(company_id, checkin_operation, checkin_idempotency_key)
  WHERE checkin_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tiss_guides_checkin_operation_key_uq
  ON public.tiss_guides(company_id, checkin_operation, checkin_idempotency_key)
  WHERE checkin_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS financial_transactions_checkin_operation_key_uq
  ON public.financial_transactions(company_id, checkin_operation, checkin_idempotency_key)
  WHERE checkin_idempotency_key IS NOT NULL;

CREATE TABLE public.reception_checkin_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  appointment_id BIGINT NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL DEFAULT 'reception_checkin'
    CHECK (operation = 'reception_checkin'),
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 120)
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]+$'),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  request_payload JSONB NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  requires_tiss BOOLEAN NOT NULL DEFAULT FALSE,
  requires_financial BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','blocked','failed','completed')),
  current_step TEXT NOT NULL DEFAULT 'precheck'
    CHECK (current_step IN ('precheck','billing','tiss','financial','checkin','completed')),
  billing_account_id UUID REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  tiss_guide_id UUID REFERENCES public.tiss_guides(id) ON DELETE RESTRICT,
  financial_transaction_id BIGINT REFERENCES public.financial_transactions(id) ON DELETE RESTRICT,
  checkin_id BIGINT REFERENCES public.reception_checkins(id) ON DELETE RESTRICT,
  result_payload JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(result_payload) = 'object'),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  error_code TEXT,
  error_message TEXT,
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT reception_checkin_workflows_company_operation_key_uq
    UNIQUE (company_id, operation, idempotency_key),
  CONSTRAINT reception_checkin_workflows_company_appointment_uq
    UNIQUE (company_id, appointment_id)
);

CREATE INDEX idx_reception_checkin_workflows_scope
  ON public.reception_checkin_workflows(company_id, unit_id, status, updated_at DESC);

ALTER TABLE public.reception_checkin_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_checkin_workflows FORCE ROW LEVEL SECURITY;

CREATE POLICY m11_checkin_workflow_select
  ON public.reception_checkin_workflows
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.audit_has_role(ARRAY[
      'admin','administrador','gestor','recepcao','recepção',
      'billing','faturista','financial','financeiro'
    ]::TEXT[])
  );

REVOKE ALL ON TABLE public.reception_checkin_workflows
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT SELECT ON TABLE public.reception_checkin_workflows
  TO authenticated, app_prontomedic;

-- Financial mutations are owner-RPC only. The runtime keeps read access but
-- cannot insert/update/delete the financial ledger directly.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.financial_transactions
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT SELECT ON TABLE public.financial_transactions TO app_prontomedic;

CREATE OR REPLACE FUNCTION private.m11_request_hash(p_payload JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT encode(digest(convert_to(p_payload::TEXT, 'UTF8'), 'sha256'), 'hex')
$function$;

CREATE OR REPLACE FUNCTION private.m11_normalize_role(p_role TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT CASE lower(COALESCE(p_role, ''))
    WHEN 'administrador' THEN 'admin'
    WHEN 'admin_master' THEN 'admin'
    WHEN 'master' THEN 'admin'
    WHEN 'gerente' THEN 'gestor'
    WHEN 'recepção' THEN 'recepcao'
    WHEN 'billing' THEN 'faturista'
    WHEN 'financial' THEN 'financeiro'
    ELSE lower(COALESCE(p_role, ''))
  END
$function$;

CREATE OR REPLACE FUNCTION private.m11_assert_actor(
  p_company_id UUID,
  p_unit_id INTEGER,
  p_allowed_roles TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_claims JSONB := COALESCE(
    NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB,
    '{}'::JSONB
  );
  v_actor UUID := COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID,
    NULLIF(v_claims->>'sub', '')::UUID
  );
  v_claim_company UUID := COALESCE(
    NULLIF(current_setting('request.jwt.claim.company_id', TRUE), '')::UUID,
    NULLIF(v_claims->>'company_id', '')::UUID
  );
  v_profile public.user_profiles;
  v_role TEXT;
BEGIN
  IF v_actor IS NULL OR v_claim_company IS NULL OR v_claim_company <> p_company_id THEN
    RAISE EXCEPTION 'Contexto autenticado de empresa invalido';
  END IF;

  SELECT * INTO v_profile
  FROM public.user_profiles profile
  WHERE (profile.id = v_actor OR profile.user_id = v_actor)
    AND profile.company_id = p_company_id
    AND profile.lg_ativo = TRUE
  ORDER BY (profile.id = v_actor) DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil operacional ativo nao encontrado';
  END IF;

  v_role := private.m11_normalize_role(v_profile.role_name);
  IF NOT (v_role = ANY(p_allowed_roles)) THEN
    RAISE EXCEPTION 'Perfil sem permissao para esta etapa';
  END IF;

  IF p_unit_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.units unit_record
      WHERE unit_record.id = p_unit_id
        AND unit_record.company_id = p_company_id
        AND unit_record.lg_ativo = TRUE
    ) THEN
      RAISE EXCEPTION 'Unidade fora da empresa autenticada';
    END IF;

    IF v_role NOT IN ('admin','gestor')
       AND v_profile.primary_unit_id IS DISTINCT FROM p_unit_id
       AND NOT EXISTS (
         SELECT 1 FROM public.unit_access access_record
         WHERE access_record.user_id = v_actor
           AND access_record.company_id = p_company_id
           AND access_record.unit_id = p_unit_id
           AND access_record.valid_from <= CURRENT_DATE
           AND (access_record.valid_until IS NULL OR access_record.valid_until >= CURRENT_DATE)
       ) THEN
      RAISE EXCEPTION 'Perfil sem acesso a unidade do workflow';
    END IF;
  END IF;

  RETURN v_actor;
END;
$function$;

CREATE OR REPLACE FUNCTION private.m11_append_audit(
  p_workflow public.reception_checkin_workflows,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_from_status TEXT,
  p_to_status TEXT,
  p_reason TEXT,
  p_details JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.reception_admin_history(
    company_id, unit_id, entity_type, entity_id, appointment_id,
    from_status, to_status, reason, details, actor_user_id
  ) VALUES (
    p_workflow.company_id,
    p_workflow.unit_id,
    p_entity_type,
    p_entity_id,
    p_workflow.appointment_id,
    p_from_status,
    p_to_status,
    left(COALESCE(p_reason, 'workflow'), 300),
    jsonb_build_object(
      'workflow_id', p_workflow.id,
      'operation', p_workflow.operation,
      'correlation_id', p_workflow.correlation_id,
      'request_hash', p_workflow.request_hash,
      'attempt_count', p_workflow.attempt_count,
      'version', p_workflow.version,
      'step', p_workflow.current_step
    ) || COALESCE(p_details, '{}'::JSONB),
    p_workflow.updated_by
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.m11_audit_workflow_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
BEGIN
  PERFORM private.m11_append_audit(
    NEW,
    'checkin_workflow',
    NEW.id::TEXT,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status || ':' || OLD.current_step END,
    NEW.status || ':' || NEW.current_step,
    COALESCE(NEW.error_code, CASE WHEN TG_OP = 'INSERT' THEN 'workflow_started' ELSE 'workflow_transition' END),
    jsonb_build_object(
      'previous_version', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.version END,
      'billing_account_id', NEW.billing_account_id,
      'tiss_guide_id', NEW.tiss_guide_id,
      'financial_transaction_id', NEW.financial_transaction_id,
      'checkin_id', NEW.checkin_id
    )
  );
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_m11_audit_workflow_transition
  AFTER INSERT OR UPDATE ON public.reception_checkin_workflows
  FOR EACH ROW EXECUTE FUNCTION private.m11_audit_workflow_transition();

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
  IF p_request_payload IS NULL OR jsonb_typeof(p_request_payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload do workflow deve ser um objeto JSON';
  END IF;
  IF octet_length(p_request_payload::TEXT) > 8192 THEN
    RAISE EXCEPTION 'Payload do workflow excede o limite';
  END IF;

  v_company := COALESCE(
    NULLIF(current_setting('request.jwt.claim.company_id', TRUE), '')::UUID,
    NULLIF(NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB->>'company_id', '')::UUID
  );
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Claim de empresa ausente';
  END IF;

  SELECT * INTO v_appointment
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado no tenant'; END IF;
  IF v_appointment.unit_id IS NULL OR v_appointment.patient_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento sem unidade ou paciente nao pode iniciar check-in';
  END IF;

  v_actor := private.m11_assert_actor(
    v_company,
    v_appointment.unit_id,
    ARRAY['admin','gestor','recepcao','faturista','financeiro']::TEXT[]
  );
  v_hash := private.m11_request_hash(p_request_payload);
  v_requires_tiss := COALESCE((p_request_payload->>'requires_tiss')::BOOLEAN, FALSE);
  v_requires_financial := COALESCE((p_request_payload->>'requires_financial')::BOOLEAN, FALSE);

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
      RAISE EXCEPTION 'Mesma chave de idempotencia com operacao ou payload diferente';
    END IF;
    UPDATE public.reception_checkin_workflows
    SET attempt_count = attempt_count + 1,
        version = version + 1,
        status = CASE WHEN status IN ('blocked','failed') THEN 'in_progress' ELSE status END,
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
    SELECT 1 FROM public.reception_checkin_workflows workflow
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
    company_id, unit_id, appointment_id, patient_id, operation,
    idempotency_key, request_hash, request_payload, requires_tiss,
    requires_financial, created_by, updated_by
  ) VALUES (
    v_company, v_appointment.unit_id, v_appointment.id, v_appointment.patient_id,
    'reception_checkin', p_idempotency_key, v_hash, p_request_payload,
    v_requires_tiss, v_requires_financial, v_actor, v_actor
  )
  RETURNING * INTO v_workflow;

  RETURN v_workflow;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_reception_checkin_workflow_secure(
  p_appointment_id BIGINT,
  p_idempotency_key TEXT,
  p_request_payload JSONB DEFAULT '{}'::JSONB
)
RETURNS public.reception_checkin_workflows
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
  SELECT private.m11_start_workflow(
    p_appointment_id,
    p_idempotency_key,
    p_request_payload
  )
$function$;

CREATE OR REPLACE FUNCTION private.m11_validate_artifacts(
  p_workflow public.reception_checkin_workflows,
  p_billing_account_id UUID,
  p_tiss_guide_id UUID,
  p_financial_transaction_id BIGINT,
  p_checkin_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_billing_account_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.billing_accounts account
       WHERE account.id = p_billing_account_id
         AND account.company_id = p_workflow.company_id
         AND account.unit_id IS NOT DISTINCT FROM p_workflow.unit_id
         AND account.patient_id = p_workflow.patient_id
         AND account.appointment_id = p_workflow.appointment_id
         AND account.deleted_at IS NULL
         AND account.checkin_operation = 'billing_preaccount'
         AND account.checkin_idempotency_key = p_workflow.idempotency_key
         AND account.checkin_request_hash ~ '^[0-9a-f]{64}$'
     ) THEN
    RAISE EXCEPTION 'Pre-conta nao pertence integralmente ao workflow';
  END IF;

  IF p_tiss_guide_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.tiss_guides guide
       JOIN public.billing_accounts account ON account.id = guide.billing_account_id
       WHERE guide.id = p_tiss_guide_id
         AND guide.company_id = p_workflow.company_id
         AND guide.unit_id IS NOT DISTINCT FROM p_workflow.unit_id
         AND guide.appointment_id = p_workflow.appointment_id
         AND guide.billing_account_id = p_billing_account_id
         AND guide.checkin_operation = 'tiss_guide'
         AND guide.checkin_idempotency_key = p_workflow.idempotency_key
         AND guide.checkin_request_hash ~ '^[0-9a-f]{64}$'
         AND account.company_id = p_workflow.company_id
         AND account.unit_id IS NOT DISTINCT FROM p_workflow.unit_id
         AND account.patient_id = p_workflow.patient_id
         AND account.appointment_id = p_workflow.appointment_id
     ) THEN
    RAISE EXCEPTION 'Guia TISS nao pertence integralmente ao workflow';
  END IF;

  IF p_financial_transaction_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.financial_transactions transaction_record
       WHERE transaction_record.id = p_financial_transaction_id
         AND transaction_record.company_id = p_workflow.company_id
         AND transaction_record.unit_id IS NOT DISTINCT FROM p_workflow.unit_id
         AND transaction_record.patient_id = p_workflow.patient_id
         AND transaction_record.appointment_id = p_workflow.appointment_id
         AND transaction_record.billing_account_id = p_billing_account_id
         AND transaction_record.checkin_operation = 'financial_receivable'
         AND transaction_record.checkin_idempotency_key = p_workflow.idempotency_key
         AND transaction_record.checkin_request_hash ~ '^[0-9a-f]{64}$'
     ) THEN
    RAISE EXCEPTION 'Titulo financeiro nao pertence integralmente ao workflow';
  END IF;

  IF p_checkin_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.reception_checkins checkin_record
       WHERE checkin_record.id = p_checkin_id
         AND checkin_record.company_id = p_workflow.company_id
         AND checkin_record.unit_id IS NOT DISTINCT FROM p_workflow.unit_id
         AND checkin_record.patient_id = p_workflow.patient_id
         AND checkin_record.appointment_id = p_workflow.appointment_id
     ) THEN
    RAISE EXCEPTION 'Check-in nao pertence integralmente ao workflow';
  END IF;
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Workflow de check-in nao encontrado'; END IF;

  v_actor := private.m11_assert_actor(
    v_workflow.company_id,
    v_workflow.unit_id,
    ARRAY['admin','gestor','recepcao','faturista','financeiro']::TEXT[]
  );
  IF v_workflow.version <> p_expected_version THEN
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
      RAISE EXCEPTION 'Bloqueio ou falha nao pode saltar etapa nem anexar artefato';
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
    IF (p_next_step = 'completed') IS DISTINCT FROM (p_status = 'completed') THEN
      RAISE EXCEPTION 'Status completed deve coincidir com a etapa completed';
    END IF;

    IF v_workflow.current_step = 'precheck'
       AND (
         p_billing_account_id IS NOT NULL OR p_tiss_guide_id IS NOT NULL
         OR p_financial_transaction_id IS NOT NULL OR p_checkin_id IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'Precheck nao pode anexar artefatos';
    ELSIF v_workflow.current_step = 'billing'
       AND (
         p_billing_account_id IS NULL OR p_tiss_guide_id IS NOT NULL
         OR p_financial_transaction_id IS NOT NULL OR p_checkin_id IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'Etapa billing exige somente a pre-conta';
    ELSIF v_workflow.current_step = 'tiss'
       AND (
         p_tiss_guide_id IS NULL OR p_billing_account_id IS NOT NULL
         OR p_financial_transaction_id IS NOT NULL OR p_checkin_id IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'Etapa TISS exige somente a guia';
    ELSIF v_workflow.current_step = 'financial'
       AND (
         p_financial_transaction_id IS NULL OR p_billing_account_id IS NOT NULL
         OR p_tiss_guide_id IS NOT NULL OR p_checkin_id IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'Etapa financeira exige somente o titulo pendente';
    ELSIF v_workflow.current_step = 'checkin'
       AND (
         p_checkin_id IS NULL OR p_billing_account_id IS NOT NULL
         OR p_tiss_guide_id IS NOT NULL OR p_financial_transaction_id IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'Etapa check-in exige somente o check-in';
    END IF;
  END IF;

  v_billing_account_id := COALESCE(v_workflow.billing_account_id, p_billing_account_id);
  v_tiss_guide_id := COALESCE(v_workflow.tiss_guide_id, p_tiss_guide_id);
  v_financial_transaction_id :=
    COALESCE(v_workflow.financial_transaction_id, p_financial_transaction_id);
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
      result_payload = result_payload || COALESCE(p_result_payload, '{}'::JSONB),
      error_code = CASE WHEN p_status IN ('blocked','failed')
        THEN left(NULLIF(p_error_code, ''), 100) ELSE NULL END,
      error_message = CASE WHEN p_status IN ('blocked','failed')
        THEN left(NULLIF(p_error_message, ''), 500) ELSE NULL END,
      completed_at = CASE WHEN p_status = 'completed' THEN NOW() ELSE completed_at END,
      updated_by = v_actor,
      updated_at = NOW(),
      version = version + 1
  WHERE id = v_workflow.id
  RETURNING * INTO v_workflow;

  RETURN v_workflow;
END;
$function$;

CREATE OR REPLACE FUNCTION public.advance_reception_checkin_workflow_secure(
  p_workflow_id UUID,
  p_expected_version INTEGER,
  p_next_step TEXT,
  p_status TEXT DEFAULT 'in_progress',
  p_billing_account_id UUID DEFAULT NULL,
  p_tiss_guide_id UUID DEFAULT NULL,
  p_financial_transaction_id BIGINT DEFAULT NULL,
  p_checkin_id BIGINT DEFAULT NULL,
  p_result_payload JSONB DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS public.reception_checkin_workflows
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
  SELECT private.m11_advance_workflow(
    p_workflow_id,
    p_expected_version,
    p_next_step,
    p_status,
    p_billing_account_id,
    p_tiss_guide_id,
    p_financial_transaction_id,
    p_checkin_id,
    p_result_payload,
    p_error_code,
    p_error_message
  )
$function$;

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
        date_trunc('month', CURRENT_DATE)::DATE,
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

CREATE OR REPLACE FUNCTION public.ensure_billing_preaccount_for_checkin_secure(
  p_workflow_id UUID,
  p_billing_type TEXT,
  p_account_type TEXT DEFAULT 'ambulatorial',
  p_insurance_id BIGINT DEFAULT NULL,
  p_total_gross_amount NUMERIC DEFAULT 0
)
RETURNS public.billing_accounts
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
  SELECT private.m11_ensure_billing_preaccount(
    p_workflow_id,
    p_billing_type,
    p_account_type,
    p_insurance_id,
    p_total_gross_amount
  )
$function$;

CREATE OR REPLACE FUNCTION private.m11_ensure_tiss_guide(
  p_workflow_id UUID,
  p_guide_type TEXT,
  p_environment TEXT
)
RETURNS public.tiss_guides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_actor UUID;
  v_workflow public.reception_checkin_workflows;
  v_account public.billing_accounts;
  v_guide public.tiss_guides;
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
  IF v_workflow.status <> 'in_progress' OR v_workflow.current_step <> 'tiss' THEN
    RAISE EXCEPTION 'Workflow nao esta na etapa TISS';
  END IF;
  IF v_workflow.billing_account_id IS NULL THEN
    RAISE EXCEPTION 'Pre-conta ausente para a guia TISS';
  END IF;
  IF p_guide_type NOT IN (
    'CONSULTA','SP/SADT','INTERNACAO','RESUMO_INTERNACAO',
    'HONORARIO','OUTRAS_DESPESAS','RECURSO_GLOSA'
  ) THEN
    RAISE EXCEPTION 'Tipo de guia TISS invalido';
  END IF;
  IF p_environment NOT IN ('HOMOLOGACAO','PRODUCAO') THEN
    RAISE EXCEPTION 'Ambiente TISS invalido';
  END IF;

  SELECT * INTO v_account
  FROM public.billing_accounts account
  WHERE account.id = v_workflow.billing_account_id
    AND account.company_id = v_workflow.company_id
    AND account.unit_id IS NOT DISTINCT FROM v_workflow.unit_id
    AND account.patient_id = v_workflow.patient_id
    AND account.appointment_id = v_workflow.appointment_id
    AND account.billing_type = 'convenio'
    AND account.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pre-conta de convenio nao pertence ao workflow';
  END IF;

  v_payload := jsonb_build_object(
    'guide_type', p_guide_type,
    'environment', p_environment,
    'billing_account_id', v_workflow.billing_account_id
  );
  v_hash := private.m11_request_hash(v_payload);

  SELECT * INTO v_guide
  FROM public.tiss_guides guide
  WHERE guide.company_id = v_workflow.company_id
    AND guide.checkin_operation = 'tiss_guide'
    AND guide.checkin_idempotency_key = v_workflow.idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    v_idempotent := TRUE;
    IF v_guide.checkin_request_hash <> v_hash
       OR v_guide.unit_id IS DISTINCT FROM v_workflow.unit_id
       OR v_guide.appointment_id <> v_workflow.appointment_id
       OR v_guide.billing_account_id <> v_workflow.billing_account_id
       OR v_guide.guide_type <> p_guide_type
       OR v_guide.environment <> p_environment THEN
      RAISE EXCEPTION 'Retry da guia TISS possui campos divergentes';
    END IF;
  ELSE
    SELECT * INTO v_guide
    FROM public.tiss_guides guide
    WHERE guide.company_id = v_workflow.company_id
      AND guide.appointment_id = v_workflow.appointment_id
      AND guide.guide_type = p_guide_type
      AND guide.substitution_of_id IS NULL
      AND guide.status NOT IN ('CANCELLED','SUBSTITUTED')
    ORDER BY guide.created_at, guide.id
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      IF v_guide.checkin_idempotency_key IS NOT NULL
         AND (
           v_guide.checkin_operation <> 'tiss_guide'
           OR v_guide.checkin_idempotency_key <> v_workflow.idempotency_key
         ) THEN
        RAISE EXCEPTION 'Agendamento possui guia TISS com outra chave';
      END IF;
      IF v_guide.unit_id IS DISTINCT FROM v_workflow.unit_id
         OR v_guide.billing_account_id <> v_workflow.billing_account_id
         OR v_guide.environment <> p_environment THEN
        RAISE EXCEPTION 'Guia TISS existente nao corresponde ao workflow';
      END IF;
      UPDATE public.tiss_guides
      SET checkin_operation = 'tiss_guide',
          checkin_idempotency_key = v_workflow.idempotency_key,
          checkin_request_hash = v_hash,
          updated_at = NOW()
      WHERE id = v_guide.id
      RETURNING * INTO v_guide;
    ELSE
      INSERT INTO public.tiss_guides(
        company_id, unit_id, appointment_id, billing_account_id,
        guide_type, status, environment, created_by,
        checkin_operation, checkin_idempotency_key, checkin_request_hash
      ) VALUES (
        v_workflow.company_id,
        v_workflow.unit_id,
        v_workflow.appointment_id,
        v_workflow.billing_account_id,
        p_guide_type,
        'DRAFT',
        p_environment,
        v_actor,
        'tiss_guide',
        v_workflow.idempotency_key,
        v_hash
      )
      RETURNING * INTO v_guide;
    END IF;
  END IF;

  v_workflow.updated_by := v_actor;
  PERFORM private.m11_append_audit(
    v_workflow,
    'tiss_guide',
    v_guide.id::TEXT,
    NULL,
    'tiss_draft_ready',
    'tiss_guide',
    jsonb_build_object(
      'owner_operation', 'tiss_guide',
      'owner_request_hash', v_hash,
      'idempotent', v_idempotent
    )
  );
  RETURN v_guide;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_tiss_guide_for_checkin_secure(
  p_workflow_id UUID,
  p_guide_type TEXT,
  p_environment TEXT DEFAULT 'HOMOLOGACAO'
)
RETURNS public.tiss_guides
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
  SELECT private.m11_ensure_tiss_guide(
    p_workflow_id,
    p_guide_type,
    p_environment
  )
$function$;

CREATE OR REPLACE FUNCTION private.m11_ensure_financial_receivable(
  p_workflow_id UUID,
  p_amount NUMERIC,
  p_due_date DATE,
  p_receivable_type TEXT
)
RETURNS public.financial_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_actor UUID;
  v_workflow public.reception_checkin_workflows;
  v_transaction public.financial_transactions;
  v_payload JSONB;
  v_hash TEXT;
  v_tipo TEXT;
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
    ARRAY['admin','gestor','recepcao','financeiro']::TEXT[]
  );
  IF v_workflow.status <> 'in_progress' OR v_workflow.current_step <> 'financial' THEN
    RAISE EXCEPTION 'Workflow nao esta na etapa financeira';
  END IF;
  IF v_workflow.billing_account_id IS NULL THEN
    RAISE EXCEPTION 'Pre-conta ausente para o titulo financeiro';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Valor do titulo deve ser maior que zero';
  END IF;
  IF p_due_date IS NULL THEN
    RAISE EXCEPTION 'Vencimento do titulo obrigatorio';
  END IF;
  IF p_receivable_type NOT IN ('copayment','private') THEN
    RAISE EXCEPTION 'Tipo de titulo do paciente invalido';
  END IF;

  PERFORM private.m11_validate_artifacts(
    v_workflow,
    v_workflow.billing_account_id,
    v_workflow.tiss_guide_id,
    NULL,
    NULL
  );

  v_tipo := CASE
    WHEN p_receivable_type = 'copayment' THEN 'coparticipacao'
    ELSE 'particular'
  END;
  v_payload := jsonb_build_object(
    'amount', p_amount,
    'due_date', p_due_date,
    'receivable_type', p_receivable_type,
    'billing_account_id', v_workflow.billing_account_id
  );
  v_hash := private.m11_request_hash(v_payload);

  SELECT * INTO v_transaction
  FROM public.financial_transactions transaction_record
  WHERE transaction_record.company_id = v_workflow.company_id
    AND transaction_record.checkin_operation = 'financial_receivable'
    AND transaction_record.checkin_idempotency_key = v_workflow.idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    v_idempotent := TRUE;
    IF v_transaction.checkin_request_hash <> v_hash
       OR v_transaction.unit_id IS DISTINCT FROM v_workflow.unit_id
       OR v_transaction.patient_id <> v_workflow.patient_id
       OR v_transaction.appointment_id <> v_workflow.appointment_id
       OR v_transaction.billing_account_id <> v_workflow.billing_account_id
       OR v_transaction.tipo <> v_tipo
       OR COALESCE(v_transaction.amount, 0) <> p_amount
       OR COALESCE(v_transaction.total, 0) <> p_amount
       OR COALESCE(v_transaction.total_amount, 0) <> p_amount
       OR COALESCE(v_transaction.net_amount, 0) <> p_amount
       OR COALESCE(v_transaction.paid_amount, 0) <> 0
       OR v_transaction.due_date IS DISTINCT FROM p_due_date
       OR v_transaction.payment_method IS NOT NULL
       OR v_transaction.payment_date IS NOT NULL
       OR v_transaction.paid_at IS NOT NULL
       OR v_transaction.status <> 'em_aberto'
       OR COALESCE(v_transaction.lg_cancelado, FALSE) THEN
      RAISE EXCEPTION 'Retry do titulo pendente possui campos divergentes';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM public.financial_transactions transaction_record
      WHERE transaction_record.company_id = v_workflow.company_id
        AND transaction_record.appointment_id = v_workflow.appointment_id
        AND transaction_record.checkin_operation = 'financial_receivable'
        AND transaction_record.checkin_idempotency_key <> v_workflow.idempotency_key
    ) THEN
      RAISE EXCEPTION 'Agendamento possui titulo de check-in com outra chave';
    END IF;

    INSERT INTO public.financial_transactions(
      company_id, unit_id, patient_id, appointment_id, billing_account_id,
      status, tipo, description, amount, total, total_amount, net_amount,
      paid_amount, payment_method, due_date, payment_date, paid_at,
      lg_cancelado, checkin_operation, checkin_idempotency_key,
      checkin_request_hash
    ) VALUES (
      v_workflow.company_id,
      v_workflow.unit_id,
      v_workflow.patient_id,
      v_workflow.appointment_id,
      v_workflow.billing_account_id,
      'em_aberto',
      v_tipo,
      CASE WHEN p_receivable_type = 'copayment'
        THEN 'Coparticipacao pendente do atendimento'
        ELSE 'Atendimento particular pendente'
      END,
      p_amount,
      p_amount,
      p_amount,
      p_amount,
      0,
      NULL,
      p_due_date,
      NULL,
      NULL,
      FALSE,
      'financial_receivable',
      v_workflow.idempotency_key,
      v_hash
    )
    RETURNING * INTO v_transaction;
  END IF;

  v_workflow.updated_by := v_actor;
  PERFORM private.m11_append_audit(
    v_workflow,
    'financial_transaction',
    v_transaction.id::TEXT,
    NULL,
    'receivable_pending',
    'financial_receivable',
    jsonb_build_object(
      'owner_operation', 'financial_receivable',
      'owner_request_hash', v_hash,
      'idempotent', v_idempotent,
      'payment_confirmed', FALSE
    )
  );
  RETURN v_transaction;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_financial_receivable_for_checkin_secure(
  p_workflow_id UUID,
  p_amount NUMERIC,
  p_due_date DATE,
  p_receivable_type TEXT DEFAULT 'copayment'
)
RETURNS public.financial_transactions
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
  SELECT private.m11_ensure_financial_receivable(
    p_workflow_id,
    p_amount,
    p_due_date,
    p_receivable_type
  )
$function$;

ALTER FUNCTION private.m11_request_hash(JSONB) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION private.m11_normalize_role(TEXT) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION private.m11_assert_actor(UUID, INTEGER, TEXT[]) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION private.m11_append_audit(
  public.reception_checkin_workflows, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION private.m11_audit_workflow_transition() OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION private.m11_start_workflow(BIGINT, TEXT, JSONB)
  OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION private.m11_validate_artifacts(
  public.reception_checkin_workflows, UUID, UUID, BIGINT, BIGINT
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION private.m11_advance_workflow(
  UUID, INTEGER, TEXT, TEXT, UUID, UUID, BIGINT, BIGINT, JSONB, TEXT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION private.m11_ensure_billing_preaccount(
  UUID, TEXT, TEXT, BIGINT, NUMERIC
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION private.m11_ensure_tiss_guide(UUID, TEXT, TEXT)
  OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION private.m11_ensure_financial_receivable(UUID, NUMERIC, DATE, TEXT)
  OWNER TO prontomedic_reception_rpc_owner;

ALTER FUNCTION public.start_reception_checkin_workflow_secure(BIGINT, TEXT, JSONB)
  OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.advance_reception_checkin_workflow_secure(
  UUID, INTEGER, TEXT, TEXT, UUID, UUID, BIGINT, BIGINT, JSONB, TEXT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.ensure_billing_preaccount_for_checkin_secure(
  UUID, TEXT, TEXT, BIGINT, NUMERIC
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.ensure_tiss_guide_for_checkin_secure(UUID, TEXT, TEXT)
  OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.ensure_financial_receivable_for_checkin_secure(
  UUID, NUMERIC, DATE, TEXT
) OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT USAGE ON SCHEMA private TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION private.m11_request_hash(JSONB)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m11_normalize_role(TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m11_assert_actor(UUID, INTEGER, TEXT[])
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m11_append_audit(
  public.reception_checkin_workflows, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m11_audit_workflow_transition()
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m11_start_workflow(BIGINT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m11_validate_artifacts(
  public.reception_checkin_workflows, UUID, UUID, BIGINT, BIGINT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m11_advance_workflow(
  UUID, INTEGER, TEXT, TEXT, UUID, UUID, BIGINT, BIGINT, JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m11_ensure_billing_preaccount(
  UUID, TEXT, TEXT, BIGINT, NUMERIC
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m11_ensure_tiss_guide(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m11_ensure_financial_receivable(
  UUID, NUMERIC, DATE, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT EXECUTE ON FUNCTION private.m11_request_hash(JSONB)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_normalize_role(TEXT)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_assert_actor(UUID, INTEGER, TEXT[])
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_append_audit(
  public.reception_checkin_workflows, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_audit_workflow_transition()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_start_workflow(BIGINT, TEXT, JSONB)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_validate_artifacts(
  public.reception_checkin_workflows, UUID, UUID, BIGINT, BIGINT
) TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_advance_workflow(
  UUID, INTEGER, TEXT, TEXT, UUID, UUID, BIGINT, BIGINT, JSONB, TEXT, TEXT
) TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_ensure_billing_preaccount(
  UUID, TEXT, TEXT, BIGINT, NUMERIC
) TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_ensure_tiss_guide(UUID, TEXT, TEXT)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_ensure_financial_receivable(
  UUID, NUMERIC, DATE, TEXT
) TO prontomedic_reception_rpc_owner;

GRANT SELECT, INSERT, UPDATE ON public.reception_checkin_workflows
  TO prontomedic_reception_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON public.billing_accounts
  TO prontomedic_reception_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON public.tiss_guides
  TO prontomedic_reception_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON public.financial_transactions
  TO prontomedic_reception_rpc_owner;
GRANT SELECT, INSERT ON public.reception_admin_history
  TO prontomedic_reception_rpc_owner;
GRANT SELECT ON public.appointments, public.patients, public.companies,
  public.units, public.user_profiles, public.unit_access, public.reception_checkins
  TO prontomedic_reception_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.tiss_guide_number_seq
  TO prontomedic_reception_rpc_owner;

DO $financial_sequence$
DECLARE
  v_sequence TEXT;
BEGIN
  SELECT pg_get_serial_sequence('public.financial_transactions', 'id')
    INTO v_sequence;
  IF v_sequence IS NOT NULL THEN
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE %s TO prontomedic_reception_rpc_owner',
      v_sequence
    );
  END IF;
END
$financial_sequence$;

REVOKE ALL ON FUNCTION public.start_reception_checkin_workflow_secure(
  BIGINT, TEXT, JSONB
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.advance_reception_checkin_workflow_secure(
  UUID, INTEGER, TEXT, TEXT, UUID, UUID, BIGINT, BIGINT, JSONB, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_billing_preaccount_for_checkin_secure(
  UUID, TEXT, TEXT, BIGINT, NUMERIC
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_tiss_guide_for_checkin_secure(
  UUID, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_financial_receivable_for_checkin_secure(
  UUID, NUMERIC, DATE, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.start_reception_checkin_workflow_secure(
  BIGINT, TEXT, JSONB
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.advance_reception_checkin_workflow_secure(
  UUID, INTEGER, TEXT, TEXT, UUID, UUID, BIGINT, BIGINT, JSONB, TEXT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.ensure_billing_preaccount_for_checkin_secure(
  UUID, TEXT, TEXT, BIGINT, NUMERIC
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.ensure_tiss_guide_for_checkin_secure(
  UUID, TEXT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.ensure_financial_receivable_for_checkin_secure(
  UUID, NUMERIC, DATE, TEXT
) TO authenticated, app_prontomedic;

DO $legacy_payment$
BEGIN
  IF to_regprocedure(
    'public.record_reception_payment_secure(bigint,numeric,text,text,text)'
  ) IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.record_reception_payment_secure(
      BIGINT, NUMERIC, TEXT, TEXT, TEXT
    ) FROM PUBLIC, anon, authenticated, app_prontomedic;
  END IF;
END
$legacy_payment$;

DO $manifest$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260725091000_module11_checkin_workflow.sql', NOW())
    ON CONFLICT (filename) DO NOTHING;
  END IF;
END
$manifest$;

COMMIT;

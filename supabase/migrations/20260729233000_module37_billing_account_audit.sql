BEGIN;

DO $requirements$
BEGIN
  IF to_regclass('public.billing_accounts') IS NULL
     OR to_regclass('public.billing_command_operations') IS NULL
     OR to_regprocedure('public.m39_billing_readiness(public.billing_accounts)') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL
     OR to_regprocedure('public.active_unit_id()') IS NULL
     OR to_regprocedure('public.request_aal()') IS NULL
     OR to_regprocedure('public.can_access(text,text)') IS NULL
     OR to_regprocedure('public.audit_trigger_func()') IS NULL
     OR to_regrole('prontomedic_financial_rpc_owner') IS NULL THEN
    RAISE EXCEPTION 'Module 37 billing audit dependencies are missing';
  END IF;
END
$requirements$;

ALTER TABLE public.billing_command_operations
  DROP CONSTRAINT IF EXISTS billing_command_operations_type_chk;
ALTER TABLE public.billing_command_operations
  ADD CONSTRAINT billing_command_operations_type_chk
  CHECK (
    operation_type IN (
      'review_billing_account',
      'reopen_billing_account',
      'close_billing_competence',
      'reopen_billing_competence',
      'claim_billing_audit',
      'decide_billing_audit'
    )
  );

CREATE TABLE IF NOT EXISTS public.billing_account_audit_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  billing_account_id UUID NOT NULL
    REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  reviewer_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned',
  deadline_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '4 hours'),
  decided_at TIMESTAMPTZ,
  opinion TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_account_audit_reviews_status_chk
    CHECK (status IN ('assigned', 'approved', 'returned', 'escalated')),
  CONSTRAINT billing_account_audit_reviews_version_chk CHECK (version > 0),
  CONSTRAINT billing_account_audit_reviews_evidence_chk
    CHECK (
      jsonb_typeof(evidence) IN ('object', 'array')
      AND octet_length(evidence::TEXT) <= 16384
    ),
  CONSTRAINT billing_account_audit_reviews_decision_chk
    CHECK (
      status = 'assigned'
      OR (
        decided_at IS NOT NULL
        AND NULLIF(trim(COALESCE(opinion, '')), '') IS NOT NULL
        AND evidence <> '{}'::JSONB
        AND evidence <> '[]'::JSONB
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_account_audit_reviews_active_uq
  ON public.billing_account_audit_reviews(company_id, unit_id, billing_account_id)
  WHERE status = 'assigned';
CREATE INDEX IF NOT EXISTS billing_account_audit_reviews_queue_idx
  ON public.billing_account_audit_reviews(company_id, unit_id, status, deadline_at);

ALTER TABLE public.billing_account_audit_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_account_audit_reviews FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.billing_account_audit_reviews
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.billing_accounts,
  public.billing_account_audit_reviews,
  public.billing_command_operations
TO prontomedic_financial_rpc_owner;
GRANT SELECT ON TABLE public.patients, public.user_profiles
  TO prontomedic_financial_rpc_owner;

DROP POLICY IF EXISTS billing_account_audit_reviews_financial_all
  ON public.billing_account_audit_reviews;
CREATE POLICY billing_account_audit_reviews_financial_all
  ON public.billing_account_audit_reviews
  FOR ALL TO prontomedic_financial_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );

DROP TRIGGER IF EXISTS trg_audit_billing_account_audit_reviews
  ON public.billing_account_audit_reviews;
CREATE TRIGGER trg_audit_billing_account_audit_reviews
  AFTER INSERT OR UPDATE OR DELETE ON public.billing_account_audit_reviews
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE OR REPLACE FUNCTION public.m37_list_billing_audit_queue_secure(
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 200
) RETURNS TABLE (
  account_id UUID,
  patient_name TEXT,
  guide_number TEXT,
  account_status TEXT,
  account_version INTEGER,
  total_net_amount NUMERIC,
  readiness JSONB,
  review_id UUID,
  review_status TEXT,
  review_version INTEGER,
  reviewer_id UUID,
  reviewer_name TEXT,
  deadline_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  opinion TEXT,
  evidence JSONB,
  sla_overdue BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = on
AS $function$
DECLARE
  v_company_id UUID := public.current_company_id();
  v_unit_id INTEGER := public.active_unit_id();
BEGIN
  IF auth.uid() IS NULL OR v_company_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Contexto de auditoria exige usuário, empresa e unidade ativas'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access('faturamento', 'view') THEN
    RAISE EXCEPTION 'Permissão de visualização do faturamento é obrigatória'
      USING ERRCODE = '42501';
  END IF;
  IF p_status IS NOT NULL
     AND p_status NOT IN ('unassigned', 'assigned', 'approved', 'returned', 'escalated') THEN
    RAISE EXCEPTION 'Filtro de auditoria inválido';
  END IF;

  RETURN QUERY
  SELECT
    account.id,
    patient.full_name::TEXT,
    account.guide_number,
    account.status,
    account.version,
    account.total_net_amount,
    public.m39_billing_readiness(account),
    review.id,
    review.status,
    review.version,
    review.reviewer_id,
    profile.full_name::TEXT,
    review.deadline_at,
    review.decided_at,
    review.opinion,
    review.evidence,
    review.status = 'assigned' AND review.deadline_at < NOW()
  FROM public.billing_accounts account
  LEFT JOIN public.patients patient
    ON patient.id = account.patient_id
   AND patient.company_id = account.company_id
  LEFT JOIN LATERAL (
    SELECT candidate.*
    FROM public.billing_account_audit_reviews candidate
    WHERE candidate.company_id = account.company_id
      AND candidate.unit_id = account.unit_id
      AND candidate.billing_account_id = account.id
    ORDER BY candidate.created_at DESC
    LIMIT 1
  ) review ON TRUE
  LEFT JOIN public.user_profiles profile
    ON profile.user_id = review.reviewer_id
   AND profile.company_id = account.company_id
  WHERE account.company_id = v_company_id
    AND account.unit_id = v_unit_id
    AND account.deleted_at IS NULL
    AND account.status IN (
      'em_montagem', 'aguardando_conferencia', 'em_auditoria',
      'com_pendencia', 'pronta_envio', 'reaberta'
    )
    AND (
      p_status IS NULL
      OR (p_status = 'unassigned' AND review.id IS NULL)
      OR review.status = p_status
    )
  ORDER BY
    CASE WHEN review.status = 'assigned' AND review.deadline_at < NOW() THEN 0 ELSE 1 END,
    COALESCE(review.deadline_at, account.opened_at),
    account.opened_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
END
$function$;

CREATE OR REPLACE FUNCTION public.m37_claim_billing_audit_secure(
  p_account_id UUID,
  p_expected_account_version INTEGER,
  p_operation_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = on
AS $function$
DECLARE
  v_company_id UUID := public.current_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_actor_id UUID := auth.uid();
  v_hash TEXT;
  v_existing public.billing_command_operations%ROWTYPE;
  v_account public.billing_accounts%ROWTYPE;
  v_review public.billing_account_audit_reviews%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL OR v_company_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Contexto de auditoria exige usuário, empresa e unidade ativas'
      USING ERRCODE = '42501';
  END IF;
  IF public.request_aal() IS DISTINCT FROM 'aal2'
     OR NOT public.can_access('faturamento', 'edit') THEN
    RAISE EXCEPTION 'AAL2 e permissão de edição do faturamento são obrigatórios'
      USING ERRCODE = '42501';
  END IF;
  IF p_account_id IS NULL OR p_expected_account_version IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Conta, versão esperada e operação são obrigatórias';
  END IF;

  v_hash := encode(public.digest(convert_to(jsonb_build_object(
    'account_id', p_account_id,
    'expected_account_version', p_expected_account_version
  )::TEXT, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.billing_command_operations (
    company_id, unit_id, operation_id, operation_type, request_hash, actor_id
  ) VALUES (
    v_company_id, v_unit_id, p_operation_id, 'claim_billing_audit', v_hash, v_actor_id
  )
  ON CONFLICT (company_id, unit_id, operation_id) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.billing_command_operations operation
  WHERE operation.company_id = v_company_id
    AND operation.unit_id = v_unit_id
    AND operation.operation_id = p_operation_id
  FOR UPDATE;

  IF v_existing.operation_type IS DISTINCT FROM 'claim_billing_audit'
     OR v_existing.request_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Chave de idempotência reutilizada com outro conteúdo';
  END IF;
  IF v_existing.completed_at IS NOT NULL THEN
    RETURN v_existing.result_payload;
  END IF;

  SELECT * INTO STRICT v_account
  FROM public.billing_accounts account
  WHERE account.id = p_account_id
    AND account.company_id = v_company_id
    AND account.unit_id = v_unit_id
    AND account.deleted_at IS NULL
  FOR UPDATE;

  IF v_account.version IS DISTINCT FROM p_expected_account_version THEN
    RAISE EXCEPTION 'Versão da conta desatualizada';
  END IF;
  IF v_account.status NOT IN (
    'em_montagem', 'aguardando_conferencia', 'com_pendencia', 'reaberta'
  ) THEN
    RAISE EXCEPTION 'Estado % não permite iniciar auditoria', v_account.status;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.billing_account_audit_reviews review
    WHERE review.company_id = v_company_id
      AND review.unit_id = v_unit_id
      AND review.billing_account_id = p_account_id
      AND review.status = 'assigned'
  ) THEN
    RAISE EXCEPTION 'Conta já possui auditoria ativa';
  END IF;

  INSERT INTO public.billing_account_audit_reviews (
    company_id, unit_id, billing_account_id, reviewer_id
  ) VALUES (
    v_company_id, v_unit_id, p_account_id, v_actor_id
  ) RETURNING * INTO v_review;

  UPDATE public.billing_accounts
  SET status = 'em_auditoria', version = version + 1, updated_at = NOW()
  WHERE id = p_account_id
  RETURNING * INTO v_account;

  v_result := jsonb_build_object(
    'account_id', v_account.id,
    'account_status', v_account.status,
    'account_version', v_account.version,
    'review_id', v_review.id,
    'review_status', v_review.status,
    'review_version', v_review.version,
    'reviewer_id', v_review.reviewer_id,
    'deadline_at', v_review.deadline_at
  );

  UPDATE public.billing_command_operations
  SET result_payload = v_result, completed_at = NOW()
  WHERE company_id = v_company_id
    AND unit_id = v_unit_id
    AND operation_id = p_operation_id;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.m37_decide_billing_audit_secure(
  p_account_id UUID,
  p_review_id UUID,
  p_decision TEXT,
  p_opinion TEXT,
  p_evidence JSONB,
  p_expected_account_version INTEGER,
  p_expected_review_version INTEGER,
  p_operation_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = on
AS $function$
DECLARE
  v_company_id UUID := public.current_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_actor_id UUID := auth.uid();
  v_opinion TEXT := NULLIF(trim(COALESCE(p_opinion, '')), '');
  v_hash TEXT;
  v_existing public.billing_command_operations%ROWTYPE;
  v_account public.billing_accounts%ROWTYPE;
  v_review public.billing_account_audit_reviews%ROWTYPE;
  v_readiness JSONB;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL OR v_company_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Contexto de auditoria exige usuário, empresa e unidade ativas'
      USING ERRCODE = '42501';
  END IF;
  IF public.request_aal() IS DISTINCT FROM 'aal2'
     OR NOT public.can_access('faturamento', 'edit') THEN
    RAISE EXCEPTION 'AAL2 e permissão de edição do faturamento são obrigatórios'
      USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved', 'returned', 'escalated')
     OR v_opinion IS NULL
     OR p_evidence IS NULL
     OR jsonb_typeof(p_evidence) NOT IN ('object', 'array')
     OR p_evidence IN ('{}'::JSONB, '[]'::JSONB)
     OR octet_length(p_evidence::TEXT) > 16384 THEN
    RAISE EXCEPTION 'Decisão, parecer e evidência válida são obrigatórios';
  END IF;

  v_hash := encode(public.digest(convert_to(jsonb_build_object(
    'account_id', p_account_id, 'review_id', p_review_id,
    'decision', p_decision, 'opinion', v_opinion, 'evidence', p_evidence,
    'expected_account_version', p_expected_account_version,
    'expected_review_version', p_expected_review_version
  )::TEXT, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.billing_command_operations (
    company_id, unit_id, operation_id, operation_type, request_hash, actor_id
  ) VALUES (
    v_company_id, v_unit_id, p_operation_id, 'decide_billing_audit', v_hash, v_actor_id
  )
  ON CONFLICT (company_id, unit_id, operation_id) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.billing_command_operations operation
  WHERE operation.company_id = v_company_id
    AND operation.unit_id = v_unit_id
    AND operation.operation_id = p_operation_id
  FOR UPDATE;

  IF v_existing.operation_type IS DISTINCT FROM 'decide_billing_audit'
     OR v_existing.request_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Chave de idempotência reutilizada com outro conteúdo';
  END IF;
  IF v_existing.completed_at IS NOT NULL THEN
    RETURN v_existing.result_payload;
  END IF;

  SELECT * INTO STRICT v_account
  FROM public.billing_accounts account
  WHERE account.id = p_account_id
    AND account.company_id = v_company_id
    AND account.unit_id = v_unit_id
    AND account.deleted_at IS NULL
  FOR UPDATE;
  SELECT * INTO STRICT v_review
  FROM public.billing_account_audit_reviews review
  WHERE review.id = p_review_id
    AND review.billing_account_id = p_account_id
    AND review.company_id = v_company_id
    AND review.unit_id = v_unit_id
  FOR UPDATE;

  IF v_account.version IS DISTINCT FROM p_expected_account_version
     OR v_review.version IS DISTINCT FROM p_expected_review_version THEN
    RAISE EXCEPTION 'Versão da conta ou auditoria desatualizada';
  END IF;
  IF v_account.status IS DISTINCT FROM 'em_auditoria'
     OR v_review.status IS DISTINCT FROM 'assigned'
     OR v_review.reviewer_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'Somente o responsável pode decidir uma auditoria ativa';
  END IF;

  v_readiness := public.m39_billing_readiness(v_account);
  IF p_decision = 'approved'
     AND (v_readiness ->> 'can_close')::BOOLEAN IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Conta com pendências bloqueadoras não pode ser aprovada';
  END IF;

  UPDATE public.billing_account_audit_reviews
  SET status = p_decision, opinion = v_opinion, evidence = p_evidence,
      decided_at = NOW(), version = version + 1, updated_at = NOW()
  WHERE id = p_review_id
  RETURNING * INTO v_review;

  UPDATE public.billing_accounts
  SET
    status = CASE p_decision
      WHEN 'approved' THEN 'pronta_envio'
      WHEN 'returned' THEN 'com_pendencia'
      ELSE 'com_pendencia'
    END,
    has_pending_issues = p_decision <> 'approved',
    last_reviewed_at = NOW(),
    last_reviewed_by = v_actor_id,
    readiness_snapshot = v_readiness || jsonb_build_object(
      'audit_review_id', v_review.id,
      'audit_decision', p_decision,
      'audit_opinion', v_opinion
    ),
    version = version + 1,
    updated_at = NOW()
  WHERE id = p_account_id
  RETURNING * INTO v_account;

  v_result := jsonb_build_object(
    'account_id', v_account.id,
    'account_status', v_account.status,
    'account_version', v_account.version,
    'review_id', v_review.id,
    'review_status', v_review.status,
    'review_version', v_review.version,
    'decided_at', v_review.decided_at
  );
  UPDATE public.billing_command_operations
  SET result_payload = v_result, completed_at = NOW()
  WHERE company_id = v_company_id
    AND unit_id = v_unit_id
    AND operation_id = p_operation_id;
  RETURN v_result;
END
$function$;

ALTER FUNCTION public.m37_list_billing_audit_queue_secure(TEXT, INTEGER)
  OWNER TO prontomedic_financial_rpc_owner;
ALTER FUNCTION public.m37_claim_billing_audit_secure(UUID, INTEGER, UUID)
  OWNER TO prontomedic_financial_rpc_owner;
ALTER FUNCTION public.m37_decide_billing_audit_secure(
  UUID, UUID, TEXT, TEXT, JSONB, INTEGER, INTEGER, UUID
) OWNER TO prontomedic_financial_rpc_owner;

REVOKE ALL ON FUNCTION public.m37_list_billing_audit_queue_secure(TEXT, INTEGER)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m37_claim_billing_audit_secure(UUID, INTEGER, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m37_decide_billing_audit_secure(
  UUID, UUID, TEXT, TEXT, JSONB, INTEGER, INTEGER, UUID
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.m37_list_billing_audit_queue_secure(TEXT, INTEGER)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m37_claim_billing_audit_secure(UUID, INTEGER, UUID)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m37_decide_billing_audit_secure(
  UUID, UUID, TEXT, TEXT, JSONB, INTEGER, INTEGER, UUID
) TO authenticated, app_prontomedic;

COMMIT;

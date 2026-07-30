BEGIN;

DO $requirements$
BEGIN
  IF to_regclass('public.billing_accounts') IS NULL
     OR to_regclass('public.companies') IS NULL
     OR to_regclass('public.units') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL
     OR to_regprocedure('public.active_unit_id()') IS NULL
     OR to_regprocedure('public.request_aal()') IS NULL
     OR to_regprocedure('public.can_access(text,text)') IS NULL
     OR to_regprocedure('public.digest(bytea,text)') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('public.audit_trigger_func()') IS NULL
     OR to_regrole('prontomedic_financial_rpc_owner') IS NULL THEN
    RAISE EXCEPTION 'Module 39 billing account closure dependencies are missing';
  END IF;
END
$requirements$;

DO $owner$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'prontomedic_financial_rpc_owner'
      AND (
        rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper
        OR rolcreatedb OR rolcreaterole OR rolreplication
      )
  ) THEN
    RAISE EXCEPTION
      'prontomedic_financial_rpc_owner must remain NOLOGIN, NOINHERIT and NOBYPASSRLS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid = membership.member
    JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
    WHERE member_role.rolname = 'prontomedic_financial_rpc_owner'
       OR granted_role.rolname = 'prontomedic_financial_rpc_owner'
  ) THEN
    RAISE EXCEPTION
      'prontomedic_financial_rpc_owner must not have role memberships';
  END IF;
END
$owner$;

ALTER TABLE public.billing_accounts
  ADD COLUMN IF NOT EXISTS authorization_number TEXT,
  ADD COLUMN IF NOT EXISTS has_denial BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_reopened BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS readiness_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB;

UPDATE public.billing_accounts
SET opened_at = COALESCE(opened_at, created_at, NOW())
WHERE opened_at IS NULL;

ALTER TABLE public.billing_accounts
  ALTER COLUMN opened_at SET DEFAULT NOW(),
  ALTER COLUMN opened_at SET NOT NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.billing_accounts'::REGCLASS
      AND conname = 'billing_accounts_version_positive_chk'
  ) THEN
    ALTER TABLE public.billing_accounts
      ADD CONSTRAINT billing_accounts_version_positive_chk
      CHECK (version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.billing_accounts'::REGCLASS
      AND conname = 'billing_accounts_competence_month_chk'
  ) THEN
    ALTER TABLE public.billing_accounts
      ADD CONSTRAINT billing_accounts_competence_month_chk
      CHECK (
        competence_month IS NULL
        OR competence_month = date_trunc('month', competence_month)::DATE
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.billing_accounts'::REGCLASS
      AND conname = 'billing_accounts_operational_status_chk'
  ) THEN
    ALTER TABLE public.billing_accounts
      ADD CONSTRAINT billing_accounts_operational_status_chk
      CHECK (
        status IN (
          'aberta', 'em_montagem', 'aguardando_documentos',
          'aguardando_autorizacao', 'aguardando_laudo',
          'aguardando_assinatura', 'aguardando_conferencia',
          'em_auditoria', 'com_pendencia', 'pronta_envio', 'enviada',
          'em_analise', 'paga', 'parcialmente_paga', 'glosada',
          'em_recurso', 'recurso_aceito', 'recurso_negado', 'baixada',
          'cancelada', 'reaberta', 'particular_paga',
          'particular_pendente', 'inadimplente'
        )
      ) NOT VALID;
  END IF;
END
$constraints$;

CREATE INDEX IF NOT EXISTS billing_accounts_company_unit_opened_idx
  ON public.billing_accounts(company_id, unit_id, opened_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS billing_accounts_company_unit_competence_idx
  ON public.billing_accounts(company_id, unit_id, competence_month, status)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.billing_competence_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL
    REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL
    REFERENCES public.units(id) ON DELETE RESTRICT,
  competence_month DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  version INTEGER NOT NULL DEFAULT 1,
  closed_at TIMESTAMPTZ,
  closed_by UUID,
  close_reason TEXT,
  reopened_at TIMESTAMPTZ,
  reopened_by UUID,
  reopen_reason TEXT,
  account_count INTEGER NOT NULL DEFAULT 0,
  account_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_competence_closures_month_chk
    CHECK (competence_month = date_trunc('month', competence_month)::DATE),
  CONSTRAINT billing_competence_closures_status_chk
    CHECK (status IN ('open', 'closed')),
  CONSTRAINT billing_competence_closures_version_chk
    CHECK (version > 0),
  CONSTRAINT billing_competence_closures_closed_fields_chk
    CHECK (
      (status = 'open')
      OR (
        closed_at IS NOT NULL
        AND closed_by IS NOT NULL
        AND NULLIF(trim(COALESCE(close_reason, '')), '') IS NOT NULL
      )
    ),
  CONSTRAINT billing_competence_closures_scope_uq
    UNIQUE (company_id, unit_id, competence_month)
);

CREATE TABLE IF NOT EXISTS public.billing_command_operations (
  company_id UUID NOT NULL
    REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL
    REFERENCES public.units(id) ON DELETE RESTRICT,
  operation_id UUID NOT NULL,
  operation_type TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  actor_id UUID NOT NULL,
  result_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (company_id, unit_id, operation_id),
  CONSTRAINT billing_command_operations_type_chk
    CHECK (
      operation_type IN (
        'review_billing_account',
        'reopen_billing_account',
        'close_billing_competence',
        'reopen_billing_competence'
      )
    ),
  CONSTRAINT billing_command_operations_hash_chk
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT billing_command_operations_completed_chk
    CHECK (
      (completed_at IS NULL AND result_payload IS NULL)
      OR (completed_at IS NOT NULL AND result_payload IS NOT NULL)
    )
);

ALTER TABLE public.billing_competence_closures
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_competence_closures
  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.billing_command_operations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_command_operations
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.billing_competence_closures
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON TABLE public.billing_command_operations
  FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.billing_accounts,
  public.billing_competence_closures,
  public.billing_command_operations
TO prontomedic_financial_rpc_owner;

GRANT EXECUTE ON FUNCTION public.request_aal()
  TO prontomedic_financial_rpc_owner;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT)
  TO prontomedic_financial_rpc_owner;

DROP POLICY IF EXISTS billing_accounts_financial_command_update
  ON public.billing_accounts;
CREATE POLICY billing_accounts_financial_command_update
  ON public.billing_accounts
  FOR UPDATE TO prontomedic_financial_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );

DROP POLICY IF EXISTS billing_competence_closures_financial_all
  ON public.billing_competence_closures;
CREATE POLICY billing_competence_closures_financial_all
  ON public.billing_competence_closures
  FOR ALL TO prontomedic_financial_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );

DROP POLICY IF EXISTS billing_command_operations_financial_all
  ON public.billing_command_operations;
CREATE POLICY billing_command_operations_financial_all
  ON public.billing_command_operations
  FOR ALL TO prontomedic_financial_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );

CREATE OR REPLACE FUNCTION public.m39_enforce_open_billing_competence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = on
AS $function$
BEGIN
  IF NEW.competence_month IS NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
     AND NEW.unit_id IS NOT DISTINCT FROM OLD.unit_id
     AND NEW.competence_month IS NOT DISTINCT FROM OLD.competence_month THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS DISTINCT FROM public.current_company_id()
     OR NEW.unit_id IS DISTINCT FROM public.active_unit_id() THEN
    RAISE EXCEPTION
      'Inclusão em competência exige empresa e unidade ativas correspondentes'
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
  BEFORE INSERT OR UPDATE OF company_id, unit_id, competence_month
  ON public.billing_accounts
  FOR EACH ROW EXECUTE FUNCTION public.m39_enforce_open_billing_competence();

DROP TRIGGER IF EXISTS trg_audit_billing_accounts
  ON public.billing_accounts;
CREATE TRIGGER trg_audit_billing_accounts
  AFTER INSERT OR UPDATE OR DELETE ON public.billing_accounts
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_billing_competence_closures
  ON public.billing_competence_closures;
CREATE TRIGGER trg_audit_billing_competence_closures
  AFTER INSERT OR UPDATE OR DELETE ON public.billing_competence_closures
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE OR REPLACE FUNCTION public.m39_billing_readiness(
  p_account public.billing_accounts
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  WITH issues AS (
    SELECT issue
    FROM (
      VALUES
        (
          CASE WHEN p_account.unit_id IS NULL
            THEN jsonb_build_object('code', 'unit_missing', 'severity', 'blocking')
          END
        ),
        (
          CASE WHEN p_account.patient_id IS NULL
            THEN jsonb_build_object('code', 'patient_missing', 'severity', 'blocking')
          END
        ),
        (
          CASE WHEN p_account.competence_month IS NULL
            THEN jsonb_build_object('code', 'competence_missing', 'severity', 'blocking')
          END
        ),
        (
          CASE WHEN p_account.total_net_amount <= 0
            THEN jsonb_build_object('code', 'net_amount_invalid', 'severity', 'blocking')
          END
        ),
        (
          CASE WHEN p_account.total_paid_amount > p_account.total_net_amount
            THEN jsonb_build_object('code', 'paid_amount_exceeds_net', 'severity', 'blocking')
          END
        ),
        (
          CASE WHEN p_account.total_pending_amount
            IS DISTINCT FROM GREATEST(p_account.total_net_amount - p_account.total_paid_amount, 0)
            THEN jsonb_build_object('code', 'pending_amount_mismatch', 'severity', 'blocking')
          END
        ),
        (
          CASE WHEN p_account.billing_type = 'convenio'
            AND p_account.insurance_id IS NULL
            THEN jsonb_build_object('code', 'insurance_missing', 'severity', 'blocking')
          END
        ),
        (
          CASE WHEN p_account.billing_type = 'convenio'
            AND NULLIF(trim(COALESCE(p_account.guide_number, '')), '') IS NULL
            THEN jsonb_build_object('code', 'guide_number_missing', 'severity', 'blocking')
          END
        ),
        (
          CASE WHEN p_account.billing_type = 'convenio'
            AND NULLIF(trim(COALESCE(p_account.authorization_number, '')), '') IS NULL
            THEN jsonb_build_object('code', 'authorization_missing', 'severity', 'blocking')
          END
        ),
        (
          CASE WHEN p_account.has_denial
            THEN jsonb_build_object('code', 'denial_open', 'severity', 'blocking')
          END
        ),
        (
          CASE WHEN p_account.deleted_at IS NOT NULL
            THEN jsonb_build_object('code', 'account_deleted', 'severity', 'blocking')
          END
        )
    ) readiness(issue)
    WHERE issue IS NOT NULL
  )
  SELECT jsonb_build_object(
    'account_id', p_account.id,
    'version', p_account.version,
    'status', p_account.status,
    'issues', COALESCE(jsonb_agg(issue), '[]'::JSONB),
    'blocking_count', COUNT(*)::INTEGER,
    'can_close', COUNT(*) = 0
  )
  FROM issues
$function$;

REVOKE ALL ON FUNCTION public.m39_billing_readiness(public.billing_accounts)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m39_billing_readiness(public.billing_accounts)
  TO prontomedic_financial_rpc_owner;

CREATE OR REPLACE FUNCTION public.m39_list_billing_accounts_secure(
  p_status TEXT DEFAULT NULL,
  p_billing_type TEXT DEFAULT NULL,
  p_competence DATE DEFAULT NULL,
  p_only_pending BOOLEAN DEFAULT FALSE,
  p_limit INTEGER DEFAULT 300
) RETURNS TABLE (
  id UUID,
  patient_id BIGINT,
  patient_name TEXT,
  insurance_id BIGINT,
  billing_type TEXT,
  account_type TEXT,
  status TEXT,
  competence_month DATE,
  total_gross_amount NUMERIC,
  total_net_amount NUMERIC,
  total_paid_amount NUMERIC,
  total_pending_amount NUMERIC,
  authorization_number TEXT,
  guide_number TEXT,
  has_pending_issues BOOLEAN,
  has_denial BOOLEAN,
  is_reopened BOOLEAN,
  opened_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  version INTEGER,
  readiness JSONB
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
    RAISE EXCEPTION 'Contexto financeiro exige usuário, empresa e unidade ativas'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access('faturamento', 'view') THEN
    RAISE EXCEPTION 'Permissão de visualização do faturamento é obrigatória'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    account.id,
    account.patient_id,
    patient.full_name::TEXT,
    account.insurance_id,
    account.billing_type,
    account.account_type,
    account.status,
    account.competence_month,
    account.total_gross_amount,
    account.total_net_amount,
    account.total_paid_amount,
    account.total_pending_amount,
    account.authorization_number,
    account.guide_number,
    account.has_pending_issues,
    account.has_denial,
    account.is_reopened,
    account.opened_at,
    account.paid_at,
    account.version,
    public.m39_billing_readiness(account)
  FROM public.billing_accounts account
  LEFT JOIN public.patients patient
    ON patient.id = account.patient_id
   AND patient.company_id = account.company_id
  WHERE account.company_id = v_company_id
    AND account.unit_id = v_unit_id
    AND account.deleted_at IS NULL
    AND (p_status IS NULL OR account.status = p_status)
    AND (p_billing_type IS NULL OR account.billing_type = p_billing_type)
    AND (
      p_competence IS NULL
      OR account.competence_month = date_trunc('month', p_competence)::DATE
    )
    AND (
      NOT COALESCE(p_only_pending, FALSE)
      OR (public.m39_billing_readiness(account) ->> 'blocking_count')::INTEGER > 0
    )
  ORDER BY account.opened_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 500);
END
$function$;

CREATE OR REPLACE FUNCTION public.m39_review_billing_account_secure(
  p_account_id UUID,
  p_expected_version INTEGER,
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
  v_result JSONB;
  v_has_pending BOOLEAN;
BEGIN
  IF v_actor_id IS NULL OR v_company_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Contexto financeiro exige usuário, empresa e unidade ativas'
      USING ERRCODE = '42501';
  END IF;
  IF public.request_aal() IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 é obrigatório para revisar conta'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access('faturamento', 'edit') THEN
    RAISE EXCEPTION 'Permissão de edição do faturamento é obrigatória'
      USING ERRCODE = '42501';
  END IF;
  IF p_account_id IS NULL OR p_expected_version IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Conta, versão esperada e operação são obrigatórias';
  END IF;

  v_hash := encode(public.digest(
    convert_to(
      jsonb_build_object(
        'account_id', p_account_id,
        'expected_version', p_expected_version
      )::TEXT,
      'UTF8'
    ),
    'sha256'
  ), 'hex');

  INSERT INTO public.billing_command_operations (
    company_id, unit_id, operation_id, operation_type,
    request_hash, actor_id
  ) VALUES (
    v_company_id, v_unit_id, p_operation_id, 'review_billing_account',
    v_hash, v_actor_id
  )
  ON CONFLICT (company_id, unit_id, operation_id) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.billing_command_operations operation
  WHERE operation.company_id = v_company_id
    AND operation.unit_id = v_unit_id
    AND operation.operation_id = p_operation_id
  FOR UPDATE;

  IF v_existing.operation_type IS DISTINCT FROM 'review_billing_account'
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
  FOR UPDATE;

  IF v_account.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Versão da conta desatualizada';
  END IF;

  v_result := public.m39_billing_readiness(v_account);
  v_has_pending := (v_result ->> 'blocking_count')::INTEGER > 0;

  UPDATE public.billing_accounts
  SET
    has_pending_issues = v_has_pending,
    readiness_snapshot = v_result,
    last_reviewed_at = NOW(),
    last_reviewed_by = v_actor_id,
    status = CASE
      WHEN v_has_pending
       AND status IN (
         'aberta', 'em_montagem', 'aguardando_documentos',
         'aguardando_autorizacao', 'aguardando_laudo',
         'aguardando_assinatura', 'aguardando_conferencia',
         'em_auditoria', 'reaberta'
       ) THEN 'com_pendencia'
      WHEN NOT v_has_pending AND status = 'com_pendencia' THEN 'em_montagem'
      ELSE status
    END,
    version = version + 1,
    updated_at = NOW()
  WHERE id = v_account.id
  RETURNING * INTO v_account;

  v_result := public.m39_billing_readiness(v_account);

  UPDATE public.billing_command_operations
  SET result_payload = v_result, completed_at = NOW()
  WHERE company_id = v_company_id
    AND unit_id = v_unit_id
    AND operation_id = p_operation_id;

  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.m39_reopen_billing_account_secure(
  p_account_id UUID,
  p_reason TEXT,
  p_expected_version INTEGER,
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
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_hash TEXT;
  v_existing public.billing_command_operations%ROWTYPE;
  v_account public.billing_accounts%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL OR v_company_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Contexto financeiro exige usuário, empresa e unidade ativas'
      USING ERRCODE = '42501';
  END IF;
  IF public.request_aal() IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 é obrigatório para reabrir conta'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access('faturamento', 'edit') THEN
    RAISE EXCEPTION 'Permissão de edição do faturamento é obrigatória'
      USING ERRCODE = '42501';
  END IF;
  IF p_account_id IS NULL OR p_expected_version IS NULL
     OR p_operation_id IS NULL OR v_reason IS NULL THEN
    RAISE EXCEPTION 'Conta, motivo, versão esperada e operação são obrigatórios';
  END IF;

  v_hash := encode(public.digest(
    convert_to(
      jsonb_build_object(
        'account_id', p_account_id,
        'reason', v_reason,
        'expected_version', p_expected_version
      )::TEXT,
      'UTF8'
    ),
    'sha256'
  ), 'hex');

  INSERT INTO public.billing_command_operations (
    company_id, unit_id, operation_id, operation_type,
    request_hash, actor_id
  ) VALUES (
    v_company_id, v_unit_id, p_operation_id, 'reopen_billing_account',
    v_hash, v_actor_id
  )
  ON CONFLICT (company_id, unit_id, operation_id) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.billing_command_operations operation
  WHERE operation.company_id = v_company_id
    AND operation.unit_id = v_unit_id
    AND operation.operation_id = p_operation_id
  FOR UPDATE;

  IF v_existing.operation_type IS DISTINCT FROM 'reopen_billing_account'
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
  FOR UPDATE;

  IF v_account.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Versão da conta desatualizada';
  END IF;
  IF v_account.status NOT IN ('pronta_envio', 'baixada', 'cancelada') THEN
    RAISE EXCEPTION 'Estado % não permite reabertura simples', v_account.status;
  END IF;

  UPDATE public.billing_accounts
  SET
    status = 'reaberta',
    is_reopened = TRUE,
    version = version + 1,
    updated_at = NOW(),
    readiness_snapshot = readiness_snapshot || jsonb_build_object(
      'reopen_reason', v_reason,
      'reopened_at', NOW(),
      'reopened_by', v_actor_id
    )
  WHERE id = v_account.id
  RETURNING jsonb_build_object(
    'account_id', id,
    'status', status,
    'version', version,
    'is_reopened', is_reopened,
    'reason', v_reason
  ) INTO v_result;

  UPDATE public.billing_command_operations
  SET result_payload = v_result, completed_at = NOW()
  WHERE company_id = v_company_id
    AND unit_id = v_unit_id
    AND operation_id = p_operation_id;

  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.m39_list_billing_competences_secure(
  p_limit INTEGER DEFAULT 120
) RETURNS TABLE (
  id UUID,
  competence_month DATE,
  status TEXT,
  version INTEGER,
  closed_at TIMESTAMPTZ,
  closed_by UUID,
  close_reason TEXT,
  reopened_at TIMESTAMPTZ,
  reopened_by UUID,
  reopen_reason TEXT,
  account_count INTEGER,
  account_ids UUID[],
  updated_at TIMESTAMPTZ
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
    RAISE EXCEPTION 'Contexto financeiro exige usuário, empresa e unidade ativas'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access('faturamento', 'view') THEN
    RAISE EXCEPTION 'Permissão de visualização do faturamento é obrigatória'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH account_months AS (
    SELECT
      account.competence_month,
      count(*)::INTEGER AS account_count,
      array_agg(account.id ORDER BY account.id)::UUID[] AS account_ids,
      max(account.updated_at) AS updated_at
    FROM public.billing_accounts account
    WHERE account.company_id = v_company_id
      AND account.unit_id = v_unit_id
      AND account.competence_month IS NOT NULL
    GROUP BY account.competence_month
  ),
  available_months AS (
    SELECT month.competence_month
    FROM account_months month
    UNION
    SELECT closure.competence_month
    FROM public.billing_competence_closures closure
    WHERE closure.company_id = v_company_id
      AND closure.unit_id = v_unit_id
  )
  SELECT
    closure.id,
    available.competence_month,
    COALESCE(closure.status, 'open'::TEXT),
    COALESCE(closure.version, 1),
    closure.closed_at,
    closure.closed_by,
    closure.close_reason,
    closure.reopened_at,
    closure.reopened_by,
    closure.reopen_reason,
    COALESCE(month.account_count, closure.account_count, 0),
    COALESCE(month.account_ids, closure.account_ids, ARRAY[]::UUID[]),
    COALESCE(closure.updated_at, month.updated_at, NOW())
  FROM available_months available
  LEFT JOIN account_months month
    ON month.competence_month = available.competence_month
  LEFT JOIN public.billing_competence_closures closure
    ON closure.company_id = v_company_id
   AND closure.unit_id = v_unit_id
   AND closure.competence_month = available.competence_month
  ORDER BY available.competence_month DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 120), 1), 240);
END
$function$;

CREATE OR REPLACE FUNCTION public.m39_close_billing_competence_secure(
  p_competence DATE,
  p_reason TEXT,
  p_expected_version INTEGER,
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
  v_competence DATE;
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_hash TEXT;
  v_existing public.billing_command_operations%ROWTYPE;
  v_closure public.billing_competence_closures%ROWTYPE;
  v_blocking_count INTEGER;
  v_account_ids UUID[];
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL OR v_company_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Contexto financeiro exige usuário, empresa e unidade ativas'
      USING ERRCODE = '42501';
  END IF;
  IF public.request_aal() IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 é obrigatório para fechar competência'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access('faturamento', 'edit') THEN
    RAISE EXCEPTION 'Permissão de edição do faturamento é obrigatória'
      USING ERRCODE = '42501';
  END IF;
  IF p_competence IS NULL OR p_expected_version IS NULL
     OR p_operation_id IS NULL OR v_reason IS NULL THEN
    RAISE EXCEPTION 'Competência, motivo, versão esperada e operação são obrigatórios';
  END IF;
  v_competence := date_trunc('month', p_competence)::DATE;
  IF p_competence IS DISTINCT FROM v_competence THEN
    RAISE EXCEPTION 'Competência deve ser o primeiro dia do mês';
  END IF;

  v_hash := encode(public.digest(
    convert_to(
      jsonb_build_object(
        'competence', v_competence,
        'reason', v_reason,
        'expected_version', p_expected_version
      )::TEXT,
      'UTF8'
    ),
    'sha256'
  ), 'hex');

  INSERT INTO public.billing_command_operations (
    company_id, unit_id, operation_id, operation_type,
    request_hash, actor_id
  ) VALUES (
    v_company_id, v_unit_id, p_operation_id, 'close_billing_competence',
    v_hash, v_actor_id
  )
  ON CONFLICT (company_id, unit_id, operation_id) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.billing_command_operations operation
  WHERE operation.company_id = v_company_id
    AND operation.unit_id = v_unit_id
    AND operation.operation_id = p_operation_id
  FOR UPDATE;

  IF v_existing.operation_type IS DISTINCT FROM 'close_billing_competence'
     OR v_existing.request_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Chave de idempotência reutilizada com outro conteúdo';
  END IF;
  IF v_existing.completed_at IS NOT NULL THEN
    RETURN v_existing.result_payload;
  END IF;

  INSERT INTO public.billing_competence_closures (
    company_id, unit_id, competence_month
  ) VALUES (
    v_company_id, v_unit_id, v_competence
  )
  ON CONFLICT (company_id, unit_id, competence_month) DO NOTHING;

  SELECT * INTO STRICT v_closure
  FROM public.billing_competence_closures closure
  WHERE closure.company_id = v_company_id
    AND closure.unit_id = v_unit_id
    AND closure.competence_month = v_competence
  FOR UPDATE;

  IF v_closure.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Versão da competência desatualizada';
  END IF;
  IF v_closure.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Competência já está fechada';
  END IF;

  SELECT
    COUNT(*) FILTER (
      WHERE (public.m39_billing_readiness(account) ->> 'blocking_count')::INTEGER > 0
         OR account.status IN (
           'aberta', 'em_montagem', 'com_pendencia',
           'aguardando_documentos', 'aguardando_autorizacao',
           'aguardando_laudo', 'aguardando_assinatura',
           'aguardando_conferencia', 'em_auditoria', 'reaberta',
           'particular_pendente'
         )
    )::INTEGER,
    COALESCE(array_agg(account.id ORDER BY account.id), ARRAY[]::UUID[])
  INTO v_blocking_count, v_account_ids
  FROM public.billing_accounts account
  WHERE account.company_id = v_company_id
    AND account.unit_id = v_unit_id
    AND account.competence_month = v_competence
    AND account.deleted_at IS NULL;

  IF COALESCE(v_blocking_count, 0) > 0 THEN
    RAISE EXCEPTION 'Competência possui % conta(s) bloqueadora(s)', v_blocking_count;
  END IF;
  IF cardinality(v_account_ids) = 0 THEN
    RAISE EXCEPTION 'Competência sem contas não pode ser fechada';
  END IF;

  UPDATE public.billing_competence_closures
  SET
    status = 'closed',
    version = version + 1,
    closed_at = NOW(),
    closed_by = v_actor_id,
    close_reason = v_reason,
    account_count = cardinality(v_account_ids),
    account_ids = v_account_ids,
    updated_at = NOW()
  WHERE id = v_closure.id
  RETURNING jsonb_build_object(
    'id', id,
    'competence_month', competence_month,
    'status', status,
    'version', version,
    'account_count', account_count,
    'account_ids', account_ids
  ) INTO v_result;

  UPDATE public.billing_command_operations
  SET result_payload = v_result, completed_at = NOW()
  WHERE company_id = v_company_id
    AND unit_id = v_unit_id
    AND operation_id = p_operation_id;

  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.m39_reopen_billing_competence_secure(
  p_competence DATE,
  p_reason TEXT,
  p_expected_version INTEGER,
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
  v_competence DATE;
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_hash TEXT;
  v_existing public.billing_command_operations%ROWTYPE;
  v_closure public.billing_competence_closures%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL OR v_company_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Contexto financeiro exige usuário, empresa e unidade ativas'
      USING ERRCODE = '42501';
  END IF;
  IF public.request_aal() IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 é obrigatório para reabrir competência'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access('faturamento', 'edit') THEN
    RAISE EXCEPTION 'Permissão de edição do faturamento é obrigatória'
      USING ERRCODE = '42501';
  END IF;
  IF p_competence IS NULL OR p_expected_version IS NULL
     OR p_operation_id IS NULL OR v_reason IS NULL THEN
    RAISE EXCEPTION 'Competência, motivo, versão esperada e operação são obrigatórios';
  END IF;
  v_competence := date_trunc('month', p_competence)::DATE;
  IF p_competence IS DISTINCT FROM v_competence THEN
    RAISE EXCEPTION 'Competência deve ser o primeiro dia do mês';
  END IF;

  v_hash := encode(public.digest(
    convert_to(
      jsonb_build_object(
        'competence', v_competence,
        'reason', v_reason,
        'expected_version', p_expected_version
      )::TEXT,
      'UTF8'
    ),
    'sha256'
  ), 'hex');

  INSERT INTO public.billing_command_operations (
    company_id, unit_id, operation_id, operation_type,
    request_hash, actor_id
  ) VALUES (
    v_company_id, v_unit_id, p_operation_id, 'reopen_billing_competence',
    v_hash, v_actor_id
  )
  ON CONFLICT (company_id, unit_id, operation_id) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.billing_command_operations operation
  WHERE operation.company_id = v_company_id
    AND operation.unit_id = v_unit_id
    AND operation.operation_id = p_operation_id
  FOR UPDATE;

  IF v_existing.operation_type IS DISTINCT FROM 'reopen_billing_competence'
     OR v_existing.request_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Chave de idempotência reutilizada com outro conteúdo';
  END IF;
  IF v_existing.completed_at IS NOT NULL THEN
    RETURN v_existing.result_payload;
  END IF;

  SELECT * INTO STRICT v_closure
  FROM public.billing_competence_closures closure
  WHERE closure.company_id = v_company_id
    AND closure.unit_id = v_unit_id
    AND closure.competence_month = v_competence
  FOR UPDATE;

  IF v_closure.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Versão da competência desatualizada';
  END IF;
  IF v_closure.status IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION 'Somente competência fechada pode ser reaberta';
  END IF;

  UPDATE public.billing_competence_closures
  SET
    status = 'open',
    version = version + 1,
    reopened_at = NOW(),
    reopened_by = v_actor_id,
    reopen_reason = v_reason,
    updated_at = NOW()
  WHERE id = v_closure.id
  RETURNING jsonb_build_object(
    'id', id,
    'competence_month', competence_month,
    'status', status,
    'version', version,
    'reason', v_reason
  ) INTO v_result;

  UPDATE public.billing_command_operations
  SET result_payload = v_result, completed_at = NOW()
  WHERE company_id = v_company_id
    AND unit_id = v_unit_id
    AND operation_id = p_operation_id;

  RETURN v_result;
END
$function$;

ALTER FUNCTION public.m39_list_billing_accounts_secure(
  TEXT, TEXT, DATE, BOOLEAN, INTEGER
) OWNER TO prontomedic_financial_rpc_owner;
ALTER FUNCTION public.m39_review_billing_account_secure(
  UUID, INTEGER, UUID
) OWNER TO prontomedic_financial_rpc_owner;
ALTER FUNCTION public.m39_reopen_billing_account_secure(
  UUID, TEXT, INTEGER, UUID
) OWNER TO prontomedic_financial_rpc_owner;
ALTER FUNCTION public.m39_list_billing_competences_secure(INTEGER)
  OWNER TO prontomedic_financial_rpc_owner;
ALTER FUNCTION public.m39_close_billing_competence_secure(
  DATE, TEXT, INTEGER, UUID
) OWNER TO prontomedic_financial_rpc_owner;
ALTER FUNCTION public.m39_reopen_billing_competence_secure(
  DATE, TEXT, INTEGER, UUID
) OWNER TO prontomedic_financial_rpc_owner;

REVOKE ALL ON FUNCTION public.m39_list_billing_accounts_secure(
  TEXT, TEXT, DATE, BOOLEAN, INTEGER
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m39_review_billing_account_secure(
  UUID, INTEGER, UUID
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m39_reopen_billing_account_secure(
  UUID, TEXT, INTEGER, UUID
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m39_list_billing_competences_secure(INTEGER)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m39_close_billing_competence_secure(
  DATE, TEXT, INTEGER, UUID
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m39_reopen_billing_competence_secure(
  DATE, TEXT, INTEGER, UUID
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.m39_list_billing_accounts_secure(
  TEXT, TEXT, DATE, BOOLEAN, INTEGER
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m39_review_billing_account_secure(
  UUID, INTEGER, UUID
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m39_reopen_billing_account_secure(
  UUID, TEXT, INTEGER, UUID
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m39_list_billing_competences_secure(INTEGER)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m39_close_billing_competence_secure(
  DATE, TEXT, INTEGER, UUID
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m39_reopen_billing_competence_secure(
  DATE, TEXT, INTEGER, UUID
) TO authenticated, app_prontomedic;

COMMENT ON TABLE public.billing_competence_closures IS
  'Canonical tenant and unit scoped operational closure for billing competences.';
COMMENT ON TABLE public.billing_command_operations IS
  'Private idempotency ledger for Module 39 billing account commands.';
COMMENT ON FUNCTION public.m39_review_billing_account_secure(UUID, INTEGER, UUID) IS
  'Recomputes billing readiness from canonical billing account fields with optimistic locking.';
COMMENT ON FUNCTION public.m39_reopen_billing_account_secure(UUID, TEXT, INTEGER, UUID) IS
  'Reopens only safe billing states without changing payments, TISS XML or denials.';
COMMENT ON FUNCTION public.m39_close_billing_competence_secure(DATE, TEXT, INTEGER, UUID) IS
  'Closes a competence only when every scoped billing account is operationally ready.';

COMMIT;

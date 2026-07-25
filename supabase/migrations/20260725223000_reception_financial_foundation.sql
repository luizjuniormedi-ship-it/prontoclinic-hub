-- =============================================================================
-- ProntoMedic — Fundação financeira e documental da Recepção
--
-- Responsabilidades:
--   * Recepção prepara a pré-conta, registra responsabilidade por pagador,
--     emite a guia individual e recebe a parcela devida pelo paciente.
--   * Faturamento completa e fecha a conta assistencial.
--   * Financeiro controla títulos, caixa, adquirentes e conciliação.
--
-- Esta migration não reutiliza tiss_xml como guia individual. tiss_xml permanece
-- reservado ao intercâmbio/lote; reception_tiss_guides guarda o documento da
-- jornada do paciente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.touch_reception_financial_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.active_role_name()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT lower(r.name)
  FROM public.user_access_context ctx
  JOIN public.memberships m
    ON m.id = ctx.membership_id
   AND m.user_id = ctx.user_id
   AND m.status = 'active'
  JOIN public.membership_roles mr
    ON mr.membership_id = ctx.membership_id
   AND mr.role_id = ctx.role_id
  JOIN public.roles r
    ON r.id = ctx.role_id
   AND r.lg_ativo = TRUE
  WHERE ctx.user_id = auth.uid()
    AND ctx.session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
    AND public.request_aal() = 'aal2'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.active_role_name() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.active_role_name() TO authenticated;

-- -----------------------------------------------------------------------------
-- Conta assistencial canônica
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_accounts (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id),
  patient_id BIGINT NOT NULL REFERENCES public.patients(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  professional_id BIGINT REFERENCES public.professionals(id),
  insurance_id INTEGER REFERENCES public.insurance_companies(id),
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id),
  billing_type VARCHAR(24) NOT NULL DEFAULT 'particular'
    CHECK (billing_type IN ('particular','convenio','misto','pacote','cortesia','empresa')),
  account_type VARCHAR(30) NOT NULL DEFAULT 'ambulatorial'
    CHECK (account_type IN ('ambulatorial','hospitalar','cirurgica','telemedicina','laboratorial','imagem')),
  status VARCHAR(40) NOT NULL DEFAULT 'aberta'
    CHECK (status IN (
      'aberta','em_montagem','aguardando_documentos','aguardando_autorizacao',
      'aguardando_laudo','aguardando_assinatura','aguardando_conferencia',
      'em_auditoria','com_pendencia','pronta_envio','enviada','em_analise',
      'paga','parcialmente_paga','glosada','em_recurso','recurso_aceito',
      'recurso_negado','baixada','cancelada','reaberta','particular_paga',
      'particular_pendente','inadimplente'
    )),
  collection_policy VARCHAR(30) NOT NULL DEFAULT 'before_checkin'
    CHECK (collection_policy IN ('before_checkin','accounts_receivable','waived')),
  competence_month VARCHAR(7),
  total_gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_gross_amount >= 0),
  total_discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_discount_amount >= 0),
  total_copay_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_copay_amount >= 0),
  patient_responsibility_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (patient_responsibility_amount >= 0),
  insurance_responsibility_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (insurance_responsibility_amount >= 0),
  total_net_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_net_amount >= 0),
  total_paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_paid_amount >= 0),
  total_pending_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_pending_amount >= 0),
  authorization_number VARCHAR(120),
  guide_number VARCHAR(120),
  has_pending_issues BOOLEAN NOT NULL DEFAULT FALSE,
  has_denial BOOLEAN NOT NULL DEFAULT FALSE,
  is_reopened BOOLEAN NOT NULL DEFAULT FALSE,
  reopened_reason TEXT,
  payer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  price_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_module VARCHAR(50) NOT NULL DEFAULT 'reception',
  source_record_id TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.user_profiles(id),
  updated_by UUID REFERENCES public.user_profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT billing_accounts_source_unique UNIQUE (company_id, source_module, source_record_id),
  CONSTRAINT billing_accounts_responsibility_chk CHECK (
    abs((patient_responsibility_amount + insurance_responsibility_amount) - total_net_amount) <= 0.01
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_accounts_appointment_unique
  ON public.billing_accounts(company_id, appointment_id)
  WHERE appointment_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS billing_accounts_patient_idx
  ON public.billing_accounts(company_id, patient_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS billing_accounts_status_idx
  ON public.billing_accounts(company_id, unit_id, status, opened_at DESC);

DROP TRIGGER IF EXISTS trg_billing_accounts_updated_at ON public.billing_accounts;
CREATE TRIGGER trg_billing_accounts_updated_at
BEFORE UPDATE ON public.billing_accounts
FOR EACH ROW EXECUTE FUNCTION public.touch_reception_financial_updated_at();

CREATE TABLE IF NOT EXISTS public.billing_account_items (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  billing_account_id BIGINT NOT NULL REFERENCES public.billing_accounts(id) ON DELETE CASCADE,
  source_module VARCHAR(50) NOT NULL,
  source_record_id TEXT NOT NULL,
  item_type VARCHAR(40) NOT NULL,
  service_id BIGINT REFERENCES public.services_catalog(id),
  procedure_code VARCHAR(80),
  description VARCHAR(300) NOT NULL,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  net_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
  patient_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (patient_amount >= 0),
  insurance_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (insurance_amount >= 0),
  status VARCHAR(30) NOT NULL DEFAULT 'capturado'
    CHECK (status IN ('previsto','capturado','confirmado','cancelado','estornado')),
  execution_date DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_item_source_unique
    UNIQUE (billing_account_id, source_module, source_record_id, item_type),
  CONSTRAINT billing_item_responsibility_chk CHECK (
    abs((patient_amount + insurance_amount) - net_amount) <= 0.01
  )
);

CREATE INDEX IF NOT EXISTS billing_account_items_account_idx
  ON public.billing_account_items(billing_account_id, status, created_at);
DROP TRIGGER IF EXISTS trg_billing_account_items_updated_at ON public.billing_account_items;
CREATE TRIGGER trg_billing_account_items_updated_at
BEFORE UPDATE ON public.billing_account_items
FOR EACH ROW EXECUTE FUNCTION public.touch_reception_financial_updated_at();

CREATE TABLE IF NOT EXISTS public.billing_pending_issues (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  billing_account_id BIGINT NOT NULL REFERENCES public.billing_accounts(id) ON DELETE CASCADE,
  issue_code VARCHAR(80) NOT NULL,
  issue_label TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'blocking'
    CHECK (severity IN ('warning','blocking')),
  source_module VARCHAR(50),
  source_record_id TEXT,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_pending_issue_unique
    UNIQUE (billing_account_id, issue_code, source_module, source_record_id)
);

CREATE INDEX IF NOT EXISTS billing_pending_issues_open_idx
  ON public.billing_pending_issues(billing_account_id, resolved, severity);

CREATE TABLE IF NOT EXISTS public.billing_competencies (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  competence_month VARCHAR(7) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','fechada','reaberta')),
  receita_prevista NUMERIC(16,2) NOT NULL DEFAULT 0,
  receita_realizada NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_glosado NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_pendente NUMERIC(16,2) NOT NULL DEFAULT 0,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, competence_month)
);

DROP TRIGGER IF EXISTS trg_billing_competencies_updated_at ON public.billing_competencies;
CREATE TRIGGER trg_billing_competencies_updated_at
BEFORE UPDATE ON public.billing_competencies
FOR EACH ROW EXECUTE FUNCTION public.touch_reception_financial_updated_at();

-- -----------------------------------------------------------------------------
-- Contas a receber, pagamentos e conciliação
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id),
  patient_id BIGINT REFERENCES public.patients(id),
  billing_account_id BIGINT REFERENCES public.billing_accounts(id),
  billing_id BIGINT REFERENCES public.billing_accounts(id),
  professional_id BIGINT REFERENCES public.professionals(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  parent_transaction_id BIGINT REFERENCES public.financial_transactions(id),
  transaction_type VARCHAR(30) NOT NULL
    CHECK (transaction_type IN ('receivable','payment','refund','acquirer_receivable','adjustment')),
  payer_type VARCHAR(24) NOT NULL DEFAULT 'patient'
    CHECK (payer_type IN ('patient','insurance','acquirer','company','other')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  discount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  payment_method VARCHAR(30),
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','open','partial','authorized','captured','confirmed','paid','overdue','cancelled','refunded','reconciled','failed')),
  due_date DATE,
  payment_date DATE,
  external_reference VARCHAR(180),
  installment_number INTEGER CHECK (installment_number IS NULL OR installment_number > 0),
  installment_count INTEGER CHECK (installment_count IS NULL OR installment_count > 0),
  idempotency_key VARCHAR(180) NOT NULL,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_transactions_idempotency_unique UNIQUE (company_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS financial_transactions_account_idx
  ON public.financial_transactions(billing_account_id, transaction_type, status, created_at);
CREATE INDEX IF NOT EXISTS financial_transactions_due_idx
  ON public.financial_transactions(company_id, unit_id, status, due_date);
DROP TRIGGER IF EXISTS trg_financial_transactions_updated_at ON public.financial_transactions;
CREATE TRIGGER trg_financial_transactions_updated_at
BEFORE UPDATE ON public.financial_transactions
FOR EACH ROW EXECUTE FUNCTION public.touch_reception_financial_updated_at();

CREATE TABLE IF NOT EXISTS public.financial_transaction_allocations (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payment_transaction_id BIGINT NOT NULL REFERENCES public.financial_transactions(id) ON DELETE RESTRICT,
  receivable_transaction_id BIGINT NOT NULL REFERENCES public.financial_transactions(id) ON DELETE RESTRICT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_transaction_id, receivable_transaction_id)
);

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES public.units(id),
  opened_by UUID NOT NULL REFERENCES public.user_profiles(id),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  closing_balance NUMERIC(14,2),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES public.user_profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_open_user_unit_unique
  ON public.cash_sessions(company_id, unit_id, opened_by)
  WHERE status = 'open';
DROP TRIGGER IF EXISTS trg_cash_sessions_updated_at ON public.cash_sessions;
CREATE TRIGGER trg_cash_sessions_updated_at
BEFORE UPDATE ON public.cash_sessions
FOR EACH ROW EXECUTE FUNCTION public.touch_reception_financial_updated_at();

CREATE TABLE IF NOT EXISTS public.cash_movements (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES public.units(id),
  cash_session_id BIGINT NOT NULL REFERENCES public.cash_sessions(id) ON DELETE RESTRICT,
  financial_transaction_id BIGINT REFERENCES public.financial_transactions(id) ON DELETE RESTRICT,
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('receipt','refund','supply','withdrawal','adjustment')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reason TEXT,
  created_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cash_movements_session_idx
  ON public.cash_movements(cash_session_id, created_at);

-- -----------------------------------------------------------------------------
-- Versionamento e guia TISS individual
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tiss_schema_versions (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  scope VARCHAR(30) NOT NULL CHECK (scope IN ('prestador_operadora','operadora_ans')),
  version VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
  effective_from DATE NOT NULL,
  effective_until DATE,
  source_reference TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, scope, version),
  CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

DROP TRIGGER IF EXISTS trg_tiss_schema_versions_updated_at ON public.tiss_schema_versions;
CREATE TRIGGER trg_tiss_schema_versions_updated_at
BEFORE UPDATE ON public.tiss_schema_versions
FOR EACH ROW EXECUTE FUNCTION public.touch_reception_financial_updated_at();

-- Referências vigentes publicadas pela ANS em 2026. Permanecem configuráveis e
-- versionadas por empresa; futuras versões entram por nova configuração/migration.
INSERT INTO public.tiss_schema_versions (
  company_id, scope, version, status, effective_from, source_reference, metadata
)
SELECT c.id, 'prestador_operadora', '04.03.00', 'active', DATE '2026-04-01',
       'ANS — Padrão TISS Março/2026',
       jsonb_build_object('component', 'comunicacao', 'configured_by', 'migration_20260725223000')
FROM public.companies c
ON CONFLICT (company_id, scope, version) DO NOTHING;

INSERT INTO public.tiss_schema_versions (
  company_id, scope, version, status, effective_from, source_reference, metadata
)
SELECT c.id, 'operadora_ans', '01.06.00', 'active', DATE '2026-04-01',
       'ANS — Padrão TISS Março/2026',
       jsonb_build_object('component', 'comunicacao', 'configured_by', 'migration_20260725223000')
FROM public.companies c
ON CONFLICT (company_id, scope, version) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_tiss_versions_for_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.tiss_schema_versions (
    company_id, scope, version, status, effective_from, source_reference, metadata
  ) VALUES
    (NEW.id, 'prestador_operadora', '04.03.00', 'active', DATE '2026-04-01',
     'ANS — Padrão TISS Março/2026', '{"component":"comunicacao","configured_by":"company_trigger"}'::jsonb),
    (NEW.id, 'operadora_ans', '01.06.00', 'active', DATE '2026-04-01',
     'ANS — Padrão TISS Março/2026', '{"component":"comunicacao","configured_by":"company_trigger"}'::jsonb)
  ON CONFLICT (company_id, scope, version) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_tiss_versions_for_company ON public.companies;
CREATE TRIGGER trg_seed_tiss_versions_for_company
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.seed_tiss_versions_for_company();

CREATE TABLE IF NOT EXISTS public.reception_tiss_guides (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id),
  patient_id BIGINT NOT NULL REFERENCES public.patients(id),
  appointment_id BIGINT NOT NULL REFERENCES public.appointments(id),
  billing_account_id BIGINT NOT NULL REFERENCES public.billing_accounts(id),
  insurance_id INTEGER NOT NULL REFERENCES public.insurance_companies(id),
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id),
  tiss_version_id BIGINT NOT NULL REFERENCES public.tiss_schema_versions(id),
  tiss_version VARCHAR(30) NOT NULL,
  guide_type VARCHAR(30) NOT NULL
    CHECK (guide_type IN ('consulta','sp_sadt','internacao','honorario','outras_despesas')),
  guide_number VARCHAR(120),
  main_guide_number VARCHAR(120),
  status VARCHAR(24) NOT NULL DEFAULT 'generated'
    CHECK (status IN ('draft','generated','validated','signed','cancelled','replaced')),
  requires_signature BOOLEAN NOT NULL DEFAULT TRUE,
  authorization_number VARCHAR(120),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  payload_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  signature_method VARCHAR(30),
  patient_signed_at TIMESTAMPTZ,
  professional_signed_at TIMESTAMPTZ,
  signed_by UUID REFERENCES public.user_profiles(id),
  replaced_by_guide_id BIGINT REFERENCES public.reception_tiss_guides(id),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_by UUID REFERENCES public.user_profiles(id),
  updated_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS reception_tiss_guides_active_unique
  ON public.reception_tiss_guides(company_id, appointment_id, guide_type)
  WHERE status NOT IN ('cancelled','replaced');
CREATE INDEX IF NOT EXISTS reception_tiss_guides_account_idx
  ON public.reception_tiss_guides(billing_account_id, status, created_at DESC);
DROP TRIGGER IF EXISTS trg_reception_tiss_guides_updated_at ON public.reception_tiss_guides;
CREATE TRIGGER trg_reception_tiss_guides_updated_at
BEFORE UPDATE ON public.reception_tiss_guides
FOR EACH ROW EXECUTE FUNCTION public.touch_reception_financial_updated_at();

ALTER TABLE public.reception_checkins
  ADD COLUMN IF NOT EXISTS billing_account_id BIGINT REFERENCES public.billing_accounts(id),
  ADD COLUMN IF NOT EXISTS tiss_guide_id BIGINT REFERENCES public.reception_tiss_guides(id),
  ADD COLUMN IF NOT EXISTS payer_type VARCHAR(24),
  ADD COLUMN IF NOT EXISTS patient_due_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS patient_paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_tiss_guide BOOLEAN NOT NULL DEFAULT FALSE;

-- -----------------------------------------------------------------------------
-- Views consumidas pelo módulo de faturamento
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_billing_receita_convenio
WITH (security_invoker = TRUE) AS
SELECT
  COALESCE(ic.name, 'Particular') AS convenio,
  COUNT(*)::BIGINT AS contas,
  COALESCE(SUM(ba.total_net_amount), 0)::NUMERIC(16,2) AS valor_faturado,
  COALESCE(SUM(ba.total_paid_amount), 0)::NUMERIC(16,2) AS valor_recebido,
  COALESCE(SUM(GREATEST(ba.total_net_amount - ba.total_paid_amount, 0)), 0)::NUMERIC(16,2) AS valor_aberto
FROM public.billing_accounts ba
LEFT JOIN public.insurance_companies ic ON ic.id = ba.insurance_id
WHERE ba.deleted_at IS NULL
GROUP BY COALESCE(ic.name, 'Particular');

CREATE OR REPLACE VIEW public.v_billing_receita_mensal
WITH (security_invoker = TRUE) AS
SELECT
  COALESCE(ba.competence_month, to_char(ba.opened_at, 'YYYY-MM')) AS competence_month,
  COUNT(*)::BIGINT AS contas,
  COALESCE(SUM(ba.total_net_amount), 0)::NUMERIC(16,2) AS faturado,
  COALESCE(SUM(ba.total_paid_amount), 0)::NUMERIC(16,2) AS recebido,
  0::NUMERIC(16,2) AS glosado,
  CASE WHEN SUM(ba.total_net_amount) > 0
    THEN ROUND((SUM(ba.total_paid_amount) / SUM(ba.total_net_amount)) * 100, 2)
    ELSE NULL
  END AS pct_recebido
FROM public.billing_accounts ba
WHERE ba.deleted_at IS NULL
GROUP BY COALESCE(ba.competence_month, to_char(ba.opened_at, 'YYYY-MM'));

CREATE OR REPLACE VIEW public.v_billing_indicadores
WITH (security_invoker = TRUE) AS
SELECT
  COUNT(*)::NUMERIC AS total_contas,
  COALESCE(SUM(total_net_amount), 0)::NUMERIC AS total_faturado,
  COALESCE(SUM(total_paid_amount), 0)::NUMERIC AS total_recebido,
  COALESCE(SUM(total_pending_amount), 0)::NUMERIC AS total_pendente,
  COUNT(*) FILTER (WHERE has_pending_issues)::NUMERIC AS contas_com_pendencia
FROM public.billing_accounts
WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Glosa preventiva mínima da conta
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_check_pending(p_account_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account public.billing_accounts;
  v_count INTEGER;
BEGIN
  SELECT * INTO v_account
  FROM public.billing_accounts
  WHERE id = p_account_id
    AND company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta não encontrada no contexto ativo' USING ERRCODE = '42501';
  END IF;

  UPDATE public.billing_pending_issues
     SET resolved = TRUE,
         resolved_at = NOW(),
         resolved_by = auth.uid()
   WHERE billing_account_id = v_account.id
     AND resolved = FALSE
     AND source_module = 'automatic_check';

  IF NOT EXISTS (
    SELECT 1 FROM public.billing_account_items
    WHERE billing_account_id = v_account.id AND status <> 'cancelado'
  ) THEN
    INSERT INTO public.billing_pending_issues (
      company_id, billing_account_id, issue_code, issue_label, severity,
      source_module, source_record_id
    ) VALUES (
      v_account.company_id, v_account.id, 'NO_ITEMS',
      'Conta sem itens faturáveis confirmados.', 'blocking',
      'automatic_check', v_account.id::TEXT
    ) ON CONFLICT (billing_account_id, issue_code, source_module, source_record_id)
      DO UPDATE SET resolved = FALSE, resolved_at = NULL, resolved_by = NULL;
  END IF;

  IF v_account.billing_type IN ('convenio','misto') AND v_account.guide_number IS NULL THEN
    INSERT INTO public.billing_pending_issues (
      company_id, billing_account_id, issue_code, issue_label, severity,
      source_module, source_record_id
    ) VALUES (
      v_account.company_id, v_account.id, 'TISS_GUIDE_MISSING',
      'Guia TISS ainda não vinculada à conta.', 'blocking',
      'automatic_check', v_account.id::TEXT
    ) ON CONFLICT (billing_account_id, issue_code, source_module, source_record_id)
      DO UPDATE SET resolved = FALSE, resolved_at = NULL, resolved_by = NULL;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.billing_pending_issues
  WHERE billing_account_id = v_account.id
    AND resolved = FALSE;

  UPDATE public.billing_accounts
     SET has_pending_issues = v_count > 0,
         status = CASE WHEN v_count > 0 THEN 'com_pendencia' ELSE status END,
         updated_by = auth.uid()
   WHERE id = v_account.id;

  RETURN v_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- Auditoria
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'billing_accounts','billing_account_items','billing_pending_issues',
    'billing_competencies','financial_transactions','financial_transaction_allocations',
    'cash_sessions','cash_movements','tiss_schema_versions','reception_tiss_guides'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_audit_' || table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func()',
      'trg_audit_' || table_name,
      table_name
    );
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- RLS: leitura no contexto ativo; mutações operacionais preferencialmente via RPC.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'billing_accounts','billing_account_items','billing_pending_issues',
    'billing_competencies','financial_transactions','financial_transaction_allocations',
    'cash_sessions','cash_movements','tiss_schema_versions','reception_tiss_guides'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_select_context', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id = public.active_company_id())',
      table_name || '_select_context',
      table_name
    );
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS billing_accounts_update_authorized ON public.billing_accounts;
CREATE POLICY billing_accounts_update_authorized
ON public.billing_accounts FOR UPDATE TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.active_role_name() IN ('admin','administrador','gestor','financeiro')
)
WITH CHECK (company_id = public.active_company_id());

DROP POLICY IF EXISTS billing_pending_issues_update_authorized ON public.billing_pending_issues;
CREATE POLICY billing_pending_issues_update_authorized
ON public.billing_pending_issues FOR UPDATE TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.active_role_name() IN ('admin','administrador','gestor','financeiro')
)
WITH CHECK (company_id = public.active_company_id());

DROP POLICY IF EXISTS billing_competencies_update_authorized ON public.billing_competencies;
CREATE POLICY billing_competencies_update_authorized
ON public.billing_competencies FOR UPDATE TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.active_role_name() IN ('admin','administrador','gestor','financeiro')
)
WITH CHECK (company_id = public.active_company_id());

DROP POLICY IF EXISTS tiss_schema_versions_manage ON public.tiss_schema_versions;
CREATE POLICY tiss_schema_versions_manage
ON public.tiss_schema_versions FOR ALL TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.active_role_name() IN ('admin','administrador','gestor','financeiro')
)
WITH CHECK (company_id = public.active_company_id());

GRANT SELECT ON
  public.billing_accounts,
  public.billing_account_items,
  public.billing_pending_issues,
  public.billing_competencies,
  public.financial_transactions,
  public.financial_transaction_allocations,
  public.cash_sessions,
  public.cash_movements,
  public.tiss_schema_versions,
  public.reception_tiss_guides,
  public.v_billing_receita_convenio,
  public.v_billing_receita_mensal,
  public.v_billing_indicadores
TO authenticated;

GRANT UPDATE ON
  public.billing_accounts,
  public.billing_pending_issues,
  public.billing_competencies,
  public.tiss_schema_versions
TO authenticated;

GRANT EXECUTE ON FUNCTION public.billing_check_pending(BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.billing_check_pending(BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.seed_tiss_versions_for_company() FROM PUBLIC;

COMMENT ON TABLE public.billing_accounts IS
  'Conta assistencial canônica. Recepção abre; módulos assistenciais alimentam; faturamento fecha.';
COMMENT ON TABLE public.financial_transactions IS
  'Razão de títulos, pagamentos, estornos e recebíveis de adquirentes com idempotência.';
COMMENT ON TABLE public.reception_tiss_guides IS
  'Guia TISS individual versionada e vinculada ao paciente, atendimento e conta.';

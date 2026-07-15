-- Fundacao dos tres contratos RPC que estavam sem dominio persistente.
-- Esta migration nao importa dados: cria apenas o modelo operacional local.

CREATE TABLE IF NOT EXISTS public.billing_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id),
  insurance_id BIGINT REFERENCES public.insurance_companies(id),
  billing_type TEXT NOT NULL DEFAULT 'convenio',
  account_type TEXT NOT NULL DEFAULT 'ambulatorial',
  status TEXT NOT NULL DEFAULT 'aberta',
  competence_month DATE,
  total_gross_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_net_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_pending_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  authorization_number TEXT,
  guide_number TEXT,
  has_pending_issues BOOLEAN NOT NULL DEFAULT FALSE,
  has_denial BOOLEAN NOT NULL DEFAULT FALSE,
  is_reopened BOOLEAN NOT NULL DEFAULT FALSE,
  reopened_reason TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_accounts_status_ck CHECK (status IN (
    'aberta','em_montagem','aguardando_documentos','aguardando_autorizacao',
    'aguardando_laudo','aguardando_assinatura','aguardando_conferencia',
    'em_auditoria','com_pendencia','pronta_envio','enviada','em_analise',
    'paga','parcialmente_paga','glosada','em_recurso','recurso_aceito',
    'recurso_negado','baixada','cancelada','reaberta','particular_paga',
    'particular_pendente','inadimplente'
  )),
  CONSTRAINT billing_accounts_competence_ck CHECK (
    competence_month IS NULL OR competence_month = date_trunc('month', competence_month)::date
  )
);

CREATE TABLE IF NOT EXISTS public.billing_pending_issues (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  billing_account_id UUID NOT NULL REFERENCES public.billing_accounts(id) ON DELETE CASCADE,
  issue_code TEXT NOT NULL,
  issue_label TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'media',
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_pending_issues_severity_ck CHECK (severity IN ('baixa','media','alta','critica')),
  CONSTRAINT billing_pending_issues_unique_open UNIQUE (billing_account_id, issue_code, resolved)
);

CREATE TABLE IF NOT EXISTS public.billing_competencies (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  competence_month DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberta',
  receita_prevista NUMERIC(14,2) NOT NULL DEFAULT 0,
  receita_realizada NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_glosado NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_pendente NUMERIC(14,2) NOT NULL DEFAULT 0,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_competencies_month_ck CHECK (competence_month = date_trunc('month', competence_month)::date),
  CONSTRAINT billing_competencies_unique UNIQUE (company_id, competence_month)
);

CREATE TABLE IF NOT EXISTS public.nursing_medication_administrations (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id),
  medication TEXT NOT NULL,
  dose TEXT,
  via TEXT,
  scheduled_at TIMESTAMPTZ,
  administered_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pendente',
  bedside_check_ok BOOLEAN NOT NULL DEFAULT FALSE,
  refusal_reason TEXT,
  prepared_by BIGINT,
  administered_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT nursing_med_admin_status_ck CHECK (status IN ('pendente','em_preparo','administrado','recusado','suspenso','atrasado','cancelado'))
);

CREATE TABLE IF NOT EXISTS public.patient_problem_list (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  problem_description TEXT NOT NULL,
  cid_code TEXT,
  severity TEXT,
  status TEXT NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.patient_allergies (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  allergen TEXT NOT NULL,
  reaction TEXT,
  severity TEXT NOT NULL DEFAULT 'moderada',
  status TEXT NOT NULL DEFAULT 'ativa',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.patient_medications (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medication TEXT NOT NULL,
  dose TEXT,
  frequency TEXT,
  status TEXT NOT NULL DEFAULT 'em_uso',
  started_at DATE,
  ended_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.set_clinical_company_from_patient()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT p.company_id INTO NEW.company_id FROM public.patients p WHERE p.id = NEW.patient_id;
  END IF;
  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'Paciente sem empresa para registro clinico';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_billing_company_from_patient()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.patient_id IS NOT NULL THEN
    SELECT p.company_id INTO NEW.company_id FROM public.patients p WHERE p.id = NEW.patient_id;
  END IF;
  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'Conta de faturamento sem empresa';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_billing_issue_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id
      FROM public.billing_accounts
     WHERE id = NEW.billing_account_id;
  END IF;
  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'Pendencia de faturamento sem empresa';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_account_company ON public.billing_accounts;
CREATE TRIGGER trg_billing_account_company BEFORE INSERT ON public.billing_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_billing_company_from_patient();
DROP TRIGGER IF EXISTS trg_billing_issue_company ON public.billing_pending_issues;
CREATE TRIGGER trg_billing_issue_company BEFORE INSERT ON public.billing_pending_issues
FOR EACH ROW EXECUTE FUNCTION public.set_billing_issue_company();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['nursing_medication_administrations','patient_problem_list','patient_allergies','patient_medications'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_company ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_company BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_clinical_company_from_patient()', t, t);
  END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_billing_accounts_company_status ON public.billing_accounts(company_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_pending_account ON public.billing_pending_issues(company_id, billing_account_id, resolved);
CREATE INDEX IF NOT EXISTS idx_nursing_med_admin_company_status ON public.nursing_medication_administrations(company_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_patient_allergies_active ON public.patient_allergies(company_id, patient_id) WHERE status = 'ativa';
CREATE INDEX IF NOT EXISTS idx_patient_medications_active ON public.patient_medications(company_id, patient_id) WHERE status = 'em_uso';

ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_pending_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_medication_administrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_problem_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_allergies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_medications ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_accounts','billing_pending_issues','billing_competencies','nursing_medication_administrations','patient_problem_list','patient_allergies','patient_medications'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())', t || '_tenant_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (company_id = public.get_my_company_id()) WITH CHECK (company_id = public.get_my_company_id())', t || '_tenant_write', t);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.bedside_check(p_admin_id BIGINT, p_patient_confirmado BIGINT)
RETURNS TABLE(certo TEXT, ok BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_company UUID; v_patient BIGINT; v_status TEXT; v_med TEXT;
BEGIN
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  SELECT patient_id, status, medication INTO v_patient, v_status, v_med
    FROM public.nursing_medication_administrations
   WHERE id = p_admin_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Administracao de medicamento nao encontrada'; END IF;
  RETURN QUERY SELECT 'paciente'::TEXT, v_patient = p_patient_confirmado;
  RETURN QUERY SELECT 'medicamento'::TEXT, v_med IS NOT NULL AND length(btrim(v_med)) > 0;
  RETURN QUERY SELECT 'status'::TEXT, v_status IN ('pendente','em_preparo','atrasado');
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_check_pending(p_account_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_company UUID; a public.billing_accounts%ROWTYPE; v_count INTEGER;
BEGIN
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  SELECT * INTO a FROM public.billing_accounts WHERE id = p_account_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta de faturamento nao encontrada'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.billing_pending_issues
   WHERE billing_account_id = a.id AND company_id = v_company AND resolved = FALSE;
  v_count := v_count
    + CASE WHEN a.patient_id IS NULL THEN 1 ELSE 0 END
    + CASE WHEN a.billing_type <> 'particular' AND a.insurance_id IS NULL THEN 1 ELSE 0 END
    + CASE WHEN a.billing_type <> 'particular' AND NULLIF(btrim(a.guide_number), '') IS NULL THEN 1 ELSE 0 END;
  UPDATE public.billing_accounts SET has_pending_issues = (v_count > 0), total_pending_amount = CASE WHEN v_count > 0 THEN total_net_amount - total_paid_amount ELSE 0 END, updated_at = NOW()
   WHERE id = a.id AND company_id = v_company;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_prescription_safety(p_patient_id BIGINT, p_medication TEXT)
RETURNS TABLE(alert_type TEXT, severity TEXT, descricao TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_company UUID; v_med TEXT := lower(btrim(COALESCE(p_medication, '')));
BEGIN
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = p_patient_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Paciente nao encontrado na empresa atual';
  END IF;
  RETURN QUERY
  SELECT 'alergia'::TEXT, pa.severity::TEXT,
         format('Medicamento informado coincide com alergia registrada: %s%s', pa.allergen, CASE WHEN pa.reaction IS NULL THEN '' ELSE ' (' || pa.reaction || ')' END)::TEXT
    FROM public.patient_allergies pa
   WHERE pa.patient_id = p_patient_id AND pa.company_id = v_company AND pa.status = 'ativa'
     AND v_med <> '' AND (v_med = lower(btrim(pa.allergen)) OR v_med LIKE '%' || lower(btrim(pa.allergen)) || '%' OR lower(btrim(pa.allergen)) LIKE '%' || v_med || '%');
  RETURN QUERY
  SELECT 'duplicidade'::TEXT, 'moderada'::TEXT,
         format('Paciente ja possui este medicamento em uso: %s', pm.medication)::TEXT
    FROM public.patient_medications pm
   WHERE pm.patient_id = p_patient_id AND pm.company_id = v_company AND pm.status = 'em_uso'
     AND v_med <> '' AND lower(btrim(pm.medication)) = v_med;
END;
$$;

REVOKE ALL ON FUNCTION public.bedside_check(BIGINT, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_check_pending(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_prescription_safety(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bedside_check(BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_check_pending(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_prescription_safety(BIGINT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.bedside_check(BIGINT, BIGINT) IS 'Checagem beira-leito sem administrar medicamento; valida paciente, medicamento e status.';
COMMENT ON FUNCTION public.billing_check_pending(UUID) IS 'Calcula pendencias estruturais e pendencias abertas da conta no tenant atual.';
COMMENT ON FUNCTION public.check_prescription_safety(BIGINT, TEXT) IS 'Alerta baseado apenas em alergias e medicamentos ativos registrados no prontuario; nao substitui base externa de interacoes.';

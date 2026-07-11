-- ProntoMedic - Convenios foundation
-- Objetivo: tornar Convenios a fonte operacional de contratos, cobertura,
-- guias, autorizacao/elegibilidade, glosa preventiva e snapshot de regra.
-- Idempotente e seguro para rodar na VPS/local sem tocar no DataSIGH.

CREATE TABLE IF NOT EXISTS public.insurance_company_contacts (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insurance_company_id INTEGER NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  contact_type VARCHAR(40) NOT NULL CHECK (contact_type IN ('administrativo','autorizacao','faturamento','glosa','portal','comercial','outro')),
  name VARCHAR(160),
  email VARCHAR(200),
  phone VARCHAR(40),
  portal_url TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_contracts (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insurance_company_id INTEGER NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id),
  contract_number VARCHAR(80),
  signed_at DATE,
  start_date DATE NOT NULL,
  end_date DATE,
  auto_renewal BOOLEAN NOT NULL DEFAULT FALSE,
  readjustment_index VARCHAR(40),
  readjustment_periodicity VARCHAR(30),
  billing_close_day SMALLINT CHECK (billing_close_day IS NULL OR billing_close_day BETWEEN 1 AND 31),
  submission_deadline_days INTEGER NOT NULL DEFAULT 30,
  payment_deadline_days INTEGER NOT NULL DEFAULT 30,
  denial_appeal_deadline_days INTEGER NOT NULL DEFAULT 30,
  submission_method VARCHAR(80),
  receipt_method VARCHAR(80),
  responsible_user_id UUID REFERENCES public.user_profiles(id),
  carrier_responsible VARCHAR(160),
  status VARCHAR(30) NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente','vencido','suspenso','encerrado','em_renegociacao','em_implantacao','bloqueado')),
  blocks_new_appointments BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_contract_documents (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insurance_contract_id BIGINT NOT NULL REFERENCES public.insurance_contracts(id) ON DELETE CASCADE,
  document_type VARCHAR(60) NOT NULL DEFAULT 'contrato',
  file_name VARCHAR(240) NOT NULL,
  file_url TEXT NOT NULL,
  checksum_sha256 VARCHAR(64),
  uploaded_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_coverage_rules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insurance_company_id INTEGER NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE CASCADE,
  service_id BIGINT REFERENCES public.services_catalog(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id),
  professional_id BIGINT REFERENCES public.professionals(id),
  is_covered BOOLEAN NOT NULL DEFAULT TRUE,
  requires_authorization BOOLEAN NOT NULL DEFAULT FALSE,
  requires_eligibility BOOLEAN NOT NULL DEFAULT FALSE,
  requires_medical_order BOOLEAN NOT NULL DEFAULT FALSE,
  requires_cid BOOLEAN NOT NULL DEFAULT FALSE,
  requires_tiss_guide BOOLEAN NOT NULL DEFAULT TRUE,
  requires_report BOOLEAN NOT NULL DEFAULT FALSE,
  max_quantity INTEGER,
  period_limit_days INTEGER,
  min_age INTEGER,
  max_age INTEGER,
  gender_restriction VARCHAR(20) CHECK (gender_restriction IN ('M','F','O','qualquer') OR gender_restriction IS NULL),
  grace_period_days INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL DEFAULT 'permitido' CHECK (status IN ('permitido','bloqueado','apenas_com_autorizacao','apenas_particular','fora_da_cobertura','em_analise')),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

CREATE TABLE IF NOT EXISTS public.insurance_authorization_rules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insurance_company_id INTEGER NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE CASCADE,
  service_id BIGINT REFERENCES public.services_catalog(id) ON DELETE CASCADE,
  requires_authorization BOOLEAN NOT NULL DEFAULT FALSE,
  default_validity_days INTEGER NOT NULL DEFAULT 30,
  quantity_limit INTEGER,
  requires_cid BOOLEAN NOT NULL DEFAULT FALSE,
  requires_medical_order BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(30) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo','bloqueado')),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_copay_rules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insurance_company_id INTEGER NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE CASCADE,
  service_id BIGINT REFERENCES public.services_catalog(id) ON DELETE CASCADE,
  model VARCHAR(30) NOT NULL CHECK (model IN ('valor_fixo','percentual','percentual_com_teto','percentual_com_piso','isento','posterior')),
  fixed_amount NUMERIC(12,2),
  percentage NUMERIC(6,3),
  floor_amount NUMERIC(12,2),
  cap_amount NUMERIC(12,2),
  charge_moment VARCHAR(40) NOT NULL DEFAULT 'recepcao' CHECK (charge_moment IN ('recepcao','posterior','lote','sessao','isento')),
  status VARCHAR(30) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo','bloqueado')),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_return_rules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insurance_company_id INTEGER NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE CASCADE,
  specialty_id INTEGER,
  professional_id BIGINT REFERENCES public.professionals(id),
  service_id BIGINT REFERENCES public.services_catalog(id),
  days_limit INTEGER NOT NULL DEFAULT 30,
  free_return BOOLEAN NOT NULL DEFAULT TRUE,
  billable_return BOOLEAN NOT NULL DEFAULT FALSE,
  requires_tiss_guide BOOLEAN NOT NULL DEFAULT FALSE,
  requires_authorization BOOLEAN NOT NULL DEFAULT FALSE,
  same_professional_only BOOLEAN NOT NULL DEFAULT FALSE,
  same_specialty_only BOOLEAN NOT NULL DEFAULT TRUE,
  max_returns INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_tiss_guide_rules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insurance_company_id INTEGER NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE CASCADE,
  service_id BIGINT REFERENCES public.services_catalog(id),
  guide_type VARCHAR(40) NOT NULL CHECK (guide_type IN ('consulta','sp_sadt','internacao','honorario','outras_despesas')),
  requires_cid BOOLEAN NOT NULL DEFAULT FALSE,
  requires_signature BOOLEAN NOT NULL DEFAULT TRUE,
  requires_physical_guide BOOLEAN NOT NULL DEFAULT FALSE,
  allows_digital_guide BOOLEAN NOT NULL DEFAULT TRUE,
  auto_numbering BOOLEAN NOT NULL DEFAULT FALSE,
  manual_number_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  main_guide_required BOOLEAN NOT NULL DEFAULT FALSE,
  required_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  validity_days INTEGER NOT NULL DEFAULT 30,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_denial_rules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insurance_company_id INTEGER REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE CASCADE,
  service_id BIGINT REFERENCES public.services_catalog(id),
  denial_type VARCHAR(40) NOT NULL CHECK (denial_type IN ('administrativa','tecnica','contratual','autorizacao','guia','cid','prazo','valor','duplicidade','documentacao','assinatura','laudo','cobertura','opme','pacote')),
  condition_expression JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity VARCHAR(20) NOT NULL DEFAULT 'media' CHECK (severity IN ('baixa','media','alta','bloqueante')),
  alert_message TEXT NOT NULL,
  blocks_billing BOOLEAN NOT NULL DEFAULT FALSE,
  blocks_checkin BOOLEAN NOT NULL DEFAULT FALSE,
  requires_correction BOOLEAN NOT NULL DEFAULT TRUE,
  responsible_area VARCHAR(60),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_deadline_rules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insurance_company_id INTEGER NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE CASCADE,
  deadline_type VARCHAR(50) NOT NULL CHECK (deadline_type IN ('envio_conta','correcao_pendencia','recurso_glosa','pagamento','autorizacao','validade_guia','validade_senha','retorno','reapresentacao')),
  days INTEGER NOT NULL CHECK (days >= 0),
  warn_before_days INTEGER NOT NULL DEFAULT 3,
  blocks_when_expired BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_rule_snapshots (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  source_module VARCHAR(40) NOT NULL,
  source_record_id TEXT,
  operation VARCHAR(40) NOT NULL,
  patient_id BIGINT REFERENCES public.patients(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  insurance_company_id INTEGER REFERENCES public.insurance_companies(id),
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id),
  service_id BIGINT REFERENCES public.services_catalog(id),
  validation_result JSONB NOT NULL,
  rule_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_contract_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type VARCHAR(80) NOT NULL,
  entity_id TEXT NOT NULL,
  action VARCHAR(40) NOT NULL,
  previous_data JSONB,
  new_data JSONB,
  reason TEXT,
  actor_user_id UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_access_logs (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_profiles(id),
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80),
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insurance_contracts_lookup ON public.insurance_contracts(company_id, insurance_company_id, insurance_plan_id, unit_id, status, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_insurance_coverage_lookup ON public.insurance_coverage_rules(company_id, insurance_company_id, insurance_plan_id, service_id, unit_id, professional_id, valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_insurance_tiss_rules_lookup ON public.insurance_tiss_guide_rules(company_id, insurance_company_id, insurance_plan_id, service_id, guide_type, active);
CREATE INDEX IF NOT EXISTS idx_insurance_snapshots_source ON public.insurance_rule_snapshots(source_module, source_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_snapshots_appt ON public.insurance_rule_snapshots(appointment_id, created_at DESC);

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'insurance_company_contacts',
    'insurance_contracts',
    'insurance_contract_documents',
    'insurance_coverage_rules',
    'insurance_authorization_rules',
    'insurance_copay_rules',
    'insurance_return_rules',
    'insurance_tiss_guide_rules',
    'insurance_denial_rules',
    'insurance_deadline_rules',
    'insurance_rule_snapshots',
    'insurance_contract_audit_logs',
    'insurance_access_logs'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO app_prontomedic', tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'app_prontomedic_all_' || tbl, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO app_prontomedic USING (true) WITH CHECK (true)',
        'app_prontomedic_all_' || tbl,
        tbl
      );
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'authenticated_company_read_' || tbl, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()))',
        'authenticated_company_read_' || tbl,
        tbl
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_prontomedic;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.validate_insurance_operation(
  p_company_id UUID,
  p_operation TEXT,
  p_insurance_company_id INTEGER,
  p_insurance_plan_id INTEGER DEFAULT NULL,
  p_service_id BIGINT DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL,
  p_professional_id BIGINT DEFAULT NULL,
  p_patient_id BIGINT DEFAULT NULL,
  p_appointment_id BIGINT DEFAULT NULL,
  p_reference_date DATE DEFAULT CURRENT_DATE,
  p_create_snapshot BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_blockers JSONB := '[]'::jsonb;
  v_warnings JSONB := '[]'::jsonb;
  v_contract insurance_contracts%ROWTYPE;
  v_coverage insurance_coverage_rules%ROWTYPE;
  v_insurance_active BOOLEAN;
  v_plan_active BOOLEAN;
  v_auth_count INTEGER := 0;
  v_elig_count INTEGER := 0;
  v_price_found BOOLEAN := NULL;
  v_result JSONB;
BEGIN
  SELECT lg_ativo INTO v_insurance_active
  FROM public.insurance_companies
  WHERE id = p_insurance_company_id
    AND company_id = p_company_id;

  IF COALESCE(v_insurance_active, FALSE) IS FALSE THEN
    v_blockers := v_blockers || jsonb_build_object('code','INSURANCE_INACTIVE_OR_MISSING','message','Convenio inexistente ou inativo.');
  END IF;

  IF p_insurance_plan_id IS NOT NULL THEN
    SELECT lg_ativo INTO v_plan_active
    FROM public.insurance_plans
    WHERE id = p_insurance_plan_id
      AND insurance_company_id = p_insurance_company_id
      AND company_id = p_company_id;

    IF COALESCE(v_plan_active, FALSE) IS FALSE THEN
      v_blockers := v_blockers || jsonb_build_object('code','PLAN_INACTIVE_OR_MISSING','message','Plano inexistente, inativo ou nao vinculado ao convenio.');
    END IF;
  END IF;

  SELECT *
  INTO v_contract
  FROM public.insurance_contracts c
  WHERE c.company_id = p_company_id
    AND c.insurance_company_id = p_insurance_company_id
    AND (c.insurance_plan_id = p_insurance_plan_id OR c.insurance_plan_id IS NULL)
    AND (c.unit_id = p_unit_id OR c.unit_id IS NULL)
    AND c.status = 'vigente'
    AND c.start_date <= p_reference_date
    AND (c.end_date IS NULL OR c.end_date >= p_reference_date)
  ORDER BY c.insurance_plan_id NULLS LAST, c.unit_id NULLS LAST, c.start_date DESC
  LIMIT 1;

  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_object('code','NO_ACTIVE_CONTRACT','message','Nao existe contrato vigente para convenio/plano/unidade na data de referencia.');
  END IF;

  IF p_service_id IS NOT NULL THEN
    SELECT *
    INTO v_coverage
    FROM public.insurance_coverage_rules r
    WHERE r.company_id = p_company_id
      AND r.insurance_company_id = p_insurance_company_id
      AND (r.insurance_plan_id = p_insurance_plan_id OR r.insurance_plan_id IS NULL)
      AND (r.service_id = p_service_id OR r.service_id IS NULL)
      AND (r.unit_id = p_unit_id OR r.unit_id IS NULL)
      AND (r.professional_id = p_professional_id OR r.professional_id IS NULL)
      AND r.valid_from <= p_reference_date
      AND (r.valid_until IS NULL OR r.valid_until >= p_reference_date)
    ORDER BY
      CASE WHEN r.insurance_plan_id IS NULL THEN 1 ELSE 0 END,
      CASE WHEN r.service_id IS NULL THEN 1 ELSE 0 END,
      CASE WHEN r.unit_id IS NULL THEN 1 ELSE 0 END,
      CASE WHEN r.professional_id IS NULL THEN 1 ELSE 0 END,
      r.valid_from DESC
    LIMIT 1;

    IF FOUND THEN
      IF v_coverage.is_covered IS FALSE OR v_coverage.status IN ('bloqueado','fora_da_cobertura','apenas_particular') THEN
        v_blockers := v_blockers || jsonb_build_object('code','SERVICE_NOT_COVERED','message','Procedimento fora da cobertura do convenio/plano.');
      END IF;

      IF v_coverage.requires_authorization THEN
        IF to_regclass('public.insurance_authorizations') IS NOT NULL THEN
          EXECUTE
            'SELECT count(*) FROM public.insurance_authorizations
             WHERE company_id = $1
               AND patient_id = $2
               AND insurance_id = $3
               AND (insurance_plan_id::text = $4::text OR $4 IS NULL)
               AND (procedure_id = $5 OR $5 IS NULL)
               AND status IN (''autorizada'',''parcialmente_autorizada'',''liberada_excecao'')
               AND (valid_until IS NULL OR valid_until >= $6)'
          INTO v_auth_count
          USING p_company_id, p_patient_id, p_insurance_company_id, p_insurance_plan_id, p_service_id, p_reference_date;
        END IF;

        IF COALESCE(v_auth_count, 0) = 0 THEN
          v_blockers := v_blockers || jsonb_build_object('code','AUTHORIZATION_REQUIRED','message','Autorizacao obrigatoria ausente ou vencida.');
        END IF;
      END IF;

      IF v_coverage.requires_eligibility THEN
        IF to_regclass('public.insurance_eligibility_checks') IS NOT NULL THEN
          EXECUTE
            'SELECT count(*) FROM public.insurance_eligibility_checks
             WHERE company_id = $1
               AND patient_id = $2
               AND insurance_id = $3
               AND (insurance_plan_id::text = $4::text OR $4 IS NULL)
               AND status IN (''elegivel'',''nao_obrigatoria'',''liberado_excecao'')'
          INTO v_elig_count
          USING p_company_id, p_patient_id, p_insurance_company_id, p_insurance_plan_id;
        END IF;

        IF COALESCE(v_elig_count, 0) = 0 THEN
          v_blockers := v_blockers || jsonb_build_object('code','ELIGIBILITY_REQUIRED','message','Elegibilidade obrigatoria ausente, negativa ou vencida.');
        END IF;
      END IF;
    ELSE
      v_warnings := v_warnings || jsonb_build_object('code','NO_COVERAGE_RULE','message','Nao ha regra de cobertura especifica cadastrada para este procedimento.');
    END IF;

    IF to_regprocedure('public.find_price(uuid,bigint,bigint,integer)') IS NOT NULL THEN
      SELECT fp.found INTO v_price_found
      FROM public.find_price(p_company_id, p_service_id, NULL::BIGINT, p_insurance_plan_id) fp
      LIMIT 1;

      IF COALESCE(v_price_found, FALSE) IS FALSE THEN
        v_blockers := v_blockers || jsonb_build_object('code','NO_PRICE','message','Procedimento sem preco vigente para convenio/plano.');
      END IF;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'operation', p_operation,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'contract_id', v_contract.id,
    'coverage_rule_id', v_coverage.id,
    'requires_authorization', COALESCE(v_coverage.requires_authorization, FALSE),
    'requires_eligibility', COALESCE(v_coverage.requires_eligibility, FALSE),
    'requires_tiss_guide', COALESCE(v_coverage.requires_tiss_guide, FALSE),
    'validated_at', NOW()
  );

  IF p_create_snapshot THEN
    INSERT INTO public.insurance_rule_snapshots (
      company_id, source_module, source_record_id, operation, patient_id, appointment_id,
      insurance_company_id, insurance_plan_id, service_id, validation_result, rule_payload
    )
    VALUES (
      p_company_id,
      COALESCE(NULLIF(split_part(p_operation, ':', 1), ''), 'unknown'),
      COALESCE(p_appointment_id::TEXT, p_patient_id::TEXT, p_service_id::TEXT),
      p_operation,
      p_patient_id,
      p_appointment_id,
      p_insurance_company_id,
      p_insurance_plan_id,
      p_service_id,
      v_result,
      jsonb_build_object('contract', to_jsonb(v_contract), 'coverage', to_jsonb(v_coverage))
    );
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.validate_insurance_operation(UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,BIGINT,BIGINT,DATE,BOOLEAN)
IS 'Valida contrato, cobertura, autorizacao/elegibilidade, guia e preco para agenda, recepcao, assistencia e faturamento, gravando snapshot da regra usada.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    GRANT EXECUTE ON FUNCTION public.validate_insurance_operation(UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,BIGINT,BIGINT,DATE,BOOLEAN) TO app_prontomedic;
  END IF;
END $$;

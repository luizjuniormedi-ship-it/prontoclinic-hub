BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $requirements$
BEGIN
  IF to_regclass('public.billing_accounts') IS NULL
     OR to_regclass('public.tiss_guides') IS NULL
     OR to_regclass('public.tiss_xml') IS NULL
     OR to_regclass('public.patient_insurances') IS NULL
     OR to_regclass('public.insurance_companies') IS NULL
     OR to_regclass('public.insurance_plans') IS NULL
     OR to_regclass('public.price_tables') IS NULL
     OR to_regprocedure('private.m16_require_actor(text[],boolean,text)') IS NULL
     OR to_regprocedure('private.m16_claim_operation(uuid,uuid,text,jsonb,uuid)') IS NULL
     OR to_regprocedure('private.m16_finish_operation(uuid,uuid,jsonb)') IS NULL
     OR to_regprocedure('public.active_unit_id()') IS NULL THEN
    RAISE EXCEPTION 'Module 16 account materialization dependencies are missing';
  END IF;
END
$requirements$;

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS cnes VARCHAR(7);
ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS council_code VARCHAR(2),
  ADD COLUMN IF NOT EXISTS council_state VARCHAR(2),
  ADD COLUMN IF NOT EXISTS cbos VARCHAR(6);

ALTER TABLE public.tiss_xml
  ADD COLUMN IF NOT EXISTS unit_id INTEGER;

UPDATE public.tiss_xml xml
   SET unit_id = appointment.unit_id
  FROM public.appointments appointment
 WHERE xml.unit_id IS NULL
   AND appointment.id = xml.appointment_id
   AND appointment.company_id = xml.company_id
   AND appointment.unit_id IS NOT NULL;
UPDATE public.tiss_xml xml
   SET unit_id = account.unit_id
  FROM public.billing_accounts account
 WHERE xml.unit_id IS NULL
   AND account.id = xml.billing_account_id
   AND account.company_id = xml.company_id
   AND account.unit_id IS NOT NULL;
UPDATE public.tiss_guides guide
   SET unit_id = appointment.unit_id
  FROM public.appointments appointment
 WHERE guide.unit_id IS NULL
   AND appointment.id = guide.appointment_id
   AND appointment.company_id = guide.company_id
   AND appointment.unit_id IS NOT NULL;
UPDATE public.tiss_guides guide
   SET unit_id = account.unit_id
  FROM public.billing_accounts account
 WHERE guide.unit_id IS NULL
   AND account.id = guide.billing_account_id
   AND account.company_id = guide.company_id
   AND account.unit_id IS NOT NULL;

DO $legacy_unit_scope$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tiss_xml WHERE unit_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.tiss_guides WHERE unit_id IS NULL) THEN
    RAISE EXCEPTION 'Legacy TISS rows without deterministic unit ancestry must be reconciled before migration';
  END IF;
END
$legacy_unit_scope$;

DO $unit_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tiss_xml'::REGCLASS
       AND conname = 'tiss_xml_unit_id_fkey'
  ) THEN
    ALTER TABLE public.tiss_xml
      ADD CONSTRAINT tiss_xml_unit_id_fkey
      FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END
$unit_fk$;

CREATE INDEX IF NOT EXISTS tiss_xml_company_unit_account_idx
  ON public.tiss_xml(company_id, unit_id, billing_account_id)
  WHERE COALESCE(lg_deletado, FALSE) IS FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS tiss_xml_active_account_guide_uq
  ON public.tiss_xml(company_id, unit_id, billing_account_id, guide_id)
  WHERE billing_account_id IS NOT NULL
    AND guide_id IS NOT NULL
    AND COALESCE(lg_deletado, FALSE) IS FALSE
    AND status NOT IN ('CANCELADO', 'REJEITADO');
CREATE UNIQUE INDEX IF NOT EXISTS tiss_guides_active_account_uq
  ON public.tiss_guides(company_id, unit_id, billing_account_id, guide_type, environment)
  WHERE status IN ('DRAFT', 'VALIDATED', 'SIGNED');

CREATE OR REPLACE FUNCTION private.m16_assign_tiss_xml_unit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_appointment_unit INTEGER;
BEGIN
  SELECT appointment.unit_id INTO v_appointment_unit
    FROM public.appointments appointment
   WHERE appointment.id = NEW.appointment_id
     AND appointment.company_id = NEW.company_id;
  IF v_appointment_unit IS NULL THEN
    RAISE EXCEPTION 'TISS XML requires an appointment in the same company with an active unit'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.unit_id IS NOT NULL AND NEW.unit_id IS DISTINCT FROM v_appointment_unit THEN
    RAISE EXCEPTION 'TISS XML unit conflicts with appointment ancestry'
      USING ERRCODE = '23514';
  END IF;
  NEW.unit_id := v_appointment_unit;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.m16_assign_tiss_xml_unit()
  OWNER TO prontomedic_tiss_rpc_owner;
REVOKE ALL ON FUNCTION private.m16_assign_tiss_xml_unit()
  FROM PUBLIC, anon, authenticated, app_prontomedic, prontomedic_tiss_gateway;
DROP TRIGGER IF EXISTS trg_m16_assign_tiss_xml_unit ON public.tiss_xml;
CREATE TRIGGER trg_m16_assign_tiss_xml_unit
  BEFORE INSERT OR UPDATE OF appointment_id, company_id, unit_id
  ON public.tiss_xml
  FOR EACH ROW EXECUTE FUNCTION private.m16_assign_tiss_xml_unit();

DROP POLICY IF EXISTS m16_xml_owner_all ON public.tiss_xml;
CREATE POLICY m16_xml_owner_all ON public.tiss_xml
  FOR ALL TO prontomedic_tiss_rpc_owner
  USING (
    company_id = private.m16_tenant_id()
    AND (
      unit_id = public.active_unit_id()
      OR (
        public.active_unit_id() IS NULL
        AND current_setting('request.jwt.claim.role', TRUE) = 'prontomedic_tiss_gateway'
      )
    )
  )
  WITH CHECK (
    company_id = private.m16_tenant_id()
    AND (
      unit_id = public.active_unit_id()
      OR (
        public.active_unit_id() IS NULL
        AND current_setting('request.jwt.claim.role', TRUE) = 'prontomedic_tiss_gateway'
      )
    )
  );

DROP POLICY IF EXISTS m16_guide_owner_all ON public.tiss_guides;
CREATE POLICY m16_guide_owner_all ON public.tiss_guides
  FOR ALL TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id() AND unit_id = public.active_unit_id())
  WITH CHECK (company_id = private.m16_tenant_id() AND unit_id = public.active_unit_id());

DROP POLICY IF EXISTS m16_denial_owner_all ON public.tiss_glosas;
CREATE POLICY m16_denial_owner_all ON public.tiss_glosas
  FOR ALL TO prontomedic_tiss_rpc_owner
  USING (
    company_id = private.m16_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.tiss_xml parent_xml
       WHERE parent_xml.id = tiss_glosas.cd_tiss_xml
         AND parent_xml.company_id = tiss_glosas.company_id
         AND parent_xml.unit_id = public.active_unit_id()
    )
  )
  WITH CHECK (
    company_id = private.m16_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.tiss_xml parent_xml
       WHERE parent_xml.id = tiss_glosas.cd_tiss_xml
         AND parent_xml.company_id = tiss_glosas.company_id
         AND parent_xml.unit_id = public.active_unit_id()
    )
  );

DROP POLICY IF EXISTS m16_guide_event_owner_all ON public.tiss_guide_events;
CREATE POLICY m16_guide_event_owner_all ON public.tiss_guide_events
  FOR ALL TO prontomedic_tiss_rpc_owner
  USING (
    company_id = private.m16_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.tiss_guides parent_guide
       WHERE parent_guide.id = tiss_guide_events.guide_id
         AND parent_guide.company_id = tiss_guide_events.company_id
         AND parent_guide.unit_id = public.active_unit_id()
    )
  )
  WITH CHECK (
    company_id = private.m16_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.tiss_guides parent_guide
       WHERE parent_guide.id = tiss_guide_events.guide_id
         AND parent_guide.company_id = tiss_guide_events.company_id
         AND parent_guide.unit_id = public.active_unit_id()
    )
  );

GRANT SELECT ON TABLE
  public.companies,
  public.units,
  public.patients,
  public.patient_insurances,
  public.insurance_plans,
  public.price_tables,
  public.professionals,
  public.services_catalog
TO prontomedic_tiss_rpc_owner;
REVOKE SELECT ON TABLE public.insurance_companies FROM prontomedic_tiss_rpc_owner;
GRANT SELECT (id, company_id, name, registro_ans, lg_ativo)
  ON public.insurance_companies TO prontomedic_tiss_rpc_owner;
GRANT UPDATE (guide_number, version, updated_at)
  ON public.billing_accounts TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_unit_id()
  TO prontomedic_tiss_rpc_owner;

DROP POLICY IF EXISTS m16_materialization_companies_read ON public.companies;
CREATE POLICY m16_materialization_companies_read ON public.companies
  FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (id = public.active_company_id());
DROP POLICY IF EXISTS m16_materialization_units_read ON public.units;
CREATE POLICY m16_materialization_units_read ON public.units
  FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (company_id = public.active_company_id() AND id = public.active_unit_id());
DROP POLICY IF EXISTS m16_materialization_patients_read ON public.patients;
CREATE POLICY m16_materialization_patients_read ON public.patients
  FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (company_id = public.active_company_id());
DROP POLICY IF EXISTS m16_materialization_patient_insurances_read ON public.patient_insurances;
CREATE POLICY m16_materialization_patient_insurances_read ON public.patient_insurances
  FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (company_id = public.active_company_id());
DROP POLICY IF EXISTS m16_materialization_insurance_plans_read ON public.insurance_plans;
CREATE POLICY m16_materialization_insurance_plans_read ON public.insurance_plans
  FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (company_id = public.active_company_id());
DROP POLICY IF EXISTS m16_materialization_insurance_companies_read ON public.insurance_companies;
CREATE POLICY m16_materialization_insurance_companies_read ON public.insurance_companies
  FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (company_id = public.active_company_id());
DROP POLICY IF EXISTS m16_materialization_price_tables_read ON public.price_tables;
CREATE POLICY m16_materialization_price_tables_read ON public.price_tables
  FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (company_id = public.active_company_id());
DROP POLICY IF EXISTS m16_materialization_professionals_read ON public.professionals;
CREATE POLICY m16_materialization_professionals_read ON public.professionals
  FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (company_id = public.active_company_id());
DROP POLICY IF EXISTS m16_materialization_services_read ON public.services_catalog;
CREATE POLICY m16_materialization_services_read ON public.services_catalog
  FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (company_id = public.active_company_id());
DROP POLICY IF EXISTS m16_materialization_billing_update ON public.billing_accounts;
CREATE POLICY m16_materialization_billing_update ON public.billing_accounts
  FOR UPDATE TO prontomedic_tiss_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND deleted_at IS NULL
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND deleted_at IS NULL
  );

ALTER TABLE public.tiss_operation_requests
  DROP CONSTRAINT IF EXISTS tiss_operation_requests_operation_type_check;
ALTER TABLE public.tiss_operation_requests
  ADD CONSTRAINT tiss_operation_requests_operation_type_check
  CHECK (operation_type IN (
    'persist_xml', 'record_transmission', 'process_return', 'manual_denial',
    'monthly_batch', 'save_protocol', 'materialize_account'
  ));

CREATE OR REPLACE FUNCTION private.m16_xml_escape(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT replace(replace(replace(replace(replace(
    p_value, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&apos;');
$function$;

ALTER FUNCTION private.m16_xml_escape(TEXT)
  OWNER TO prontomedic_tiss_rpc_owner;
REVOKE ALL ON FUNCTION private.m16_xml_escape(TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic, prontomedic_tiss_gateway;

CREATE OR REPLACE FUNCTION private.m16_xml_unescape(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT replace(replace(replace(replace(replace(
    p_value, '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&apos;', ''''), '&amp;', '&');
$function$;

ALTER FUNCTION private.m16_xml_unescape(TEXT)
  OWNER TO prontomedic_tiss_rpc_owner;
REVOKE ALL ON FUNCTION private.m16_xml_unescape(TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic, prontomedic_tiss_gateway;

CREATE OR REPLACE FUNCTION public.create_tiss_guide_secure(
  p_guide_type TEXT,
  p_appointment_id BIGINT DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL,
  p_billing_account_id UUID DEFAULT NULL,
  p_source_xml_id BIGINT DEFAULT NULL,
  p_environment TEXT DEFAULT 'HOMOLOGACAO'
)
RETURNS public.tiss_guides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_account public.billing_accounts;
  v_row public.tiss_guides;
BEGIN
  SELECT * INTO v_actor
    FROM private.m16_require_actor(ARRAY[]::TEXT[], FALSE, 'create');
  IF p_billing_account_id IS NULL THEN
    RAISE EXCEPTION 'Billing account is required for a TISS guide'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_account
    FROM public.billing_accounts account
   WHERE account.id = p_billing_account_id
     AND account.company_id = v_actor.company_id
     AND account.unit_id = public.active_unit_id()
     AND account.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Billing account not found in active company and unit'
      USING ERRCODE = '42501';
  END IF;
  IF p_appointment_id IS NOT NULL AND p_appointment_id IS DISTINCT FROM v_account.appointment_id
     OR p_unit_id IS NOT NULL AND p_unit_id IS DISTINCT FROM v_account.unit_id THEN
    RAISE EXCEPTION 'Guide ancestry conflicts with billing account'
      USING ERRCODE = '23514';
  END IF;
  IF p_source_xml_id IS NOT NULL THEN
    RAISE EXCEPTION 'Source XML must be linked by the account materialization command'
      USING ERRCODE = '22023';
  END IF;
  IF p_guide_type NOT IN ('CONSULTA','SP/SADT','INTERNACAO','RESUMO_INTERNACAO','HONORARIO','OUTRAS_DESPESAS','RECURSO_GLOSA')
     OR p_environment NOT IN ('HOMOLOGACAO','PRODUCAO') THEN
    RAISE EXCEPTION 'Invalid TISS guide type or environment' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.tiss_guides(
    company_id, appointment_id, unit_id, billing_account_id,
    guide_type, environment, created_by
  ) VALUES (
    v_actor.company_id, v_account.appointment_id, v_account.unit_id,
    v_account.id, p_guide_type, p_environment, v_actor.user_id
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

ALTER FUNCTION public.create_tiss_guide_secure(TEXT, BIGINT, INTEGER, UUID, BIGINT, TEXT)
  OWNER TO prontomedic_tiss_rpc_owner;
REVOKE ALL ON FUNCTION public.create_tiss_guide_secure(TEXT, BIGINT, INTEGER, UUID, BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.create_tiss_guide_secure(TEXT, BIGINT, INTEGER, UUID, BIGINT, TEXT)
  TO prontomedic_tiss_rpc_owner;

CREATE OR REPLACE FUNCTION public.m16_materialize_account_tiss_secure(
  p_operation_id UUID,
  p_billing_account_id UUID,
  p_expected_account_version INTEGER,
  p_guide_type TEXT DEFAULT 'SP/SADT',
  p_environment TEXT DEFAULT 'HOMOLOGACAO'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_company UUID;
  v_unit INTEGER := public.active_unit_id();
  v_account public.billing_accounts;
  v_appointment public.appointments;
  v_patient public.patients;
  v_professional public.professionals;
  v_insurance RECORD;
  v_plan public.insurance_plans;
  v_price public.price_tables;
  v_service public.services_catalog;
  v_company_row public.companies;
  v_unit_row public.units;
  v_existing JSONB;
  v_payload JSONB;
  v_guide public.tiss_guides;
  v_xml_id BIGINT;
  v_card TEXT;
  v_provider_cnpj TEXT;
  v_ans TEXT;
  v_cnes TEXT;
  v_license TEXT;
  v_council TEXT;
  v_state TEXT;
  v_cbos TEXT;
  v_tuss TEXT;
  v_transaction_id TEXT;
  v_transaction_xml TEXT;
  v_values TEXT;
  v_md5 TEXT;
  v_xml TEXT;
  v_sha256 TEXT;
  v_response JSONB;
BEGIN
  SELECT * INTO v_actor
    FROM private.m16_require_actor(
      ARRAY['admin','administrador','financeiro','faturamento','faturista','billing','gestor'],
      FALSE,
      'create'
    );
  v_company := v_actor.company_id;

  IF p_operation_id IS NULL OR p_billing_account_id IS NULL
     OR p_expected_account_version IS NULL THEN
    RAISE EXCEPTION 'Operation, billing account and expected version are required'
      USING ERRCODE = '22023';
  END IF;
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'Active unit is required for TISS materialization'
      USING ERRCODE = '42501';
  END IF;
  IF p_guide_type IS DISTINCT FROM 'SP/SADT' THEN
    RAISE EXCEPTION 'Account materialization currently supports only SP/SADT'
      USING ERRCODE = '22023';
  END IF;
  IF p_environment IS DISTINCT FROM 'HOMOLOGACAO' THEN
    RAISE EXCEPTION 'Production TISS materialization is disabled until provider homologation'
      USING ERRCODE = '42501';
  END IF;

  v_payload := jsonb_build_object(
    'billing_account_id', p_billing_account_id,
    'account_version', p_expected_account_version,
    'guide_type', p_guide_type,
    'environment', p_environment
  );
  v_existing := private.m16_claim_operation(
    v_company, p_operation_id, 'materialize_account', v_payload, v_actor.user_id
  );
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_company::TEXT || ':' || v_unit::TEXT || ':' || p_billing_account_id::TEXT, 0)
  );

  SELECT * INTO v_account
    FROM public.billing_accounts account
   WHERE account.id = p_billing_account_id
     AND account.company_id = v_company
     AND account.unit_id = v_unit
     AND account.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Billing account not found in active company and unit'
      USING ERRCODE = '42501';
  END IF;
  IF v_account.version IS DISTINCT FROM p_expected_account_version THEN
    RAISE EXCEPTION 'Billing account version conflict' USING ERRCODE = '40001';
  END IF;
  IF v_account.billing_type IS DISTINCT FROM 'convenio' THEN
    RAISE EXCEPTION 'Private billing accounts do not generate TISS XML'
      USING ERRCODE = '22023';
  END IF;
  IF v_account.status IS DISTINCT FROM 'pronta_envio'
     OR v_account.has_pending_issues
     OR v_account.appointment_id IS NULL
     OR v_account.patient_id IS NULL
     OR v_account.insurance_id IS NULL
     OR NULLIF(btrim(COALESCE(v_account.authorization_number, '')), '') IS NULL
     OR v_account.total_net_amount <= 0
     OR v_account.total_net_amount = 'NaN'::NUMERIC THEN
    RAISE EXCEPTION 'Billing account is not ready for TISS materialization'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO STRICT v_appointment FROM public.appointments appointment
   WHERE appointment.id = v_account.appointment_id
     AND appointment.company_id = v_company
     AND appointment.unit_id = v_unit
     AND appointment.patient_id = v_account.patient_id;
  SELECT * INTO STRICT v_patient FROM public.patients patient
   WHERE patient.id = v_account.patient_id AND patient.company_id = v_company;
  SELECT * INTO STRICT v_professional FROM public.professionals professional
   WHERE professional.id = v_appointment.professional_id AND professional.company_id = v_company;
  SELECT insurance.id, insurance.company_id, insurance.name,
         insurance.registro_ans, insurance.lg_ativo
    INTO STRICT v_insurance
    FROM public.insurance_companies insurance
   WHERE insurance.id = v_account.insurance_id AND insurance.company_id = v_company
     AND COALESCE(insurance.lg_ativo, TRUE);
  SELECT * INTO STRICT v_plan FROM public.insurance_plans plan
   WHERE plan.id = v_appointment.insurance_plan_id
     AND plan.company_id = v_company
     AND plan.insurance_company_id = v_account.insurance_id
     AND COALESCE(plan.lg_ativo, TRUE);
  SELECT * INTO STRICT v_service FROM public.services_catalog service
   WHERE service.id = v_appointment.service_id AND service.company_id = v_company
     AND COALESCE(service.lg_ativo, TRUE);
  SELECT * INTO STRICT v_company_row FROM public.companies company WHERE company.id = v_company;
  SELECT * INTO STRICT v_unit_row FROM public.units unit_record
   WHERE unit_record.id = v_unit AND unit_record.company_id = v_company;

  SELECT insurance.card_number INTO v_card
    FROM public.patient_insurances insurance
   WHERE insurance.company_id = v_company
     AND insurance.patient_id = v_account.patient_id
     AND insurance.insurance_plan_id = v_plan.id
     AND insurance.status = 'active'
     AND NULLIF(btrim(COALESCE(insurance.card_number, '')), '') IS NOT NULL
   ORDER BY insurance.is_primary DESC, insurance.updated_at DESC, insurance.id DESC
   LIMIT 1;

  SELECT price.* INTO STRICT v_price
    FROM public.price_tables price
   WHERE price.company_id = v_company
     AND price.insurance_plan_id = v_plan.id
     AND price.service_id = v_appointment.service_id
     AND price.active
     AND price.dt_inicio <= v_appointment.appointment_date
     AND (price.dt_fim IS NULL OR price.dt_fim >= v_appointment.appointment_date)
   ORDER BY price.dt_inicio DESC, price.id DESC
   LIMIT 1;

  IF COALESCE(v_price.vl_material, 0) <> 0
     OR COALESCE(v_price.vl_medicamento, 0) <> 0
     OR COALESCE(v_price.vl_taxa, 0) <> 0
     OR COALESCE(v_price.vl_diaria, 0) <> 0
     OR COALESCE(v_price.vl_gases, 0) <> 0
     OR COALESCE(v_price.vl_convenio, 0) IS DISTINCT FROM v_account.total_net_amount THEN
    RAISE EXCEPTION 'Account requires canonical billing items before TISS XML materialization'
      USING ERRCODE = '23514';
  END IF;

  v_provider_cnpj := regexp_replace(COALESCE(
    to_jsonb(v_unit_row)->>'nr_cnpj', to_jsonb(v_company_row)->>'cnpj',
    to_jsonb(v_company_row)->>'nr_cnpj', to_jsonb(v_company_row)->>'cd_cnpj', ''
  ), '\D', '', 'g');
  v_ans := regexp_replace(COALESCE(v_insurance.registro_ans, ''), '\D', '', 'g');
  v_cnes := NULLIF(btrim(COALESCE(to_jsonb(v_unit_row)->>'cnes', to_jsonb(v_unit_row)->>'cd_cnes', '')), '');
  v_license := regexp_replace(COALESCE(
    to_jsonb(v_professional)->>'professional_license', to_jsonb(v_professional)->>'crm', ''
  ), '\D', '', 'g');
  v_council := NULLIF(btrim(COALESCE(to_jsonb(v_professional)->>'council_code', '06')), '');
  v_state := NULLIF(btrim(COALESCE(to_jsonb(v_professional)->>'council_state', to_jsonb(v_unit_row)->>'ds_uf', '')), '');
  v_cbos := regexp_replace(COALESCE(to_jsonb(v_professional)->>'cbos', ''), '\D', '', 'g');
  v_tuss := regexp_replace(COALESCE(v_service.code, ''), '\D', '', 'g');

  IF v_card IS NULL OR length(v_provider_cnpj) <> 14 OR length(v_ans) <> 6
     OR v_cnes IS NULL OR v_license = '' OR v_state IS NULL OR v_cbos = ''
     OR v_tuss = '' OR v_tuss !~ '^\d{1,10}$' THEN
    RAISE EXCEPTION 'Canonical TISS data is incomplete: card, provider CNPJ, ANS, CNES, professional council/CBOS or TUSS'
      USING ERRCODE = '23514';
  END IF;

  SELECT guide.* INTO v_guide
    FROM public.tiss_guides guide
   WHERE guide.company_id = v_company
     AND guide.unit_id = v_unit
     AND guide.billing_account_id = v_account.id
     AND guide.appointment_id = v_account.appointment_id
     AND guide.guide_type = p_guide_type
     AND guide.environment = p_environment
     AND guide.status IN ('DRAFT', 'VALIDATED', 'SIGNED')
   ORDER BY guide.created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.tiss_guides(
      company_id, unit_id, appointment_id, billing_account_id,
      guide_type, environment, created_by
    ) VALUES (
      v_company, v_unit, v_account.appointment_id, v_account.id,
      p_guide_type, p_environment, v_actor.user_id
    ) RETURNING * INTO v_guide;
  END IF;

  SELECT xml.id INTO v_xml_id
    FROM public.tiss_xml xml
   WHERE xml.company_id = v_company
     AND xml.unit_id = v_unit
     AND xml.billing_account_id = v_account.id
     AND xml.guide_id = v_guide.id
     AND COALESCE(xml.lg_deletado, FALSE) IS FALSE
     AND xml.status NOT IN ('CANCELADO', 'REJEITADO')
   ORDER BY xml.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_xml_id IS NULL THEN
    v_transaction_id := right(replace(p_operation_id::TEXT, '-', ''), 12);
    v_transaction_xml := format(
      '<?xml version="1.0" encoding="ISO-8859-1"?><ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"><ans:cabecalho><ans:identificacaoTransacao><ans:tipoTransacao>ENVIO_LOTE_GUIAS</ans:tipoTransacao><ans:sequencialTransacao>%s</ans:sequencialTransacao><ans:dataRegistroTransacao>%s</ans:dataRegistroTransacao><ans:horaRegistroTransacao>%s</ans:horaRegistroTransacao></ans:identificacaoTransacao><ans:origem><ans:identificacaoPrestador><ans:CNPJ>%s</ans:CNPJ></ans:identificacaoPrestador></ans:origem><ans:destino><ans:registroANS>%s</ans:registroANS></ans:destino><ans:Padrao>4.03.00</ans:Padrao></ans:cabecalho><ans:prestadorParaOperadora><ans:loteGuias><ans:numeroLote>%s</ans:numeroLote><ans:guiasTISS><ans:guiaSP-SADT><ans:cabecalhoGuia><ans:registroANS>%s</ans:registroANS><ans:numeroGuiaPrestador>%s</ans:numeroGuiaPrestador></ans:cabecalhoGuia><ans:dadosBeneficiario><ans:numeroCarteira>%s</ans:numeroCarteira><ans:atendimentoRN>N</ans:atendimentoRN></ans:dadosBeneficiario><ans:dadosSolicitante><ans:contratadoSolicitante><ans:cnpjContratado>%s</ans:cnpjContratado></ans:contratadoSolicitante><ans:nomeContratadoSolicitante>%s</ans:nomeContratadoSolicitante><ans:profissionalSolicitante><ans:nomeProfissional>%s</ans:nomeProfissional><ans:conselhoProfissional>%s</ans:conselhoProfissional><ans:numeroConselhoProfissional>%s</ans:numeroConselhoProfissional><ans:UF>%s</ans:UF><ans:CBOS>%s</ans:CBOS></ans:profissionalSolicitante></ans:dadosSolicitante><ans:dadosSolicitacao><ans:dataSolicitacao>%s</ans:dataSolicitacao><ans:caraterAtendimento>1</ans:caraterAtendimento></ans:dadosSolicitacao><ans:dadosExecutante><ans:contratadoExecutante><ans:cnpjContratado>%s</ans:cnpjContratado></ans:contratadoExecutante><ans:CNES>%s</ans:CNES></ans:dadosExecutante><ans:dadosAtendimento><ans:tipoAtendimento>05</ans:tipoAtendimento><ans:indicacaoAcidente>9</ans:indicacaoAcidente><ans:regimeAtendimento>01</ans:regimeAtendimento></ans:dadosAtendimento><ans:procedimentosExecutados><ans:procedimentoExecutado><ans:sequencialItem>1</ans:sequencialItem><ans:dataExecucao>%s</ans:dataExecucao><ans:horaInicial>%s</ans:horaInicial><ans:procedimento><ans:codigoTabela>22</ans:codigoTabela><ans:codigoProcedimento>%s</ans:codigoProcedimento><ans:descricaoProcedimento>%s</ans:descricaoProcedimento></ans:procedimento><ans:quantidadeExecutada>1</ans:quantidadeExecutada><ans:reducaoAcrescimo>1.00</ans:reducaoAcrescimo><ans:valorUnitario>%s</ans:valorUnitario><ans:valorTotal>%s</ans:valorTotal></ans:procedimentoExecutado></ans:procedimentosExecutados><ans:valorTotal><ans:valorProcedimentos>%s</ans:valorProcedimentos><ans:valorTotalGeral>%s</ans:valorTotalGeral></ans:valorTotal></ans:guiaSP-SADT></ans:guiasTISS></ans:loteGuias></ans:prestadorParaOperadora>',
      v_transaction_id, to_char(CURRENT_DATE, 'YYYY-MM-DD'), to_char(LOCALTIME(0), 'HH24:MI:SS'),
      v_provider_cnpj, v_ans, v_transaction_id, v_ans, v_guide.guide_number,
      private.m16_xml_escape(v_card), v_provider_cnpj,
      private.m16_xml_escape(v_professional.full_name), private.m16_xml_escape(v_professional.full_name),
      v_council, v_license, private.m16_xml_escape(v_state), v_cbos,
      to_char(v_appointment.appointment_date, 'YYYY-MM-DD'), v_provider_cnpj, private.m16_xml_escape(v_cnes),
      to_char(v_appointment.appointment_date, 'YYYY-MM-DD'), to_char(v_appointment.start_time, 'HH24:MI:SS'),
      v_tuss, private.m16_xml_escape(v_service.name),
      to_char(v_account.total_net_amount, 'FM999999990.00'), to_char(v_account.total_net_amount, 'FM999999990.00'),
      to_char(v_account.total_net_amount, 'FM999999990.00'), to_char(v_account.total_net_amount, 'FM999999990.00')
    );
    v_transaction_xml := replace(
      v_transaction_xml,
      '<ans:tipoAtendimento>05</ans:tipoAtendimento>',
      '<ans:tipoAtendimento>23</ans:tipoAtendimento>'
    );
    SELECT string_agg(private.m16_xml_unescape(match[1]), '' ORDER BY ordinal) INTO v_values
      FROM regexp_matches(v_transaction_xml, '>([^<]*)<', 'g') WITH ORDINALITY AS found(match, ordinal)
     WHERE btrim(match[1]) <> '';
    v_md5 := upper(encode(public.digest(convert_to(v_values, 'LATIN1'), 'md5'), 'hex'));
    v_xml := v_transaction_xml || '<ans:epilogo><ans:hash>' || v_md5 || '</ans:hash></ans:epilogo></ans:mensagemTISS>';
    v_sha256 := encode(public.digest(convert_to(v_xml, 'UTF8'), 'sha256'), 'hex');

    INSERT INTO public.tiss_xml(
      company_id, unit_id, appointment_id, cd_convenio, ds_descricao,
      ds_filename, dt_fatura, ds_tipo_guia, vl_informado, vl_processado,
      vl_liberado, vl_glosa, bl_xml_enviado, ds_hash_envio,
      ds_versao_tiss, tp_ambiente, status, guide_id, billing_account_id
    ) VALUES (
      v_company, v_unit, v_account.appointment_id, v_account.insurance_id,
      'Conta ' || v_account.id::TEXT || ' - guia ' || v_guide.guide_number::TEXT,
      'tiss_' || v_account.id::TEXT || '.xml', CURRENT_DATE, p_guide_type,
      v_account.total_net_amount, 0, 0, 0, v_xml, v_sha256,
      '4.03.00', p_environment, 'PENDENTE', v_guide.id, v_account.id
    ) RETURNING id INTO v_xml_id;
    UPDATE public.billing_accounts
       SET guide_number = v_guide.guide_number::TEXT,
           version = version + 1,
           updated_at = NOW()
     WHERE id = v_account.id;
  END IF;

  v_response := jsonb_build_object(
    'billing_account_id', v_account.id,
    'appointment_id', v_account.appointment_id,
    'unit_id', v_unit,
    'guide_id', v_guide.id,
    'guide_number', v_guide.guide_number,
    'xml_id', v_xml_id,
    'environment', p_environment
  );
  RETURN private.m16_finish_operation(v_company, p_operation_id, v_response);
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'Canonical TISS relation is missing for the billing account'
      USING ERRCODE = '23503';
END;
$function$;

ALTER FUNCTION public.m16_materialize_account_tiss_secure(UUID, UUID, INTEGER, TEXT, TEXT)
  OWNER TO prontomedic_tiss_rpc_owner;
REVOKE ALL ON FUNCTION public.m16_materialize_account_tiss_secure(UUID, UUID, INTEGER, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m16_materialize_account_tiss_secure(UUID, UUID, INTEGER, TEXT, TEXT)
  TO authenticated, app_prontomedic;

COMMENT ON FUNCTION public.m16_materialize_account_tiss_secure(UUID, UUID, INTEGER, TEXT, TEXT) IS
  'Atomically derives and persists a SP/SADT guide and XML from one canonical billing account.';

COMMIT;

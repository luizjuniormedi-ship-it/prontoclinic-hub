BEGIN;

REVOKE EXECUTE ON FUNCTION public.active_unit_id()
  FROM prontomedic_tiss_rpc_owner;

REVOKE ALL ON FUNCTION public.m16_materialize_account_tiss_secure(UUID, UUID, INTEGER, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
DROP FUNCTION IF EXISTS public.m16_materialize_account_tiss_secure(UUID, UUID, INTEGER, TEXT, TEXT);
DROP TRIGGER IF EXISTS trg_m16_assign_tiss_xml_unit ON public.tiss_xml;
DROP FUNCTION IF EXISTS private.m16_assign_tiss_xml_unit();
DROP FUNCTION IF EXISTS private.m16_xml_unescape(TEXT);
DROP FUNCTION IF EXISTS private.m16_xml_escape(TEXT);

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
  v_row public.tiss_guides;
BEGIN
  SELECT * INTO v_actor
    FROM private.m16_require_actor(ARRAY[]::TEXT[], FALSE, 'create');
  IF p_guide_type NOT IN (
    'CONSULTA','SP/SADT','INTERNACAO','RESUMO_INTERNACAO',
    'HONORARIO','OUTRAS_DESPESAS','RECURSO_GLOSA'
  ) THEN
    RAISE EXCEPTION 'Invalid TISS guide type';
  END IF;
  IF p_environment NOT IN ('HOMOLOGACAO', 'PRODUCAO') THEN
    RAISE EXCEPTION 'Invalid TISS environment';
  END IF;
  INSERT INTO public.tiss_guides(
    company_id, appointment_id, unit_id, billing_account_id, source_xml_id,
    guide_type, environment, created_by
  ) VALUES (
    v_actor.company_id, p_appointment_id, p_unit_id, p_billing_account_id,
    p_source_xml_id, p_guide_type, p_environment, v_actor.user_id
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
ALTER FUNCTION public.create_tiss_guide_secure(TEXT, BIGINT, INTEGER, UUID, BIGINT, TEXT)
  OWNER TO prontomedic_tiss_rpc_owner;
REVOKE ALL ON FUNCTION public.create_tiss_guide_secure(TEXT, BIGINT, INTEGER, UUID, BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic, prontomedic_tiss_gateway;
GRANT EXECUTE ON FUNCTION public.create_tiss_guide_secure(TEXT, BIGINT, INTEGER, UUID, BIGINT, TEXT)
  TO authenticated, app_prontomedic;

DROP POLICY IF EXISTS m16_xml_owner_all ON public.tiss_xml;
CREATE POLICY m16_xml_owner_all ON public.tiss_xml
  FOR ALL TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id())
  WITH CHECK (company_id = private.m16_tenant_id());
DROP POLICY IF EXISTS m16_guide_owner_all ON public.tiss_guides;
CREATE POLICY m16_guide_owner_all ON public.tiss_guides
  FOR ALL TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id())
  WITH CHECK (company_id = private.m16_tenant_id());
DROP POLICY IF EXISTS m16_denial_owner_all ON public.tiss_glosas;
CREATE POLICY m16_denial_owner_all ON public.tiss_glosas
  FOR ALL TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id())
  WITH CHECK (company_id = private.m16_tenant_id());
DROP POLICY IF EXISTS m16_guide_event_owner_all ON public.tiss_guide_events;
CREATE POLICY m16_guide_event_owner_all ON public.tiss_guide_events
  FOR ALL TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id())
  WITH CHECK (company_id = private.m16_tenant_id());

DROP INDEX IF EXISTS public.tiss_guides_active_account_uq;
DROP INDEX IF EXISTS public.tiss_xml_active_account_guide_uq;
DROP INDEX IF EXISTS public.tiss_xml_company_unit_account_idx;
ALTER TABLE public.tiss_xml DROP CONSTRAINT IF EXISTS tiss_xml_unit_id_fkey;

DROP POLICY IF EXISTS m16_materialization_companies_read ON public.companies;
DROP POLICY IF EXISTS m16_materialization_units_read ON public.units;
DROP POLICY IF EXISTS m16_materialization_patients_read ON public.patients;
DROP POLICY IF EXISTS m16_materialization_patient_insurances_read ON public.patient_insurances;
DROP POLICY IF EXISTS m16_materialization_insurance_plans_read ON public.insurance_plans;
DROP POLICY IF EXISTS m16_materialization_insurance_companies_read ON public.insurance_companies;
DROP POLICY IF EXISTS m16_materialization_price_tables_read ON public.price_tables;
DROP POLICY IF EXISTS m16_materialization_professionals_read ON public.professionals;
DROP POLICY IF EXISTS m16_materialization_services_read ON public.services_catalog;
DROP POLICY IF EXISTS m16_materialization_billing_update ON public.billing_accounts;
REVOKE SELECT ON TABLE
  public.companies,
  public.units,
  public.patients,
  public.patient_insurances,
  public.price_tables,
  public.professionals,
  public.services_catalog
FROM prontomedic_tiss_rpc_owner;
REVOKE UPDATE (guide_number, version, updated_at)
  ON public.billing_accounts FROM prontomedic_tiss_rpc_owner;

ALTER TABLE public.tiss_operation_requests
  DROP CONSTRAINT IF EXISTS tiss_operation_requests_operation_type_check;
ALTER TABLE public.tiss_operation_requests
  ADD CONSTRAINT tiss_operation_requests_operation_type_check
  CHECK (operation_type IN (
    'persist_xml', 'record_transmission', 'process_return', 'manual_denial',
    'monthly_batch', 'save_protocol'
  ));

COMMIT;

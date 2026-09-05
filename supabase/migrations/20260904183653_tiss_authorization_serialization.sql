BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)') IS NULL
     OR to_regclass('public.insurance_authorizations') IS NULL THEN
    RAISE EXCEPTION 'Canonical TISS materializer or authorization ledger is missing';
  END IF;
END
$preflight$;

REVOKE ALL PRIVILEGES ON public.insurance_authorizations
  FROM prontomedic_tiss_rpc_owner;
GRANT SELECT (
  id, company_id, unit_id, patient_id, appointment_id, insurance_id,
  insurance_plan_id, status, authorization_number, password_number,
  authorized_at, valid_until, quantity_authorized, quantity_used, updated_at
) ON public.insurance_authorizations TO prontomedic_tiss_rpc_owner;
GRANT UPDATE (id) ON public.insurance_authorizations TO prontomedic_tiss_rpc_owner;

DROP POLICY IF EXISTS m16_materialization_authorizations_read
  ON public.insurance_authorizations;
CREATE POLICY m16_materialization_authorizations_read
  ON public.insurance_authorizations
  FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  );

DROP POLICY IF EXISTS m16_materialization_authorizations_lock
  ON public.insurance_authorizations;
CREATE POLICY m16_materialization_authorizations_lock
  ON public.insurance_authorizations
  FOR UPDATE TO prontomedic_tiss_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  );

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
  v_authorization RECORD;
  v_materializable_authorization_statuses CONSTANT TEXT[] :=
    ARRAY['autorizada', 'parcialmente_autorizada'];
  v_authorization_xml TEXT;
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

  SELECT authz.id,
         authz.authorization_number,
         authz.password_number,
         authz.authorized_at,
         authz.valid_until,
         authz.quantity_authorized,
         authz.quantity_used
    INTO v_authorization
    FROM public.insurance_authorizations authz
   WHERE authz.company_id = v_company
     AND authz.unit_id = v_unit
     AND authz.patient_id = v_account.patient_id
     AND authz.appointment_id = v_account.appointment_id
     AND authz.insurance_id = v_account.insurance_id
     AND authz.insurance_plan_id = v_plan.id
     AND authz.authorization_number = v_account.authorization_number
     AND authz.status = ANY (v_materializable_authorization_statuses)
     AND (authz.valid_until IS NULL OR authz.valid_until >= CURRENT_DATE)
     AND authz.quantity_authorized IS NOT NULL
     AND authz.quantity_authorized > COALESCE(authz.quantity_used, 0)
   ORDER BY authz.authorized_at DESC NULLS LAST,
            authz.updated_at DESC,
            authz.id DESC
   LIMIT 1
   FOR UPDATE OF authz;

  IF v_authorization.id IS NULL OR v_authorization.authorized_at IS NULL THEN
    RAISE EXCEPTION 'Canonical TISS authorization is missing, expired, exhausted or has no authorization date'
      USING ERRCODE = '23514';
  END IF;
  IF length(v_authorization.authorization_number) > 20
     OR length(COALESCE(v_authorization.password_number, '')) > 20 THEN
    RAISE EXCEPTION 'Canonical TISS authorization number or password exceeds XSD limits'
      USING ERRCODE = '22001';
  END IF;

  v_authorization_xml := format(
    '<ans:dadosAutorizacao><ans:numeroGuiaOperadora>%s</ans:numeroGuiaOperadora><ans:dataAutorizacao>%s</ans:dataAutorizacao>%s%s</ans:dadosAutorizacao>',
    private.m16_xml_escape(v_authorization.authorization_number),
    to_char(v_authorization.authorized_at::DATE, 'YYYY-MM-DD'),
    CASE
      WHEN NULLIF(btrim(COALESCE(v_authorization.password_number, '')), '') IS NULL THEN ''
      ELSE '<ans:senha>' || private.m16_xml_escape(btrim(v_authorization.password_number)) || '</ans:senha>'
    END,
    CASE
      WHEN v_authorization.valid_until IS NULL THEN ''
      ELSE '<ans:dataValidadeSenha>' || to_char(v_authorization.valid_until, 'YYYY-MM-DD') || '</ans:dataValidadeSenha>'
    END
  );

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
    v_transaction_xml := replace(
      v_transaction_xml,
      '</ans:cabecalhoGuia><ans:dadosBeneficiario>',
      '</ans:cabecalhoGuia>' || v_authorization_xml || '<ans:dadosBeneficiario>'
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
  'Atomically derives a SP/SADT guide and XML, including its canonical authorization, from one billing account.';

COMMIT;

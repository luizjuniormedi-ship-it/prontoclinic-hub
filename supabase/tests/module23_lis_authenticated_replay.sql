-- Module 23 authenticated behavioral replay.
-- Disposable replay database only. Never run on production, VPS operational DB or DataSIGH.
BEGIN;

INSERT INTO public.companies (id, name, cnpj, lg_ativo)
VALUES
  ('00000000-0000-4000-8000-000000000231', 'M23 Tenant A', '00000000000231', TRUE),
  ('00000000-0000-4000-8000-000000000232', 'M23 Tenant B', '00000000000232', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_principal, lg_ativo)
VALUES
  (23001, '00000000-0000-4000-8000-000000000231', 'M23A', 'M23 Unit A', TRUE, TRUE),
  (23002, '00000000-0000-4000-8000-000000000232', 'M23B', 'M23 Unit B', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES
  ('00000000-0000-4000-8000-000000002301', 'm23-recorder-a@example.invalid', 'synthetic', NOW()),
  ('00000000-0000-4000-8000-000000002302', 'm23-validator-a@example.invalid', 'synthetic', NOW()),
  ('00000000-0000-4000-8000-000000002303', 'm23-doctor-a@example.invalid', 'synthetic', NOW()),
  ('00000000-0000-4000-8000-000000002304', 'm23-lab-b@example.invalid', 'synthetic', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (
  id, user_id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo
)
VALUES
  ('00000000-0000-4000-8000-000000002301', '00000000-0000-4000-8000-000000002301', 'M23 Recorder A', 'm23-recorder-a@example.invalid', 'laboratorio', '00000000-0000-4000-8000-000000000231', 23001, TRUE),
  ('00000000-0000-4000-8000-000000002302', '00000000-0000-4000-8000-000000002302', 'M23 Validator A', 'm23-validator-a@example.invalid', 'laboratorio', '00000000-0000-4000-8000-000000000231', 23001, TRUE),
  ('00000000-0000-4000-8000-000000002303', '00000000-0000-4000-8000-000000002303', 'M23 Doctor A', 'm23-doctor-a@example.invalid', 'medico', '00000000-0000-4000-8000-000000000231', 23001, TRUE),
  ('00000000-0000-4000-8000-000000002304', '00000000-0000-4000-8000-000000002304', 'M23 Lab B', 'm23-lab-b@example.invalid', 'laboratorio', '00000000-0000-4000-8000-000000000232', 23002, TRUE)
ON CONFLICT (id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    role_name = EXCLUDED.role_name,
    company_id = EXCLUDED.company_id,
    primary_unit_id = EXCLUDED.primary_unit_id,
    lg_ativo = TRUE;

INSERT INTO public.patients (id, company_id, full_name, cpf, lg_ativo)
VALUES
  (23001, '00000000-0000-4000-8000-000000000231', 'M23 Patient A', '00000000231', TRUE),
  (23002, '00000000-0000-4000-8000-000000000232', 'M23 Patient B', '00000000232', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.professionals (id, company_id, full_name, specialty, lg_ativo)
VALUES
  (23001, '00000000-0000-4000-8000-000000000231', 'M23 Doctor A', 'Patologia Clinica', TRUE),
  (23002, '00000000-0000-4000-8000-000000000232', 'M23 Doctor B', 'Patologia Clinica', TRUE)
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE app_prontomedic;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002301';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000231';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002301","company_id":"00000000-0000-4000-8000-000000000231","role":"authenticated"}';

SELECT
  auth.uid() AS auth_user_id,
  private.current_user_id() AS runtime_user_id,
  private.current_company_id() AS runtime_company_id;

SELECT (
  public.m23_upsert_exam_catalog_secure(
    NULL,
    '{
      "ds_exame":"Analito critico sintetico M23",
      "ds_sigla":"M23CRIT",
      "ds_categoria":"BIOQUIMICA",
      "ds_metodo":"SINTETICO",
      "ds_material":"SANGUE",
      "tp_tubo":"SORO",
      "vl_critico_minimo":"10",
      "vl_critico_maximo":"500",
      "nr_prazo_dias":"1",
      "preparo_instrucoes":"Fixture descartavel"
    }'::JSONB
  )->>'exam_id'
)::BIGINT AS exam_id \gset m23_

SELECT (
  public.m23_upsert_reference_range_secure(
    NULL,
    :'m23_exam_id'::BIGINT,
    '{
      "parameter":"Analito M23",
      "minimumValue":"70",
      "maximumValue":"110",
      "unit":"mg/dL",
      "sex":"A",
      "minimumAge":"0",
      "maximumAge":"120",
      "active":"true"
    }'::JSONB
  )->>'reference_id'
)::BIGINT AS reference_id \gset m23_

SELECT (
  public.m23_upsert_equipment_secure(
    NULL,
    23001,
    '{
      "code":"M23-EQ-A",
      "name":"Analisador sintetico M23",
      "integration_kind":"MANUAL",
      "status":"ACTIVE",
      "active":"true"
    }'::JSONB
  )->>'equipment_id'
)::UUID AS equipment_id \gset m23_

SELECT (
  public.m23_create_lab_order_secure(
    23001,
    23001,
    23001,
    NULL,
    'URGENTE',
    'Hipotese sintetica M23',
    'Replay descartavel',
    jsonb_build_array(
      jsonb_build_object('exam_id', :'m23_exam_id'::BIGINT, 'notes', 'M23')
    )
  )->>'order_id'
)::BIGINT AS order_id \gset m23_

SELECT (
  public.m23_create_lab_order_secure(
    23001,
    23001,
    23001,
    NULL,
    'ROTINA',
    'Pedido de recoleta sintetico',
    'Replay descartavel',
    jsonb_build_array(
      jsonb_build_object('exam_id', :'m23_exam_id'::BIGINT, 'notes', 'M23 recollection')
    )
  )->>'order_id'
)::BIGINT AS recollection_order_id \gset m23_

SELECT id AS order_item_id
FROM public.exames_lab_pedido_itens
WHERE cd_pedido = :'m23_order_id'::BIGINT
\gset m23_

SELECT id AS recollection_item_id
FROM public.exames_lab_pedido_itens
WHERE cd_pedido = :'m23_recollection_order_id'::BIGINT
\gset m23_

SELECT (
  public.m23_collect_specimen_secure(
    :'m23_order_id'::BIGINT,
    'SANGUE',
    'TUBO_SORO',
    ARRAY[:'m23_order_item_id'::BIGINT],
    'M23-ACCESSION-A'
  )->>'specimen_id'
)::UUID AS specimen_id \gset m23_

SELECT (
  public.m23_collect_specimen_secure(
    :'m23_recollection_order_id'::BIGINT,
    'SANGUE',
    'TUBO_SORO',
    ARRAY[:'m23_recollection_item_id'::BIGINT],
    'M23-RECOLLECTION-A'
  )->>'specimen_id'
)::UUID AS recollection_specimen_id \gset m23_

SELECT public.m23_transition_specimen_secure(
  :'m23_recollection_specimen_id'::UUID,
  'RECOLLECTION_REQUIRED',
  'Amostra sintetica hemolisada'
);

SELECT public.m23_transition_specimen_secure(
  :'m23_specimen_id'::UUID,
  'RECEIVED',
  NULL
);
SELECT public.m23_transition_specimen_secure(
  :'m23_specimen_id'::UUID,
  'PROCESSING',
  NULL
);

SELECT public.m23_record_qc_run_secure(
  :'m23_equipment_id'::UUID,
  'Controle sintetico',
  'LOTE-M23',
  'NORMAL',
  100,
  100,
  90,
  110,
  'QC aprovado no replay descartavel'
);

SELECT public.m23_record_results_secure(
  :'m23_order_item_id'::BIGINT,
  '[{
    "parameter":"Analito M23",
    "numeric_value":"600",
    "unit":"mg/dL",
    "reference_min":"70",
    "reference_max":"110",
    "reagent_lot":"LOTE-M23",
    "note":"Resultado critico sintetico"
  }]'::JSONB,
  :'m23_equipment_id'::UUID
);

SELECT a.id AS alert_id
FROM public.exames_lab_alerta_critico a
JOIN public.exames_lab_resultado r ON r.id = a.cd_resultado
WHERE r.cd_item_pedido = :'m23_order_item_id'::BIGINT
  AND r.is_current = TRUE
  AND a.lg_comunicado = FALSE
\gset m23_

CREATE TEMP TABLE m23_replay_state AS
SELECT
  :'m23_exam_id'::BIGINT AS exam_id,
  :'m23_reference_id'::BIGINT AS reference_id,
  :'m23_order_id'::BIGINT AS order_id,
  :'m23_order_item_id'::BIGINT AS order_item_id,
  :'m23_specimen_id'::UUID AS specimen_id,
  :'m23_recollection_specimen_id'::UUID AS recollection_specimen_id,
  :'m23_alert_id'::BIGINT AS alert_id;

DO $same_actor_denial$
DECLARE
  v_blocked BOOLEAN := FALSE;
  v_order_item_id BIGINT;
BEGIN
  SELECT order_item_id INTO v_order_item_id FROM m23_replay_state;
  BEGIN
    PERFORM public.m23_validate_result_secure(
      v_order_item_id,
      'TECHNICAL_VALIDATE',
      'Must be denied'
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M23 result recorder validated the same result';
  END IF;
END
$same_actor_denial$;

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002304';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000232';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002304","company_id":"00000000-0000-4000-8000-000000000232","role":"authenticated"}';

DO $cross_tenant$
DECLARE
  v_count INTEGER;
  v_blocked BOOLEAN := FALSE;
  v_specimen_id UUID;
BEGIN
  SELECT specimen_id INTO v_specimen_id FROM m23_replay_state;
  SELECT COUNT(*) INTO v_count
  FROM public.lab_specimens
  WHERE id = v_specimen_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M23 cross-tenant specimen is visible';
  END IF;

  BEGIN
    PERFORM public.m23_transition_specimen_secure(
      v_specimen_id,
      'STORED',
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M23 cross-tenant specimen transition was allowed';
  END IF;
END
$cross_tenant$;

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002302';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000231';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002302","company_id":"00000000-0000-4000-8000-000000000231","role":"authenticated"}';

SELECT public.m23_validate_result_secure(
  :'m23_order_item_id'::BIGINT,
  'TECHNICAL_VALIDATE',
  'Validacao tecnica sintetica'
);
SELECT public.m23_acknowledge_critical_alert_secure(
  :'m23_alert_id'::BIGINT,
  'TELEFONE',
  'Comunicacao sintetica registrada'
);

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002303';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000231';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002303","company_id":"00000000-0000-4000-8000-000000000231","role":"authenticated"}';

SELECT public.m23_validate_result_secure(
  :'m23_order_item_id'::BIGINT,
  'MEDICAL_VALIDATE',
  'Validacao medica sintetica'
);
SELECT public.m23_validate_result_secure(
  :'m23_order_item_id'::BIGINT,
  'RELEASE',
  'Liberacao sintetica'
);

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002302';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000231';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002302","company_id":"00000000-0000-4000-8000-000000000231","role":"authenticated"}';

SELECT public.m23_deliver_order_secure(
  :'m23_order_id'::BIGINT,
  'PORTAL',
  'Paciente sintetico',
  '{"channel":"synthetic-replay"}'::JSONB
);

DO $assertions$
DECLARE
  v_count INTEGER;
  v_status TEXT;
  v_order_id BIGINT;
  v_order_item_id BIGINT;
  v_recollection_specimen_id UUID;
  v_alert_id BIGINT;
  v_exam_id BIGINT;
  v_reference_id BIGINT;
BEGIN
  SELECT
    exam_id, reference_id, order_id, order_item_id,
    recollection_specimen_id, alert_id
    INTO
      v_exam_id, v_reference_id, v_order_id, v_order_item_id,
      v_recollection_specimen_id, v_alert_id
  FROM m23_replay_state;

  SELECT tp_status INTO v_status
  FROM public.exames_lab_pedido
  WHERE id = v_order_id;
  IF v_status <> 'ENTREGUE' THEN
    RAISE EXCEPTION 'M23 order final status mismatch: %', v_status;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.lab_result_validations
  WHERE order_item_id = v_order_item_id
    AND validation_type IN ('TECHNICAL', 'MEDICAL', 'RELEASE');
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'M23 validation chain mismatch: %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.exames_lab_valor_referencia
    WHERE id = v_reference_id
      AND cd_exame = v_exam_id
      AND vl_minimo = 70
      AND vl_maximo = 110
      AND lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'M23 reference range was not persisted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.lab_specimens
    WHERE id = v_recollection_specimen_id
      AND status = 'RECOLLECTION_REQUIRED'
      AND rejection_reason = 'Amostra sintetica hemolisada'
  ) THEN
    RAISE EXCEPTION 'M23 recollection workflow was not persisted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.exames_lab_alerta_critico
    WHERE id = v_alert_id
      AND lg_comunicado = TRUE
  ) THEN
    RAISE EXCEPTION 'M23 critical result communication is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.lab_delivery_events
    WHERE order_id = v_order_id
      AND delivery_method = 'PORTAL'
  ) THEN
    RAISE EXCEPTION 'M23 delivery event is missing';
  END IF;
END
$assertions$;

RESET ROLE;

SELECT
  'M23_LIS_AUTHENTICATED_REPLAY_PASS' AS result,
  (SELECT COUNT(*) FROM public.lab_specimen_events) AS specimen_events,
  (SELECT COUNT(*) FROM public.lab_result_validations) AS validations,
  (SELECT COUNT(*) FROM public.lab_delivery_events) AS deliveries;

ROLLBACK;

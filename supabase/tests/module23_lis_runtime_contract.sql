\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_database() !~ '^prontomedic_reception_[a-z0-9_]+$' THEN
    RAISE EXCEPTION
      'Module 23 runtime contract is restricted to disposable reception databases';
  END IF;
END;
$guard$;

BEGIN;

DO $assert_result_rpc_signature$
BEGIN
  IF to_regprocedure(
       'public.m23_record_results_secure(bigint,jsonb,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'Final result RPC signature m23_record_results_secure(BIGINT, JSONB, UUID) is missing';
  END IF;
  IF to_regprocedure(
       'public.m23_record_results_secure(bigint,jsonb)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'Legacy result RPC without mandatory operation_id remains exposed';
  END IF;
END;
$assert_result_rpc_signature$;

CREATE TEMP TABLE lis_contract_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE ON lis_contract_state TO app_prontomedic;

INSERT INTO public.companies (id, name, cnpj, phone, email, lg_ativo)
VALUES
  (
    '23000000-0000-4000-8000-000000000001',
    'LIS Synthetic A',
    '23000000000001',
    '00000002301',
    'lis-a@example.invalid',
    TRUE
  ),
  (
    '23000000-0000-4000-8000-000000000002',
    'LIS Synthetic B',
    '23000000000002',
    '00000002302',
    'lis-b@example.invalid',
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET lg_ativo = TRUE;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    '23000000-0000-4000-8000-000000000011',
    'lis-lab-a@example.invalid',
    crypt('Synthetic-Only-Password-123!', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"LIS Lab A"}',
    NOW(),
    NOW()
  ),
  (
    '23000000-0000-4000-8000-000000000012',
    'lis-lab-accent-a@example.invalid',
    crypt('Synthetic-Only-Password-123!', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"LIS Lab Accent A"}',
    NOW(),
    NOW()
  ),
  (
    '23000000-0000-4000-8000-000000000013',
    'lis-reception-a@example.invalid',
    crypt('Synthetic-Only-Password-123!', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"LIS Reception A"}',
    NOW(),
    NOW()
  ),
  (
    '23000000-0000-4000-8000-000000000021',
    'lis-lab-b@example.invalid',
    crypt('Synthetic-Only-Password-123!', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"LIS Lab B"}',
    NOW(),
    NOW()
  )
ON CONFLICT (id) DO UPDATE SET updated_at = NOW();

INSERT INTO public.user_profiles (
  id, user_id, full_name, email, role_name, company_id, lg_ativo
)
VALUES
  (
    '23000000-0000-4000-8000-000000000011',
    '23000000-0000-4000-8000-000000000011',
    'LIS Lab A',
    'lis-lab-a@example.invalid',
    'laboratorio',
    '23000000-0000-4000-8000-000000000001',
    TRUE
  ),
  (
    '23000000-0000-4000-8000-000000000012',
    '23000000-0000-4000-8000-000000000012',
    'LIS Lab Accent A',
    'lis-lab-accent-a@example.invalid',
    'laboratório',
    '23000000-0000-4000-8000-000000000001',
    TRUE
  ),
  (
    '23000000-0000-4000-8000-000000000013',
    '23000000-0000-4000-8000-000000000013',
    'LIS Reception A',
    'lis-reception-a@example.invalid',
    'recepcao',
    '23000000-0000-4000-8000-000000000001',
    TRUE
  ),
  (
    '23000000-0000-4000-8000-000000000021',
    '23000000-0000-4000-8000-000000000021',
    'LIS Lab B',
    'lis-lab-b@example.invalid',
    'laboratorio',
    '23000000-0000-4000-8000-000000000002',
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET
  role_name = EXCLUDED.role_name,
  company_id = EXCLUDED.company_id,
  lg_ativo = TRUE;

INSERT INTO public.patients (
  id,
  company_id,
  full_name,
  birth_date,
  sex
)
VALUES
  (
    230001,
    '23000000-0000-4000-8000-000000000001',
    'LIS Synthetic Patient A',
    DATE '1990-01-01',
    'F'
  ),
  (
    230002,
    '23000000-0000-4000-8000-000000000002',
    'LIS Synthetic Patient B',
    DATE '1990-01-01',
    'M'
  )
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  birth_date = EXCLUDED.birth_date,
  sex = EXCLUDED.sex;

INSERT INTO public.professionals (id, company_id, full_name)
VALUES
  (
    230011,
    '23000000-0000-4000-8000-000000000001',
    'LIS Synthetic Professional A'
  ),
  (
    230012,
    '23000000-0000-4000-8000-000000000002',
    'LIS Synthetic Professional B'
  )
ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id;

SET LOCAL ROLE app_prontomedic;
SELECT set_config(
  'request.jwt.claim.sub',
  '23000000-0000-4000-8000-000000000011',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.company_id',
  '23000000-0000-4000-8000-000000000001',
  TRUE
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '23000000-0000-4000-8000-000000000011',
    'company_id', '23000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::TEXT,
  TRUE
);

DO $assert_role_aliases$
BEGIN
  IF NOT public.is_lab_user(
       '23000000-0000-4000-8000-000000000011'
     ) THEN
    RAISE EXCEPTION 'Unaccented laboratorio alias was not authorized';
  END IF;
END;
$assert_role_aliases$;

INSERT INTO lis_contract_state (key, value)
SELECT
  'exam_a',
  public.m23_upsert_exam_catalog_secure(
    '{
      "ds_exame":"Glicose Synthetic A",
      "ds_sigla":"GLIA",
      "ds_categoria":"BIOQUIMICA",
      "nr_prazo_dias":1,
      "vl_particular":"45.50",
      "vl_convenio":"38.10",
      "lg_ativo":true
    }'::JSONB
  );

INSERT INTO lis_contract_state (key, value)
SELECT
  'reference_a',
  public.m23_upsert_reference_range_secure(
    jsonb_build_object(
      'cd_exame', (
        SELECT (value->>'id')::BIGINT
          FROM lis_contract_state
         WHERE key = 'exam_a'
      ),
      'ds_parametro', 'Glicose',
      'vl_minimo', 70,
      'vl_maximo', 99,
      'ds_unidade', 'mg/dL',
      'cd_sexo', 'A',
      'nr_idade_min', 0,
      'nr_idade_max', 120,
      'lg_ativo', TRUE
    )
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '23000000-0000-4000-8000-000000000012',
  TRUE
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '23000000-0000-4000-8000-000000000012',
    'company_id', '23000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::TEXT,
  TRUE
);

DO $assert_accented_role_alias$
BEGIN
  IF NOT public.is_lab_user(
       '23000000-0000-4000-8000-000000000012'
     ) THEN
    RAISE EXCEPTION 'Accented laboratorio alias was not authorized';
  END IF;
END;
$assert_accented_role_alias$;

UPDATE lis_contract_state
   SET value = public.m23_upsert_exam_catalog_secure(
     jsonb_build_object(
       'id', (value->>'id')::BIGINT,
       'vl_particular', '55.50'
     )
   )
 WHERE key = 'exam_a';

DO $assert_accented_alias_rpc$
BEGIN
  IF (
    SELECT value->>'vl_particular'
      FROM lis_contract_state
     WHERE key = 'exam_a'
  ) IS DISTINCT FROM '55.50' THEN
    RAISE EXCEPTION 'Accented laboratorio alias could not update catalog';
  END IF;
END;
$assert_accented_alias_rpc$;

SELECT set_config(
  'request.jwt.claim.sub',
  '23000000-0000-4000-8000-000000000021',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.company_id',
  '23000000-0000-4000-8000-000000000002',
  TRUE
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '23000000-0000-4000-8000-000000000021',
    'company_id', '23000000-0000-4000-8000-000000000002',
    'role', 'authenticated'
  )::TEXT,
  TRUE
);

INSERT INTO lis_contract_state (key, value)
SELECT
  'exam_b',
  public.m23_upsert_exam_catalog_secure(
    '{
      "ds_exame":"Glicose Synthetic B",
      "ds_sigla":"GLIB",
      "nr_prazo_dias":1,
      "vl_particular":"60.00",
      "vl_convenio":"50.00",
      "lg_ativo":true
    }'::JSONB
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '23000000-0000-4000-8000-000000000011',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.company_id',
  '23000000-0000-4000-8000-000000000001',
  TRUE
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '23000000-0000-4000-8000-000000000011',
    'company_id', '23000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::TEXT,
  TRUE
);

DO $assert_tenant_read_and_direct_dml$
DECLARE
  v_rejected BOOLEAN := FALSE;
BEGIN
  IF (
    SELECT count(*)
      FROM public.exames_lab_catalogo
     WHERE id = (
       SELECT (value->>'id')::BIGINT
         FROM lis_contract_state
        WHERE key = 'exam_b'
     )
  ) <> 0 THEN
    RAISE EXCEPTION 'Tenant A can read tenant B lab catalog';
  END IF;

  BEGIN
    INSERT INTO public.exames_lab_catalogo (
      company_id, ds_exame, ds_sigla
    ) VALUES (
      '23000000-0000-4000-8000-000000000001',
      'Forbidden Direct Write',
      'FORBID'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Direct client LIS DML unexpectedly succeeded';
  END IF;
END;
$assert_tenant_read_and_direct_dml$;

INSERT INTO lis_contract_state (key, value)
SELECT
  'order_a',
  public.m23_create_lab_order_secure(
    '23000000-0000-4000-8000-000000000101',
    '{
      "cd_paciente":230001,
      "cd_medico":230011,
      "cd_tipo_atendimento":"AMBULATORIAL",
      "tp_prioridade":"ROTINA",
      "nr_protocolo_lab":"LIS-A-001"
    }'::JSONB,
    jsonb_build_array(
      jsonb_build_object(
        'cd_exame', (
          SELECT (value->>'id')::BIGINT
            FROM lis_contract_state
           WHERE key = 'exam_a'
        ),
        'ds_observacao', 'Synthetic only'
      )
    )
  );

INSERT INTO lis_contract_state (key, value)
SELECT
  'order_a_repeated',
  public.m23_create_lab_order_secure(
    '23000000-0000-4000-8000-000000000101',
    '{
      "cd_paciente":230001,
      "cd_medico":230011,
      "cd_tipo_atendimento":"AMBULATORIAL",
      "tp_prioridade":"ROTINA",
      "nr_protocolo_lab":"LIS-A-001"
    }'::JSONB,
    jsonb_build_array(
      jsonb_build_object(
        'cd_exame', (
          SELECT (value->>'id')::BIGINT
            FROM lis_contract_state
           WHERE key = 'exam_a'
        ),
        'ds_observacao', 'Synthetic only'
      )
    )
  );

DO $assert_order_json_and_idempotency$
DECLARE
  v_order JSONB;
BEGIN
  SELECT value INTO v_order
    FROM lis_contract_state
   WHERE key = 'order_a';
  IF jsonb_typeof(v_order) <> 'object'
     OR jsonb_typeof(v_order->'itens_ids') <> 'array'
     OR jsonb_array_length(v_order->'itens_ids') <> 1
     OR (v_order->>'pedido_id')::BIGINT IS NULL
     OR v_order IS DISTINCT FROM (
       SELECT value
         FROM lis_contract_state
        WHERE key = 'order_a_repeated'
     ) THEN
    RAISE EXCEPTION 'Order JSON/idempotency contract failed';
  END IF;

  IF (
    SELECT count(*)
      FROM public.exames_lab_pedido
     WHERE nr_protocolo_lab = 'LIS-A-001'
  ) <> 1 THEN
    RAISE EXCEPTION 'Idempotent order persisted duplicate rows';
  END IF;
END;
$assert_order_json_and_idempotency$;

INSERT INTO lis_contract_state (key, value)
SELECT
  'pending_result_order',
  public.m23_create_lab_order_secure(
    '23000000-0000-4000-8000-000000000105',
    '{
      "cd_paciente":230001,
      "cd_medico":230011,
      "nr_protocolo_lab":"LIS-PENDING-RESULT-001"
    }'::JSONB,
    jsonb_build_array(
      jsonb_build_object(
        'cd_exame', (
          SELECT (value->>'id')::BIGINT
            FROM lis_contract_state
           WHERE key = 'exam_a'
        )
      )
    )
  );

DO $assert_pending_item_rejects_results$
DECLARE
  v_item_id BIGINT := (
    SELECT (value->'itens_ids'->>0)::BIGINT
      FROM lis_contract_state
     WHERE key = 'pending_result_order'
  );
  v_rejected BOOLEAN := FALSE;
  v_error TEXT;
BEGIN
  BEGIN
    PERFORM public.m23_record_results_secure(
      v_item_id,
      jsonb_build_array(
        jsonb_build_object(
          'cd_valor_referencia', (
            SELECT (value->>'id')::BIGINT
              FROM lis_contract_state
             WHERE key = 'reference_a'
          ),
          'ds_parametro', 'Glicose',
          'vl_resultado', 90,
          'vl_minimo_referencia', 70,
          'vl_maximo_referencia', 99,
          'ds_unidade', 'mg/dL'
        )
      ),
      '23000000-0000-4000-8000-000000000203'
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    v_rejected :=
      lower(v_error) LIKE '%pending%'
      OR lower(v_error) LIKE '%pendente%'
      OR lower(v_error) LIKE '%collect%'
      OR lower(v_error) LIKE '%colet%';
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'PENDENTE lab item accepted a result';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_resultado
     WHERE cd_item_pedido = v_item_id
  ) OR (
    SELECT tp_status
      FROM public.exames_lab_pedido_itens
     WHERE id = v_item_id
  ) IS DISTINCT FROM 'PENDENTE' THEN
    RAISE EXCEPTION 'Rejected PENDENTE result attempt left persisted state';
  END IF;
END;
$assert_pending_item_rejects_results$;

DO $assert_operation_reuse_and_atomicity$
DECLARE
  v_rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.m23_create_lab_order_secure(
      '23000000-0000-4000-8000-000000000101',
      '{
        "cd_paciente":230001,
        "cd_medico":230011,
        "nr_protocolo_lab":"REUSED-DIFFERENT"
      }'::JSONB,
      jsonb_build_array(
        jsonb_build_object(
          'cd_exame', (
            SELECT (value->>'id')::BIGINT
              FROM lis_contract_state
             WHERE key = 'exam_a'
          )
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE
      '%operation id reused with different payload%';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Order operation id accepted a different payload';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.m23_create_lab_order_secure(
      '23000000-0000-4000-8000-000000000102',
      '{
        "cd_paciente":230001,
        "cd_medico":230011,
        "nr_protocolo_lab":"CROSS-ITEM-A"
      }'::JSONB,
      jsonb_build_array(
        jsonb_build_object(
          'cd_exame', (
            SELECT (value->>'id')::BIGINT
              FROM lis_contract_state
             WHERE key = 'exam_b'
          )
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Cross-company exam was accepted in a lab order';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_pedido
     WHERE nr_protocolo_lab = 'CROSS-ITEM-A'
  ) THEN
    RAISE EXCEPTION 'Failed cross-company order left an orphan header';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.m23_create_lab_order_secure(
      '23000000-0000-4000-8000-000000000103',
      '{
        "cd_paciente":230002,
        "cd_medico":230011,
        "nr_protocolo_lab":"CROSS-PATIENT-A"
      }'::JSONB,
      jsonb_build_array(
        jsonb_build_object(
          'cd_exame', (
            SELECT (value->>'id')::BIGINT
              FROM lis_contract_state
             WHERE key = 'exam_a'
          )
        )
      )
    );
  EXCEPTION WHEN foreign_key_violation OR insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Cross-company patient was accepted in a lab order';
  END IF;
END;
$assert_operation_reuse_and_atomicity$;

DO $assert_collect_requires_sample_id$
DECLARE
  v_item_id BIGINT := (
    SELECT (value->'itens_ids'->>0)::BIGINT
      FROM lis_contract_state
     WHERE key = 'order_a'
  );
  v_rejected BOOLEAN;
BEGIN
  v_rejected := FALSE;
  BEGIN
    PERFORM public.m23_collect_specimen_secure(v_item_id, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM = 'Sample id is required';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Collect specimen accepted a null sample id';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.m23_collect_specimen_secure(v_item_id, '   ');
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM = 'Sample id is required';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Collect specimen accepted an empty sample id';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_pedido_itens
     WHERE id = v_item_id
       AND (
         tp_status IS DISTINCT FROM 'PENDENTE'
         OR dt_coleta IS NOT NULL
         OR ds_amostra_id IS NOT NULL
       )
  ) THEN
    RAISE EXCEPTION
      'Rejected collection changed item state before a sample id existed';
  END IF;
END;
$assert_collect_requires_sample_id$;

INSERT INTO lis_contract_state (key, value)
SELECT
  'collected_item',
  public.m23_collect_specimen_secure(
    (
      SELECT (value->'itens_ids'->>0)::BIGINT
        FROM lis_contract_state
       WHERE key = 'order_a'
    ),
    'SYNTHETIC-SAMPLE-A'
  );

DO $assert_collect_output$
BEGIN
  IF (
    SELECT value->>'tp_status'
      FROM lis_contract_state
     WHERE key = 'collected_item'
  ) IS DISTINCT FROM 'COLETADO'
     OR (
       SELECT value->>'ds_amostra_id'
         FROM lis_contract_state
        WHERE key = 'collected_item'
     ) IS DISTINCT FROM 'SYNTHETIC-SAMPLE-A' THEN
    RAISE EXCEPTION 'Collect specimen output is unstable';
  END IF;
END;
$assert_collect_output$;

DO $assert_collect_sample_id_is_immutable$
DECLARE
  v_item_id BIGINT := (
    SELECT (value->'itens_ids'->>0)::BIGINT
      FROM lis_contract_state
     WHERE key = 'order_a'
  );
  v_retry JSONB;
  v_rejected BOOLEAN := FALSE;
BEGIN
  v_retry := public.m23_collect_specimen_secure(
    v_item_id,
    'SYNTHETIC-SAMPLE-A'
  );
  IF v_retry->>'tp_status' IS DISTINCT FROM 'COLETADO'
     OR v_retry->>'ds_amostra_id'
        IS DISTINCT FROM 'SYNTHETIC-SAMPLE-A' THEN
    RAISE EXCEPTION 'Collect specimen retry is not idempotent';
  END IF;

  BEGIN
    PERFORM public.m23_collect_specimen_secure(
      v_item_id,
      'SYNTHETIC-SAMPLE-CHANGED'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM = 'Collected sample id cannot be changed';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Collect specimen allowed sample id mutation';
  END IF;

  IF (
    SELECT ds_amostra_id
      FROM public.exames_lab_pedido_itens
     WHERE id = v_item_id
  ) IS DISTINCT FROM 'SYNTHETIC-SAMPLE-A' THEN
    RAISE EXCEPTION 'Rejected sample id mutation changed stored identity';
  END IF;
END;
$assert_collect_sample_id_is_immutable$;

DO $assert_result_operation_id_required$
DECLARE
  v_item_id BIGINT := (
    SELECT (value->'itens_ids'->>0)::BIGINT
      FROM lis_contract_state
     WHERE key = 'order_a'
  );
  v_rejected BOOLEAN := FALSE;
  v_error TEXT;
BEGIN
  BEGIN
    PERFORM public.m23_record_results_secure(
      v_item_id,
      jsonb_build_array(
        jsonb_build_object(
          'cd_valor_referencia', (
            SELECT (value->>'id')::BIGINT
              FROM lis_contract_state
             WHERE key = 'reference_a'
          ),
          'ds_parametro', 'Glicose',
          'vl_resultado', 200,
          'vl_minimo_referencia', 70,
          'vl_maximo_referencia', 99,
          'ds_unidade', 'mg/dL'
        )
      ),
      NULL::UUID
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    v_rejected :=
      lower(v_error) LIKE '%operation%'
      AND lower(v_error) LIKE '%required%';
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Result RPC accepted a null operation_id';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_resultado
     WHERE cd_item_pedido = v_item_id
  ) THEN
    RAISE EXCEPTION 'Rejected null result operation_id left persisted state';
  END IF;
END;
$assert_result_operation_id_required$;

INSERT INTO lis_contract_state (key, value)
SELECT
  'results_a',
  public.m23_record_results_secure(
    (
      SELECT (value->'itens_ids'->>0)::BIGINT
        FROM lis_contract_state
       WHERE key = 'order_a'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'cd_valor_referencia', (
          SELECT (value->>'id')::BIGINT
            FROM lis_contract_state
           WHERE key = 'reference_a'
        ),
        'ds_parametro', 'Glicose',
        'vl_resultado', 200,
        'vl_minimo_referencia', 70,
        'vl_maximo_referencia', 99,
        'ds_unidade', 'mg/dL',
        'tp_resultado', 'NORMAL'
      )
    ),
    '23000000-0000-4000-8000-000000000201'
  );

INSERT INTO lis_contract_state (key, value)
SELECT
  'results_a_repeated',
  public.m23_record_results_secure(
    (
      SELECT (value->'itens_ids'->>0)::BIGINT
        FROM lis_contract_state
       WHERE key = 'order_a'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'cd_valor_referencia', (
          SELECT (value->>'id')::BIGINT
            FROM lis_contract_state
           WHERE key = 'reference_a'
        ),
        'ds_parametro', 'Glicose',
        'vl_resultado', 200,
        'vl_minimo_referencia', 70,
        'vl_maximo_referencia', 99,
        'ds_unidade', 'mg/dL',
        'tp_resultado', 'NORMAL'
      )
    ),
    '23000000-0000-4000-8000-000000000201'
  );

DO $assert_results_and_analysis_transition$
DECLARE
  v_item_id BIGINT := (
    SELECT (value->'itens_ids'->>0)::BIGINT
      FROM lis_contract_state
     WHERE key = 'order_a'
  );
  v_order_id BIGINT := (
    SELECT (value->>'pedido_id')::BIGINT
      FROM lis_contract_state
     WHERE key = 'order_a'
  );
BEGIN
  IF (
    SELECT jsonb_typeof(value)
      FROM lis_contract_state
     WHERE key = 'results_a'
  ) <> 'array'
     OR (
       SELECT jsonb_array_length(value)
         FROM lis_contract_state
        WHERE key = 'results_a'
     ) <> 1
     OR (
        SELECT value->0->>'tp_resultado'
          FROM lis_contract_state
         WHERE key = 'results_a'
     ) IS DISTINCT FROM 'CRITICO_ALTO'
     OR (
       SELECT value
         FROM lis_contract_state
        WHERE key = 'results_a'
     ) IS DISTINCT FROM (
       SELECT value
         FROM lis_contract_state
        WHERE key = 'results_a_repeated'
     ) THEN
    RAISE EXCEPTION 'Result array/classification contract failed';
  END IF;
  IF (
    SELECT tp_status
      FROM public.exames_lab_pedido_itens
     WHERE id = v_item_id
  ) IS DISTINCT FROM 'EM_ANALISE'
     OR (
       SELECT tp_status
         FROM public.exames_lab_pedido
        WHERE id = v_order_id
     ) IS DISTINCT FROM 'EM_ANALISE' THEN
    RAISE EXCEPTION 'Result write did not atomically move item/order to EM_ANALISE';
  END IF;
  IF (
    SELECT count(*)
      FROM public.exames_lab_alerta_critico
     WHERE cd_resultado = (
       SELECT (value->0->>'id')::BIGINT
         FROM lis_contract_state
        WHERE key = 'results_a'
     )
       AND tp_status = 'PENDENTE'
       AND NOT lg_comunicado
  ) <> 1 THEN
    RAISE EXCEPTION 'Critical result did not create exactly one tenant alert';
  END IF;
  IF (
    SELECT count(*)
      FROM public.exames_lab_pedido
     WHERE nr_protocolo_lab = 'LIS-A-001'
  ) <> 1 OR (
    SELECT count(*)
      FROM public.exames_lab_resultado
     WHERE cd_item_pedido = v_item_id
  ) <> 1 THEN
    RAISE EXCEPTION
      'Idempotent result retry did not preserve one order and one result';
  END IF;
END;
$assert_results_and_analysis_transition$;

DO $assert_result_operation_reuse$
DECLARE
  v_item_id BIGINT := (
    SELECT (value->'itens_ids'->>0)::BIGINT
      FROM lis_contract_state
     WHERE key = 'order_a'
  );
  v_rejected BOOLEAN := FALSE;
  v_error TEXT;
BEGIN
  BEGIN
    PERFORM public.m23_record_results_secure(
      v_item_id,
      jsonb_build_array(
        jsonb_build_object(
          'cd_valor_referencia', (
            SELECT (value->>'id')::BIGINT
              FROM lis_contract_state
             WHERE key = 'reference_a'
          ),
          'ds_parametro', 'Glicose',
          'vl_resultado', 201,
          'vl_minimo_referencia', 70,
          'vl_maximo_referencia', 99,
          'ds_unidade', 'mg/dL',
          'tp_resultado', 'NORMAL'
        )
      ),
      '23000000-0000-4000-8000-000000000201'
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    v_rejected :=
      lower(v_error) LIKE '%operation%'
      AND lower(v_error) LIKE '%payload%';
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION
      'Result operation_id accepted a different payload';
  END IF;
  IF (
    SELECT count(*)
      FROM public.exames_lab_resultado
     WHERE cd_item_pedido = v_item_id
  ) <> 1 OR (
    SELECT vl_resultado
      FROM public.exames_lab_resultado
     WHERE cd_item_pedido = v_item_id
  ) IS DISTINCT FROM 200::NUMERIC THEN
    RAISE EXCEPTION
      'Rejected result operation reuse changed persisted result state';
  END IF;
END;
$assert_result_operation_reuse$;

UPDATE lis_contract_state
   SET value = public.m23_record_results_secure(
     (
       SELECT (value->'itens_ids'->>0)::BIGINT
         FROM lis_contract_state
        WHERE key = 'order_a'
     ),
     jsonb_build_array(
       jsonb_build_object(
         'id', (
           SELECT (value->0->>'id')::BIGINT
             FROM lis_contract_state
            WHERE key = 'results_a'
         ),
         'cd_valor_referencia', (
           SELECT (value->>'id')::BIGINT
             FROM lis_contract_state
            WHERE key = 'reference_a'
         ),
         'ds_parametro', 'Glicose',
         'vl_resultado', 210,
         'vl_minimo_referencia', 70,
         'vl_maximo_referencia', 99,
          'ds_unidade', 'mg/dL'
        )
      ),
      '23000000-0000-4000-8000-000000000202'
    )
 WHERE key = 'results_a';

DO $assert_result_upsert$
BEGIN
  IF (
    SELECT value->0->>'vl_resultado'
      FROM lis_contract_state
     WHERE key = 'results_a'
  ) IS DISTINCT FROM '210.000000'
     OR (
       SELECT count(*)
         FROM public.exames_lab_resultado
        WHERE cd_item_pedido = (
          SELECT (value->'itens_ids'->>0)::BIGINT
            FROM lis_contract_state
           WHERE key = 'order_a'
        )
     ) <> 1 THEN
    RAISE EXCEPTION 'Result upsert did not return/update exactly one row';
  END IF;
END;
$assert_result_upsert$;

INSERT INTO lis_contract_state (key, value)
SELECT
  'validated_item',
  public.m23_validate_result_secure(
    (
      SELECT (value->'itens_ids'->>0)::BIGINT
        FROM lis_contract_state
       WHERE key = 'order_a'
    )
  );

DO $assert_uncommunicated_critical_alert_blocks_delivery$
DECLARE
  v_order_id BIGINT := (
    SELECT (value->>'pedido_id')::BIGINT
      FROM lis_contract_state
     WHERE key = 'order_a'
  );
  v_rejected BOOLEAN := FALSE;
  v_error TEXT;
BEGIN
  BEGIN
    PERFORM public.m23_deliver_order_secure(v_order_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    v_rejected :=
      lower(v_error) LIKE '%critical%'
      AND (
        lower(v_error) LIKE '%alert%'
        OR lower(v_error) LIKE '%communicat%'
      );
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION
      'Released order with uncommunicated active critical alert was delivered';
  END IF;
  IF (
    SELECT tp_status
      FROM public.exames_lab_pedido
     WHERE id = v_order_id
  ) IS DISTINCT FROM 'LIBERADO' THEN
    RAISE EXCEPTION
      'Rejected critical-alert delivery changed the order status';
  END IF;
END;
$assert_uncommunicated_critical_alert_blocks_delivery$;

DO $acknowledge_active_alerts$
DECLARE
  v_alert_id BIGINT;
  v_acknowledged JSONB;
BEGIN
  FOR v_alert_id IN
    SELECT id
      FROM public.exames_lab_alerta_critico
     WHERE cd_resultado = (
       SELECT (value->0->>'id')::BIGINT
         FROM lis_contract_state
        WHERE key = 'results_a'
     )
       AND tp_status = 'PENDENTE'
       AND NOT lg_comunicado
     ORDER BY id
  LOOP
    v_acknowledged :=
      public.m23_acknowledge_critical_alert_secure(v_alert_id, 'TELEFONE');
  END LOOP;

  IF v_acknowledged IS NULL THEN
    RAISE EXCEPTION 'No active critical alert was available to acknowledge';
  END IF;

  INSERT INTO lis_contract_state (key, value)
  VALUES ('acknowledged_alert', v_acknowledged);
END;
$acknowledge_active_alerts$;

INSERT INTO lis_contract_state (key, value)
SELECT
  'delivered_order',
  public.m23_deliver_order_secure(
    (
      SELECT (value->>'pedido_id')::BIGINT
        FROM lis_contract_state
       WHERE key = 'order_a'
    )
  );

DO $assert_release_alert_delivery$
BEGIN
  IF (
    SELECT value->>'tp_status'
      FROM lis_contract_state
     WHERE key = 'validated_item'
  ) IS DISTINCT FROM 'LIBERADO'
     OR (
       SELECT value->>'lg_comunicado'
         FROM lis_contract_state
        WHERE key = 'acknowledged_alert'
     ) IS DISTINCT FROM 'true'
     OR (
       SELECT value->>'ds_forma_comunicacao'
         FROM lis_contract_state
        WHERE key = 'acknowledged_alert'
     ) IS DISTINCT FROM 'TELEFONE'
     OR (
       SELECT value->>'tp_status'
         FROM lis_contract_state
        WHERE key = 'delivered_order'
     ) IS DISTINCT FROM 'ENTREGUE' THEN
    RAISE EXCEPTION 'Validate/acknowledge/deliver JSON workflow failed';
  END IF;
END;
$assert_release_alert_delivery$;

INSERT INTO lis_contract_state (key, value)
SELECT
  'rectify_order',
  public.m23_create_lab_order_secure(
    '23000000-0000-4000-8000-000000000106',
    '{
      "cd_paciente":230001,
      "cd_medico":230011,
      "nr_protocolo_lab":"LIS-RECTIFY-001"
    }'::JSONB,
    jsonb_build_array(
      jsonb_build_object(
        'cd_exame', (
          SELECT (value->>'id')::BIGINT
            FROM lis_contract_state
           WHERE key = 'exam_a'
        )
      )
    )
  );

INSERT INTO lis_contract_state (key, value)
SELECT
  'rectify_collected_item',
  public.m23_collect_specimen_secure(
    (
      SELECT (value->'itens_ids'->>0)::BIGINT
        FROM lis_contract_state
       WHERE key = 'rectify_order'
    ),
    'SYNTHETIC-SAMPLE-RECTIFY-A'
  );

INSERT INTO lis_contract_state (key, value)
SELECT
  'rectify_results_critical',
  public.m23_record_results_secure(
    (
      SELECT (value->'itens_ids'->>0)::BIGINT
        FROM lis_contract_state
       WHERE key = 'rectify_order'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'cd_valor_referencia', (
          SELECT (value->>'id')::BIGINT
            FROM lis_contract_state
           WHERE key = 'reference_a'
        ),
        'ds_parametro', 'Glicose',
        'vl_resultado', 200,
        'vl_minimo_referencia', 70,
        'vl_maximo_referencia', 99,
        'ds_unidade', 'mg/dL'
      )
    ),
    '23000000-0000-4000-8000-000000000204'
  );

INSERT INTO lis_contract_state (key, value)
SELECT
  'rectify_results_normal',
  public.m23_record_results_secure(
    (
      SELECT (value->'itens_ids'->>0)::BIGINT
        FROM lis_contract_state
       WHERE key = 'rectify_order'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'id', (
          SELECT (value->0->>'id')::BIGINT
            FROM lis_contract_state
           WHERE key = 'rectify_results_critical'
        ),
        'cd_valor_referencia', (
          SELECT (value->>'id')::BIGINT
            FROM lis_contract_state
           WHERE key = 'reference_a'
        ),
        'ds_parametro', 'Glicose',
        'vl_resultado', 90,
        'vl_minimo_referencia', 70,
        'vl_maximo_referencia', 99,
        'ds_unidade', 'mg/dL'
      )
    ),
    '23000000-0000-4000-8000-000000000205'
  );

DO $assert_retification_closes_alert_without_history_loss$
DECLARE
  v_result_id BIGINT := (
    SELECT (value->0->>'id')::BIGINT
      FROM lis_contract_state
     WHERE key = 'rectify_results_critical'
  );
  v_item_id BIGINT := (
    SELECT (value->'itens_ids'->>0)::BIGINT
      FROM lis_contract_state
     WHERE key = 'rectify_order'
  );
BEGIN
  IF (
    SELECT value->0->>'id'
      FROM lis_contract_state
     WHERE key = 'rectify_results_normal'
  ) IS DISTINCT FROM v_result_id::TEXT OR (
    SELECT value->0->>'tp_resultado'
      FROM lis_contract_state
     WHERE key = 'rectify_results_normal'
  ) IS DISTINCT FROM 'NORMAL' THEN
    RAISE EXCEPTION
      'Critical-to-normal retification did not preserve/reclassify result';
  END IF;
  IF (
    SELECT count(*)
      FROM public.exames_lab_resultado
     WHERE cd_item_pedido = v_item_id
  ) <> 1 OR (
    SELECT count(*)
      FROM public.exames_lab_alerta_critico
     WHERE cd_resultado = v_result_id
  ) <> 1 THEN
    RAISE EXCEPTION
      'Critical-to-normal retification erased or duplicated history';
  END IF;
  IF (
    SELECT count(*)
      FROM public.exames_lab_alerta_critico
     WHERE cd_resultado = v_result_id
       AND tp_status = 'RESOLVIDO'
       AND dt_resolucao IS NOT NULL
       AND ds_motivo_resolucao =
           'RETIFICACAO_RESULTADO_NAO_CRITICO'
  ) <> 1 OR EXISTS (
    SELECT 1
      FROM public.exames_lab_alerta_critico
     WHERE cd_resultado = v_result_id
       AND tp_status IN ('PENDENTE', 'COMUNICADO')
  ) THEN
    RAISE EXCEPTION
      'Retified normal result still has an active critical alert';
  END IF;
END;
$assert_retification_closes_alert_without_history_loss$;

INSERT INTO lis_contract_state (key, value)
SELECT
  'rectify_validated_item',
  public.m23_validate_result_secure(
    (
      SELECT (value->'itens_ids'->>0)::BIGINT
        FROM lis_contract_state
       WHERE key = 'rectify_order'
    )
  );

INSERT INTO lis_contract_state (key, value)
SELECT
  'rectify_delivered_order',
  public.m23_deliver_order_secure(
    (
      SELECT (value->>'pedido_id')::BIGINT
        FROM lis_contract_state
       WHERE key = 'rectify_order'
    )
  );

DO $assert_retified_order_delivery$
BEGIN
  IF (
    SELECT value->>'tp_status'
      FROM lis_contract_state
     WHERE key = 'rectify_delivered_order'
  ) IS DISTINCT FROM 'ENTREGUE' THEN
    RAISE EXCEPTION
      'Order with closed retified alert was not delivered';
  END IF;
END;
$assert_retified_order_delivery$;

INSERT INTO lis_contract_state (key, value)
SELECT
  'cancel_order',
  public.m23_create_lab_order_secure(
    '23000000-0000-4000-8000-000000000104',
    '{
      "cd_paciente":230001,
      "cd_medico":230011,
      "nr_protocolo_lab":"LIS-CANCEL-001"
    }'::JSONB,
    jsonb_build_array(
      jsonb_build_object(
        'cd_exame', (
          SELECT (value->>'id')::BIGINT
            FROM lis_contract_state
           WHERE key = 'exam_a'
        )
      )
    )
  );

INSERT INTO lis_contract_state (key, value)
SELECT
  'cancelled_order',
  public.m23_transition_specimen_secure(
    (
      SELECT (value->>'pedido_id')::BIGINT
        FROM lis_contract_state
       WHERE key = 'cancel_order'
    ),
    'CANCELADO'
  );

DO $assert_transition_output$
BEGIN
  IF (
    SELECT value->>'tp_status'
      FROM lis_contract_state
     WHERE key = 'cancelled_order'
  ) IS DISTINCT FROM 'CANCELADO'
     OR EXISTS (
       SELECT 1
         FROM public.exames_lab_pedido_itens
         WHERE cd_pedido = (
           SELECT (value->>'pedido_id')::BIGINT
             FROM lis_contract_state
            WHERE key = 'cancel_order'
         )
          AND tp_status <> 'CANCELADO'
     ) THEN
    RAISE EXCEPTION 'Specimen transition did not cancel order/items atomically';
  END IF;
END;
$assert_transition_output$;

SELECT set_config(
  'request.jwt.claim.sub',
  '23000000-0000-4000-8000-000000000013',
  TRUE
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '23000000-0000-4000-8000-000000000013',
    'company_id', '23000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::TEXT,
  TRUE
);

DO $assert_reception_is_not_lab$
BEGIN
  IF public.is_lab_user(
       '23000000-0000-4000-8000-000000000013'
     ) THEN
    RAISE EXCEPTION 'Reception role was authorized as laboratory';
  END IF;
END;
$assert_reception_is_not_lab$;

DO $assert_role_denial$
DECLARE
  v_rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.m23_upsert_exam_catalog_secure(
      '{"ds_exame":"Forbidden Reception Exam","ds_sigla":"NOPE"}'::JSONB
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Reception role managed the LIS catalog';
  END IF;
END;
$assert_role_denial$;

SELECT set_config(
  'request.jwt.claim.sub',
  '23000000-0000-4000-8000-000000000011',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.company_id',
  '23000000-0000-4000-8000-000000000001',
  TRUE
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '23000000-0000-4000-8000-000000000011',
    'company_id', '23000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::TEXT,
  TRUE
);

RESET ROLE;

DO $assert_owner_has_no_dangerous_memberships$
DECLARE
  v_owner_oid OID;
  v_owner RECORD;
BEGIN
  SELECT *
    INTO v_owner
    FROM pg_roles
   WHERE rolname = 'prontomedic_lis_rpc_owner';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LIS RPC owner role is missing';
  END IF;
  v_owner_oid := v_owner.oid;

  IF v_owner.rolsuper
     OR v_owner.rolinherit
     OR v_owner.rolcreaterole
     OR v_owner.rolcreatedb
     OR v_owner.rolcanlogin
     OR v_owner.rolreplication
     OR v_owner.rolbypassrls THEN
    RAISE EXCEPTION 'LIS RPC owner has dangerous role attributes';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_auth_members membership
     WHERE membership.member = v_owner_oid
        OR membership.roleid = v_owner_oid
  ) THEN
    RAISE EXCEPTION 'LIS RPC owner participates in a role membership';
  END IF;
END;
$assert_owner_has_no_dangerous_memberships$;

SET LOCAL ROLE prontomedic_lis_rpc_owner;

DO $assert_owner_force_rls$
DECLARE
  v_rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.exames_lab_catalogo (
      company_id, ds_exame, ds_sigla
    ) VALUES (
      '23000000-0000-4000-8000-000000000002',
      'Owner Cross Tenant Forbidden',
      'OWNCROSS'
    );
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'NOBYPASSRLS owner bypassed tenant FORCE RLS';
  END IF;
END;
$assert_owner_force_rls$;

RESET ROLE;
ROLLBACK;

\echo 'module23_lis_runtime_contract: PASS'

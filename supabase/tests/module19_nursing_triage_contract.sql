-- Module 19 authenticated contract.
-- Run only in a disposable ProntoMedic PostgreSQL replay database.
-- Never run against production, the VPS operational database or DataSIGH.

BEGIN;

DO $$
DECLARE
  v_count INTEGER;
  v_public_definers INTEGER;
  v_permissive_catalog_policies INTEGER;
BEGIN
  SELECT count(*)
    INTO v_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('triagens', 'news2_avaliacoes', 'triagem_reclassificacoes')
     AND c.relrowsecurity
     AND c.relforcerowsecurity;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'M19 RLS/FORCE RLS contract incomplete: %', v_count;
  END IF;

  SELECT count(*)
    INTO v_public_definers
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('m19_complete_triage_secure', 'm19_reclassify_triage_secure')
     AND p.prosecdef
     AND pg_get_userbyid(p.proowner) = 'prontomedic_rpc_owner';
  IF v_public_definers <> 2 THEN
    RAISE EXCEPTION 'M19 secure wrapper ownership is incomplete: %', v_public_definers;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.permissions
  WHERE module = 'triagem_clinica'
    AND action IN ('view', 'create', 'edit');
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'M19 triagem_clinica permission catalog is incomplete: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id
  WHERE rp.module = 'triagem_clinica'
    AND r.name IN ('admin', 'gestor', 'medico', 'enfermagem', 'tecnico_enfermagem')
    AND rp.can_view AND rp.can_create AND rp.can_edit
    AND NOT rp.can_delete AND NOT rp.can_export;
  IF v_count <> (
    SELECT count(*)
    FROM public.roles
    WHERE name IN ('admin', 'gestor', 'medico', 'enfermagem', 'tecnico_enfermagem')
  ) OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
    WHERE rp.module = 'triagem_clinica'
      AND r.name NOT IN ('admin', 'gestor', 'medico', 'enfermagem', 'tecnico_enfermagem')
      AND (rp.can_view OR rp.can_create OR rp.can_edit OR rp.can_delete OR rp.can_export)
  ) THEN
    RAISE EXCEPTION 'M19 triagem_clinica role matrix is broader than expected';
  END IF;

  SELECT count(*)
    INTO v_permissive_catalog_policies
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('mnct_classificacao_risco', 'mnct_fluxograma')
     AND lower(coalesce(qual, '')) IN ('true', '(true)');
  IF v_permissive_catalog_policies <> 0 THEN
    RAISE EXCEPTION 'M19 catalog still has USING(true)';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.triagens', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.triagens', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.news2_avaliacoes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.triagens', 'DELETE')
     OR has_table_privilege('authenticated', 'public.news2_avaliacoes', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.news2_avaliacoes', 'DELETE')
     OR has_table_privilege('authenticated', 'public.triagem_reclassificacoes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.triagem_reclassificacoes', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.triagem_reclassificacoes', 'DELETE') THEN
    RAISE EXCEPTION 'M19 legacy compatibility grants exceed the intended bridge';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'private.m19_complete_triage(integer,bigint,bigint,bigint,integer,text,jsonb,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'app_prontomedic',
       'private.m19_reclassify_triage(bigint,integer,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'M19 private helpers are directly executable';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conname IN (
    'm19_triagens_unit_fkey',
    'm19_triagens_queue_fkey',
    'm19_news2_unit_fkey',
    'm19_news2_actor_fkey'
  )
    AND convalidated;
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'M19 foreign keys remain NOT VALID: %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'prontomedic_rpc_owner'
      AND NOT rolcanlogin
      AND rolbypassrls
      AND NOT rolsuper
  ) THEN
    RAISE EXCEPTION 'M19 technical owner role is not hardened';
  END IF;

  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM (VALUES ('authenticated'), ('app_prontomedic')) AS role_name(name)
       CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS privilege_name(name)
       WHERE has_table_privilege(
         role_name.name,
         'public.prontomedic_deployment_migrations',
         privilege_name.name
       )
     ) THEN
    RAISE EXCEPTION 'M19 deployment ledger is mutable by an application role';
  END IF;
END
$$;

INSERT INTO public.companies (id, name, cnpj, lg_ativo)
VALUES
  ('00000000-0000-4000-8000-000000000191', 'M19 Tenant A', '00000000000191', TRUE),
  ('00000000-0000-4000-8000-000000000192', 'M19 Tenant B', '00000000000192', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.units (
  id, company_id, cd_codigo, ds_nome, lg_principal, lg_ativo
)
VALUES
  (19001, '00000000-0000-4000-8000-000000000191', 'M19A', 'M19 Unidade A', TRUE, TRUE),
  (19002, '00000000-0000-4000-8000-000000000192', 'M19B', 'M19 Unidade B', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES
  (
    '00000000-0000-4000-8000-000000001901',
    'm19-nurse-a@example.invalid',
    'synthetic-not-a-real-password',
    NOW()
  ),
  (
    '00000000-0000-4000-8000-000000001902',
    'm19-nurse-b@example.invalid',
    'synthetic-not-a-real-password',
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (
  id, user_id, full_name, email, role_name,
  company_id, primary_unit_id, lg_ativo
)
VALUES
  (
    '00000000-0000-4000-8000-000000001901',
    '00000000-0000-4000-8000-000000001901',
    'M19 Nurse A',
    'm19-nurse-a@example.invalid',
    'enfermeiro',
    '00000000-0000-4000-8000-000000000191',
    19001,
    TRUE
  ),
  (
    '00000000-0000-4000-8000-000000001902',
    '00000000-0000-4000-8000-000000001902',
    'M19 Nurse B',
    'm19-nurse-b@example.invalid',
    'enfermeiro',
    '00000000-0000-4000-8000-000000000192',
    19002,
    TRUE
  )
ON CONFLICT (id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    role_name = EXCLUDED.role_name,
    company_id = EXCLUDED.company_id,
    primary_unit_id = EXCLUDED.primary_unit_id,
    lg_ativo = TRUE;

INSERT INTO public.patients (id, company_id, full_name, cpf, lg_ativo)
VALUES
  (19001, '00000000-0000-4000-8000-000000000191', 'M19 Patient A', '00000000191', TRUE),
  (19002, '00000000-0000-4000-8000-000000000192', 'M19 Patient B', '00000000192', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.appointments (
  id, company_id, patient_id, unit_id,
  appointment_date, start_time, end_time, status
)
VALUES
  (
    19001,
    '00000000-0000-4000-8000-000000000191',
    19001,
    19001,
    CURRENT_DATE,
    TIME '08:00',
    TIME '08:30',
    'waiting'
  ),
  (
    19002,
    '00000000-0000-4000-8000-000000000192',
    19002,
    19002,
    CURRENT_DATE,
    TIME '09:00',
    TIME '09:30',
    'waiting'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.mnct_classificacao_risco (
  id, company_id, ds_classificacao, cd_cor_hex,
  nr_tempo_max_atendimento_min, ds_descricao, lg_ativo
)
VALUES
  (
    19001,
    '00000000-0000-4000-8000-000000000191',
    'M19_AMARELO_A',
    '#FACC15',
    60,
    'Classificacao sintetica inicial',
    TRUE
  ),
  (
    19002,
    '00000000-0000-4000-8000-000000000191',
    'M19_LARANJA_A',
    '#F97316',
    10,
    'Classificacao sintetica de reavaliacao',
    TRUE
  ),
  (
    19003,
    '00000000-0000-4000-8000-000000000192',
    'M19_VERDE_B',
    '#22C55E',
    120,
    'Classificacao sintetica tenant B',
    TRUE
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.triagem_fila (
  id, company_id, unit_id, cd_paciente, cd_senha,
  tp_status, ds_queixa_inicial
)
VALUES
  (
    19001,
    '00000000-0000-4000-8000-000000000191',
    19001,
    19001,
    'M19001',
    'EM_TRIAGEM',
    'Queixa sintetica M19'
  )
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000001901';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000191';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000001901","company_id":"00000000-0000-4000-8000-000000000191","role":"authenticated"}';

CREATE TEMP TABLE m19_result AS
SELECT public.m19_complete_triage_secure(
  19001,
  19001,
  19001,
  19001,
  19001,
  'Classificacao inicial sintetica',
  jsonb_build_object(
    'chiefComplaint', 'Dor abdominal sintetica',
    'systolicBloodPressure', 120,
    'diastolicBloodPressure', 80,
    'heartRate', 88,
    'respiratoryRate', 18,
    'temperature', 37.2,
    'oxygenSaturation', 98,
    'painScale', 5,
    'nursingNotes', 'Registro descartavel M19'
  ),
  jsonb_build_object(
    'respiratoryRateScore', 0,
    'oxygenSaturationScore', 0,
    'temperatureScore', 0,
    'systolicBloodPressureScore', 0,
    'heartRateScore', 0,
    'consciousnessScore', 0,
    'risk', 'BAIXO'
  )
) AS payload;

DO $$
DECLARE
  v_triage_id BIGINT;
  v_count INTEGER;
  v_queue_status TEXT;
  v_actor UUID;
BEGIN
  SELECT (payload->'triage'->>'id')::BIGINT
    INTO v_triage_id
    FROM m19_result;
  IF v_triage_id IS NULL THEN
    RAISE EXCEPTION 'M19 atomic RPC did not return triage';
  END IF;

  SELECT count(*)
    INTO v_count
    FROM public.news2_avaliacoes
   WHERE cd_triagem = v_triage_id
     AND company_id = '00000000-0000-4000-8000-000000000191'
     AND unit_id = 19001;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M19 NEWS2 atomic insert failed: %', v_count;
  END IF;

  SELECT count(*), (array_agg(ator_usuario_id))[1]
    INTO v_count, v_actor
    FROM public.triagem_reclassificacoes
   WHERE triagem_id = v_triage_id
     AND tipo = 'CLASSIFICACAO_INICIAL';
  IF v_count <> 1
     OR v_actor <> '00000000-0000-4000-8000-000000001901'::UUID THEN
    RAISE EXCEPTION 'M19 initial immutable history/actor invalid';
  END IF;

  SELECT tp_status
    INTO v_queue_status
    FROM public.triagem_fila
   WHERE id = 19001;
  IF v_queue_status <> 'TRIADO' THEN
    RAISE EXCEPTION 'M19 did not complete Module 12 queue atomically: %', v_queue_status;
  END IF;
END
$$;

SELECT (payload->'triage'->>'id')::BIGINT AS triage_id
  FROM m19_result
\gset m19_

SELECT public.m19_reclassify_triage_secure(
  :'m19_triage_id'::BIGINT,
  19002,
  'Piora clinica sintetica documentada'
);

DO $$
DECLARE
  v_count INTEGER;
  v_current INTEGER;
  v_triage_id BIGINT := (
    SELECT (payload->'triage'->>'id')::BIGINT
    FROM m19_result
  );
  v_mutation_blocked BOOLEAN := FALSE;
BEGIN
  SELECT cd_classificacao_id
    INTO v_current
    FROM public.triagens
   WHERE id = v_triage_id;
  IF v_current <> 19002 THEN
    RAISE EXCEPTION 'M19 current classification was not updated: %', v_current;
  END IF;

  SELECT count(*)
    INTO v_count
    FROM public.triagem_reclassificacoes
   WHERE triagem_id = v_triage_id;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'M19 reclassification history count invalid: %', v_count;
  END IF;

  BEGIN
    UPDATE public.triagem_reclassificacoes
       SET motivo = 'Mutation must fail'
     WHERE triagem_id = v_triage_id;
  EXCEPTION WHEN OTHERS THEN
    v_mutation_blocked := TRUE;
  END;
  IF NOT v_mutation_blocked THEN
    RAISE EXCEPTION 'M19 immutable history accepted an update';
  END IF;
END
$$;

-- The same request is idempotent and does not append duplicate clinical rows.
SELECT public.m19_complete_triage_secure(
  19001,
  19001,
  19001,
  19001,
  19001,
  'Retry sintetico',
  '{"chiefComplaint":"Retry"}'::JSONB,
  NULL
);

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*)
    INTO v_count
    FROM public.triagens
   WHERE company_id = '00000000-0000-4000-8000-000000000191'
     AND unit_id = 19001
     AND triagem_fila_id = 19001;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M19 idempotency failed: %', v_count;
  END IF;
END
$$;

RESET ROLE;

INSERT INTO public.user_permissions (
  user_id, company_id, permission_id, effect, reason
)
SELECT
  '00000000-0000-4000-8000-000000001901',
  '00000000-0000-4000-8000-000000000191',
  p.id,
  'deny',
  'M19 synthetic deny override'
FROM public.permissions p
WHERE p.module = 'triagem_clinica'
  AND p.action = 'create';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000001901';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000191';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000001901","company_id":"00000000-0000-4000-8000-000000000191","role":"authenticated"}';

DO $override_denial$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.m19_complete_triage_secure(
      19001, 19001, 19001, 19001, 19001,
      'Explicit deny must win', '{}'::JSONB, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M19 explicit deny override did not block the RPC';
  END IF;
END
$override_denial$;

RESET ROLE;
DELETE FROM public.user_permissions up
USING public.permissions p
WHERE up.permission_id = p.id
  AND up.user_id = '00000000-0000-4000-8000-000000001901'
  AND p.module = 'triagem_clinica'
  AND p.action = 'create';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000001902';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000192';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000001902","company_id":"00000000-0000-4000-8000-000000000192","role":"authenticated"}';

DO $$
DECLARE
  v_count INTEGER;
  v_triage_id BIGINT := (
    SELECT (payload->'triage'->>'id')::BIGINT
    FROM m19_result
  );
  v_cross_tenant_blocked BOOLEAN := FALSE;
BEGIN
  SELECT count(*)
    INTO v_count
    FROM public.triagens
   WHERE id = v_triage_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M19 cross-tenant triage is visible';
  END IF;

  BEGIN
    PERFORM public.m19_complete_triage_secure(
      19001,
      19001,
      19001,
      NULL,
      19001,
      'Cross tenant must fail',
      '{}'::JSONB,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_cross_tenant_blocked := TRUE;
  END;
  IF NOT v_cross_tenant_blocked THEN
    RAISE EXCEPTION 'M19 cross-tenant RPC was not blocked';
  END IF;
END
$$;

RESET ROLE;

SELECT
  'M19_NURSING_TRIAGE_CONTRACT_PASS' AS result,
  (SELECT count(*) FROM public.triagens WHERE unit_id = 19001) AS triages,
  (SELECT count(*) FROM public.news2_avaliacoes WHERE unit_id = 19001) AS news2,
  (
    SELECT count(*)
      FROM public.triagem_reclassificacoes
     WHERE unit_id = 19001
  ) AS history_entries;

ROLLBACK;

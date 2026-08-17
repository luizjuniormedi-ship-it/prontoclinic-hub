-- Module 22 authenticated behavioral contract.
-- Disposable replay database only. Never run on VPS, production or DataSIGH.
BEGIN;

DO $contract$
DECLARE
  v_table TEXT;
  v_function TEXT;
  v_security_definer_count INTEGER;
  v_open_policy_count INTEGER;
  v_write_grant_count INTEGER;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'exam_requests',
    'exam_request_items',
    'exam_request_dispatches',
    'exam_request_events'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'M22 contract: missing table public.%', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_table
        AND c.relrowsecurity
        AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'M22 contract: RLS/FORCE RLS missing on public.%', v_table;
    END IF;
  END LOOP;

  FOREACH v_function IN ARRAY ARRAY[
    'm22_create_exam_request_secure',
    'm22_sign_exam_request_secure',
    'm22_dispatch_exam_request_item_secure',
    'm22_cancel_exam_request_secure',
    'm22_transition_exam_request_item_secure'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_function
        AND p.prosecdef
        AND pg_get_userbyid(p.proowner) = 'prontomedic_rpc_owner'
    ) THEN
      RAISE EXCEPTION 'M22 contract: secure owner missing for public RPC %', v_function;
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_security_definer_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'm22_%_secure'
    AND p.prosecdef;
  IF v_security_definer_count <> 5 THEN
    RAISE EXCEPTION 'M22 contract: SECURITY DEFINER wrapper count mismatch: %',
      v_security_definer_count;
  END IF;

  SELECT COUNT(*) INTO v_write_grant_count
  FROM public.permissions
  WHERE (module = 'solicitacoes_exames' AND action IN ('view', 'create', 'edit'))
     OR (module = 'execucao_exames' AND action IN ('view', 'create', 'edit'));
  IF v_write_grant_count <> 6 THEN
    RAISE EXCEPTION 'M22 contract: specific permission catalog is incomplete: %',
      v_write_grant_count;
  END IF;

  SELECT COUNT(*) INTO v_write_grant_count
  FROM public.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id
  WHERE (
      (rp.module = 'solicitacoes_exames'
       AND r.name IN ('admin', 'medico', 'enfermagem'))
      OR
      (rp.module = 'execucao_exames'
       AND r.name IN (
         'admin', 'medico', 'enfermagem', 'tecnico_enfermagem',
         'laboratorio', 'diagnostico'
       ))
    )
    AND rp.can_view AND rp.can_create AND rp.can_edit
    AND (
      (r.name = 'admin' AND rp.can_delete AND rp.can_export)
      OR
      (r.name <> 'admin' AND NOT rp.can_delete AND NOT rp.can_export)
    );
  IF v_write_grant_count <> (
    SELECT count(*)
    FROM public.roles
    WHERE name IN ('admin', 'medico', 'enfermagem')
  ) + (
    SELECT count(*)
    FROM public.roles
    WHERE name IN (
      'admin', 'medico', 'enfermagem', 'tecnico_enfermagem',
      'laboratorio', 'diagnostico'
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
    WHERE (
      (
        (rp.module = 'solicitacoes_exames'
         AND r.name NOT IN ('admin', 'medico', 'enfermagem'))
        OR
        (rp.module = 'execucao_exames'
         AND r.name NOT IN (
           'admin', 'medico', 'enfermagem', 'tecnico_enfermagem',
           'laboratorio', 'diagnostico'
         ))
      )
      AND (rp.can_view OR rp.can_create OR rp.can_edit OR rp.can_delete OR rp.can_export)
    ) OR (
        rp.module IN ('solicitacoes_exames', 'execucao_exames')
        AND r.name <> 'admin'
        AND (rp.can_delete OR rp.can_export)
      )
  ) THEN
    RAISE EXCEPTION 'M22 contract: role matrix is broader than request/execution surfaces';
  END IF;

  SELECT COUNT(*) INTO v_open_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'exam_requests',
      'exam_request_items',
      'exam_request_dispatches',
      'exam_request_events'
    )
    AND (
      COALESCE(qual, '') ~* '(^|[^a-z])true([^a-z]|$)'
      OR COALESCE(with_check, '') ~* '(^|[^a-z])true([^a-z]|$)'
    );
  IF v_open_policy_count <> 0 THEN
    RAISE EXCEPTION 'M22 contract: open USING/WITH CHECK policy found';
  END IF;

  SELECT COUNT(*) INTO v_write_grant_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN (
      'exam_requests',
      'exam_request_items',
      'exam_request_dispatches',
      'exam_request_events'
    )
    AND grantee IN ('anon', 'authenticated', 'app_prontomedic')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  IF v_write_grant_count <> 0 THEN
    RAISE EXCEPTION 'M22 contract: direct application write grants found: %',
      v_write_grant_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.exam_request_items'::regclass
      AND conname = 'exam_request_items_request_fk'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'M22 contract: central request/item foreign key missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.exam_request_items'::regclass
      AND confrelid = 'public.insurance_authorizations'::regclass
      AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.exam_request_items'::regclass
      AND confrelid = 'public.tiss_guides'::regclass
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'M22 contract: authorization/TISS strong links missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.exam_request_dispatches'::regclass
      AND confrelid = 'public.exames_lab_pedido'::regclass
      AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.exam_request_dispatches'::regclass
      AND confrelid = 'public.imaging_orders'::regclass
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'M22 contract: LIS/DICOM executor links missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.exam_request_dispatches'::regclass
      AND tgname = 'trg_m22_dispatches_immutable'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.exam_request_events'::regclass
      AND tgname = 'trg_m22_events_immutable'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'M22 contract: immutable log triggers missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'm22_private'
      AND p.proname = 'm22_append_event'
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'M22 contract: protected append-only event writer missing';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'm22_private.m22_create_exam_request(integer,bigint,uuid,bigint,bigint,text,text,text,jsonb,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'app_prontomedic',
       'm22_private.m22_append_event(uuid,uuid,uuid,text,text,text,text,jsonb,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'M22 contract: private helper is directly executable';
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
    RAISE EXCEPTION 'M22 deployment ledger is mutable by an application role';
  END IF;
END;
$contract$;

INSERT INTO public.companies (id, name, cnpj, lg_ativo)
VALUES
  ('00000000-0000-4000-8000-000000000221', 'M22 Tenant A', '00000000000221', TRUE),
  ('00000000-0000-4000-8000-000000000222', 'M22 Tenant B', '00000000000222', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_principal, lg_ativo)
VALUES
  (22001, '00000000-0000-4000-8000-000000000221', 'M22A', 'M22 Unit A', TRUE, TRUE),
  (22002, '00000000-0000-4000-8000-000000000222', 'M22B', 'M22 Unit B', TRUE, TRUE),
  (22003, '00000000-0000-4000-8000-000000000221', 'M22A2', 'M22 Unit A2', FALSE, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES
  ('00000000-0000-4000-8000-000000002201', 'm22-admin-a@example.invalid', 'synthetic', NOW()),
  ('00000000-0000-4000-8000-000000002202', 'm22-admin-b@example.invalid', 'synthetic', NOW()),
  ('00000000-0000-4000-8000-000000002203', 'm22-reception-a@example.invalid', 'synthetic', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (
  id, user_id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo
)
VALUES
  ('00000000-0000-4000-8000-000000002201', '00000000-0000-4000-8000-000000002201', 'M22 Admin A', 'm22-admin-a@example.invalid', 'admin', '00000000-0000-4000-8000-000000000221', 22001, TRUE),
  ('00000000-0000-4000-8000-000000002202', '00000000-0000-4000-8000-000000002202', 'M22 Admin B', 'm22-admin-b@example.invalid', 'admin', '00000000-0000-4000-8000-000000000222', 22002, TRUE),
  ('00000000-0000-4000-8000-000000002203', '00000000-0000-4000-8000-000000002203', 'M22 Reception A', 'm22-reception-a@example.invalid', 'recepcao', '00000000-0000-4000-8000-000000000221', 22001, TRUE)
ON CONFLICT (id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    role_name = EXCLUDED.role_name,
    company_id = EXCLUDED.company_id,
    primary_unit_id = EXCLUDED.primary_unit_id,
    lg_ativo = TRUE;

INSERT INTO public.memberships (id, user_id, company_id, status)
VALUES
  ('00000000-0000-4000-8000-000000002251', '00000000-0000-4000-8000-000000002201', '00000000-0000-4000-8000-000000000221', 'active'),
  ('00000000-0000-4000-8000-000000002252', '00000000-0000-4000-8000-000000002202', '00000000-0000-4000-8000-000000000222', 'active'),
  ('00000000-0000-4000-8000-000000002253', '00000000-0000-4000-8000-000000002203', '00000000-0000-4000-8000-000000000221', 'active');

INSERT INTO public.membership_roles (membership_id, role_id)
SELECT fixture.membership_id, role_record.id
FROM (VALUES
  ('00000000-0000-4000-8000-000000002251'::UUID, 'admin'),
  ('00000000-0000-4000-8000-000000002252'::UUID, 'admin'),
  ('00000000-0000-4000-8000-000000002253'::UUID, 'recepcao')
) AS fixture(membership_id, role_name)
JOIN public.roles AS role_record ON role_record.name = fixture.role_name;

INSERT INTO public.membership_units (membership_id, unit_id)
VALUES
  ('00000000-0000-4000-8000-000000002251', 22001),
  ('00000000-0000-4000-8000-000000002252', 22002),
  ('00000000-0000-4000-8000-000000002253', 22001);

INSERT INTO public.application_devices (
  id, user_id, company_id, unit_id, client_device_id, display_name
)
VALUES
  ('00000000-0000-4000-8000-000000002261', '00000000-0000-4000-8000-000000002201', '00000000-0000-4000-8000-000000000221', 22001, '00000000-0000-4000-8000-000000002271', 'M22 Admin A device'),
  ('00000000-0000-4000-8000-000000002262', '00000000-0000-4000-8000-000000002202', '00000000-0000-4000-8000-000000000222', 22002, '00000000-0000-4000-8000-000000002272', 'M22 Admin B device'),
  ('00000000-0000-4000-8000-000000002263', '00000000-0000-4000-8000-000000002203', '00000000-0000-4000-8000-000000000221', 22001, '00000000-0000-4000-8000-000000002273', 'M22 Reception A device');

INSERT INTO public.application_sessions (
  id, user_id, company_id, unit_id, device_id, gotrue_session_id,
  idle_expires_at, absolute_expires_at
)
VALUES
  ('00000000-0000-4000-8000-000000002271', '00000000-0000-4000-8000-000000002201', '00000000-0000-4000-8000-000000000221', 22001, '00000000-0000-4000-8000-000000002261', '00000000-0000-4000-8000-000000002271', NOW() + INTERVAL '30 minutes', NOW() + INTERVAL '12 hours'),
  ('00000000-0000-4000-8000-000000002272', '00000000-0000-4000-8000-000000002202', '00000000-0000-4000-8000-000000000222', 22002, '00000000-0000-4000-8000-000000002262', '00000000-0000-4000-8000-000000002272', NOW() + INTERVAL '30 minutes', NOW() + INTERVAL '12 hours'),
  ('00000000-0000-4000-8000-000000002273', '00000000-0000-4000-8000-000000002203', '00000000-0000-4000-8000-000000000221', 22001, '00000000-0000-4000-8000-000000002263', '00000000-0000-4000-8000-000000002273', NOW() + INTERVAL '30 minutes', NOW() + INTERVAL '12 hours');

INSERT INTO public.user_access_context (
  user_id, session_id, membership_id, role_id, unit_id
)
SELECT fixture.user_id, fixture.session_id, fixture.membership_id, role_record.id, fixture.unit_id
FROM (VALUES
  ('00000000-0000-4000-8000-000000002201'::UUID, '00000000-0000-4000-8000-000000002271'::UUID, '00000000-0000-4000-8000-000000002251'::UUID, 'admin', 22001),
  ('00000000-0000-4000-8000-000000002202'::UUID, '00000000-0000-4000-8000-000000002272'::UUID, '00000000-0000-4000-8000-000000002252'::UUID, 'admin', 22002),
  ('00000000-0000-4000-8000-000000002203'::UUID, '00000000-0000-4000-8000-000000002273'::UUID, '00000000-0000-4000-8000-000000002253'::UUID, 'recepcao', 22001)
) AS fixture(user_id, session_id, membership_id, role_name, unit_id)
JOIN public.roles AS role_record ON role_record.name = fixture.role_name;

INSERT INTO public.patients (id, company_id, full_name, cpf, lg_ativo)
VALUES
  (22001, '00000000-0000-4000-8000-000000000221', 'M22 Patient A', '00000000221', TRUE),
  (22002, '00000000-0000-4000-8000-000000000222', 'M22 Patient B', '00000000222', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.professionals (id, company_id, full_name, specialty, lg_ativo)
VALUES
  (22001, '00000000-0000-4000-8000-000000000221', 'M22 Doctor A', 'Clinica', TRUE),
  (22002, '00000000-0000-4000-8000-000000000222', 'M22 Doctor B', 'Clinica', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Same-company, different-unit fixtures are inserted by the test owner so the
-- authenticated actor from Unit A can prove both RLS reads and RPC writes fail
-- closed for Unit A2.
INSERT INTO public.exam_requests (
  id, company_id, unit_id, patient_id, requester_professional_id,
  clinical_indication, priority, status, idempotency_key, created_by,
  signed_by, signed_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000002211',
    '00000000-0000-4000-8000-000000000221', 22003, 22001, 22001,
    'Same-company Unit A2 draft', 'ROUTINE', 'DRAFT',
    'm22-contract-same-company-draft', '00000000-0000-4000-8000-000000002201',
    NULL, NULL
  ),
  (
    '00000000-0000-4000-8000-000000002212',
    '00000000-0000-4000-8000-000000000221', 22003, 22001, 22001,
    'Same-company Unit A2 signed', 'ROUTINE', 'SIGNED',
    'm22-contract-same-company-signed', '00000000-0000-4000-8000-000000002201',
    '00000000-0000-4000-8000-000000002201', NOW()
  );

INSERT INTO public.exam_request_items (
  id, company_id, request_id, domain, description, status
)
VALUES
  (
    '00000000-0000-4000-8000-000000002221',
    '00000000-0000-4000-8000-000000000221',
    '00000000-0000-4000-8000-000000002211',
    'LABORATORY', 'Unit A2 draft item', 'PENDING'
  ),
  (
    '00000000-0000-4000-8000-000000002222',
    '00000000-0000-4000-8000-000000000221',
    '00000000-0000-4000-8000-000000002212',
    'LABORATORY', 'Unit A2 signed item', 'READY'
  );

INSERT INTO public.exam_request_dispatches (
  id, company_id, request_id, request_item_id, executor_kind,
  status, attempt_number, actor_user_id
)
VALUES (
  '00000000-0000-4000-8000-000000002231',
  '00000000-0000-4000-8000-000000000221',
  '00000000-0000-4000-8000-000000002212',
  '00000000-0000-4000-8000-000000002222',
  'SPECIALTY', 'QUEUED', 1, '00000000-0000-4000-8000-000000002201'
);

INSERT INTO public.exam_request_events (
  id, company_id, request_id, request_item_id, event_type,
  from_status, to_status, actor_user_id
)
VALUES (
  '00000000-0000-4000-8000-000000002241',
  '00000000-0000-4000-8000-000000000221',
  '00000000-0000-4000-8000-000000002212',
  '00000000-0000-4000-8000-000000002222',
  'SIGNED', 'DRAFT', 'SIGNED', '00000000-0000-4000-8000-000000002201'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002201';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000221';
SET LOCAL request.jwt.claim.unit_id = '22001';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002201","company_id":"00000000-0000-4000-8000-000000000221","unit_id":22001,"session_id":"00000000-0000-4000-8000-000000002271","role":"authenticated","aal":"aal2"}';

CREATE TEMP TABLE m22_created AS
SELECT *
FROM public.m22_create_exam_request_secure(
  22001, 22001, NULL, NULL, 22001,
  'Synthetic clinical indication', 'Z00.0', 'ROUTINE',
  '[{"domain":"LABORATORY","description":"Synthetic CBC","quantity":1}]'::JSONB,
  'm22-contract-tenant-a'
);

DO $behavior$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.exam_requests
  WHERE company_id = '00000000-0000-4000-8000-000000000221'
    AND idempotency_key = 'm22-contract-tenant-a';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M22 authenticated create/read failed: %', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.exam_request_events
  WHERE company_id = '00000000-0000-4000-8000-000000000221'
    AND event_type = 'CREATED';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M22 creation event was not recorded: %', v_count;
  END IF;
END
$behavior$;

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002202';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000222';
SET LOCAL request.jwt.claim.unit_id = '22002';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002202","company_id":"00000000-0000-4000-8000-000000000222","unit_id":22002,"session_id":"00000000-0000-4000-8000-000000002272","role":"authenticated","aal":"aal2"}';

DO $cross_tenant$
DECLARE
  v_count INTEGER;
  v_blocked BOOLEAN := FALSE;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.exam_requests
  WHERE company_id = '00000000-0000-4000-8000-000000000221';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M22 cross-tenant request is visible';
  END IF;

  BEGIN
    PERFORM public.m22_create_exam_request_secure(
      22001, 22001, NULL, NULL, 22001,
      'Cross tenant', NULL, 'ROUTINE',
      '[{"domain":"LABORATORY","description":"Denied"}]'::JSONB,
      'm22-contract-cross'
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M22 cross-tenant creation was not denied';
  END IF;
END
$cross_tenant$;

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002203';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000221';
SET LOCAL request.jwt.claim.unit_id = '22001';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002203","company_id":"00000000-0000-4000-8000-000000000221","unit_id":22001,"session_id":"00000000-0000-4000-8000-000000002273","role":"authenticated","aal":"aal2"}';

DO $role_denial$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.m22_create_exam_request_secure(
      22001, 22001, NULL, NULL, 22001,
      'Role denial', NULL, 'ROUTINE',
      '[{"domain":"LABORATORY","description":"Denied"}]'::JSONB,
      'm22-contract-role'
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M22 reception role was allowed to request exams';
  END IF;
END
$role_denial$;

RESET ROLE;

INSERT INTO public.user_permissions (
  user_id, company_id, permission_id, effect, reason
)
SELECT
  '00000000-0000-4000-8000-000000002203',
  '00000000-0000-4000-8000-000000000221',
  p.id,
  'grant',
  'M22 synthetic request override'
FROM public.permissions p
WHERE p.module = 'solicitacoes_exames'
  AND p.action = 'create';

INSERT INTO public.user_permissions (
  user_id, company_id, permission_id, effect, reason
)
SELECT
  '00000000-0000-4000-8000-000000002203',
  '00000000-0000-4000-8000-000000000221',
  p.id,
  'grant',
  'M22 synthetic same-company unit isolation'
FROM public.permissions p
WHERE (p.module = 'solicitacoes_exames' AND p.action = 'edit')
   OR (p.module = 'execucao_exames' AND p.action IN ('create', 'edit'));

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002203';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000221';
SET LOCAL request.jwt.claim.unit_id = '22001';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002203","company_id":"00000000-0000-4000-8000-000000000221","unit_id":22001,"session_id":"00000000-0000-4000-8000-000000002273","role":"authenticated","aal":"aal2"}';

SELECT *
FROM public.m22_create_exam_request_secure(
  22001, 22001, NULL, NULL, 22001,
  'Explicit grant override M22', NULL, 'ROUTINE',
  '[{"domain":"LABORATORY","description":"Override grant"}]'::JSONB,
  'm22-contract-override'
);

RESET ROLE;

DO $override_grant$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.exam_requests
    WHERE company_id = '00000000-0000-4000-8000-000000000221'
      AND idempotency_key = 'm22-contract-override'
      AND created_by = '00000000-0000-4000-8000-000000002203'
  ) THEN
    RAISE EXCEPTION 'M22 explicit grant override did not reach the RPC';
  END IF;
END
$override_grant$;

SET LOCAL ROLE authenticated;

DO $same_company_unit_isolation$
DECLARE
  v_count INTEGER;
  v_blocked BOOLEAN;
BEGIN
  IF NOT public.m22_can_create_requests()
     OR NOT public.m22_can_dispatch_requests() THEN
    RAISE EXCEPTION
      'M22 same-company isolation actor lacks required functional permissions';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'm22_unit_access'
      AND p.prosecdef
      AND pg_get_userbyid(p.proowner) = 'prontomedic_rpc_owner'
  ) THEN
    RAISE EXCEPTION 'M22 contract: unit access wrapper is not protected by the RPC owner';
  END IF;

  IF NOT public.m22_unit_access(
       '00000000-0000-4000-8000-000000000221', 22001
     ) OR public.m22_unit_access(
       '00000000-0000-4000-8000-000000000221', 22003
     ) THEN
    RAISE EXCEPTION
      'M22 same-company unit isolation precondition is invalid';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.exam_requests
  WHERE unit_id = 22003;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M22 same-company request from another unit is visible';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.exam_request_items
  WHERE request_id IN (
    '00000000-0000-4000-8000-000000002211',
    '00000000-0000-4000-8000-000000002212'
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M22 same-company items from another unit are visible';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.exam_request_dispatches
  WHERE request_id = '00000000-0000-4000-8000-000000002212';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M22 same-company dispatch from another unit is visible';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.exam_request_events
  WHERE request_id = '00000000-0000-4000-8000-000000002212';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M22 same-company event from another unit is visible';
  END IF;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.m22_create_exam_request_secure(
      22003, 22001, NULL, NULL, 22001,
      'Denied cross-unit create', NULL, 'ROUTINE',
      '[{"domain":"LABORATORY","description":"Denied cross-unit create"}]'::JSONB,
      'm22-contract-same-company-denied-create'
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M22 same-company cross-unit creation was not denied';
  END IF;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.m22_sign_exam_request_secure(
      '00000000-0000-4000-8000-000000002211'
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M22 same-company cross-unit signing was not denied';
  END IF;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.m22_dispatch_exam_request_item_secure(
      '00000000-0000-4000-8000-000000002222',
      'SPECIALTY', NULL, NULL, NULL, NULL, '{}'::JSONB
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M22 same-company cross-unit dispatch was not denied';
  END IF;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.m22_transition_exam_request_item_secure(
      '00000000-0000-4000-8000-000000002222', 'IN_PROGRESS',
      'Denied cross-unit transition'
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M22 same-company cross-unit transition was not denied';
  END IF;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.m22_cancel_exam_request_secure(
      '00000000-0000-4000-8000-000000002212',
      'Denied cross-unit cancellation'
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M22 same-company cross-unit cancellation was not denied';
  END IF;
END
$same_company_unit_isolation$;

RESET ROLE;

SELECT 'M22_EXAM_REQUESTS_CONTRACT_PASS' AS result;

ROLLBACK;

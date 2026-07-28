\set ON_ERROR_STOP on

-- Disposable PostgreSQL contract. Synthetic data only; transaction is rolled back.
BEGIN;

INSERT INTO public.companies(id, name, lg_ativo) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Reception Contract A', TRUE),
  ('20000000-0000-4000-8000-000000000002', 'Reception Contract B', TRUE);

INSERT INTO public.units(id, company_id, cd_codigo, ds_nome, lg_ativo) VALUES
  (9101, '10000000-0000-4000-8000-000000000001', 'RC-A', 'Unit A', TRUE),
  (9102, '10000000-0000-4000-8000-000000000001', 'RC-A2', 'Unit A2', TRUE),
  (9201, '20000000-0000-4000-8000-000000000002', 'RC-B', 'Unit B', TRUE);

INSERT INTO auth.users(
  id,
  email,
  raw_user_meta_data,
  raw_app_meta_data,
  email_confirmed_at
) VALUES
  (
    '10000000-0000-4000-8000-000000000101',
    'reception-a@example.invalid',
    '{}'::JSONB,
    '{}'::JSONB,
    NOW()
  ),
  (
    '10000000-0000-4000-8000-000000000102',
    'supervisor-a@example.invalid',
    '{}'::JSONB,
    '{}'::JSONB,
    NOW()
  ),
  (
    '20000000-0000-4000-8000-000000000201',
    'supervisor-b@example.invalid',
    '{}'::JSONB,
    '{}'::JSONB,
    NOW()
  ),
  (
    '10000000-0000-4000-8000-000000000103',
    'legacy-link-a@example.invalid',
    '{}'::JSONB,
    '{}'::JSONB,
    NOW()
  );

INSERT INTO public.roles(name, description, lg_ativo)
VALUES (
  'recepcao_restrita_teste',
  'Papel sintetico sem permissao operacional',
  TRUE
)
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description,
    lg_ativo = TRUE,
    updated_at = NOW();

INSERT INTO public.user_profiles(
  id,
  user_id,
  full_name,
  email,
  role_name,
  company_id,
  primary_unit_id,
  lg_ativo
) VALUES
  (
    '10000000-0000-4000-8000-000000000101',
    '10000000-0000-4000-8000-000000000101',
    'Reception User A',
    'reception-a@example.invalid',
    'recepcao',
    '10000000-0000-4000-8000-000000000001',
    9101,
    TRUE
  ),
  (
    '10000000-0000-4000-8000-000000000102',
    '10000000-0000-4000-8000-000000000102',
    'Reception Supervisor A',
    'supervisor-a@example.invalid',
    'supervisor_recepcao',
    '10000000-0000-4000-8000-000000000001',
    9101,
    TRUE
  ),
  (
    '20000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000201',
    'Reception Supervisor B',
    'supervisor-b@example.invalid',
    'supervisor_recepcao',
    '20000000-0000-4000-8000-000000000002',
    9201,
    TRUE
  ),
  (
    '10000000-0000-4000-8000-000000000103',
    '10000000-0000-4000-8000-000000000103',
    'Restricted Reception User A',
    'legacy-link-a@example.invalid',
    'recepcao_restrita_teste',
    '10000000-0000-4000-8000-000000000001',
    9101,
    TRUE
  );

INSERT INTO public.memberships(id, user_id, company_id, status) VALUES
  (
    '10000000-0000-4000-8000-000000000211',
    '10000000-0000-4000-8000-000000000101',
    '10000000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    '10000000-0000-4000-8000-000000000212',
    '10000000-0000-4000-8000-000000000102',
    '10000000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    '10000000-0000-4000-8000-000000000213',
    '10000000-0000-4000-8000-000000000103',
    '10000000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    '20000000-0000-4000-8000-000000000211',
    '20000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000002',
    'active'
  );

INSERT INTO public.membership_roles(membership_id, role_id)
SELECT fixture.membership_id, role_record.id
FROM (
  VALUES
    ('10000000-0000-4000-8000-000000000211'::UUID, 'recepcao'::TEXT),
    ('10000000-0000-4000-8000-000000000212'::UUID, 'supervisor_recepcao'::TEXT),
    ('10000000-0000-4000-8000-000000000213'::UUID, 'recepcao_restrita_teste'::TEXT),
    ('20000000-0000-4000-8000-000000000211'::UUID, 'supervisor_recepcao'::TEXT)
) AS fixture(membership_id, role_name)
JOIN public.roles role_record ON role_record.name = fixture.role_name;

INSERT INTO public.membership_units(membership_id, unit_id) VALUES
  ('10000000-0000-4000-8000-000000000211', 9101),
  ('10000000-0000-4000-8000-000000000212', 9101),
  ('10000000-0000-4000-8000-000000000213', 9101),
  ('20000000-0000-4000-8000-000000000211', 9201);

INSERT INTO public.role_permissions(
  company_id, role_id, module, can_view, can_create, can_edit, can_delete
)
SELECT
  fixture.company_id,
  role_record.id,
  'recepcao',
  TRUE,
  TRUE,
  TRUE,
  FALSE
FROM (
  VALUES
    ('10000000-0000-4000-8000-000000000001'::UUID, 'recepcao'::TEXT),
    ('10000000-0000-4000-8000-000000000001'::UUID, 'supervisor_recepcao'::TEXT),
    ('20000000-0000-4000-8000-000000000002'::UUID, 'supervisor_recepcao'::TEXT)
) AS fixture(company_id, role_name)
JOIN public.roles role_record ON role_record.name = fixture.role_name
ON CONFLICT (company_id, role_id, module) DO UPDATE
SET can_view = EXCLUDED.can_view,
    can_create = EXCLUDED.can_create,
    can_edit = EXCLUDED.can_edit,
    can_delete = EXCLUDED.can_delete,
    updated_at = NOW();

INSERT INTO public.application_devices(
  id, user_id, company_id, unit_id, client_device_id, display_name, platform
) VALUES
  (
    '10000000-0000-4000-8000-000000000311',
    '10000000-0000-4000-8000-000000000101',
    '10000000-0000-4000-8000-000000000001',
    9101,
    '10000000-0000-4000-8000-000000000411',
    'Reception Contract Device',
    'contract'
  ),
  (
    '10000000-0000-4000-8000-000000000312',
    '10000000-0000-4000-8000-000000000102',
    '10000000-0000-4000-8000-000000000001',
    9101,
    '10000000-0000-4000-8000-000000000412',
    'Supervisor Contract Device',
    'contract'
  ),
  (
    '10000000-0000-4000-8000-000000000313',
    '10000000-0000-4000-8000-000000000103',
    '10000000-0000-4000-8000-000000000001',
    9101,
    '10000000-0000-4000-8000-000000000413',
    'Restricted Contract Device',
    'contract'
  ),
  (
    '20000000-0000-4000-8000-000000000311',
    '20000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000002',
    9201,
    '20000000-0000-4000-8000-000000000411',
    'Supervisor B Contract Device',
    'contract'
  );

INSERT INTO public.application_sessions(
  id,
  user_id,
  company_id,
  unit_id,
  device_id,
  gotrue_session_id,
  idle_expires_at,
  absolute_expires_at
) VALUES
  (
    '10000000-0000-4000-8000-000000000611',
    '10000000-0000-4000-8000-000000000101',
    '10000000-0000-4000-8000-000000000001',
    9101,
    '10000000-0000-4000-8000-000000000311',
    '10000000-0000-4000-8000-000000000711',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  ),
  (
    '10000000-0000-4000-8000-000000000612',
    '10000000-0000-4000-8000-000000000102',
    '10000000-0000-4000-8000-000000000001',
    9101,
    '10000000-0000-4000-8000-000000000312',
    '10000000-0000-4000-8000-000000000712',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  ),
  (
    '10000000-0000-4000-8000-000000000613',
    '10000000-0000-4000-8000-000000000103',
    '10000000-0000-4000-8000-000000000001',
    9101,
    '10000000-0000-4000-8000-000000000313',
    '10000000-0000-4000-8000-000000000713',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  ),
  (
    '20000000-0000-4000-8000-000000000611',
    '20000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000002',
    9201,
    '20000000-0000-4000-8000-000000000311',
    '20000000-0000-4000-8000-000000000711',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  );

INSERT INTO public.user_access_context(
  user_id, session_id, membership_id, role_id, unit_id
)
SELECT
  fixture.user_id,
  fixture.session_id,
  fixture.membership_id,
  role_record.id,
  fixture.unit_id
FROM (
  VALUES
    (
      '10000000-0000-4000-8000-000000000101'::UUID,
      '10000000-0000-4000-8000-000000000711'::UUID,
      '10000000-0000-4000-8000-000000000211'::UUID,
      'recepcao'::TEXT,
      9101
    ),
    (
      '10000000-0000-4000-8000-000000000102'::UUID,
      '10000000-0000-4000-8000-000000000712'::UUID,
      '10000000-0000-4000-8000-000000000212'::UUID,
      'supervisor_recepcao'::TEXT,
      9101
    ),
    (
      '10000000-0000-4000-8000-000000000103'::UUID,
      '10000000-0000-4000-8000-000000000713'::UUID,
      '10000000-0000-4000-8000-000000000213'::UUID,
      'recepcao_restrita_teste'::TEXT,
      9101
    ),
    (
      '20000000-0000-4000-8000-000000000201'::UUID,
      '20000000-0000-4000-8000-000000000711'::UUID,
      '20000000-0000-4000-8000-000000000211'::UUID,
      'supervisor_recepcao'::TEXT,
      9201
    )
) AS fixture(user_id, session_id, membership_id, role_name, unit_id)
JOIN public.roles role_record ON role_record.name = fixture.role_name;

CREATE OR REPLACE FUNCTION pg_temp.set_contract_jwt(
  p_user_id UUID,
  p_company_id UUID,
  p_session_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user_id::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.company_id', p_company_id::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.aal', 'aal2', TRUE);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user_id,
      'company_id', p_company_id,
      'role', 'authenticated',
      'session_id', p_session_id,
      'aal', 'aal2'
    )::TEXT,
    TRUE
  );
END
$function$;

INSERT INTO public.patients(
  id, company_id, unit_id, full_name, birth_date, lg_ativo
) VALUES
  (
    910001,
    '10000000-0000-4000-8000-000000000001',
    9101,
    'Synthetic Patient A',
    DATE '1990-01-01',
    TRUE
  ),
  (
    920001,
    '20000000-0000-4000-8000-000000000002',
    9201,
    'Synthetic Patient B',
    DATE '1991-01-01',
    TRUE
  );

INSERT INTO public.lgpd_termos(
  id,
  company_id,
  codigo,
  versao,
  titulo,
  texto,
  texto_hash,
  lg_ativo,
  publicado_em
) VALUES (
  '10000000-0000-4000-8000-000000000601',
  '10000000-0000-4000-8000-000000000001',
  'reception-consent',
  '1.0',
  'Synthetic Reception Consent',
  'Synthetic reception consent v1',
  encode(digest('Synthetic reception consent v1', 'sha256'), 'hex'),
  TRUE,
  NOW()
);

INSERT INTO public.appointments(
  id,
  company_id,
  unit_id,
  patient_id,
  appointment_date,
  start_time,
  status
) VALUES
  (
    910001,
    '10000000-0000-4000-8000-000000000001',
    9101,
    910001,
    CURRENT_DATE,
    TIME '09:00',
    'scheduled'
  ),
  (
    910002,
    '10000000-0000-4000-8000-000000000001',
    9101,
    910001,
    CURRENT_DATE,
    TIME '09:30',
    'scheduled'
  ),
  (
    910003,
    '10000000-0000-4000-8000-000000000001',
    9102,
    910001,
    CURRENT_DATE,
    TIME '09:45',
    'scheduled'
  ),
  (
    910004,
    '10000000-0000-4000-8000-000000000001',
    9101,
    910001,
    CURRENT_DATE,
    TIME '09:50',
    'scheduled'
  ),
  (
    920001,
    '20000000-0000-4000-8000-000000000002',
    9201,
    920001,
    CURRENT_DATE,
    TIME '10:00',
    'scheduled'
  );

INSERT INTO public.patient_documents(
  id,
  company_id,
  patient_id,
  document_type,
  expires_at,
  status
) VALUES
  (
    '10000000-0000-4000-8000-000000000301',
    '10000000-0000-4000-8000-000000000001',
    910001,
    'identity',
    CURRENT_DATE - 1,
    'active'
  ),
  (
    '20000000-0000-4000-8000-000000000301',
    '20000000-0000-4000-8000-000000000002',
    920001,
    'identity',
    CURRENT_DATE - 1,
    'active'
  );

INSERT INTO public.billing_accounts(
  id,
  company_id,
  unit_id,
  patient_id,
  appointment_id,
  billing_type,
  account_type,
  total_gross_amount
) VALUES
  (
    '10000000-0000-4000-8000-000000000401',
    '10000000-0000-4000-8000-000000000001',
    9101,
    910001,
    910001,
    'particular',
    'ambulatorial',
    100
  ),
  (
    '10000000-0000-4000-8000-000000000402',
    '10000000-0000-4000-8000-000000000001',
    9102,
    910001,
    910003,
    'particular',
    'ambulatorial',
    100
  ),
  (
    '20000000-0000-4000-8000-000000000401',
    '20000000-0000-4000-8000-000000000002',
    9201,
    920001,
    920001,
    'particular',
    'ambulatorial',
    100
  );

INSERT INTO public.unit_access(
  user_id,
  company_id,
  unit_id,
  valid_from
) VALUES (
  '10000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000001',
  9102,
  NOW()
);

SELECT set_config(
  'request.jwt.claim.sub',
  '',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.company_id',
  '10000000-0000-4000-8000-000000000001',
  TRUE
);

-- Fixture-only bypass for rows that must exist outside the active unit/tenant.
-- The trigger is restored before any security or mutation assertion.
ALTER TABLE public.reception_checkin_workflows
  DISABLE TRIGGER trg_m11_audit_workflow_transition;

INSERT INTO public.reception_checkin_workflows(
  id,
  company_id,
  unit_id,
  appointment_id,
  patient_id,
  idempotency_key,
  request_hash,
  request_payload,
  status,
  current_step,
  billing_account_id,
  created_by,
  updated_by
) VALUES
  (
    '10000000-0000-4000-8000-000000000501',
    '10000000-0000-4000-8000-000000000001',
    9101,
    910001,
    910001,
    'reception-contract-a',
    repeat('a', 64),
    jsonb_build_object(
      'priority',
      'normal',
      'exception_reason',
      'Supervisor assumiu o risco do documento expirado'
    ),
    'in_progress',
    'checkin',
    '10000000-0000-4000-8000-000000000401',
    '10000000-0000-4000-8000-000000000101',
    '10000000-0000-4000-8000-000000000101'
  ),
  (
    '10000000-0000-4000-8000-000000000502',
    '10000000-0000-4000-8000-000000000001',
    9101,
    910002,
    910001,
    'reception-contract-precheck-a',
    repeat('c', 64),
    jsonb_build_object(
      'priority',
      'normal',
      'exception_reason',
      'Supervisor assumiu o risco do documento expirado'
    ),
    'in_progress',
    'precheck',
    NULL,
    '10000000-0000-4000-8000-000000000101',
    '10000000-0000-4000-8000-000000000101'
  ),
  (
    '10000000-0000-4000-8000-000000000503',
    '10000000-0000-4000-8000-000000000001',
    9102,
    910003,
    910001,
    'reception-contract-other-unit-a',
    repeat('d', 64),
    jsonb_build_object(
      'priority',
      'normal',
      'exception_reason',
      'Tentativa sintetica fora da unidade primaria deve falhar'
    ),
    'in_progress',
    'checkin',
    '10000000-0000-4000-8000-000000000402',
    '10000000-0000-4000-8000-000000000101',
    '10000000-0000-4000-8000-000000000101'
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.company_id',
  '20000000-0000-4000-8000-000000000002',
  TRUE
);

INSERT INTO public.reception_checkin_workflows(
  id,
  company_id,
  unit_id,
  appointment_id,
  patient_id,
  idempotency_key,
  request_hash,
  request_payload,
  status,
  current_step,
  billing_account_id,
  created_by,
  updated_by
) VALUES
  (
    '20000000-0000-4000-8000-000000000501',
    '20000000-0000-4000-8000-000000000002',
    9201,
    920001,
    920001,
    'reception-contract-b',
    repeat('b', 64),
    '{}'::JSONB,
    'in_progress',
    'checkin',
    '20000000-0000-4000-8000-000000000401',
    '20000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000201'
  );

ALTER TABLE public.reception_checkin_workflows
  ENABLE TRIGGER trg_m11_audit_workflow_transition;

DO $catalog_security_contract$
DECLARE
  v_role TEXT;
  v_table REGCLASS;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = 'prontomedic_reception_rpc_owner'
       AND NOT rolsuper
       AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION
      'Reception RPC owner must exist without SUPERUSER or BYPASSRLS';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class
     WHERE oid = ANY (
       ARRAY[
          'public.reception_payments'::REGCLASS,
          'public.reception_term_acceptances'::REGCLASS,
          'public.reception_document_pickups'::REGCLASS,
          'public.reception_queue_tickets'::REGCLASS,
          'public.reception_checkin_workflows'::REGCLASS
        ]
      )
       AND (NOT relrowsecurity OR NOT relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Reception operational tables must use FORCE RLS';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'app_prontomedic']
  LOOP
    FOREACH v_table IN ARRAY ARRAY[
      'public.reception_payments'::REGCLASS,
      'public.reception_term_acceptances'::REGCLASS,
      'public.reception_document_pickups'::REGCLASS,
      'public.reception_queue_tickets'::REGCLASS
    ]
    LOOP
      IF has_table_privilege(v_role, v_table, 'INSERT')
         OR has_table_privilege(v_role, v_table, 'UPDATE')
         OR has_table_privilege(v_role, v_table, 'DELETE') THEN
        RAISE EXCEPTION
          'Role % retains direct DML on %',
          v_role,
          v_table;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
     WHERE p.oid = ANY (
       ARRAY[
         'public.record_reception_payment_secure(bigint,numeric,text,text,text)'::REGPROCEDURE,
         'public.record_reception_term_acceptance_secure(bigint,text,text,text,bigint,text)'::REGPROCEDURE,
         'public.create_reception_document_pickup_secure(bigint,text,bigint,text)'::REGPROCEDURE,
         'public.release_reception_document_pickup_secure(uuid,text,text)'::REGPROCEDURE,
         'public.transition_reception_queue_ticket_secure(bigint,text,text)'::REGPROCEDURE,
         'public.transition_reception_queue_ticket_secure(bigint,text,text,integer)'::REGPROCEDURE
       ]
     )
       AND (
         NOT p.prosecdef
         OR r.rolname <> 'prontomedic_reception_rpc_owner'
       )
  ) THEN
    RAISE EXCEPTION
      'Reception operational RPC owner or SECURITY DEFINER contract is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc procedure_record
      JOIN pg_roles owner_role
        ON owner_role.oid = procedure_record.proowner
     WHERE procedure_record.oid = ANY (
       ARRAY[
         'public.start_reception_checkin_workflow_secure(bigint,text,jsonb)'::REGPROCEDURE,
         'public.advance_reception_checkin_workflow_secure(uuid,integer,text,text,uuid,uuid,bigint,bigint,jsonb,text,text)'::REGPROCEDURE,
         'private.m11_start_workflow(bigint,text,jsonb)'::REGPROCEDURE,
         'private.m11_advance_workflow(uuid,integer,text,text,uuid,uuid,bigint,bigint,jsonb,text,text)'::REGPROCEDURE,
         'private.m11_append_audit(public.reception_checkin_workflows,text,text,text,text,text,jsonb)'::REGPROCEDURE,
         'private.m11_audit_workflow_transition()'::REGPROCEDURE
       ]
     )
       AND (
         NOT procedure_record.prosecdef
         OR owner_role.rolname <> 'prontomedic_reception_rpc_owner'
         OR owner_role.rolbypassrls
         OR owner_role.rolsuper
       )
  ) THEN
    RAISE EXCEPTION
      'Reception workflow mutator owner/BYPASSRLS contract is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'prontomedic_rpc_owner'
  ) THEN
    IF has_function_privilege(
         'prontomedic_rpc_owner',
         'private.m11_start_workflow(bigint,text,jsonb)',
         'EXECUTE'
       )
       OR has_function_privilege(
         'prontomedic_rpc_owner',
         'private.m11_advance_workflow(uuid,integer,text,text,uuid,uuid,bigint,bigint,jsonb,text,text)',
         'EXECUTE'
       ) THEN
      RAISE EXCEPTION
        'Legacy BYPASSRLS owner can still execute workflow mutation cores';
    END IF;
  END IF;

  IF NOT has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.appointments',
       'SELECT'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.appointments',
       'UPDATE'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.appointments',
       'INSERT'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.appointments',
       'DELETE'
     ) THEN
    RAISE EXCEPTION
      'Reception owner appointment grants are broader than read-only';
  END IF;

  IF NOT has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.lgpd_termos',
       'SELECT'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.lgpd_termos',
       'UPDATE'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.lgpd_termos',
       'INSERT'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.lgpd_termos',
       'DELETE'
     ) THEN
    RAISE EXCEPTION
      'Reception owner term catalog grants are broader than read-only';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_policy policy_record
     WHERE policy_record.polrelid = 'public.appointments'::REGCLASS
       AND policy_record.polname = 'appointments_reception_rpc_select'
       AND policy_record.polcmd = 'r'
       AND policy_record.polroles = ARRAY[
         (
           SELECT oid
             FROM pg_roles
            WHERE rolname = 'prontomedic_reception_rpc_owner'
         )
       ]::OID[]
  ) THEN
    RAISE EXCEPTION
      'Reception owner appointment read policy is missing or not role-specific';
  END IF;
END
$catalog_security_contract$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000103',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.company_id',
  '10000000-0000-4000-8000-000000000001',
  TRUE
);
SELECT pg_temp.set_contract_jwt(
  '10000000-0000-4000-8000-000000000103',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000713'
);
DO $restricted_profile_company_resolution$
DECLARE
  v_actor RECORD;
  v_denied BOOLEAN := FALSE;
BEGIN
  IF public.current_company_id()
     IS DISTINCT FROM '10000000-0000-4000-8000-000000000001'::UUID THEN
    RAISE EXCEPTION 'Restricted user company resolution failed';
  END IF;

  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id
       IS DISTINCT FROM '10000000-0000-4000-8000-000000000103'::UUID
     OR v_actor.company_id
       IS DISTINCT FROM '10000000-0000-4000-8000-000000000001'::UUID
     OR v_actor.role_name <> 'recepcao_restrita_teste' THEN
    RAISE EXCEPTION
      'Restricted scheduling actor did not preserve the authenticated user id';
  END IF;

  BEGIN
    PERFORM public.perform_reception_checkin_secure(
      '10000000-0000-4000-8000-000000000501',
      910001,
      'normal',
      'Supervisor assumiu o risco do documento expirado'
    );
  EXCEPTION WHEN OTHERS THEN
    IF POSITION('reception.checkin' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
    v_denied := TRUE;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'Restricted reception.checkin deny was bypassed';
  END IF;
END
$restricted_profile_company_resolution$;
RESET ROLE;

DO $restricted_deny_side_effects$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.reception_checkins
     WHERE appointment_id = 910001
  ) OR EXISTS (
    SELECT 1
      FROM public.reception_queue_tickets
     WHERE appointment_id = 910001
  ) THEN
    RAISE EXCEPTION 'Restricted deny produced reception side effects';
  END IF;
END
$restricted_deny_side_effects$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000101',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.company_id',
  '10000000-0000-4000-8000-000000000001',
  TRUE
);
SELECT pg_temp.set_contract_jwt(
  '10000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000711'
);

DO $start_workflow_owner_rls$
DECLARE
  v_workflow public.reception_checkin_workflows;
BEGIN
  SELECT *
    INTO v_workflow
    FROM public.start_reception_checkin_workflow_secure(
      910004,
      'reception-contract-start-a',
      jsonb_build_object(
        'requires_tiss',
        FALSE,
        'requires_financial',
        FALSE
      )
    );

  IF v_workflow.company_id
       IS DISTINCT FROM '10000000-0000-4000-8000-000000000001'::UUID
     OR v_workflow.unit_id IS DISTINCT FROM 9101
     OR v_workflow.appointment_id IS DISTINCT FROM 910004 THEN
    RAISE EXCEPTION 'Reception workflow start owner/RLS contract failed';
  END IF;
END
$start_workflow_owner_rls$;

DO $precheck_exception_denied$
DECLARE
  v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.advance_reception_checkin_workflow_secure(
      '10000000-0000-4000-8000-000000000502',
      (
        SELECT version
          FROM public.reception_checkin_workflows
         WHERE id = '10000000-0000-4000-8000-000000000502'
      ),
      'billing',
      'in_progress'
    );
  EXCEPTION WHEN OTHERS THEN
    IF POSITION('reception.release_exception' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
    v_denied := TRUE;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'Reception precheck exception was not denied';
  END IF;
END
$precheck_exception_denied$;

RESET ROLE;

DO $precheck_denied_side_effects$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.billing_accounts
     WHERE appointment_id = 910002
  ) OR NOT EXISTS (
    SELECT 1
      FROM public.reception_checkin_workflows
     WHERE id = '10000000-0000-4000-8000-000000000502'
       AND current_step = 'precheck'
  ) THEN
    RAISE EXCEPTION
      'Denied precheck exception advanced workflow or produced billing artifacts';
  END IF;
END
$precheck_denied_side_effects$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000102',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.company_id',
  '10000000-0000-4000-8000-000000000001',
  TRUE
);
SELECT pg_temp.set_contract_jwt(
  '10000000-0000-4000-8000-000000000102',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000712'
);

DO $supervisor_workflow_read_scope$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.reception_checkin_workflows
     WHERE id = '10000000-0000-4000-8000-000000000502'
  ) OR EXISTS (
    SELECT 1
      FROM public.reception_checkin_workflows
     WHERE id IN (
       '10000000-0000-4000-8000-000000000503',
       '20000000-0000-4000-8000-000000000501'
     )
  ) THEN
    RAISE EXCEPTION
      'Supervisor workflow read policy leaked or hid tenant/unit rows';
  END IF;
END
$supervisor_workflow_read_scope$;

DO $null_expected_version_denied$
DECLARE
  v_denied BOOLEAN := FALSE;
  v_version INTEGER;
BEGIN
  SELECT version
    INTO v_version
    FROM public.reception_checkin_workflows
   WHERE id = '10000000-0000-4000-8000-000000000502';

  BEGIN
    PERFORM public.advance_reception_checkin_workflow_secure(
      '10000000-0000-4000-8000-000000000502',
      NULL,
      'billing',
      'in_progress'
    );
  EXCEPTION WHEN OTHERS THEN
    IF POSITION('Versao esperada do workflow e obrigatoria' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
    v_denied := TRUE;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'NULL expected_version unexpectedly advanced workflow';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.reception_checkin_workflows
     WHERE id = '10000000-0000-4000-8000-000000000502'
       AND current_step = 'precheck'
       AND version = v_version
  ) THEN
    RAISE EXCEPTION 'NULL expected_version changed workflow state';
  END IF;
END
$null_expected_version_denied$;

DO $precheck_supervisor_allowed$
DECLARE
  v_workflow public.reception_checkin_workflows;
BEGIN
  SELECT *
    INTO v_workflow
    FROM public.advance_reception_checkin_workflow_secure(
      '10000000-0000-4000-8000-000000000502',
      (
        SELECT version
          FROM public.reception_checkin_workflows
         WHERE id = '10000000-0000-4000-8000-000000000502'
      ),
      'billing',
      'in_progress'
    );

  IF v_workflow.current_step <> 'billing'
     OR v_workflow.result_payload->>'exception_authorized' <> 'true' THEN
    RAISE EXCEPTION
      'Supervisor did not authorize the precheck transition';
  END IF;

  PERFORM public.ensure_billing_preaccount_for_checkin_secure(
    v_workflow.id,
    'particular',
    'ambulatorial',
    NULL,
    0
  );
END
$precheck_supervisor_allowed$;

RESET ROLE;

DO $precheck_allowed_artifact$
BEGIN
  IF (
    SELECT count(*)
      FROM public.billing_accounts
     WHERE appointment_id = 910002
  ) <> 1 THEN
    RAISE EXCEPTION
      'Authorized precheck transition did not create exactly one billing artifact';
  END IF;
END
$precheck_allowed_artifact$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000101',
  TRUE
);
SELECT pg_temp.set_contract_jwt(
  '10000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000711'
);

DO $reception_denied$
DECLARE
  v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.perform_reception_checkin_secure(
      '10000000-0000-4000-8000-000000000501',
      910001,
      'normal',
      'Supervisor assumiu o risco do documento expirado'
    );
  EXCEPTION WHEN OTHERS THEN
    IF POSITION('reception.release_exception' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
    v_denied := TRUE;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'Reception exception was not denied';
  END IF;
END
$reception_denied$;

RESET ROLE;

DO $denied_side_effects$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reception_checkins
     WHERE appointment_id = 910001
  ) OR EXISTS (
    SELECT 1 FROM public.reception_queue_tickets
     WHERE appointment_id = 910001
  ) OR EXISTS (
    SELECT 1 FROM public.reception_admin_history
     WHERE appointment_id = 910001
       AND entity_type = 'checkin'
  ) THEN
    RAISE EXCEPTION 'Denied reception exception produced side effects';
  END IF;
END
$denied_side_effects$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000102',
  TRUE
);
SELECT pg_temp.set_contract_jwt(
  '10000000-0000-4000-8000-000000000102',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000712'
);

DO $supervisor_allowed$
DECLARE
  v_result JSONB;
  v_retry JSONB;
  v_divergent_retry_denied BOOLEAN := FALSE;
BEGIN
  v_result := public.perform_reception_checkin_secure(
    '10000000-0000-4000-8000-000000000501',
    910001,
    'normal',
    'Supervisor assumiu o risco do documento expirado'
  );
  IF COALESCE((v_result->>'released_by_exception')::BOOLEAN, FALSE) IS NOT TRUE
     OR COALESCE((v_result->>'idempotent')::BOOLEAN, TRUE) IS NOT FALSE THEN
    RAISE EXCEPTION 'Supervisor result did not record the exception';
  END IF;

  v_retry := public.perform_reception_checkin_secure(
    '10000000-0000-4000-8000-000000000501',
    910001,
    'normal',
    'Supervisor assumiu o risco do documento expirado'
  );
  IF COALESCE((v_retry->>'idempotent')::BOOLEAN, FALSE) IS NOT TRUE
     OR v_retry->>'ticket_id' IS DISTINCT FROM v_result->>'ticket_id' THEN
    RAISE EXCEPTION 'Reception check-in retry was not idempotent';
  END IF;

  BEGIN
    PERFORM public.perform_reception_checkin_secure(
      '10000000-0000-4000-8000-000000000501',
      910001,
      'urgent',
      'Supervisor assumiu o risco do documento expirado'
    );
  EXCEPTION WHEN OTHERS THEN
    IF POSITION('parametros divergentes' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
    v_divergent_retry_denied := TRUE;
  END;
  IF NOT v_divergent_retry_denied THEN
    RAISE EXCEPTION 'Divergent reception check-in retry was not denied';
  END IF;
END
$supervisor_allowed$;

SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000101',
  TRUE
);
SELECT pg_temp.set_contract_jwt(
  '10000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000711'
);

DO $reception_operational_rpcs$
DECLARE
  v_payment_id UUID;
  v_term_id UUID;
  v_pickup_id UUID;
  v_ticket_id BIGINT;
  v_queue_result JSONB;
BEGIN
  v_payment_id := public.record_reception_payment_secure(
    910001,
    25.50,
    'pix',
    'copayment',
    'Synthetic contract payment'
  );
  v_term_id := public.record_reception_term_acceptance_secure(
    910001,
    'reception-consent',
    '1.0',
    encode(digest('Synthetic reception consent v1', 'sha256'), 'hex'),
    910001,
    'synthetic-signature-reference'
  );
  v_pickup_id := public.create_reception_document_pickup_secure(
    910001,
    'exam_result',
    910001,
    'Synthetic contract pickup'
  );
  PERFORM public.release_reception_document_pickup_secure(
    v_pickup_id,
    'Synthetic Recipient',
    '11144477735'
  );

  SELECT id
    INTO v_ticket_id
    FROM public.reception_queue_tickets
   WHERE appointment_id = 910001;
  v_queue_result := public.transition_reception_queue_ticket_secure(
    v_ticket_id,
    'called',
    'Synthetic contract queue call'
  );

  IF NOT EXISTS (
       SELECT 1
         FROM public.reception_payments
        WHERE id = v_payment_id
          AND company_id = '10000000-0000-4000-8000-000000000001'
     )
     OR NOT EXISTS (
       SELECT 1
         FROM public.reception_term_acceptances
        WHERE id = v_term_id
          AND company_id = '10000000-0000-4000-8000-000000000001'
     )
     OR NOT EXISTS (
       SELECT 1
         FROM public.reception_document_pickups
        WHERE id = v_pickup_id
          AND status = 'released'
          AND company_id = '10000000-0000-4000-8000-000000000001'
     )
     OR v_queue_result->>'to_status' <> 'called' THEN
    RAISE EXCEPTION 'Reception FORCE RLS owner RPC contract failed';
  END IF;
END
$reception_operational_rpcs$;

RESET ROLE;

DO $allowed_side_effects$
BEGIN
  IF (SELECT count(*) FROM public.reception_checkins WHERE appointment_id = 910001) <> 1
     OR (SELECT count(*) FROM public.reception_queue_tickets WHERE appointment_id = 910001) <> 1
     OR (
       SELECT count(*) FROM public.reception_admin_history
        WHERE appointment_id = 910001
          AND entity_type = 'checkin'
     ) <> 1 THEN
    RAISE EXCEPTION 'Supervisor check-in did not produce exactly one audited handoff';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.reception_admin_history
     WHERE appointment_id = 910001
       AND details->>'exception_authorized' = 'true'
       AND details->>'exception_authorized_by_role' = 'supervisor_recepcao'
  ) THEN
    RAISE EXCEPTION 'Supervisor exception audit evidence is incomplete';
  END IF;
END
$allowed_side_effects$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000102',
  TRUE
);
SELECT pg_temp.set_contract_jwt(
  '10000000-0000-4000-8000-000000000102',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000712'
);

DO $cross_tenant_denied$
DECLARE
  v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.perform_reception_checkin_secure(
      '20000000-0000-4000-8000-000000000501',
      920001,
      'normal',
      'Tentativa sintetica entre tenants deve falhar'
    );
  EXCEPTION WHEN OTHERS THEN
    IF POSITION('fora do escopo' IN SQLERRM) = 0
       AND POSITION('nao encontrado' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
    v_denied := TRUE;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'Cross-tenant workflow access was not denied';
  END IF;
END
$cross_tenant_denied$;

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000102',
  TRUE
);
SELECT pg_temp.set_contract_jwt(
  '10000000-0000-4000-8000-000000000102',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000712'
);

DO $cross_unit_denied$
DECLARE
  v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.perform_reception_checkin_secure(
      '10000000-0000-4000-8000-000000000503',
      910003,
      'normal',
      'Tentativa sintetica fora da unidade primaria deve falhar'
    );
  EXCEPTION WHEN OTHERS THEN
    IF POSITION('fora do escopo' IN SQLERRM) = 0
       AND POSITION('unidade' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
    v_denied := TRUE;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'Cross-unit workflow access was not denied';
  END IF;
END
$cross_unit_denied$;

RESET ROLE;

DO $cross_tenant_side_effects$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reception_checkins
     WHERE company_id = '20000000-0000-4000-8000-000000000002'
  ) OR EXISTS (
    SELECT 1 FROM public.reception_queue_tickets
     WHERE company_id = '20000000-0000-4000-8000-000000000002'
  ) OR EXISTS (
    SELECT 1 FROM public.reception_checkins
     WHERE appointment_id = 910003
  ) OR EXISTS (
    SELECT 1 FROM public.reception_queue_tickets
     WHERE appointment_id = 910003
  ) THEN
    RAISE EXCEPTION 'Cross-tenant or cross-unit attempt produced side effects';
  END IF;
END
$cross_tenant_side_effects$;

DO $workflow_context_contract$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'private.m11_start_workflow(bigint,text,jsonb)'::REGPROCEDURE
  ) INTO v_definition;

  IF position('current_company_id()' IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Workflow start does not resolve tenant from application context';
  END IF;
  IF position('request.jwt.claim.company_id' IN v_definition) > 0 THEN
    RAISE EXCEPTION
      'Workflow start still depends on a noncanonical JWT company claim';
  END IF;
  IF position('get_reception_precheckin_context' IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Workflow start does not derive appointment scope from canonical precheck';
  END IF;
  IF position('FROM public.appointments' IN v_definition) > 0 THEN
    RAISE EXCEPTION
      'Workflow start still reads appointments directly under the RPC owner';
  END IF;
END
$workflow_context_contract$;

ROLLBACK;
\echo RECEPTION_RUNTIME_SECURITY_PASS

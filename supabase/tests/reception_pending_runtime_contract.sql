\set ON_ERROR_STOP on

-- Disposable PostgreSQL contract. Synthetic data only; transaction is rolled back.
BEGIN;

INSERT INTO public.companies(id, name, lg_ativo) VALUES
  ('31000000-0000-4000-8000-000000000001', 'Pending Contract A', TRUE),
  ('32000000-0000-4000-8000-000000000002', 'Pending Contract B', TRUE);

INSERT INTO public.units(id, company_id, cd_codigo, ds_nome, lg_ativo) VALUES
  (9311, '31000000-0000-4000-8000-000000000001', 'PC-A1', 'Pending Unit A1', TRUE),
  (9312, '31000000-0000-4000-8000-000000000001', 'PC-A2', 'Pending Unit A2', TRUE),
  (9321, '32000000-0000-4000-8000-000000000002', 'PC-B1', 'Pending Unit B1', TRUE);

INSERT INTO auth.users(
  id, email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at
) VALUES
  (
    '31000000-0000-4000-8000-000000000101',
    'pending-reception-a@example.invalid',
    '{}'::JSONB,
    '{}'::JSONB,
    NOW()
  ),
  (
    '31000000-0000-4000-8000-000000000102',
    'pending-supervisor-a@example.invalid',
    '{}'::JSONB,
    '{}'::JSONB,
    NOW()
  ),
  (
    '32000000-0000-4000-8000-000000000101',
    'pending-reception-b@example.invalid',
    '{}'::JSONB,
    '{}'::JSONB,
    NOW()
  );

INSERT INTO public.user_profiles(
  id, user_id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo
) VALUES
  (
    '31000000-0000-4000-8000-000000000101',
    '31000000-0000-4000-8000-000000000101',
    'Pending Reception A',
    'pending-reception-a@example.invalid',
    'recepcao',
    '31000000-0000-4000-8000-000000000001',
    9311,
    TRUE
  ),
  (
    '31000000-0000-4000-8000-000000000102',
    '31000000-0000-4000-8000-000000000102',
    'Pending Supervisor A',
    'pending-supervisor-a@example.invalid',
    'supervisor_recepcao',
    '31000000-0000-4000-8000-000000000001',
    9311,
    TRUE
  ),
  (
    '32000000-0000-4000-8000-000000000101',
    '32000000-0000-4000-8000-000000000101',
    'Pending Reception B',
    'pending-reception-b@example.invalid',
    'recepcao',
    '32000000-0000-4000-8000-000000000002',
    9321,
    TRUE
  );

INSERT INTO public.memberships(id, user_id, company_id, status) VALUES
  (
    '31000000-0000-4000-8000-000000000201',
    '31000000-0000-4000-8000-000000000101',
    '31000000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    '31000000-0000-4000-8000-000000000202',
    '31000000-0000-4000-8000-000000000102',
    '31000000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    '32000000-0000-4000-8000-000000000201',
    '32000000-0000-4000-8000-000000000101',
    '32000000-0000-4000-8000-000000000002',
    'active'
  );

INSERT INTO public.membership_roles(membership_id, role_id)
SELECT fixture.membership_id, role_record.id
FROM (
  VALUES
    ('31000000-0000-4000-8000-000000000201'::UUID, 'recepcao'::TEXT),
    ('31000000-0000-4000-8000-000000000202'::UUID, 'supervisor_recepcao'::TEXT),
    ('32000000-0000-4000-8000-000000000201'::UUID, 'recepcao'::TEXT)
) AS fixture(membership_id, role_name)
JOIN public.roles role_record ON role_record.name = fixture.role_name;

INSERT INTO public.membership_units(membership_id, unit_id) VALUES
  ('31000000-0000-4000-8000-000000000201', 9311),
  ('31000000-0000-4000-8000-000000000202', 9311),
  ('32000000-0000-4000-8000-000000000201', 9321);

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
    ('31000000-0000-4000-8000-000000000001'::UUID, 'recepcao'::TEXT),
    ('31000000-0000-4000-8000-000000000001'::UUID, 'supervisor_recepcao'::TEXT),
    ('32000000-0000-4000-8000-000000000002'::UUID, 'recepcao'::TEXT)
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
    '31000000-0000-4000-8000-000000000301',
    '31000000-0000-4000-8000-000000000101',
    '31000000-0000-4000-8000-000000000001',
    9311,
    '31000000-0000-4000-8000-000000000401',
    'Pending Reception A Device',
    'contract'
  ),
  (
    '31000000-0000-4000-8000-000000000302',
    '31000000-0000-4000-8000-000000000102',
    '31000000-0000-4000-8000-000000000001',
    9311,
    '31000000-0000-4000-8000-000000000402',
    'Pending Supervisor A Device',
    'contract'
  ),
  (
    '32000000-0000-4000-8000-000000000301',
    '32000000-0000-4000-8000-000000000101',
    '32000000-0000-4000-8000-000000000002',
    9321,
    '32000000-0000-4000-8000-000000000401',
    'Pending Reception B Device',
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
    '31000000-0000-4000-8000-000000000601',
    '31000000-0000-4000-8000-000000000101',
    '31000000-0000-4000-8000-000000000001',
    9311,
    '31000000-0000-4000-8000-000000000301',
    '31000000-0000-4000-8000-000000000501',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  ),
  (
    '31000000-0000-4000-8000-000000000602',
    '31000000-0000-4000-8000-000000000102',
    '31000000-0000-4000-8000-000000000001',
    9311,
    '31000000-0000-4000-8000-000000000302',
    '31000000-0000-4000-8000-000000000502',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  ),
  (
    '32000000-0000-4000-8000-000000000601',
    '32000000-0000-4000-8000-000000000101',
    '32000000-0000-4000-8000-000000000002',
    9321,
    '32000000-0000-4000-8000-000000000301',
    '32000000-0000-4000-8000-000000000501',
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
      '31000000-0000-4000-8000-000000000101'::UUID,
      '31000000-0000-4000-8000-000000000501'::UUID,
      '31000000-0000-4000-8000-000000000201'::UUID,
      'recepcao'::TEXT,
      9311
    ),
    (
      '31000000-0000-4000-8000-000000000102'::UUID,
      '31000000-0000-4000-8000-000000000502'::UUID,
      '31000000-0000-4000-8000-000000000202'::UUID,
      'supervisor_recepcao'::TEXT,
      9311
    ),
    (
      '32000000-0000-4000-8000-000000000101'::UUID,
      '32000000-0000-4000-8000-000000000501'::UUID,
      '32000000-0000-4000-8000-000000000201'::UUID,
      'recepcao'::TEXT,
      9321
    )
) AS fixture(user_id, session_id, membership_id, role_name, unit_id)
JOIN public.roles role_record ON role_record.name = fixture.role_name;

INSERT INTO public.patients(
  id, company_id, unit_id, full_name, birth_date, lg_ativo
) VALUES
  (931001, '31000000-0000-4000-8000-000000000001', 9311, 'Pending Patient A', DATE '1990-01-01', TRUE),
  (932001, '32000000-0000-4000-8000-000000000002', 9321, 'Pending Patient B', DATE '1991-01-01', TRUE);

INSERT INTO public.appointments(
  id, company_id, unit_id, patient_id, appointment_date, start_time, status
) VALUES
  (931001, '31000000-0000-4000-8000-000000000001', 9311, 931001, CURRENT_DATE, TIME '08:00', 'scheduled'),
  (931002, '31000000-0000-4000-8000-000000000001', 9312, 931001, CURRENT_DATE, TIME '08:30', 'scheduled'),
  (932001, '32000000-0000-4000-8000-000000000002', 9321, 932001, CURRENT_DATE, TIME '09:00', 'scheduled');

SELECT set_config(
  'request.jwt.claim.company_id',
  '31000000-0000-4000-8000-000000000001',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  '',
  TRUE
);

DO $invalid_unit_scope$
BEGIN
  BEGIN
    INSERT INTO public.insurance_eligibility_checks(
      id, company_id, patient_id, appointment_id, unit_id, status, source
    ) VALUES (
      '31000000-0000-4000-8000-000000000901',
      '31000000-0000-4000-8000-000000000001',
      931001,
      NULL,
      NULL,
      'pendente',
      'manual'
    );
    RAISE EXCEPTION 'Eligibility without unit was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END
$invalid_unit_scope$;

INSERT INTO public.insurance_eligibility_checks(
  id, company_id, patient_id, appointment_id, unit_id, status, source
) VALUES (
  '31000000-0000-4000-8000-000000000902',
  '31000000-0000-4000-8000-000000000001',
  931001,
  931002,
  9312,
  'pendente',
  'manual'
);

SELECT set_config(
  'request.jwt.claim.company_id',
  '32000000-0000-4000-8000-000000000002',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  '',
  TRUE
);

INSERT INTO public.insurance_eligibility_checks(
  id, company_id, patient_id, appointment_id, unit_id, status, source
) VALUES (
  '32000000-0000-4000-8000-000000000903',
  '32000000-0000-4000-8000-000000000002',
  932001,
  932001,
  9321,
  'pendente',
  'manual'
);

SELECT set_config(
  'request.jwt.claim.company_id',
  '31000000-0000-4000-8000-000000000001',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  '',
  TRUE
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000101', TRUE);
SELECT set_config('request.jwt.claim.company_id', '31000000-0000-4000-8000-000000000001', TRUE);
SELECT set_config('request.jwt.claim.aal', 'aal2', TRUE);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '31000000-0000-4000-8000-000000000101',
    'company_id', '31000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'session_id', '31000000-0000-4000-8000-000000000501',
    'aal', 'aal2'
  )::TEXT,
  TRUE
);

DO $reception_scope$
DECLARE
  v_created JSONB;
  v_eligibility_id UUID;
  v_capability JSONB;
  v_blocked BOOLEAN;
BEGIN
  v_created := public.create_insurance_eligibility_check_secure(
    p_patient_id => 931001,
    p_appointment_id => 931001,
    p_unit_id => 9311,
    p_status => 'pendente'
  );
  v_eligibility_id := (v_created->>'id')::UUID;
  PERFORM set_config('test.eligibility_id', v_eligibility_id::TEXT, TRUE);

  IF (v_created->>'unit_id')::INTEGER IS DISTINCT FROM 9311 THEN
    RAISE EXCEPTION 'Eligibility creation did not preserve the authorized unit';
  END IF;

  PERFORM public.update_insurance_eligibility_check_secure(
    p_eligibility_id => v_eligibility_id,
    p_status => 'elegivel',
    p_protocol_number => 'SYNTHETIC-OK',
    p_result_detail => 'Synthetic contract only'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.insurance_eligibility_checks
    WHERE id = v_eligibility_id
      AND company_id = '31000000-0000-4000-8000-000000000001'
      AND unit_id = 9311
      AND status = 'elegivel'
  ) THEN
    RAISE EXCEPTION 'Authorized eligibility update was not visible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.insurance_eligibility_checks
    WHERE id = '31000000-0000-4000-8000-000000000901'
  ) THEN
    RAISE EXCEPTION 'Eligibility row without unit leaked through RLS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.insurance_eligibility_events
    WHERE eligibility_check_id IN (
      '31000000-0000-4000-8000-000000000902',
      '32000000-0000-4000-8000-000000000903'
    )
  ) THEN
    RAISE EXCEPTION 'Cross-unit or cross-tenant eligibility event leaked through RLS';
  END IF;

  v_capability := public.get_reception_exception_capability(931001);
  IF COALESCE((v_capability->>'allowed')::BOOLEAN, TRUE) THEN
    RAISE EXCEPTION 'Reception role unexpectedly received exception capability';
  END IF;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.update_insurance_eligibility_check_secure(
      p_eligibility_id => v_eligibility_id,
      p_status => 'liberado_excecao',
      p_exception_reason => 'Reception must not release this exception'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Reception role released an eligibility exception';
  END IF;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.create_insurance_eligibility_check_secure(
      p_patient_id => 931001,
      p_appointment_id => 931002,
      p_unit_id => 9312,
      p_status => 'pendente'
    );
  EXCEPTION WHEN OTHERS THEN
    IF POSITION('Unidade nao autorizada' IN SQLERRM) = 0
       AND POSITION('Agendamento fora do tenant ou do paciente' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Cross-unit eligibility creation was accepted';
  END IF;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.create_insurance_eligibility_check_secure(
      p_patient_id => 932001,
      p_appointment_id => 932001,
      p_unit_id => 9321,
      p_status => 'pendente'
    );
  EXCEPTION WHEN OTHERS THEN
    IF POSITION('Paciente fora do tenant' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Cross-tenant eligibility creation was accepted';
  END IF;
END
$reception_scope$;

RESET ROLE;

UPDATE public.role_permissions
SET can_create = FALSE,
    can_edit = FALSE,
    updated_at = NOW()
WHERE company_id = '31000000-0000-4000-8000-000000000001'
  AND role_id = (
    SELECT id
    FROM public.roles
    WHERE name = 'recepcao'
  )
  AND module = 'recepcao';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000101', TRUE);
SELECT set_config('request.jwt.claim.aal', 'aal2', TRUE);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '31000000-0000-4000-8000-000000000101',
    'company_id', '31000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'session_id', '31000000-0000-4000-8000-000000000501',
    'aal', 'aal2'
  )::TEXT,
  TRUE
);

DO $explicit_deny$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.create_insurance_eligibility_check_secure(
      p_patient_id => 931001,
      p_appointment_id => 931001,
      p_unit_id => 9311,
      p_status => 'pendente'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Explicit reception.checkin deny did not block eligibility';
  END IF;
END
$explicit_deny$;

SELECT set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000102', TRUE);
SELECT set_config('request.jwt.claim.aal', 'aal2', TRUE);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '31000000-0000-4000-8000-000000000102',
    'company_id', '31000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'session_id', '31000000-0000-4000-8000-000000000502',
    'aal', 'aal2'
  )::TEXT,
  TRUE
);

DO $supervisor_capability$
DECLARE
  v_capability JSONB;
  v_updated JSONB;
BEGIN
  v_capability := public.get_reception_exception_capability(931001);
  IF COALESCE((v_capability->>'allowed')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Supervisor exception capability was not granted';
  END IF;

  v_updated := public.update_insurance_eligibility_check_secure(
    p_eligibility_id => current_setting('test.eligibility_id')::UUID,
    p_status => 'liberado_excecao',
    p_exception_reason => 'Synthetic supervisor release'
  );
  IF v_updated->>'status' <> 'liberado_excecao'
     OR v_updated->>'exception_granted_by'
        <> '31000000-0000-4000-8000-000000000102' THEN
    RAISE EXCEPTION 'Supervisor eligibility exception was not audited correctly';
  END IF;
END
$supervisor_capability$;

RESET ROLE;

DO $audit_events$
BEGIN
  IF (
    SELECT count(*)
    FROM public.insurance_eligibility_events
    WHERE company_id = '31000000-0000-4000-8000-000000000001'
      AND event_type IN ('created', 'status_changed')
  ) < 2 THEN
    RAISE EXCEPTION 'Eligibility mutation audit events were not recorded';
  END IF;
END
$audit_events$;

ROLLBACK;
\echo RECEPTION_PENDING_RUNTIME_SECURITY_OK

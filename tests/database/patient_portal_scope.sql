BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition BOOLEAN, message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'assertion failed: %', message;
  END IF;
END;
$$;

INSERT INTO public.companies (id, name, lg_ativo)
VALUES ('85000000-0000-0000-0000-000000000001', 'Portal E2E', TRUE);

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_ativo)
VALUES (
  850001, '85000000-0000-0000-0000-000000000001',
  'PORTAL', 'Unidade Portal', TRUE
);

INSERT INTO public.roles (name, description, lg_ativo)
VALUES ('paciente', 'Paciente do portal', TRUE)
ON CONFLICT (name) DO UPDATE SET lg_ativo = TRUE;

INSERT INTO auth.users (id, email)
VALUES ('85000000-0000-0000-0000-000000000010', 'portal-patient@example.test');

INSERT INTO public.user_profiles (
  id, user_id, email, full_name, company_id, role_id, role_name,
  primary_unit_id, lg_ativo
)
SELECT
  '85000000-0000-0000-0000-000000000010',
  '85000000-0000-0000-0000-000000000010',
  'portal-patient@example.test', 'Paciente Portal',
  '85000000-0000-0000-0000-000000000001',
  id, name, 850001, TRUE
FROM public.roles
WHERE name = 'paciente';

INSERT INTO public.memberships (id, user_id, company_id, status)
VALUES (
  '85000000-0000-0000-0000-000000000020',
  '85000000-0000-0000-0000-000000000010',
  '85000000-0000-0000-0000-000000000001',
  'active'
);

INSERT INTO public.membership_roles (membership_id, role_id)
SELECT '85000000-0000-0000-0000-000000000020', id
FROM public.roles
WHERE name = 'paciente';

INSERT INTO public.membership_units (membership_id, unit_id)
VALUES ('85000000-0000-0000-0000-000000000020', 850001);

INSERT INTO public.professionals (id, company_id, full_name, lg_ativo)
VALUES (
  850010, '85000000-0000-0000-0000-000000000001',
  'Profissional Portal', TRUE
);

INSERT INTO public.patients (
  id, company_id, unit_id, user_id, full_name, status, lg_ativo
)
VALUES
  (
    850020, '85000000-0000-0000-0000-000000000001', 850001,
    '85000000-0000-0000-0000-000000000010',
    'Paciente autenticado', 'active', TRUE
  ),
  (
    850021, '85000000-0000-0000-0000-000000000001', 850001,
    NULL, 'Paciente da mesma unidade', 'active', TRUE
  );

INSERT INTO public.appointments (
  id, company_id, unit_id, patient_id, professional_id,
  appointment_date, start_time, end_time, status, tp_status, notes
)
VALUES
  (
    850030, '85000000-0000-0000-0000-000000000001', 850001,
    850020, 850010, CURRENT_DATE + 1, TIME '08:00', TIME '08:30',
    'scheduled', 'agendado', 'Agenda propria'
  ),
  (
    850031, '85000000-0000-0000-0000-000000000001', 850001,
    850021, 850010, CURRENT_DATE + 1, TIME '09:00', TIME '09:30',
    'scheduled', 'agendado', 'Agenda de terceiro'
  );

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '85000000-0000-0000-0000-000000000010';
SET LOCAL request.jwt.claim.aal = 'aal2';
SET LOCAL request.jwt.claims =
  '{"sub":"85000000-0000-0000-0000-000000000010","role":"authenticated","aal":"aal2","session_id":"85000000-0000-0000-0000-000000000099"}';

SELECT public.activate_application_context(
  '85000000-0000-0000-0000-000000000020',
  (SELECT id FROM public.roles WHERE name = 'paciente'),
  850001,
  '85000000-0000-0000-0000-000000000090',
  'Teste portal', 'test', 'psql'
);

SELECT pg_temp.assert_true(
  (SELECT array_agg(id ORDER BY id) FROM public.patients) = ARRAY[850020]::BIGINT[],
  'paciente nao pode listar outro paciente da mesma unidade'
);

SELECT pg_temp.assert_true(
  (SELECT array_agg(id ORDER BY id) FROM public.appointments) = ARRAY[850030]::BIGINT[],
  'paciente nao pode listar agendamento de terceiro da mesma unidade'
);

SELECT public.update_my_appointment_status_secure(850030, 'confirmed', NULL);
SELECT pg_temp.assert_true(
  (SELECT status = 'confirmed' FROM public.appointments WHERE id = 850030)
  AND COALESCE(
    current_setting('app.patient_self_service_appointment_id', TRUE),
    ''
  ) = '',
  'paciente precisa confirmar o proprio agendamento'
);

DO $$
BEGIN
  BEGIN
    UPDATE public.appointments
    SET status = 'cancelled',
        tp_status = 'cancelado',
        lg_confirmado = FALSE,
        updated_at = now()
    WHERE id = 850030;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT status = 'confirmed' FROM public.appointments WHERE id = 850030),
  'paciente nao pode contornar o RPC com UPDATE direto'
);

DO $$
BEGIN
  BEGIN
    PERFORM public.update_my_appointment_status_secure(850031, 'confirmed', NULL);
    RAISE EXCEPTION 'paciente confirmou agendamento de terceiro';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
ROLLBACK;


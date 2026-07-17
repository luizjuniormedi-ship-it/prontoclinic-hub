\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'OPERATIONAL_RLS_ASSERTION_FAILED: %', message;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.professional_schedules'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.insurance_authorizations'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.insurance_eligibility_checks'::regclass),
  'tabelas operacionais precisam de RLS'
);
SELECT pg_temp.assert_true(
  NOT has_function_privilege('anon', 'public.get_professional_available_slots(bigint,date,integer,integer)', 'EXECUTE'),
  'anon não pode consultar disponibilidade'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prokind = 'f'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'anon não pode executar nenhuma função SECURITY DEFINER pública'
);
SELECT pg_temp.assert_true(
  NOT has_function_privilege('anon', 'public.get_dicom_exam_by_appointment(bigint)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.publish_dicom_report(bigint,boolean,uuid)', 'EXECUTE')
  AND NOT has_function_privilege(
    'anon',
    'public.queue_notification(uuid,varchar,varchar,bigint,varchar,varchar,varchar,varchar,varchar,jsonb,bigint,bigint,timestamptz,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege('anon', 'public.criar_sala_telemedicina(bigint)', 'EXECUTE'),
  'RPCs legadas privilegiadas devem permanecer fechadas para anon'
);
SELECT pg_temp.assert_true(
  NOT has_function_privilege('anon', 'public.get_reception_checkin_readiness(bigint)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.perform_reception_checkin_secure(bigint,text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_reception_checkin_readiness(bigint)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.perform_reception_checkin_secure(bigint,text,text)', 'EXECUTE'),
  'RPCs de check-in devem ser exclusivas de authenticated'
);
SELECT pg_temp.assert_true(
  NOT has_function_privilege('anon', 'public.finalize_attendance_secure(bigint,text,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.finalize_attendance_secure(bigint,text,text,jsonb)', 'EXECUTE'),
  'finalização atômica do atendimento deve ser exclusiva de authenticated'
);
SELECT pg_temp.assert_true(
  NOT has_function_privilege('anon', 'public.update_reception_authorization_secure(uuid,text,text,text,text,date,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.update_reception_eligibility_secure(uuid,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_scheduling_requirements(bigint,bigint,bigint,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege(
    'anon',
    'public.create_appointment_with_requirements_secure(bigint,bigint,date,time without time zone,time without time zone,uuid,integer,integer,bigint,bigint,text,boolean,boolean,text,integer,text,text)',
    'EXECUTE'
  ),
  'writers de convênio não podem ser executáveis por PUBLIC/anon'
);
SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated',
    'public.create_appointment_secure(bigint,bigint,date,time without time zone,time without time zone,uuid,integer,integer,bigint,bigint,text,boolean,boolean,text)',
    'EXECUTE'
  ),
  'writer interno sem requisitos não pode ser chamado diretamente'
);
SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.update_appointment_status_secure(bigint,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.reschedule_appointment_secure(bigint,date,time without time zone,time without time zone,text)',
    'EXECUTE'
  ),
  'authenticated precisa executar as RPCs seguras de lifecycle'
);
SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'anon',
    'public.update_appointment_status_secure(bigint,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.reschedule_appointment_secure(bigint,date,time without time zone,time without time zone,text)',
    'EXECUTE'
  ),
  'anon não pode executar writers de agenda'
);
SELECT pg_temp.assert_true(
  (
    SELECT pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR UPDATE ON public.appointments%'
       AND pg_get_triggerdef(t.oid) NOT LIKE '%UPDATE OF%'
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.appointments'::regclass
      AND t.tgname = 'trg_appointments_unit_company'
      AND NOT t.tgisinternal
  ),
  'trigger de appointments precisa cobrir qualquer UPDATE'
);
SELECT pg_temp.assert_true(
  (SELECT pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR UPDATE%'
     AND pg_get_triggerdef(oid) NOT LIKE '%UPDATE OF%'
   FROM pg_trigger
   WHERE tgrelid = 'public.insurance_authorizations'::regclass
     AND tgname = 'trg_insurance_authorizations_scope')
  AND
  (SELECT pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR UPDATE%'
     AND pg_get_triggerdef(oid) NOT LIKE '%UPDATE OF%'
   FROM pg_trigger
   WHERE tgrelid = 'public.insurance_eligibility_checks'::regclass
     AND tgname = 'trg_insurance_eligibility_scope'),
  'triggers de escopo precisam cobrir qualquer UPDATE'
);

INSERT INTO public.companies (id, name, lg_ativo) VALUES
  ('84000000-0000-0000-0000-000000000001', 'Operacional A', TRUE),
  ('84000000-0000-0000-0000-000000000002', 'Operacional B', TRUE)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_ativo) VALUES
  (840001, '84000000-0000-0000-0000-000000000001', 'OPA1', 'A1', TRUE),
  (840002, '84000000-0000-0000-0000-000000000001', 'OPA2', 'A2', TRUE),
  (840003, '84000000-0000-0000-0000-000000000002', 'OPB1', 'B1', TRUE)
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email) VALUES
  ('84000000-0000-0000-0000-000000000010', 'operador@example.test'),
  ('84000000-0000-0000-0000-000000000011', 'colega@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (
  id, user_id, email, full_name, company_id, role_id, role_name, primary_unit_id, lg_ativo
)
SELECT '84000000-0000-0000-0000-000000000010'::UUID, '84000000-0000-0000-0000-000000000010'::UUID,
  'operador@example.test', 'Operador', '84000000-0000-0000-0000-000000000001'::UUID,
  r.id, r.name, 840001, TRUE
FROM public.roles r WHERE r.name = 'admin'
UNION ALL
SELECT '84000000-0000-0000-0000-000000000011'::UUID, '84000000-0000-0000-0000-000000000011'::UUID,
  'colega@example.test', 'Colega', '84000000-0000-0000-0000-000000000001'::UUID,
  r.id, r.name, 840001, TRUE
FROM public.roles r WHERE r.name = 'recepcao';
INSERT INTO public.memberships (id, user_id, company_id, status) VALUES
  ('84000000-0000-0000-0000-000000000020', '84000000-0000-0000-0000-000000000010', '84000000-0000-0000-0000-000000000001', 'active'),
  ('84000000-0000-0000-0000-000000000021', '84000000-0000-0000-0000-000000000010', '84000000-0000-0000-0000-000000000002', 'active');
INSERT INTO public.membership_roles (membership_id, role_id)
SELECT '84000000-0000-0000-0000-000000000020', id FROM public.roles WHERE name IN ('recepcao', 'admin');
INSERT INTO public.membership_roles (membership_id, role_id)
SELECT '84000000-0000-0000-0000-000000000021', id FROM public.roles WHERE name = 'recepcao';
INSERT INTO public.membership_units (membership_id, unit_id) VALUES
  ('84000000-0000-0000-0000-000000000020', 840001),
  ('84000000-0000-0000-0000-000000000020', 840002),
  ('84000000-0000-0000-0000-000000000021', 840003);
INSERT INTO public.role_permissions (
  company_id, role_id, module, can_view, can_create, can_edit, can_delete, can_export
)
SELECT '84000000-0000-0000-0000-000000000001'::UUID, r.id, m.module, TRUE, TRUE, TRUE, FALSE, FALSE
FROM public.roles r CROSS JOIN (VALUES ('agenda'), ('recepcao'), ('pacientes')) m(module)
WHERE r.name = 'recepcao'
UNION ALL
SELECT '84000000-0000-0000-0000-000000000001'::UUID, r.id, 'agenda', TRUE, TRUE, TRUE, TRUE, FALSE
FROM public.roles r WHERE r.name = 'admin'
UNION ALL
SELECT '84000000-0000-0000-0000-000000000002'::UUID, r.id, 'pacientes', TRUE, TRUE, TRUE, FALSE, FALSE
FROM public.roles r WHERE r.name = 'recepcao';

INSERT INTO public.professionals (id, company_id, full_name, lg_ativo) VALUES
  (840010, '84000000-0000-0000-0000-000000000001', 'Profissional A', TRUE),
  (840011, '84000000-0000-0000-0000-000000000002', 'Profissional B', TRUE);
INSERT INTO public.insurance_companies (
  id, company_id, name, lg_ativo, lg_matric_obrigatorio,
  lg_autorizac_obrigatorio, lg_val_matricula
) VALUES
  (840030, '84000000-0000-0000-0000-000000000001', 'Convênio A', TRUE, TRUE, TRUE, TRUE),
  (840031, '84000000-0000-0000-0000-000000000002', 'Convênio B', TRUE, TRUE, TRUE, TRUE);
INSERT INTO public.insurance_plans (
  id, company_id, insurance_company_id, name, lg_ativo
) VALUES
  (840040, '84000000-0000-0000-0000-000000000001', 840030, 'Plano A', TRUE),
  (840041, '84000000-0000-0000-0000-000000000002', 840031, 'Plano B', TRUE);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.insurance_plans (
      id, company_id, insurance_company_id, name, lg_ativo
    ) VALUES (
      840042, '84000000-0000-0000-0000-000000000001', 840031,
      'Plano inconsistente', TRUE
    );
    RAISE EXCEPTION 'plano aceitou operadora de outra empresa';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;
INSERT INTO public.professional_insurances (
  company_id, professional_id, insurance_company_id, lg_credenciado, lg_ativo
) VALUES (
  '84000000-0000-0000-0000-000000000001', 840010, 840030, TRUE, TRUE
);
INSERT INTO public.professional_schedules (
  company_id, professional_id, unit_id, day_of_week, lg_habilitado,
  slot1_start, slot1_end, slot1_duration, slot1_unit_id
) VALUES
  ('84000000-0000-0000-0000-000000000001', 840010, 840001, 'sábado', TRUE, 800, 900, 30, 840001),
  ('84000000-0000-0000-0000-000000000001', 840010, 840002, 'sábado', TRUE, 900, 1000, 30, 840002),
  ('84000000-0000-0000-0000-000000000002', 840011, 840003, 'sábado', TRUE, 1000, 1100, 30, 840003);

INSERT INTO public.patients (
  id, company_id, unit_id, full_name, insurance_plan_id, insurance_card_number
) VALUES
  (840020, '84000000-0000-0000-0000-000000000001', 840001, 'Paciente A1', 840040, 'CARD-A1'),
  (840021, '84000000-0000-0000-0000-000000000001', 840002, 'Paciente A2', NULL, NULL),
  (840022, '84000000-0000-0000-0000-000000000002', 840003, 'Paciente B1', 840041, 'CARD-B1');
DO $$
BEGIN
  UPDATE public.patients SET insurance_plan_id = 840041 WHERE id = 840020;
  RAISE EXCEPTION 'plano de outra empresa foi aceito no paciente';
EXCEPTION WHEN check_violation THEN NULL;
END;
$$;
INSERT INTO public.insurance_authorizations (id, company_id, unit_id, patient_id, status) VALUES
  ('84000000-0000-0000-0000-000000000031', '84000000-0000-0000-0000-000000000001', 840001, 840020, 'pendente'),
  ('84000000-0000-0000-0000-000000000032', '84000000-0000-0000-0000-000000000001', 840002, 840021, 'pendente'),
  ('84000000-0000-0000-0000-000000000033', '84000000-0000-0000-0000-000000000002', 840003, 840022, 'pendente');
INSERT INTO public.insurance_eligibility_checks (id, company_id, unit_id, patient_id, status) VALUES
  ('84000000-0000-0000-0000-000000000041', '84000000-0000-0000-0000-000000000001', 840001, 840020, 'pendente'),
  ('84000000-0000-0000-0000-000000000042', '84000000-0000-0000-0000-000000000001', 840002, 840021, 'pendente'),
  ('84000000-0000-0000-0000-000000000043', '84000000-0000-0000-0000-000000000002', 840003, 840022, 'pendente');

INSERT INTO public.appointments (
  id, company_id, unit_id, patient_id, professional_id,
  appointment_date, start_time, end_time, status, notes
) VALUES
  (840050, '84000000-0000-0000-0000-000000000001', 840001, 840020, 840010,
   DATE '2026-07-20', TIME '08:00', TIME '08:30', 'scheduled', NULL),
  (840051, '84000000-0000-0000-0000-000000000001', 840002, 840021, 840010,
   DATE '2026-07-20', TIME '09:00', TIME '09:30', 'scheduled', NULL),
  (840052, '84000000-0000-0000-0000-000000000002', 840003, 840022, 840011,
   DATE '2026-07-20', TIME '10:00', TIME '10:30', 'scheduled', NULL);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '84000000-0000-0000-0000-000000000010';
SET LOCAL request.jwt.claim.aal = 'aal2';
SET LOCAL request.jwt.claims = '{"sub":"84000000-0000-0000-0000-000000000010","role":"authenticated","aal":"aal2","session_id":"84000000-0000-0000-0000-000000000099"}';

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.user_profiles) = 1,
  'perfil admin legado não pode listar a empresa sem contexto AAL2 ativo'
);

SELECT public.activate_application_context(
  '84000000-0000-0000-0000-000000000020',
  (SELECT id FROM public.roles WHERE name = 'recepcao'),
  840001,
  '84000000-0000-0000-0000-000000000090',
  'Teste operacional', 'test', 'psql'
);

INSERT INTO public.patients (id, full_name)
VALUES (840023, 'Paciente Escopo Automático');
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.patients
    WHERE full_name = 'Paciente Escopo Automático'
      AND company_id = '84000000-0000-0000-0000-000000000001'
      AND unit_id = 840001
  ),
  'cadastro sem IDs do cliente deve herdar empresa e unidade do contexto ativo'
);
SELECT pg_temp.assert_true(
  (SELECT array_agg(id ORDER BY id) FROM public.insurance_plans) = ARRAY[840040],
  'planos devem ser filtrados pela empresa do contexto ativo'
);

SELECT pg_temp.assert_true((SELECT count(*) FROM public.professional_schedules) = 1, 'escala deve filtrar unidade ativa');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.insurance_authorizations) = 1, 'autorizações devem filtrar unidade ativa');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.insurance_eligibility_checks) = 1, 'elegibilidades devem filtrar unidade ativa');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.get_professional_available_slots(840010, DATE '2026-07-18', 30, NULL)) = 2,
  'RPC deve retornar somente slots da unidade ativa'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.get_professional_available_slots(840011, DATE '2026-07-18', 30, NULL)) = 0,
  'RPC não pode vazar profissional de outra empresa'
);

SELECT public.update_reception_authorization_secure(
  '84000000-0000-0000-0000-000000000031', 'solicitada', 'PROTO-A1', NULL, NULL, NULL, NULL, NULL
);
SELECT public.update_reception_eligibility_secure(
  '84000000-0000-0000-0000-000000000041', 'em_analise', 'ELIG-A1', NULL
);
SELECT pg_temp.assert_true(
  (SELECT protocol_number = 'PROTO-A1' FROM public.insurance_authorizations WHERE id = '84000000-0000-0000-0000-000000000031')
  AND (SELECT protocol_number = 'ELIG-A1' FROM public.insurance_eligibility_checks WHERE id = '84000000-0000-0000-0000-000000000041'),
  'writers devem atualizar somente registros da unidade ativa'
);

SELECT public.create_appointment_with_requirements_secure(
  840020, 840010, DATE '2026-07-19', TIME '10:00', TIME '10:30',
  '84000000-0000-0000-0000-000000000001', 840001,
  NULL, NULL, NULL, 'scheduled', FALSE, FALSE, NULL, NULL, NULL, NULL
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.insurance_authorizations
    WHERE patient_id = 840020 AND unit_id = 840001 AND appointment_id IS NOT NULL
      AND insurance_id = 840030 AND insurance_plan_id = 840040
  )
  AND EXISTS (
    SELECT 1 FROM public.insurance_eligibility_checks
    WHERE patient_id = 840020 AND unit_id = 840001 AND appointment_id IS NOT NULL
      AND insurance_id = 840030 AND insurance_plan_id = 840040
      AND card_number = 'CARD-A1'
  ),
  'writer deve usar o plano padrão e propagar convênio, plano, carteirinha e unidade'
);

SELECT public.update_appointment_status_secure(840050, 'confirmed', 'Confirmação de teste');
SELECT pg_temp.assert_true(
  (SELECT status = 'confirmed' FROM public.appointments WHERE id = 840050),
  'RPC de status deve atualizar o agendamento da unidade ativa'
);
SELECT public.reschedule_appointment_secure(
  840050, DATE '2026-07-21', TIME '12:00', TIME '12:30', 'Solicitação do paciente'
);
SELECT pg_temp.assert_true(
  (SELECT appointment_date = DATE '2026-07-21' AND status = 'scheduled'
     FROM public.appointments WHERE id = 840050),
  'RPC de remarcação deve atualizar somente o agendamento do contexto ativo'
);

DO $$
BEGIN
  BEGIN
    PERFORM public.update_appointment_status_secure(840051, 'confirmed', 'Outra unidade');
    RAISE EXCEPTION 'RPC de status aceitou agendamento de outra unidade';
  EXCEPTION WHEN insufficient_privilege OR no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.reschedule_appointment_secure(
      840052, DATE '2026-07-21', TIME '13:00', TIME '13:30', 'Outra empresa'
    );
    RAISE EXCEPTION 'RPC de remarcação aceitou agendamento de outra empresa';
  EXCEPTION WHEN insufficient_privilege OR no_data_found THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    PERFORM public.get_scheduling_requirements(840022, 840010, NULL, 840030, 'CARD-B1');
    RAISE EXCEPTION 'leitor de requisitos aceitou paciente de outra empresa';
  EXCEPTION WHEN insufficient_privilege OR no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.create_appointment_with_requirements_secure(
      840021, 840010, DATE '2026-07-19', TIME '11:00', TIME '11:30',
      '84000000-0000-0000-0000-000000000001', 840002,
      NULL, NULL, NULL, 'scheduled', FALSE, FALSE, NULL, 840030, 'CARD-A2', NULL
    );
    RAISE EXCEPTION 'writer de agendamento aceitou unidade diferente do contexto ativo';
  EXCEPTION WHEN insufficient_privilege OR no_data_found THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    PERFORM public.update_reception_authorization_secure(
      '84000000-0000-0000-0000-000000000032', 'solicitada', 'VAZAMENTO', NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'writer de autorização aceitou outra unidade';
  EXCEPTION WHEN insufficient_privilege OR no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.update_reception_eligibility_secure(
      '84000000-0000-0000-0000-000000000042', 'em_analise', 'VAZAMENTO', NULL
    );
    RAISE EXCEPTION 'writer de elegibilidade aceitou outra unidade';
  EXCEPTION WHEN insufficient_privilege OR no_data_found THEN NULL;
  END;
END;
$$;

SELECT public.activate_application_context(
  '84000000-0000-0000-0000-000000000021',
  (SELECT id FROM public.roles WHERE name = 'recepcao'),
  840003,
  '84000000-0000-0000-0000-000000000090',
  'Teste operacional', 'test', 'psql'
);
SELECT pg_temp.assert_true(
  (SELECT array_agg(id ORDER BY id) FROM public.insurance_plans) = ARRAY[840041],
  'troca de empresa deve expor somente os planos do novo contexto ativo'
);

SET LOCAL request.jwt.claim.aal = 'aal1';
SET LOCAL request.jwt.claims = '{"sub":"84000000-0000-0000-0000-000000000010","role":"authenticated","aal":"aal1","session_id":"84000000-0000-0000-0000-000000000099"}';
SELECT pg_temp.assert_true((SELECT count(*) FROM public.professional_schedules) = 0, 'AAL1 deve negar escalas');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.get_professional_available_slots(840010, DATE '2026-07-18', 30, NULL)) = 0,
  'AAL1 deve negar RPC de disponibilidade'
);
DO $$
BEGIN
  BEGIN
    PERFORM public.update_reception_authorization_secure(
      '84000000-0000-0000-0000-000000000031', 'solicitada', 'AAL1', NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'writer de autorização aceitou AAL1';
  EXCEPTION WHEN insufficient_privilege OR no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.update_appointment_status_secure(840052, 'confirmed', 'AAL1');
    RAISE EXCEPTION 'RPC de status aceitou AAL1';
  EXCEPTION WHEN insufficient_privilege OR no_data_found THEN NULL;
  END;
END;
$$;

RESET ROLE;
ROLLBACK;

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(condition, false) THEN
    RAISE EXCEPTION 'ACCESS_CONTEXT_ASSERTION_FAILED: %', message;
  END IF;
END;
$$;

-- Contratos estruturais e deny-by-default.
SELECT pg_temp.assert_true(to_regclass('public.memberships') IS NOT NULL, 'memberships deve existir');
SELECT pg_temp.assert_true(to_regclass('public.membership_roles') IS NOT NULL, 'membership_roles deve existir');
SELECT pg_temp.assert_true(to_regclass('public.membership_units') IS NOT NULL, 'membership_units deve existir');
SELECT pg_temp.assert_true(to_regclass('public.user_access_context') IS NOT NULL, 'user_access_context deve existir');
SELECT pg_temp.assert_true(
  to_regprocedure('public.activate_application_context(uuid,integer,integer,uuid,text,text,text)') IS NOT NULL,
  'RPC pública de ativação de contexto deve existir'
);
SELECT pg_temp.assert_true(to_regprocedure('public.can_access(text,text)') IS NOT NULL, 'helper can_access deve existir');
SELECT pg_temp.assert_true(to_regprocedure('public.active_unit_id()') IS NOT NULL, 'helper active_unit_id deve existir');
SELECT pg_temp.assert_true(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.memberships'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.membership_roles'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.membership_units'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_access_context'::regclass),
  'tabelas de acesso devem ter RLS habilitada'
);
SELECT pg_temp.assert_true(
  NOT has_function_privilege('anon', 'public.activate_application_context(uuid,integer,integer,uuid,text,text,text)', 'EXECUTE'),
  'anon não pode selecionar contexto'
);

-- Fixture determinística: usuário principal tem dois vínculos, dois papéis e três unidades autorizadas.
INSERT INTO public.companies (id, name)
VALUES
  ('31000000-0000-0000-0000-000000000001', 'Empresa Contexto A'),
  ('32000000-0000-0000-0000-000000000002', 'Empresa Contexto B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_ativo)
VALUES
  (910001, '31000000-0000-0000-0000-000000000001', 'CTX-A1', 'Unidade A1', true),
  (910002, '31000000-0000-0000-0000-000000000001', 'CTX-A2', 'Unidade A2', true),
  (910003, '31000000-0000-0000-0000-000000000001', 'CTX-A3', 'Unidade A não vinculada', true),
  (920001, '32000000-0000-0000-0000-000000000002', 'CTX-B1', 'Unidade B1', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES
  ('c1000000-0000-0000-0000-000000000001', 'context.user@example.test', 'test', now()),
  ('c2000000-0000-0000-0000-000000000002', 'other.user@example.test', 'test', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (
  id, user_id, full_name, email, role_id, role_name,
  company_id, primary_unit_id, lg_ativo
)
SELECT
  'c1000000-0000-0000-0000-000000000001',
  'c1000000-0000-0000-0000-000000000001',
  'Usuário de contexto', 'context.user@example.test',
  r.id, r.name, '31000000-0000-0000-0000-000000000001', 910001, TRUE
FROM public.roles r WHERE r.name = 'admin'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (
  id, user_id, full_name, email, role_id, role_name,
  company_id, primary_unit_id, lg_ativo
)
SELECT
  'c2000000-0000-0000-0000-000000000002',
  'c2000000-0000-0000-0000-000000000002',
  'Outro usuário', 'other.user@example.test',
  r.id, r.name, '32000000-0000-0000-0000-000000000002', 920001, TRUE
FROM public.roles r WHERE r.name = 'recepcao'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.memberships (id, user_id, company_id, status)
VALUES
  ('d1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'active'),
  ('d1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000002', 'active'),
  ('d2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000002', '32000000-0000-0000-0000-000000000002', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.membership_roles (membership_id, role_id)
SELECT 'd1000000-0000-0000-0000-000000000001', id FROM public.roles WHERE name IN ('recepcao', 'medico')
ON CONFLICT DO NOTHING;
INSERT INTO public.membership_roles (membership_id, role_id)
SELECT 'd1000000-0000-0000-0000-000000000001', id FROM public.roles WHERE name = 'admin'
ON CONFLICT DO NOTHING;
INSERT INTO public.membership_roles (membership_id, role_id)
SELECT 'd1000000-0000-0000-0000-000000000002', id FROM public.roles WHERE name = 'recepcao'
ON CONFLICT DO NOTHING;
INSERT INTO public.membership_roles (membership_id, role_id)
SELECT 'd2000000-0000-0000-0000-000000000002', id FROM public.roles WHERE name = 'recepcao'
ON CONFLICT DO NOTHING;

INSERT INTO public.membership_units (membership_id, unit_id)
VALUES
  ('d1000000-0000-0000-0000-000000000001', 910001),
  ('d1000000-0000-0000-0000-000000000001', 910002),
  ('d1000000-0000-0000-0000-000000000002', 920001),
  ('d2000000-0000-0000-0000-000000000002', 920001)
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (
  company_id, role_id, module, can_view, can_create, can_edit, can_delete, can_export
)
SELECT c.id, r.id, m.module, true, false, false, false, false
FROM (VALUES
  ('31000000-0000-0000-0000-000000000001'::uuid),
  ('32000000-0000-0000-0000-000000000002'::uuid)
) AS c(id)
CROSS JOIN public.roles r
CROSS JOIN (VALUES ('patients'), ('appointments'), ('medical_records')) AS m(module)
WHERE r.name = 'recepcao'
ON CONFLICT (company_id, role_id, module) DO UPDATE
SET can_view = true, can_create = false, can_edit = false, can_delete = false, can_export = false;

INSERT INTO public.role_permissions (
  company_id, role_id, module, can_view, can_create, can_edit, can_delete, can_export
)
SELECT '31000000-0000-0000-0000-000000000001', r.id, 'admin', true, true, true, true, false
FROM public.roles r
WHERE r.name = 'admin'
ON CONFLICT (company_id, role_id, module) DO UPDATE
SET can_view = true, can_create = true, can_edit = true, can_delete = true;

-- Dados clínicos em empresas/unidades diferentes.
INSERT INTO public.patients (id, company_id, unit_id, full_name)
VALUES
  (930001, '31000000-0000-0000-0000-000000000001', 910001, 'Paciente A1'),
  (930002, '31000000-0000-0000-0000-000000000001', 910002, 'Paciente A2'),
  (930003, '32000000-0000-0000-0000-000000000002', 920001, 'Paciente B1');

INSERT INTO public.appointments (
  id, company_id, unit_id, patient_id, appointment_date, start_time, status
)
VALUES
  (940001, '31000000-0000-0000-0000-000000000001', 910001, 930001, DATE '2026-07-16', TIME '08:00', 'scheduled'),
  (940002, '31000000-0000-0000-0000-000000000001', 910002, 930002, DATE '2026-07-16', TIME '09:00', 'scheduled'),
  (940003, '32000000-0000-0000-0000-000000000002', 920001, 930003, DATE '2026-07-16', TIME '10:00', 'scheduled');

INSERT INTO public.medical_records (id, company_id, unit_id, patient_id, appointment_id, diagnosis)
VALUES
  (950001, '31000000-0000-0000-0000-000000000001', 910001, 930001, 940001, 'Registro A1'),
  (950002, '31000000-0000-0000-0000-000000000001', 910002, 930002, 940002, 'Registro A2'),
  (950003, '32000000-0000-0000-0000-000000000002', 920001, 930003, 940003, 'Registro B1');

CREATE OR REPLACE FUNCTION pg_temp.activate_context(
  p_membership_id UUID,
  p_role_id INTEGER,
  p_unit_id INTEGER
)
RETURNS JSONB
LANGUAGE sql
AS $$
  SELECT public.activate_application_context(
    p_membership_id,
    p_role_id,
    p_unit_id,
    'c1000000-0000-0000-0000-000000000077'::UUID,
    'Teste de contexto',
    'psql',
    'access-context-foundation'
  );
$$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000001';
SET LOCAL request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"c1000000-0000-0000-0000-000000000099"}';

-- AAL1 nunca pode criar/trocar o contexto ativo.
SET LOCAL request.jwt.claim.aal = 'aal1';
DO $$
BEGIN
  PERFORM pg_temp.activate_context(
    'd1000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.roles WHERE name = 'recepcao'),
    910001
  );
  RAISE EXCEPTION 'ACCESS_CONTEXT_ASSERTION_FAILED: AAL1 não pode selecionar contexto';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END;
$$;
SELECT pg_temp.assert_true(public.active_unit_id() IS NULL, 'falha AAL1 não pode persistir contexto');

SET LOCAL request.jwt.claim.aal = 'aal2';

-- Papel corporativo pode selecionar a empresa sem inventar uma unidade.
SELECT pg_temp.activate_context(
  'd1000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.roles WHERE name = 'admin'),
  NULL
);
SELECT pg_temp.assert_true(
  public.active_company_id() = '31000000-0000-0000-0000-000000000001',
  'papel corporativo deve manter empresa ativa sem unidade'
);
SELECT pg_temp.assert_true(public.active_unit_id() IS NULL, 'papel corporativo deve manter unidade nula');
SELECT pg_temp.assert_true(public.can_access('admin', 'edit'), 'papel corporativo deve usar RBAC no contexto sem unidade');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.patients) = 0, 'contexto corporativo sem unidade não pode abrir dados clínicos');

-- Não confiar em membership/company/unit arbitrários enviados pelo cliente.
DO $$
BEGIN
  PERFORM pg_temp.activate_context(
    'd2000000-0000-0000-0000-000000000002',
    (SELECT id FROM public.roles WHERE name = 'recepcao'),
    920001
  );
  RAISE EXCEPTION 'ACCESS_CONTEXT_ASSERTION_FAILED: vínculo de outro usuário foi aceito';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END;
$$;

DO $$
BEGIN
  PERFORM pg_temp.activate_context(
    'd1000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.roles WHERE name = 'recepcao'),
    910003
  );
  RAISE EXCEPTION 'ACCESS_CONTEXT_ASSERTION_FAILED: unidade não vinculada foi aceita';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END;
$$;

-- Troca válida para A1: RBAC por ação e RLS por empresa + unidade.
SELECT pg_temp.activate_context(
  'd1000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.roles WHERE name = 'recepcao'),
  910001
);
SELECT pg_temp.assert_true(public.active_unit_id() = 910001, 'unidade A1 deve ficar ativa');
SELECT pg_temp.assert_true(public.can_access('patients', 'view'), 'recepção deve visualizar patients');
SELECT pg_temp.assert_true(NOT public.can_access('patients', 'edit'), 'ação não concedida deve falhar fechada');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.patients) = 1, 'patients deve filtrar empresa e unidade A1');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.appointments) = 1, 'appointments deve filtrar empresa e unidade A1');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.medical_records) = 1, 'medical_records deve filtrar empresa e unidade A1');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM public.patients WHERE company_id = '32000000-0000-0000-0000-000000000002'), 'outra empresa não pode vazar');

-- O contexto pertence à sessão do JWT, não apenas ao usuário.
SET LOCAL request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"c1000000-0000-0000-0000-000000000098"}';
SELECT pg_temp.assert_true(public.active_unit_id() IS NULL, 'outra sessão do mesmo usuário não pode reutilizar o contexto');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.patients) = 0, 'RLS deve fechar quando a sessão não possui contexto');
SET LOCAL request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"c1000000-0000-0000-0000-000000000099"}';

-- Um contexto previamente selecionado também fica inoperante se a sessão cai para AAL1.
SET LOCAL request.jwt.claim.aal = 'aal1';
SELECT pg_temp.assert_true(public.active_unit_id() IS NULL, 'AAL1 não pode reutilizar contexto AAL2 persistido');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.patients) = 0, 'RLS deve fechar ao perder AAL2');
SET LOCAL request.jwt.claim.aal = 'aal2';

-- Papel vinculado, porém sem permissão explícita, continua deny-by-default.
SELECT pg_temp.activate_context(
  'd1000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.roles WHERE name = 'medico'),
  910001
);
SELECT pg_temp.assert_true(NOT public.can_access('patients', 'view'), 'papel sem permissão explícita deve ser negado');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.patients) = 0, 'RLS deve negar papel sem permissão');

-- Trocas válidas de unidade e empresa para vínculos do próprio usuário.
SELECT pg_temp.activate_context(
  'd1000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.roles WHERE name = 'recepcao'),
  910002
);
SELECT pg_temp.assert_true(public.active_unit_id() = 910002, 'troca válida para A2 deve funcionar');
SELECT pg_temp.assert_true((SELECT id FROM public.patients) = 930002, 'contexto A2 deve ver apenas paciente A2');

SELECT pg_temp.activate_context(
  'd1000000-0000-0000-0000-000000000002',
  (SELECT id FROM public.roles WHERE name = 'recepcao'),
  920001
);
SELECT pg_temp.assert_true(public.active_company_id() = '32000000-0000-0000-0000-000000000002', 'troca válida de empresa deve funcionar');
SELECT pg_temp.assert_true((SELECT id FROM public.patients) = 930003, 'contexto B1 deve ver apenas paciente B1');

RESET ROLE;
ROLLBACK;

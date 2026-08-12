-- Farmácia: saldo prescrito, idempotência e rollback de sobredispensação.
-- Executar somente em PostgreSQL descartável completo.
BEGIN;

INSERT INTO public.companies (id, name, cnpj, lg_ativo)
VALUES ('00000000-0000-4000-8000-000000000281', 'M8 Balance Tenant', '00000000000281', TRUE);

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_principal, lg_ativo)
VALUES (28001, '00000000-0000-4000-8000-000000000281', 'M8BAL', 'M8 Balance Unit', TRUE, TRUE);

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES ('00000000-0000-4000-8000-000000002801', 'm8-balance@example.invalid', 'synthetic', NOW());

INSERT INTO public.user_profiles (
  id, user_id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo
) VALUES (
  '00000000-0000-4000-8000-000000002801',
  '00000000-0000-4000-8000-000000002801',
  'M8 Balance Admin', 'm8-balance@example.invalid', 'admin',
  '00000000-0000-4000-8000-000000000281', 28001, TRUE
);

INSERT INTO public.patients (id, company_id, full_name, cpf, lg_ativo)
VALUES (28001, '00000000-0000-4000-8000-000000000281', 'M8 Balance Patient', '00000000281', TRUE);

INSERT INTO public.professionals (
  id, company_id, user_id, full_name, specialty, lg_ativo
) VALUES (
  28001, '00000000-0000-4000-8000-000000000281',
  '00000000-0000-4000-8000-000000002801', 'M8 Balance Prescriber', 'Clínica', TRUE
);

INSERT INTO public.medicamentos (
  id, company_id, cd_principio_ativo, ds_concentracao, lg_ativo
) VALUES (
  28001, '00000000-0000-4000-8000-000000000281', 'Fármaco sintético', '10 mg', TRUE
);

INSERT INTO public.almoxarifados (
  id, company_id, ds_nome, cd_unidade, lg_principal, lg_ativo
) VALUES (
  28001, '00000000-0000-4000-8000-000000000281', 'Farmácia sintética', 28001, TRUE, TRUE
);

INSERT INTO public.lotes (
  id, company_id, cd_produto_tipo, cd_medicamento_id, cd_lote,
  dt_validade, qt_inicial, qt_atual, cd_almoxarifado, lg_ativo
) VALUES (
  28001, '00000000-0000-4000-8000-000000000281', 'MEDICAMENTO', 28001,
  'M8-BALANCE-LOT', CURRENT_DATE + 365, 20, 20, 28001, TRUE
);

SET LOCAL m20.internal_write = 'on';
INSERT INTO public.electronic_prescriptions (
  id, company_id, unit_id, patient_id, prescriber_id, root_prescription_id,
  status, current_version,
  created_by, updated_by
) VALUES (
  '00000000-0000-4000-8000-000000002810',
  '00000000-0000-4000-8000-000000000281', 28001, 28001, 28001,
  '00000000-0000-4000-8000-000000002810', 'draft', 1,
  '00000000-0000-4000-8000-000000002801',
  '00000000-0000-4000-8000-000000002801'
);

INSERT INTO public.electronic_prescription_items (
  id, company_id, prescription_id, item_type, medication_id, medication_name,
  dose, dose_unit, route, frequency_text, dispensable_quantity,
  created_by, updated_by
) VALUES (
  '00000000-0000-4000-8000-000000002811',
  '00000000-0000-4000-8000-000000000281',
  '00000000-0000-4000-8000-000000002810', 'medication', 28001,
  'Fármaco sintético', 10, 'mg', 'oral', 'uma vez ao dia', 7,
  '00000000-0000-4000-8000-000000002801',
  '00000000-0000-4000-8000-000000002801'
);

UPDATE public.electronic_prescriptions
SET status = 'active',
    signed_at = NOW(),
    signed_by = '00000000-0000-4000-8000-000000002801',
    signature_hash = repeat('a', 64),
    activated_at = NOW()
WHERE id = '00000000-0000-4000-8000-000000002810';

INSERT INTO public.memberships (id, user_id, company_id, status)
VALUES (
  '00000000-0000-4000-8000-000000002830',
  '00000000-0000-4000-8000-000000002801',
  '00000000-0000-4000-8000-000000000281', 'active'
);
INSERT INTO public.membership_roles (membership_id, role_id)
VALUES ('00000000-0000-4000-8000-000000002830', 1);
INSERT INTO public.membership_units (membership_id, unit_id)
VALUES ('00000000-0000-4000-8000-000000002830', 28001);
INSERT INTO public.application_devices (
  id, user_id, company_id, unit_id, client_device_id, display_name
) VALUES (
  '00000000-0000-4000-8000-000000002831',
  '00000000-0000-4000-8000-000000002801',
  '00000000-0000-4000-8000-000000000281', 28001,
  '00000000-0000-4000-8000-000000002833', 'M8 synthetic device'
);
INSERT INTO public.application_sessions (
  id, user_id, company_id, unit_id, device_id, gotrue_session_id
) VALUES (
  '00000000-0000-4000-8000-000000002832',
  '00000000-0000-4000-8000-000000002801',
  '00000000-0000-4000-8000-000000000281', 28001,
  '00000000-0000-4000-8000-000000002831',
  '00000000-0000-4000-8000-000000002832'
);
INSERT INTO public.user_access_context (
  user_id, session_id, membership_id, role_id, unit_id
) VALUES (
  '00000000-0000-4000-8000-000000002801',
  '00000000-0000-4000-8000-000000002832',
  '00000000-0000-4000-8000-000000002830', 1, 28001
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002801';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000281';
SET LOCAL request.jwt.claim.unit_id = '28001';
SET LOCAL request.jwt.claim.session_id = '00000000-0000-4000-8000-000000002832';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002801","company_id":"00000000-0000-4000-8000-000000000281","unit_id":28001,"session_id":"00000000-0000-4000-8000-000000002832","role":"authenticated","aal":"aal2"}';

DO $context$
BEGIN
  IF public.get_my_company_id() IS DISTINCT FROM '00000000-0000-4000-8000-000000000281'::UUID
     OR public.active_unit_id() IS DISTINCT FROM 28001 THEN
    RAISE EXCEPTION 'M8 balance: synthetic authenticated context is incomplete (company %, unit %)',
      public.get_my_company_id(), public.active_unit_id();
  END IF;
END
$context$;

SELECT public.dispensar_estoque_atomic(
  '00000000-0000-4000-8000-000000002821', 28001, NULL, NULL,
  '00000000-0000-4000-8000-000000002810', 'parcial 1',
  '[{"cd_lote":28001,"qt_dispensada":4,"electronic_prescription_item_id":"00000000-0000-4000-8000-000000002811"}]'
);

-- A repetição da mesma operação não pode baixar o lote novamente.
SELECT public.dispensar_estoque_atomic(
  '00000000-0000-4000-8000-000000002821', 28001, NULL, NULL,
  '00000000-0000-4000-8000-000000002810', 'parcial 1',
  '[{"cd_lote":28001,"qt_dispensada":4,"electronic_prescription_item_id":"00000000-0000-4000-8000-000000002811"}]'
);

SELECT public.dispensar_estoque_atomic(
  '00000000-0000-4000-8000-000000002822', 28001, NULL, NULL,
  '00000000-0000-4000-8000-000000002810', 'parcial 2',
  '[{"cd_lote":28001,"qt_dispensada":3,"electronic_prescription_item_id":"00000000-0000-4000-8000-000000002811"}]'
);

DO $behavior$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.dispensar_estoque_atomic(
      '00000000-0000-4000-8000-000000002823', 28001, NULL, NULL,
      '00000000-0000-4000-8000-000000002810', 'excedente',
      '[{"cd_lote":28001,"qt_dispensada":1,"electronic_prescription_item_id":"00000000-0000-4000-8000-000000002811"}]'
    );
  EXCEPTION WHEN check_violation THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M8 balance: overdispensing was not rejected';
  END IF;
END
$behavior$;

RESET ROLE;

DO $assertions$
BEGIN
  IF (SELECT qt_atual FROM public.lotes WHERE id = 28001) <> 13 THEN
    RAISE EXCEPTION 'M8 balance: stock changed beyond the prescribed total';
  END IF;
  IF (SELECT COUNT(*) FROM public.dispensacoes WHERE company_id = '00000000-0000-4000-8000-000000000281') <> 2 THEN
    RAISE EXCEPTION 'M8 balance: idempotency or failed-operation rollback is broken';
  END IF;
  IF (SELECT COALESCE(SUM(qt_dispensada), 0) FROM public.dispensacao_itens
      WHERE electronic_prescription_item_id = '00000000-0000-4000-8000-000000002811') <> 7 THEN
    RAISE EXCEPTION 'M8 balance: accumulated quantity differs from prescribed quantity';
  END IF;
END
$assertions$;

SELECT 'M8_PHARMACY_PRESCRIPTION_BALANCE_PASS' AS result;
ROLLBACK;

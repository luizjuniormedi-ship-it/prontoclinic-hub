\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'RECEPTION_CHECKOUT_ASSERTION_FAILED: %', message;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  to_regclass('public.billing_accounts') IS NOT NULL
  AND to_regclass('public.financial_transactions') IS NOT NULL
  AND to_regclass('public.reception_tiss_guides') IS NOT NULL
  AND to_regclass('public.cash_sessions') IS NOT NULL,
  'fundação financeira da recepção precisa existir'
);

SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'anon',
    'public.prepare_reception_checkout_secure(bigint,text,numeric,numeric,numeric,numeric,text,date,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.register_reception_payment_secure(bigint,numeric,text,text,text,integer,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.prepare_reception_checkout_secure(bigint,text,numeric,numeric,numeric,numeric,text,date,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.generate_reception_tiss_guide_secure(bigint,text,bigint,text)',
    'EXECUTE'
  ),
  'RPCs financeiras e TISS devem ser exclusivas de authenticated'
);

INSERT INTO public.companies (id, name, lg_ativo)
VALUES ('85000000-0000-0000-0000-000000000001', 'Checkout E2E', TRUE);

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_ativo) VALUES
  (850001, '85000000-0000-0000-0000-000000000001', 'CHK1', 'Checkout Unidade A', TRUE),
  (850002, '85000000-0000-0000-0000-000000000001', 'CHK2', 'Checkout Unidade B', TRUE);

INSERT INTO auth.users (id, email)
VALUES ('85000000-0000-0000-0000-000000000010', 'checkout@example.test');

INSERT INTO public.user_profiles (
  id, user_id, email, full_name, company_id, role_id, role_name,
  primary_unit_id, lg_ativo, must_change_password
)
SELECT
  '85000000-0000-0000-0000-000000000010',
  '85000000-0000-0000-0000-000000000010',
  'checkout@example.test', 'Operador Checkout',
  '85000000-0000-0000-0000-000000000001',
  role.id, role.name, 850001, TRUE, FALSE
FROM public.roles role WHERE role.name = 'recepcao';

INSERT INTO public.memberships (id, user_id, company_id, status)
VALUES (
  '85000000-0000-0000-0000-000000000020',
  '85000000-0000-0000-0000-000000000010',
  '85000000-0000-0000-0000-000000000001',
  'active'
);
INSERT INTO public.membership_roles (membership_id, role_id)
SELECT '85000000-0000-0000-0000-000000000020', id
FROM public.roles WHERE name = 'recepcao';
INSERT INTO public.membership_units (membership_id, unit_id) VALUES
  ('85000000-0000-0000-0000-000000000020', 850001),
  ('85000000-0000-0000-0000-000000000020', 850002);

-- O fixture força uma recepção sem edição ampla da agenda. Assim, o contrato
-- comprova que somente a transição controlada de check-in é autorizada.
INSERT INTO public.role_permissions (
  company_id, role_id, module,
  can_view, can_create, can_edit, can_delete, can_export
)
SELECT
  '85000000-0000-0000-0000-000000000001'::UUID,
  role.id,
  permission.module,
  permission.can_view,
  permission.can_create,
  permission.can_edit,
  FALSE,
  FALSE
FROM public.roles role
CROSS JOIN (
  VALUES
    ('recepcao', TRUE, TRUE, TRUE),
    ('agenda', TRUE, TRUE, FALSE),
    ('appointments', TRUE, TRUE, FALSE)
) AS permission(module, can_view, can_create, can_edit)
WHERE role.name = 'recepcao'
ON CONFLICT (company_id, role_id, module) DO UPDATE
SET can_view = EXCLUDED.can_view,
    can_create = EXCLUDED.can_create,
    can_edit = EXCLUDED.can_edit,
    can_delete = FALSE,
    can_export = FALSE,
    updated_at = NOW();

UPDATE public.role_permissions
SET can_edit = FALSE,
    updated_at = NOW()
WHERE company_id = '85000000-0000-0000-0000-000000000001'
  AND role_id = (SELECT id FROM public.roles WHERE name = 'recepcao')
  AND lower(module) IN ('agenda', 'appointments');

INSERT INTO public.professionals (id, company_id, full_name, lg_ativo)
VALUES (850010, '85000000-0000-0000-0000-000000000001', 'Profissional Checkout', TRUE);

INSERT INTO public.patients (
  id, company_id, unit_id, full_name, birth_date, registration_status, status, lg_ativo
) VALUES
  (850020, '85000000-0000-0000-0000-000000000001', 850001, 'Paciente Particular', DATE '1990-01-01', 'complete', 'active', TRUE),
  (850021, '85000000-0000-0000-0000-000000000001', 850002, 'Paciente Outra Unidade', DATE '1988-01-01', 'complete', 'active', TRUE);

INSERT INTO public.appointments (
  id, company_id, unit_id, patient_id, professional_id,
  appointment_date, start_time, end_time, status, notes
) VALUES
  (850050, '85000000-0000-0000-0000-000000000001', 850001, 850020, 850010,
   CURRENT_DATE, TIME '08:00', TIME '08:30', 'scheduled', 'Checkout particular'),
  (850051, '85000000-0000-0000-0000-000000000001', 850002, 850021, 850010,
   CURRENT_DATE, TIME '09:00', TIME '09:30', 'scheduled', 'Outra unidade');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '85000000-0000-0000-0000-000000000010';
SET LOCAL request.jwt.claim.aal = 'aal2';
SET LOCAL request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000010","role":"authenticated","aal":"aal2","session_id":"85000000-0000-0000-0000-000000000099"}';

SELECT public.activate_application_context(
  '85000000-0000-0000-0000-000000000020',
  (SELECT id FROM public.roles WHERE name = 'recepcao'),
  850001,
  '85000000-0000-0000-0000-000000000090',
  'Teste checkout', 'test', 'psql'
);

SELECT pg_temp.assert_true(
  NOT (public.get_reception_checkout_summary(850050)->>'prepared')::BOOLEAN,
  'resumo inicial deve informar cobrança ainda não preparada'
);

SELECT public.prepare_reception_checkout_secure(
  850050, 'particular', 100, 0, 100, 0,
  'before_checkin', CURRENT_DATE, 'Pagamento no check-in'
);
SELECT public.prepare_reception_checkout_secure(
  850050, 'particular', 100, 0, 100, 0,
  'before_checkin', CURRENT_DATE, 'Repetição idempotente'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.billing_accounts WHERE appointment_id = 850050) = 1
  AND (SELECT count(*) FROM public.billing_account_items WHERE source_record_id = '850050') = 1
  AND (SELECT count(*) FROM public.financial_transactions
       WHERE appointment_id = 850050 AND transaction_type = 'receivable') = 1,
  'preparação repetida não pode duplicar conta, item ou título'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      public.get_reception_checkin_readiness(850050)->'issues'
    ) issue
    WHERE issue->>'type' = 'payment_pending'
      AND issue->>'severity' = 'blocking'
  ),
  'pagamento before_checkin pendente precisa bloquear o check-in'
);

SELECT public.open_reception_cash_session_secure(50, 'Abertura de teste');
SELECT public.open_reception_cash_session_secure(50, 'Repetição idempotente');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.cash_sessions
   WHERE company_id = '85000000-0000-0000-0000-000000000001'
     AND unit_id = 850001 AND status = 'open') = 1,
  'abertura repetida não pode duplicar caixa'
);

SELECT public.register_reception_payment_secure(
  850050, 60, 'dinheiro', 'checkout-850050-cash-1', NULL, 1, 'Primeira parcela'
);
SELECT public.register_reception_payment_secure(
  850050, 60, 'dinheiro', 'checkout-850050-cash-1', NULL, 1, 'Retry da mesma parcela'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.financial_transactions
   WHERE idempotency_key = 'checkout-850050-cash-1') = 1
  AND (SELECT count(*) FROM public.cash_movements
       WHERE financial_transaction_id = (
         SELECT id FROM public.financial_transactions
         WHERE idempotency_key = 'checkout-850050-cash-1'
       )) = 1
  AND (public.get_reception_checkout_summary(850050)->>'patient_pending_amount')::NUMERIC = 40,
  'pagamento em dinheiro deve ser idempotente, movimentar caixa e atualizar saldo'
);

SELECT public.register_reception_payment_secure(
  850050, 40, 'credito', 'checkout-850050-card-1', 'NSU-850050', 2, 'Saldo em cartão'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.financial_transactions
   WHERE parent_transaction_id = (
     SELECT id FROM public.financial_transactions
     WHERE idempotency_key = 'checkout-850050-card-1'
   ) AND transaction_type = 'acquirer_receivable') = 2
  AND (public.get_reception_checkout_summary(850050)->>'patient_pending_amount')::NUMERIC = 0
  AND (SELECT status = 'particular_paga' FROM public.billing_accounts WHERE appointment_id = 850050),
  'cartão parcelado deve quitar paciente e criar recebíveis da adquirente'
);

SELECT pg_temp.assert_true(
  (public.get_reception_checkin_readiness(850050)->>'ready')::BOOLEAN,
  'particular integralmente pago deve estar pronto para check-in'
);

DO $$
BEGIN
  BEGIN
    PERFORM public.prepare_reception_checkout_secure(
      850051, 'particular', 10, 0, 10, 0,
      'before_checkin', CURRENT_DATE, NULL
    );
    RAISE EXCEPTION 'checkout aceitou agendamento de outra unidade';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
RESET request.jwt.claim.sub;
RESET request.jwt.claim.aal;
RESET request.jwt.claims;

-- Cenário TISS: preparação e guia individual com versão vigente configurável.
INSERT INTO public.insurance_companies (
  id, company_id, name, lg_ativo, lg_matric_obrigatorio,
  lg_autorizac_obrigatorio, lg_val_matricula
) VALUES (
  850030, '85000000-0000-0000-0000-000000000001', 'Convênio Checkout',
  TRUE, TRUE, FALSE, FALSE
);
INSERT INTO public.insurance_plans (
  id, company_id, insurance_company_id, name, lg_ativo
) VALUES (
  850040, '85000000-0000-0000-0000-000000000001', 850030,
  'Plano Checkout', TRUE
);

UPDATE public.patients
   SET insurance_plan_id = 850040,
       insurance_card_number = 'CARD-850'
 WHERE id = 850020;
INSERT INTO public.appointments (
  id, company_id, unit_id, patient_id, professional_id,
  insurance_company_id,
  appointment_date, start_time, end_time, status, notes
) VALUES (
  850052, '85000000-0000-0000-0000-000000000001', 850001,
  850020, 850010, 850030, CURRENT_DATE,
  TIME '10:00', TIME '10:30', 'scheduled', 'Checkout convênio'
);

CREATE TEMP TABLE checkout_appointment_before ON COMMIT DROP AS
SELECT id, to_jsonb(appointment) AS row_data
FROM public.appointments appointment
WHERE id = 850052;
GRANT SELECT ON checkout_appointment_before TO authenticated;

CREATE TEMP TABLE checkout_checkin_results (
  attempt INTEGER PRIMARY KEY,
  result JSONB NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT ON checkout_checkin_results TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '85000000-0000-0000-0000-000000000010';
SET LOCAL request.jwt.claim.aal = 'aal2';
SET LOCAL request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000010","role":"authenticated","aal":"aal2","session_id":"85000000-0000-0000-0000-000000000099"}';

SELECT pg_temp.assert_true(
  public.can_access('recepcao', 'create')
  AND NOT public.can_access('agenda', 'edit'),
  'fixture deve representar recepção sem edição ampla da agenda'
);

SELECT public.prepare_reception_checkout_secure(
  850052, 'convenio', 200, 0, 20, 180,
  'accounts_receivable', CURRENT_DATE + 30, 'Coparticipação a receber'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.get_reception_checkin_readiness(850052)->'issues'
    ) issue
    WHERE issue->>'type' = 'tiss_guide_missing'
      AND issue->>'severity' = 'blocking'
      AND issue->>'step' = 'tiss'
      AND issue->>'resolution_action' = 'generate_tiss_guide'
      AND issue->>'owner' = 'reception'
      AND (issue->>'blocking')::BOOLEAN
      AND issue->>'impact' = 'checkin_blocked'
  ),
  'readiness deve orientar de forma estruturada a geração da guia TISS'
);
SELECT public.generate_reception_tiss_guide_secure(850052, 'consulta', NULL, NULL);
SELECT public.validate_reception_tiss_guide_secure(
  (SELECT id FROM public.reception_tiss_guides WHERE appointment_id = 850052)
);
SELECT public.sign_reception_tiss_guide_secure(
  (SELECT id FROM public.reception_tiss_guides WHERE appointment_id = 850052),
  'tablet'
);

SELECT pg_temp.assert_true(
  (SELECT status = 'signed' AND tiss_version = '04.03.00'
   FROM public.reception_tiss_guides WHERE appointment_id = 850052)
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      public.get_reception_checkin_readiness(850052)->'issues'
    ) issue
    WHERE issue->>'type' = 'payment_pending'
      AND issue->>'severity' = 'warning'
  )
  AND (public.get_reception_checkin_readiness(850052)->>'ready')::BOOLEAN,
  'guia assinada e saldo enviado ao contas a receber devem permitir check-in com warning'
);

DO $$
BEGIN
  BEGIN
    PERFORM public.update_appointment_status_secure(
      850052, 'waiting', 'Check-in realizado - senha C999'
    );
    RAISE EXCEPTION
      'recepção conseguiu avançar agenda sem check-in e ticket íntegros';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.scheduling_status_history
   WHERE appointment_id = 850052) = 0,
  'tentativa negada não pode gerar histórico de status'
);

INSERT INTO checkout_checkin_results (attempt, result)
SELECT 1, public.perform_reception_checkin_secure(850052, 'normal', NULL);
INSERT INTO checkout_checkin_results (attempt, result)
SELECT 2, public.perform_reception_checkin_secure(850052, 'normal', NULL);
RESET ROLE;

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM public.appointments appointment
    JOIN checkout_appointment_before before_row USING (id)
    WHERE appointment.id = 850052
      AND appointment.status = 'waiting'
      AND appointment.notes ~ '^Check-in realizado - senha C[0-9]{3}$'
      AND (
        to_jsonb(appointment) - ARRAY['status', 'notes', 'updated_at']::TEXT[]
        = before_row.row_data - ARRAY['status', 'notes', 'updated_at']::TEXT[]
      )
  ),
  'check-in deve alterar somente status, notes e updated_at na transição para waiting'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.reception_checkins checkin
    JOIN public.billing_accounts account ON account.id = checkin.billing_account_id
    JOIN public.reception_tiss_guides guide ON guide.id = checkin.tiss_guide_id
    WHERE checkin.appointment_id = 850052
      AND checkin.payer_type = 'convenio'
      AND checkin.has_payment_pending
      AND checkin.has_tiss_guide
      AND guide.status = 'signed'
  ),
  'check-in por convênio deve preservar vínculos da conta, guia e contas a receber'
);
SELECT pg_temp.assert_true(
  (
    SELECT first.result->>'checkin_id' = retry.result->>'checkin_id'
       AND first.result->>'ticket_id' = retry.result->>'ticket_id'
       AND first.result->>'ticket' = retry.result->>'ticket'
       AND NOT (first.result->>'idempotent_replay')::BOOLEAN
       AND (retry.result->>'idempotent_replay')::BOOLEAN
    FROM checkout_checkin_results first
    CROSS JOIN checkout_checkin_results retry
    WHERE first.attempt = 1 AND retry.attempt = 2
  ),
  'retry do check-in deve devolver o mesmo check-in e a mesma senha'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.reception_checkins
   WHERE appointment_id = 850052) = 1
  AND (SELECT count(*) FROM public.reception_queue_tickets
       WHERE appointment_id = 850052
         AND company_id = '85000000-0000-0000-0000-000000000001'
         AND unit_id = 850001) = 1
  AND (SELECT count(*) FROM public.scheduling_status_history
       WHERE appointment_id = 850052
         AND from_status = 'scheduled'
         AND to_status = 'waiting') = 1
  AND (SELECT count(*) FROM public.reception_checkin_status_history history
       JOIN public.reception_checkins checkin ON checkin.id = history.checkin_id
       WHERE checkin.appointment_id = 850052
         AND history.to_status = 'checked_in') = 1,
  'check-in idempotente não pode duplicar registros, senha ou históricos'
);

ROLLBACK;

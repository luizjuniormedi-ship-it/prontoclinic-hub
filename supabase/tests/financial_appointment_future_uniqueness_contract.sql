\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition BOOLEAN, message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'FINANCIAL_APPOINTMENT_UNIQUENESS_FAILED: %', message;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  to_regclass('private.financial_appointment_duplicate_audit') IS NOT NULL,
  'Historical duplicate audit view is missing'
);

SELECT pg_temp.assert_true(
  NOT has_table_privilege(
    'authenticated',
    'private.financial_appointment_duplicate_audit',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'app_prontomedic',
    'private.financial_appointment_duplicate_audit',
    'SELECT'
  ),
  'Duplicate audit must remain private'
);

SELECT pg_temp.assert_true(
  (
    SELECT NOT procedure_record.prosecdef
    FROM pg_proc procedure_record
    WHERE procedure_record.oid =
      'private.enforce_financial_appointment_uniqueness()'::REGPROCEDURE
  ),
  'Uniqueness trigger must remain SECURITY INVOKER'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*)
    FROM pg_trigger trigger_record
    WHERE trigger_record.tgname = 'trg_zz_financial_appointment_uniqueness'
      AND trigger_record.tgrelid IN (
        'public.billing_accounts'::REGCLASS,
        'public.billings'::REGCLASS
      )
      AND trigger_record.tgenabled = 'O'
      AND NOT trigger_record.tgisinternal
  ) = 2,
  'Both financial ledgers must enforce future uniqueness'
);

INSERT INTO public.companies (id, name)
VALUES ('fa000000-0000-4000-8000-000000000001', 'Financial uniqueness QA')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome)
VALUES (
  933537,
  'fa000000-0000-4000-8000-000000000001',
  'FIN-UQ',
  'Financial uniqueness unit'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.patients (id, company_id, unit_id, full_name)
VALUES (
  933537,
  'fa000000-0000-4000-8000-000000000001',
  933537,
  'Financial uniqueness patient'
)
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = replica;
INSERT INTO public.appointments (
  id, company_id, unit_id, patient_id,
  appointment_date, start_time, end_time, status
)
VALUES
  (
    933537,
    'fa000000-0000-4000-8000-000000000001',
    933537,
    933537,
    CURRENT_DATE,
    TIME '08:00',
    TIME '08:30',
    'completed'
  ),
  (
    933538,
    'fa000000-0000-4000-8000-000000000001',
    933537,
    933537,
    CURRENT_DATE,
    TIME '09:00',
    TIME '09:30',
    'completed'
  );

-- Simulate preserved legacy duplicates without invoking future guards.
INSERT INTO public.billing_accounts (
  id, company_id, unit_id, appointment_id, patient_id,
  billing_type, account_type, status
)
VALUES
  (
    'fa000000-0000-4000-8000-000000000101',
    'fa000000-0000-4000-8000-000000000001',
    933537, 933537, 933537, 'particular', 'ambulatorial', 'aberta'
  ),
  (
    'fa000000-0000-4000-8000-000000000102',
    'fa000000-0000-4000-8000-000000000001',
    933537, 933537, 933537, 'particular', 'ambulatorial', 'aberta'
  );

INSERT INTO public.billings (
  id, company_id, patient_id, appointment_id, amount, status, lg_ativo
)
OVERRIDING SYSTEM VALUE
VALUES
  (9335371, 'fa000000-0000-4000-8000-000000000001', 933537, 933537, 10, 'pending', TRUE),
  (9335372, 'fa000000-0000-4000-8000-000000000001', 933537, 933537, 10, 'pending', TRUE);
SET LOCAL session_replication_role = origin;

SELECT pg_temp.assert_true(
  (
    SELECT count(*)
    FROM private.financial_appointment_duplicate_audit duplicate_record
    WHERE duplicate_record.appointment_id = 933537
      AND duplicate_record.row_count = 2
      AND duplicate_record.active_count = 2
  ) = 2,
  'Audit must report preserved duplicates in both ledgers'
);

ALTER TABLE public.billing_accounts DISABLE TRIGGER USER;
ALTER TABLE public.billing_accounts
  ENABLE TRIGGER trg_zz_financial_appointment_uniqueness;
ALTER TABLE public.billings DISABLE TRIGGER USER;
ALTER TABLE public.billings
  ENABLE TRIGGER trg_zz_financial_appointment_uniqueness;

DO $billing_account_duplicate$
BEGIN
  INSERT INTO public.billing_accounts (
    company_id, unit_id, appointment_id, patient_id,
    billing_type, account_type, status
  ) VALUES (
    'fa000000-0000-4000-8000-000000000001',
    933537, 933537, 933537, 'particular', 'ambulatorial', 'aberta'
  );
  RAISE EXCEPTION
    'FINANCIAL_APPOINTMENT_UNIQUENESS_FAILED: billing account duplicate accepted';
EXCEPTION
  WHEN unique_violation THEN NULL;
END
$billing_account_duplicate$;

DO $billing_duplicate$
BEGIN
  INSERT INTO public.billings (
    company_id, patient_id, appointment_id, amount, status, lg_ativo
  ) VALUES (
    'fa000000-0000-4000-8000-000000000001',
    933537, 933537, 10, 'pending', TRUE
  );
  RAISE EXCEPTION
    'FINANCIAL_APPOINTMENT_UNIQUENESS_FAILED: billing duplicate accepted';
EXCEPTION
  WHEN unique_violation THEN NULL;
END
$billing_duplicate$;

INSERT INTO public.billing_accounts (
  company_id, unit_id, appointment_id, patient_id,
  billing_type, account_type, status, deleted_at
) VALUES (
  'fa000000-0000-4000-8000-000000000001',
  933537, 933538, 933537, 'particular', 'ambulatorial', 'cancelada', NOW()
);

INSERT INTO public.billings (
  company_id, patient_id, appointment_id, amount, status, lg_ativo
) VALUES (
  'fa000000-0000-4000-8000-000000000001',
  933537, 933538, 10, 'cancelled', FALSE
);

ROLLBACK;

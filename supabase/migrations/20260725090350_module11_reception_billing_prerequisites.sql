-- Module 11 / Reception scoped billing prerequisite.
-- Creates only the pending account identity used by the check-in workflow.
-- Runtime roles remain read-only; mutations are restricted to owner RPCs.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.companies') IS NULL
     OR to_regclass('public.units') IS NULL
     OR to_regclass('public.patients') IS NULL
     OR to_regclass('public.appointments') IS NULL
     OR to_regclass('public.insurance_companies') IS NULL THEN
    RAISE EXCEPTION 'Module 11 billing prerequisites are missing';
  END IF;
  IF to_regprocedure('public.current_company_id()') IS NULL THEN
    RAISE EXCEPTION 'Module 11 billing tenant helpers are missing';
  END IF;
END
$preflight$;

CREATE TABLE IF NOT EXISTS public.billing_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL
    REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER
    REFERENCES public.units(id) ON DELETE RESTRICT,
  appointment_id BIGINT
    REFERENCES public.appointments(id) ON DELETE RESTRICT,
  patient_id BIGINT
    REFERENCES public.patients(id) ON DELETE RESTRICT,
  insurance_id BIGINT
    REFERENCES public.insurance_companies(id) ON DELETE RESTRICT,
  billing_type TEXT NOT NULL DEFAULT 'convenio',
  account_type TEXT NOT NULL DEFAULT 'ambulatorial',
  status TEXT NOT NULL DEFAULT 'aberta',
  guide_number TEXT,
  competence_month DATE,
  total_gross_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_net_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_pending_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  has_pending_issues BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_accounts_type_chk
    CHECK (billing_type IN ('particular', 'convenio')),
  CONSTRAINT billing_accounts_amounts_chk
    CHECK (
      total_gross_amount >= 0
      AND total_net_amount >= 0
      AND total_paid_amount >= 0
      AND total_pending_amount >= 0
    )
);

DO $columns$
BEGIN
  IF to_regclass('public.billing_accounts') IS NULL THEN
    RAISE EXCEPTION 'public.billing_accounts was not created';
  END IF;

  ALTER TABLE public.billing_accounts
    ADD COLUMN IF NOT EXISTS unit_id INTEGER,
    ADD COLUMN IF NOT EXISTS appointment_id BIGINT,
    ADD COLUMN IF NOT EXISTS patient_id BIGINT,
    ADD COLUMN IF NOT EXISTS insurance_id BIGINT,
    ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'convenio',
    ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'ambulatorial',
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'aberta',
    ADD COLUMN IF NOT EXISTS guide_number TEXT,
    ADD COLUMN IF NOT EXISTS competence_month DATE,
    ADD COLUMN IF NOT EXISTS total_gross_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_net_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_pending_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS has_pending_issues BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
END
$columns$;

CREATE INDEX IF NOT EXISTS billing_accounts_company_created_idx
  ON public.billing_accounts(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_accounts_company_appointment_active_idx
  ON public.billing_accounts(company_id, appointment_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_accounts_authenticated_read
  ON public.billing_accounts;
CREATE POLICY billing_accounts_authenticated_read
  ON public.billing_accounts
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS billing_accounts_runtime_read
  ON public.billing_accounts;
CREATE POLICY billing_accounts_runtime_read
  ON public.billing_accounts
  FOR SELECT TO app_prontomedic
  USING (
    company_id = NULLIF(
      current_setting('request.jwt.claim.company_id', true),
      ''
    )::UUID
  );

REVOKE ALL ON TABLE public.billing_accounts
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT SELECT ON TABLE public.billing_accounts
  TO authenticated, app_prontomedic;

COMMENT ON TABLE public.billing_accounts IS
  'Tenant-scoped pending billing account owned by restricted workflow RPCs.';

COMMIT;

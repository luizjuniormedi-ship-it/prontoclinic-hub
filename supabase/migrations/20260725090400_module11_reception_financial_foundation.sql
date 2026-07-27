-- Module 11 prerequisite: minimal tenant-scoped receivable ledger.
-- Reception may create a pending receivable through its restricted RPC owner.
-- It never confirms or settles a payment.

BEGIN;

DO $requirements$
BEGIN
  IF to_regclass('public.companies') IS NULL
     OR to_regclass('public.units') IS NULL
     OR to_regclass('public.billings') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL
     OR to_regprocedure('public.org_can_access_unit(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'Reception financial foundation dependencies are missing';
  END IF;
END
$requirements$;

CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  patient_id BIGINT,
  billing_id BIGINT REFERENCES public.billings(id) ON DELETE RESTRICT,
  professional_id BIGINT,
  insurance_company_id INTEGER,
  nr_guia VARCHAR(50),
  dt_atendimento TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'em_aberto',
  lg_faturado BOOLEAN NOT NULL DEFAULT FALSE,
  tipo VARCHAR(30),
  notes TEXT,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(50),
  due_date DATE,
  payment_date DATE,
  paid_at TIMESTAMPTZ,
  authorization_number VARCHAR(30),
  protocol_number VARCHAR(60),
  total_amount NUMERIC(14,2),
  glosa_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2),
  batch_number BIGINT,
  tiss_xml_id BIGINT,
  fatura_id BIGINT,
  lg_cancelado BOOLEAN NOT NULL DEFAULT FALSE,
  appointment_id BIGINT,
  cd_origem_sigh BIGINT,
  billing_account_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_transactions_company_created
  ON public.financial_transactions(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_company_unit_created
  ON public.financial_transactions(company_id, unit_id, created_at DESC);

ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_transactions_runtime_select
  ON public.financial_transactions;
CREATE POLICY financial_transactions_runtime_select
  ON public.financial_transactions
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR public.org_can_access_unit(company_id, unit_id)
    )
  );

REVOKE ALL ON TABLE public.financial_transactions
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT SELECT ON TABLE public.financial_transactions
  TO authenticated, app_prontomedic;

COMMIT;

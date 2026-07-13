-- Read model for the financial UI. Balances are calculated from the immutable ledger.

CREATE INDEX IF NOT EXISTS billing_receipts_company_billing_occurred_idx
  ON public.billing_receipts(company_id, billing_id, occurred_at DESC, id DESC);

-- Financial reads are only exposed through permission-checked RPCs.
REVOKE SELECT ON TABLE public.billing_receipts FROM authenticated;

CREATE OR REPLACE FUNCTION public.list_billing_financial_summary_secure()
RETURNS TABLE(
  billing_id BIGINT, company_id UUID, patient_id BIGINT, appointment_id BIGINT,
  billed_amount NUMERIC, received_amount NUMERIC, balance_amount NUMERIC,
  financial_status TEXT, due_date DATE, last_payment_method TEXT,
  last_payment_at TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor RECORD;
BEGIN
  PERFORM public.assert_billing_permission(TRUE);
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  RETURN QUERY
  SELECT b.id, b.company_id, b.patient_id, b.appointment_id, b.amount,
    COALESCE(r.received, 0)::NUMERIC,
    GREATEST(b.amount - COALESCE(r.received, 0), 0)::NUMERIC,
    CASE
      WHEN b.status = 'cancelado' THEN 'cancelado'
      WHEN COALESCE(r.received, 0) <= 0 THEN 'pendente'
      WHEN COALESCE(r.received, 0) < b.amount THEN 'parcial'
      ELSE 'pago'
    END,
    b.dt_vencimento, lr.payment_method::TEXT, lr.occurred_at, b.created_at
  FROM public.billings b
  LEFT JOIN LATERAL (
    SELECT sum(CASE WHEN br.entry_type='receipt' THEN br.amount ELSE -br.amount END) AS received
    FROM public.billing_receipts br
    WHERE br.company_id=b.company_id AND br.billing_id=b.id
  ) r ON TRUE
  LEFT JOIN LATERAL (
    SELECT br.payment_method, br.occurred_at
    FROM public.billing_receipts br
    WHERE br.company_id=b.company_id AND br.billing_id=b.id AND br.entry_type='receipt'
      AND br.amount > COALESCE((
        SELECT sum(reversal.amount)
        FROM public.billing_receipts reversal
        WHERE reversal.company_id=br.company_id
          AND reversal.billing_id=br.billing_id
          AND reversal.entry_type='reversal'
          AND reversal.reverses_receipt_id=br.id
      ), 0)
    ORDER BY br.occurred_at DESC, br.id DESC LIMIT 1
  ) lr ON TRUE
  WHERE b.company_id=v_actor.company_id AND b.lg_ativo=TRUE
  ORDER BY b.created_at DESC
  LIMIT 2000;
END;
$$;

REVOKE ALL ON FUNCTION public.list_billing_financial_summary_secure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_billing_financial_summary_secure() TO authenticated;

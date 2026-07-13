-- Immutable tenant-aware receipt ledger for billings.

CREATE UNIQUE INDEX IF NOT EXISTS billings_company_id_id_key
  ON public.billings(company_id, id);

CREATE TABLE IF NOT EXISTS public.billing_receipts (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  billing_id BIGINT NOT NULL,
  entry_type VARCHAR(20) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  payment_method VARCHAR(40),
  idempotency_key UUID NOT NULL,
  reverses_receipt_id BIGINT,
  reason TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_receipts_amount_chk CHECK (amount > 0),
  CONSTRAINT billing_receipts_type_chk CHECK (entry_type IN ('receipt', 'reversal')),
  CONSTRAINT billing_receipts_reversal_shape_chk CHECK (
    (entry_type = 'receipt' AND reverses_receipt_id IS NULL)
    OR (entry_type = 'reversal' AND reverses_receipt_id IS NOT NULL)
  ),
  CONSTRAINT billing_receipts_company_billing_fkey
    FOREIGN KEY (company_id, billing_id) REFERENCES public.billings(company_id, id),
  CONSTRAINT billing_receipts_company_idempotency_uq UNIQUE (company_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_receipts_company_id_id_key
  ON public.billing_receipts(company_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.billing_receipts'::regclass
       AND conname = 'billing_receipts_reverses_fkey'
  ) THEN
    ALTER TABLE public.billing_receipts
      ADD CONSTRAINT billing_receipts_reverses_fkey
      FOREIGN KEY (company_id, reverses_receipt_id)
      REFERENCES public.billing_receipts(company_id, id);
  END IF;
END $$;

ALTER TABLE public.billing_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_receipts_tenant_select ON public.billing_receipts;
CREATE POLICY billing_receipts_tenant_select ON public.billing_receipts
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

CREATE OR REPLACE FUNCTION public.get_billing_balance_secure(p_billing_id BIGINT)
RETURNS TABLE(billing_id BIGINT, billed_amount NUMERIC, received_amount NUMERIC, balance_amount NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor RECORD; v_billing public.billings; v_received NUMERIC;
BEGIN
  PERFORM public.assert_billing_permission(TRUE);
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  SELECT * INTO v_billing FROM public.billings
   WHERE id = p_billing_id AND company_id = v_actor.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Faturamento inexistente ou fora da empresa'; END IF;
  SELECT COALESCE(sum(CASE WHEN entry_type = 'receipt' THEN amount ELSE -amount END), 0)
    INTO v_received FROM public.billing_receipts
   WHERE company_id = v_actor.company_id AND billing_receipts.billing_id = p_billing_id;
  RETURN QUERY SELECT v_billing.id, v_billing.amount, v_received, v_billing.amount - v_received;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_billing_receipt_secure(
  p_billing_id BIGINT,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_idempotency_key UUID
)
RETURNS public.billing_receipts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor RECORD; v_billing public.billings; v_existing public.billing_receipts;
  v_received NUMERIC; v_row public.billing_receipts;
BEGIN
  PERFORM public.assert_billing_permission(TRUE);
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF p_idempotency_key IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Chave idempotente e valor positivo sao obrigatorios';
  END IF;
  IF NULLIF(trim(COALESCE(p_payment_method, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Forma de pagamento obrigatoria';
  END IF;
  SELECT * INTO v_existing FROM public.billing_receipts
   WHERE company_id = v_actor.company_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.entry_type <> 'receipt' OR v_existing.billing_id <> p_billing_id
       OR v_existing.amount <> p_amount OR v_existing.payment_method <> trim(p_payment_method) THEN
      RAISE EXCEPTION 'Chave idempotente reutilizada com payload diferente';
    END IF;
    RETURN v_existing;
  END IF;
  SELECT * INTO v_billing FROM public.billings
   WHERE id = p_billing_id AND company_id = v_actor.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Faturamento inexistente ou fora da empresa'; END IF;
  IF v_billing.status = 'cancelado' THEN RAISE EXCEPTION 'Faturamento cancelado nao aceita recebimento'; END IF;
  SELECT COALESCE(sum(CASE WHEN entry_type = 'receipt' THEN amount ELSE -amount END), 0)
    INTO v_received FROM public.billing_receipts
   WHERE company_id = v_actor.company_id AND billing_id = v_billing.id;
  IF p_amount > v_billing.amount - v_received THEN
    RAISE EXCEPTION 'Valor recebido excede saldo do faturamento';
  END IF;
  INSERT INTO public.billing_receipts (
    company_id, billing_id, entry_type, amount, payment_method,
    idempotency_key, occurred_at, created_by
  ) VALUES (
    v_actor.company_id, v_billing.id, 'receipt', p_amount, trim(p_payment_method),
    p_idempotency_key, NOW(), v_actor.user_id
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_billing_receipt_secure(
  p_receipt_id BIGINT,
  p_reason TEXT,
  p_idempotency_key UUID
)
RETURNS public.billing_receipts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor RECORD; v_receipt public.billing_receipts; v_existing public.billing_receipts;
  v_reversed NUMERIC; v_row public.billing_receipts;
BEGIN
  PERFORM public.assert_billing_permission(TRUE);
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF p_idempotency_key IS NULL OR NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Chave idempotente e motivo do estorno sao obrigatorios';
  END IF;
  SELECT * INTO v_existing FROM public.billing_receipts
   WHERE company_id = v_actor.company_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.entry_type <> 'reversal' OR v_existing.reverses_receipt_id <> p_receipt_id
       OR v_existing.reason <> trim(p_reason) THEN
      RAISE EXCEPTION 'Chave idempotente reutilizada com payload diferente';
    END IF;
    RETURN v_existing;
  END IF;
  SELECT * INTO v_receipt FROM public.billing_receipts
   WHERE id = p_receipt_id AND company_id = v_actor.company_id AND entry_type = 'receipt'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recebimento inexistente ou fora da empresa'; END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_reversed FROM public.billing_receipts
   WHERE company_id = v_actor.company_id AND reverses_receipt_id = v_receipt.id
     AND entry_type = 'reversal';
  IF v_reversed >= v_receipt.amount THEN RAISE EXCEPTION 'Recebimento ja estornado integralmente'; END IF;
  INSERT INTO public.billing_receipts (
    company_id, billing_id, entry_type, amount, idempotency_key,
    reverses_receipt_id, reason, occurred_at, created_by
  ) VALUES (
    v_actor.company_id, v_receipt.billing_id, 'reversal', v_receipt.amount - v_reversed,
    p_idempotency_key, v_receipt.id, trim(p_reason), NOW(), v_actor.user_id
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON TABLE public.billing_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.billing_receipts TO authenticated;
REVOKE ALL ON FUNCTION public.get_billing_balance_secure(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_billing_receipt_secure(BIGINT, NUMERIC, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_billing_receipt_secure(BIGINT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_billing_balance_secure(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_billing_receipt_secure(BIGINT, NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_billing_receipt_secure(BIGINT, TEXT, UUID) TO authenticated;

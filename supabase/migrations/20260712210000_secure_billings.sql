-- Canonical tenant-aware billing mutations. Browser roles remain read-only.

ALTER TABLE public.billings
  ADD COLUMN IF NOT EXISTS guide_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS tiss_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS dt_vencimento DATE,
  ADD COLUMN IF NOT EXISTS dt_pagamento DATE,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.billings
     WHERE patient_id IS NULL OR amount IS NULL OR status IS NULL
  ) THEN
    RAISE EXCEPTION 'Billings possui dados incompletos; saneamento controlado obrigatorio antes desta migracao';
  END IF;
END $$;

ALTER TABLE public.billings
  ALTER COLUMN patient_id SET NOT NULL,
  ALTER COLUMN amount SET NOT NULL,
  ALTER COLUMN amount SET DEFAULT 0,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'em_aberto';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.billings'::regclass
       AND conname = 'billings_amount_nonnegative_chk'
  ) THEN
    ALTER TABLE public.billings
      ADD CONSTRAINT billings_amount_nonnegative_chk CHECK (amount >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.billings'::regclass
       AND conname = 'billings_status_chk'
  ) THEN
    ALTER TABLE public.billings
      ADD CONSTRAINT billings_status_chk CHECK (
        status IN ('em_aberto', 'faturado', 'faturado_enviado', 'glosa', 'cancelado')
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assert_billing_permission(p_status_change BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional';
  END IF;
  IF p_status_change THEN
    IF v_actor.role_name NOT IN ('admin', 'administrador', 'gestor', 'financeiro', 'faturamento') THEN
      RAISE EXCEPTION 'Usuario sem permissao para alterar faturamento';
    END IF;
  ELSIF v_actor.role_name NOT IN (
    'admin', 'administrador', 'gestor', 'financeiro', 'faturamento', 'medico', 'médico'
  ) THEN
    RAISE EXCEPTION 'Usuario sem permissao para gerar faturamento';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_transition_billing_status(p_from TEXT, p_to TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_from
    WHEN 'em_aberto' THEN p_to IN ('faturado', 'cancelado')
    WHEN 'faturado' THEN p_to IN ('faturado_enviado', 'glosa', 'cancelado')
    WHEN 'faturado_enviado' THEN p_to IN ('glosa', 'cancelado')
    WHEN 'glosa' THEN p_to IN ('em_aberto', 'cancelado')
    ELSE FALSE
  END
$$;

CREATE OR REPLACE FUNCTION public.create_billing_secure(
  p_appointment_id BIGINT,
  p_amount NUMERIC,
  p_tiss_status TEXT DEFAULT NULL,
  p_guide_number TEXT DEFAULT NULL
)
RETURNS public.billings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor RECORD; v_appointment public.appointments; v_row public.billings;
BEGIN
  PERFORM public.assert_billing_permission(FALSE);
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Valor de faturamento invalido';
  END IF;
  SELECT * INTO v_appointment
    FROM public.appointments
   WHERE id = p_appointment_id AND company_id = v_actor.company_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento inexistente ou fora da empresa'; END IF;
  IF v_appointment.patient_id IS NULL THEN RAISE EXCEPTION 'Atendimento sem paciente'; END IF;
  IF v_appointment.status <> 'completed' THEN
    RAISE EXCEPTION 'Faturamento exige atendimento concluido';
  END IF;
  INSERT INTO public.billings (
    company_id, patient_id, appointment_id, amount, status,
    tiss_status, guide_number, created_by, updated_by
  ) VALUES (
    v_actor.company_id, v_appointment.patient_id, v_appointment.id, p_amount,
    'em_aberto', NULLIF(trim(COALESCE(p_tiss_status, '')), ''),
    NULLIF(trim(COALESCE(p_guide_number, '')), ''), v_actor.user_id, v_actor.user_id
  ) RETURNING * INTO v_row;
  RETURN v_row;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Atendimento ja possui faturamento';
END;
$$;

CREATE OR REPLACE FUNCTION public.update_billing_status_secure(
  p_billing_id BIGINT,
  p_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.billings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor RECORD; v_old public.billings; v_row public.billings;
BEGIN
  PERFORM public.assert_billing_permission(TRUE);
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  SELECT * INTO v_old FROM public.billings
   WHERE id = p_billing_id AND company_id = v_actor.company_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Faturamento inexistente ou fora da empresa'; END IF;
  IF NOT public.can_transition_billing_status(v_old.status, p_status) THEN
    RAISE EXCEPTION 'Transicao de faturamento invalida: % -> %', v_old.status, p_status;
  END IF;
  IF p_status IN ('glosa', 'cancelado') AND NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo obrigatorio para glosa ou cancelamento';
  END IF;
  UPDATE public.billings
     SET status = p_status, updated_by = v_actor.user_id, updated_at = NOW()
   WHERE id = v_old.id
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_billing_permission(BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_transition_billing_status(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_billing_secure(BIGINT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_billing_status_secure(BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_billing_secure(BIGINT, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_billing_status_secure(BIGINT, TEXT, TEXT) TO authenticated;
GRANT SELECT ON public.billings TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.billings FROM anon, authenticated;

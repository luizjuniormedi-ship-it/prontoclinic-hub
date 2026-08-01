-- Module 14: tenant-aware insurance eligibility operations.
-- Additive only: preserves the reception compatibility table and existing rows.
-- No provider credentials, email delivery, DataSIGH access, or external calls.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.insurance_eligibility_checks') IS NULL THEN
    RAISE EXCEPTION 'Module 14 requires public.insurance_eligibility_checks from the reception foundation';
  END IF;
END
$$;

ALTER TABLE public.insurance_eligibility_checks
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS request_channel VARCHAR(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS valid_from DATE,
  ADD COLUMN IF NOT EXISTS valid_until DATE,
  ADD COLUMN IF NOT EXISTS result_code VARCHAR(80),
  ADD COLUMN IF NOT EXISTS proof_reference TEXT,
  ADD COLUMN IF NOT EXISTS proof_sha256 VARCHAR(128),
  ADD COLUMN IF NOT EXISTS proof_content_type VARCHAR(120),
  ADD COLUMN IF NOT EXISTS proof_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS external_request_id VARCHAR(160),
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exception_reason TEXT,
  ADD COLUMN IF NOT EXISTS exception_granted_by UUID,
  ADD COLUMN IF NOT EXISTS exception_granted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS block_reason TEXT,
  ADD COLUMN IF NOT EXISTS blocked_by UUID,
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;

ALTER TABLE public.insurance_eligibility_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_eligibility_checks FORCE ROW LEVEL SECURITY;

ALTER TABLE public.insurance_eligibility_checks
  DROP CONSTRAINT IF EXISTS insurance_eligibility_status_chk,
  DROP CONSTRAINT IF EXISTS insurance_eligibility_request_channel_chk,
  DROP CONSTRAINT IF EXISTS insurance_eligibility_validity_chk;

ALTER TABLE public.insurance_eligibility_checks
  ADD CONSTRAINT insurance_eligibility_status_chk CHECK (status IN (
    'elegivel','nao_elegivel','pendente','em_analise','portal_indisponivel',
    'nao_obrigatoria','liberado_excecao','bloqueado','expirado','cancelado'
  )),
  ADD CONSTRAINT insurance_eligibility_request_channel_chk CHECK (
    request_channel IN ('manual','portal','api')
  ),
  ADD CONSTRAINT insurance_eligibility_validity_chk CHECK (
    valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from
  );

DO $$
BEGIN
  IF to_regclass('public.units') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.insurance_eligibility_checks'::regclass
         AND conname = 'insurance_eligibility_unit_fkey'
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.insurance_eligibility_checks e
       WHERE e.unit_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.units u
           WHERE u.id = e.unit_id AND u.company_id = e.company_id
         )
     ) THEN
    ALTER TABLE public.insurance_eligibility_checks
      ADD CONSTRAINT insurance_eligibility_unit_fkey
      FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_insurance_eligibility_tenant_unit_status
  ON public.insurance_eligibility_checks(company_id, unit_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_eligibility_patient_history
  ON public.insurance_eligibility_checks(company_id, patient_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_insurance_eligibility_external_request
  ON public.insurance_eligibility_checks(company_id, external_request_id)
  WHERE external_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.insurance_eligibility_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  eligibility_check_id UUID NOT NULL REFERENCES public.insurance_eligibility_checks(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL,
  from_status VARCHAR(40),
  to_status VARCHAR(40) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insurance_eligibility_events_history
  ON public.insurance_eligibility_events(company_id, eligibility_check_id, created_at DESC);

ALTER TABLE public.insurance_eligibility_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS insurance_eligibility_events_tenant ON public.insurance_eligibility_events;
CREATE POLICY insurance_eligibility_events_tenant
  ON public.insurance_eligibility_events FOR SELECT TO authenticated, app_prontomedic
  USING (company_id = public.current_company_id());

REVOKE ALL ON public.insurance_eligibility_events FROM PUBLIC, anon;
GRANT SELECT ON public.insurance_eligibility_events TO authenticated, app_prontomedic;

-- Direct writes remain closed for authenticated users. The two SECURITY DEFINER
-- entry points below validate tenant, patient, appointment and unit ownership.
DROP POLICY IF EXISTS insurance_eligibility_tenant ON public.insurance_eligibility_checks;
DROP POLICY IF EXISTS insurance_eligibility_select_tenant ON public.insurance_eligibility_checks;
CREATE POLICY insurance_eligibility_select_tenant
  ON public.insurance_eligibility_checks FOR SELECT TO authenticated, app_prontomedic
  USING (company_id = public.current_company_id());
REVOKE INSERT, UPDATE, DELETE ON public.insurance_eligibility_checks FROM authenticated, app_prontomedic;
GRANT SELECT ON public.insurance_eligibility_checks TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.capture_insurance_eligibility_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.insurance_eligibility_events(
    company_id, eligibility_check_id, event_type, from_status, to_status,
    payload, actor_user_id
  ) VALUES (
    NEW.company_id,
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'status_changed' END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    jsonb_build_object(
      'request_channel', NEW.request_channel,
      'protocol_number', NEW.protocol_number,
      'result_code', NEW.result_code,
      'result_detail', NEW.result_detail,
      'valid_from', NEW.valid_from,
      'valid_until', NEW.valid_until,
      'proof_reference', NEW.proof_reference,
      'exception_reason', NEW.exception_reason,
      'block_reason', NEW.block_reason
    ),
    auth.uid()
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_insurance_eligibility_event() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_insurance_eligibility_event ON public.insurance_eligibility_checks;
CREATE TRIGGER trg_insurance_eligibility_event
  AFTER INSERT OR UPDATE OF status, protocol_number, result_code, result_detail,
    valid_from, valid_until, proof_reference, exception_reason, block_reason
  ON public.insurance_eligibility_checks
  FOR EACH ROW EXECUTE FUNCTION public.capture_insurance_eligibility_event();

CREATE OR REPLACE FUNCTION public.create_insurance_eligibility_check_secure(
  p_patient_id BIGINT,
  p_appointment_id BIGINT DEFAULT NULL,
  p_insurance_id INTEGER DEFAULT NULL,
  p_insurance_plan_id INTEGER DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL,
  p_card_number TEXT DEFAULT NULL,
  p_request_channel TEXT DEFAULT 'manual',
  p_protocol_number TEXT DEFAULT NULL,
  p_valid_from DATE DEFAULT NULL,
  p_valid_until DATE DEFAULT NULL,
  p_status TEXT DEFAULT 'pendente',
  p_result_code TEXT DEFAULT NULL,
  p_result_detail TEXT DEFAULT NULL,
  p_proof_reference TEXT DEFAULT NULL,
  p_proof_sha256 TEXT DEFAULT NULL,
  p_proof_content_type TEXT DEFAULT NULL,
  p_external_request_id TEXT DEFAULT NULL,
  p_exception_reason TEXT DEFAULT NULL,
  p_block_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id UUID := public.current_company_id();
  v_row public.insurance_eligibility_checks;
BEGIN
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Empresa do usuario nao identificada'; END IF;
  IF p_request_channel NOT IN ('manual','portal','api') THEN RAISE EXCEPTION 'Canal de consulta invalido'; END IF;
  IF p_status NOT IN ('elegivel','nao_elegivel','pendente','em_analise','portal_indisponivel','nao_obrigatoria','liberado_excecao','bloqueado','expirado','cancelado') THEN RAISE EXCEPTION 'Status de elegibilidade invalido'; END IF;
  IF p_status = 'bloqueado' AND NULLIF(trim(COALESCE(p_block_reason,'')), '') IS NULL THEN RAISE EXCEPTION 'Motivo do bloqueio e obrigatorio'; END IF;
  IF p_status = 'liberado_excecao' AND NULLIF(trim(COALESCE(p_exception_reason,'')), '') IS NULL THEN RAISE EXCEPTION 'Motivo da excecao e obrigatorio'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id=p_patient_id AND company_id=v_company_id) THEN RAISE EXCEPTION 'Paciente fora do tenant'; END IF;
  IF p_appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments WHERE id=p_appointment_id AND company_id=v_company_id AND patient_id=p_patient_id
  ) THEN RAISE EXCEPTION 'Agendamento fora do tenant ou do paciente'; END IF;
  IF p_unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.units WHERE id=p_unit_id AND company_id=v_company_id AND lg_ativo) THEN RAISE EXCEPTION 'Unidade nao autorizada'; END IF;

  INSERT INTO public.insurance_eligibility_checks(
    company_id, patient_id, appointment_id, insurance_id, insurance_plan_id, unit_id,
    card_number, request_channel, source, status, protocol_number, valid_from,
    valid_until, result_code, result_detail, proof_reference, proof_sha256,
    proof_content_type, proof_received_at, external_request_id, requested_at,
    completed_at, exception_reason, exception_granted_by, exception_granted_at,
    block_reason, blocked_by, blocked_at, checked_at, checked_by
  ) VALUES (
    v_company_id, p_patient_id, p_appointment_id, p_insurance_id, p_insurance_plan_id, p_unit_id,
    NULLIF(trim(COALESCE(p_card_number,'')), ''), p_request_channel, p_request_channel, p_status,
    NULLIF(trim(COALESCE(p_protocol_number,'')), ''), p_valid_from, p_valid_until,
    NULLIF(trim(COALESCE(p_result_code,'')), ''), NULLIF(trim(COALESCE(p_result_detail,'')), ''),
    NULLIF(trim(COALESCE(p_proof_reference,'')), ''), NULLIF(trim(COALESCE(p_proof_sha256,'')), ''),
    NULLIF(trim(COALESCE(p_proof_content_type,'')), ''), CASE WHEN p_proof_reference IS NULL THEN NULL ELSE NOW() END,
    NULLIF(trim(COALESCE(p_external_request_id,'')), ''), NOW(),
    CASE WHEN p_status NOT IN ('pendente','em_analise','portal_indisponivel') THEN NOW() ELSE NULL END,
    NULLIF(trim(COALESCE(p_exception_reason,'')), ''), CASE WHEN p_status='liberado_excecao' THEN auth.uid() ELSE NULL END,
    CASE WHEN p_status='liberado_excecao' THEN NOW() ELSE NULL END,
    NULLIF(trim(COALESCE(p_block_reason,'')), ''), CASE WHEN p_status='bloqueado' THEN auth.uid() ELSE NULL END,
    CASE WHEN p_status='bloqueado' THEN NOW() ELSE NULL END,
    CASE WHEN p_status NOT IN ('pendente','em_analise','portal_indisponivel') THEN NOW() ELSE NULL END,
    CASE WHEN p_status NOT IN ('pendente','em_analise','portal_indisponivel') THEN auth.uid() ELSE NULL END
  ) RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_insurance_eligibility_check_secure(
  p_eligibility_id UUID,
  p_status TEXT DEFAULT NULL,
  p_request_channel TEXT DEFAULT NULL,
  p_protocol_number TEXT DEFAULT NULL,
  p_valid_from DATE DEFAULT NULL,
  p_valid_until DATE DEFAULT NULL,
  p_result_code TEXT DEFAULT NULL,
  p_result_detail TEXT DEFAULT NULL,
  p_proof_reference TEXT DEFAULT NULL,
  p_proof_sha256 TEXT DEFAULT NULL,
  p_proof_content_type TEXT DEFAULT NULL,
  p_exception_reason TEXT DEFAULT NULL,
  p_block_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id UUID := public.current_company_id();
  v_old public.insurance_eligibility_checks;
  v_new public.insurance_eligibility_checks;
  v_status TEXT;
BEGIN
  SELECT * INTO v_old FROM public.insurance_eligibility_checks WHERE id=p_eligibility_id FOR UPDATE;
  IF NOT FOUND OR v_old.company_id <> v_company_id THEN RAISE EXCEPTION 'Elegibilidade fora do tenant'; END IF;
  v_status := COALESCE(p_status, v_old.status);
  IF v_status NOT IN ('elegivel','nao_elegivel','pendente','em_analise','portal_indisponivel','nao_obrigatoria','liberado_excecao','bloqueado','expirado','cancelado') THEN RAISE EXCEPTION 'Status de elegibilidade invalido'; END IF;
  IF COALESCE(p_request_channel, v_old.request_channel) NOT IN ('manual','portal','api') THEN RAISE EXCEPTION 'Canal de consulta invalido'; END IF;
  IF v_status = 'bloqueado' AND NULLIF(trim(COALESCE(p_block_reason, v_old.block_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Motivo do bloqueio e obrigatorio'; END IF;
  IF v_status = 'liberado_excecao' AND NULLIF(trim(COALESCE(p_exception_reason, v_old.exception_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Motivo da excecao e obrigatorio'; END IF;

  UPDATE public.insurance_eligibility_checks SET
    status=v_status,
    request_channel=COALESCE(p_request_channel,request_channel),
    source=COALESCE(p_request_channel,source),
    protocol_number=COALESCE(NULLIF(trim(COALESCE(p_protocol_number,'')),''),protocol_number),
    valid_from=COALESCE(p_valid_from,valid_from), valid_until=COALESCE(p_valid_until,valid_until),
    result_code=COALESCE(NULLIF(trim(COALESCE(p_result_code,'')),''),result_code),
    result_detail=COALESCE(NULLIF(trim(COALESCE(p_result_detail,'')),''),result_detail),
    proof_reference=COALESCE(NULLIF(trim(COALESCE(p_proof_reference,'')),''),proof_reference),
    proof_sha256=COALESCE(NULLIF(trim(COALESCE(p_proof_sha256,'')),''),proof_sha256),
    proof_content_type=COALESCE(NULLIF(trim(COALESCE(p_proof_content_type,'')),''),proof_content_type),
    proof_received_at=CASE WHEN p_proof_reference IS NOT NULL THEN NOW() ELSE proof_received_at END,
    exception_reason=CASE WHEN v_status='liberado_excecao' THEN COALESCE(NULLIF(trim(COALESCE(p_exception_reason,'')),''),exception_reason) ELSE exception_reason END,
    exception_granted_by=CASE WHEN v_status='liberado_excecao' THEN auth.uid() ELSE exception_granted_by END,
    exception_granted_at=CASE WHEN v_status='liberado_excecao' THEN NOW() ELSE exception_granted_at END,
    block_reason=CASE WHEN v_status='bloqueado' THEN COALESCE(NULLIF(trim(COALESCE(p_block_reason,'')),''),block_reason) ELSE block_reason END,
    blocked_by=CASE WHEN v_status='bloqueado' THEN auth.uid() ELSE blocked_by END,
    blocked_at=CASE WHEN v_status='bloqueado' THEN NOW() ELSE blocked_at END,
    checked_at=CASE WHEN v_status NOT IN ('pendente','em_analise','portal_indisponivel') THEN NOW() ELSE checked_at END,
    checked_by=CASE WHEN v_status NOT IN ('pendente','em_analise','portal_indisponivel') THEN auth.uid() ELSE checked_by END,
    completed_at=CASE WHEN v_status NOT IN ('pendente','em_analise','portal_indisponivel') THEN NOW() ELSE completed_at END,
    updated_at=NOW()
  WHERE id=p_eligibility_id RETURNING * INTO v_new;
  RETURN to_jsonb(v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.create_insurance_eligibility_check_secure(BIGINT,BIGINT,INTEGER,INTEGER,INTEGER,TEXT,TEXT,TEXT,DATE,DATE,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_insurance_eligibility_check_secure(UUID,TEXT,TEXT,TEXT,DATE,DATE,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_insurance_eligibility_check_secure(BIGINT,BIGINT,INTEGER,INTEGER,INTEGER,TEXT,TEXT,TEXT,DATE,DATE,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.update_insurance_eligibility_check_secure(UUID,TEXT,TEXT,TEXT,DATE,DATE,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated, app_prontomedic;

DO $$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.prontomedic_deployment_migrations WHERE filename='20260722140000_module14_insurance_eligibility.sql') THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260722140000_module14_insurance_eligibility.sql', NOW());
  END IF;
END
$$;

COMMIT;

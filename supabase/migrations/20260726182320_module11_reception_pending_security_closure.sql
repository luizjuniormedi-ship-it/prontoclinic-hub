-- Module 11: close legacy pending-item mutation RPCs and require a
-- functional role for insurance eligibility writes.
-- Additive only. DataSIGH and external provider integrations are not accessed.

BEGIN;

CREATE OR REPLACE FUNCTION public.m14_can_operate_eligibility(
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_actor RECORD;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL OR p_unit_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN private.reception_can_checkin(
    v_actor.user_id,
    v_actor.company_id,
    p_unit_id,
    v_actor.role_name
  );
END
$function$;

ALTER FUNCTION public.m14_can_operate_eligibility(INTEGER)
  OWNER TO prontomedic_reception_rpc_owner;

CREATE OR REPLACE FUNCTION public.m14_can_release_eligibility_exception(
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_actor RECORD;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL OR p_unit_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN private.reception_can_release_exception(
    v_actor.user_id,
    v_actor.company_id,
    p_unit_id,
    v_actor.role_name
  );
END
$function$;

ALTER FUNCTION public.m14_can_release_eligibility_exception(INTEGER)
  OWNER TO prontomedic_reception_rpc_owner;

UPDATE public.insurance_eligibility_checks eligibility
SET unit_id = appointment.unit_id
FROM public.appointments appointment
WHERE eligibility.appointment_id = appointment.id
  AND eligibility.company_id = appointment.company_id
  AND eligibility.unit_id IS NULL
  AND appointment.unit_id IS NOT NULL;

DO $pending_unit_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.insurance_eligibility_checks
    WHERE unit_id IS NULL
      AND status IN ('pendente', 'em_analise', 'portal_indisponivel')
  ) THEN
    RAISE EXCEPTION
      'Existem elegibilidades operacionais sem unidade; reconcilie antes de aplicar a migration';
  END IF;
END
$pending_unit_guard$;

DO $unit_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.insurance_eligibility_checks'::regclass
      AND conname = 'insurance_eligibility_unit_fkey'
  ) THEN
    ALTER TABLE public.insurance_eligibility_checks
      ADD CONSTRAINT insurance_eligibility_unit_fkey
      FOREIGN KEY (unit_id) REFERENCES public.units(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END
$unit_fk$;

DROP POLICY IF EXISTS insurance_eligibility_select_tenant
  ON public.insurance_eligibility_checks;
CREATE POLICY insurance_eligibility_select_tenant
  ON public.insurance_eligibility_checks
  FOR SELECT
  TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS insurance_eligibility_reception_owner
  ON public.insurance_eligibility_checks;
CREATE POLICY insurance_eligibility_reception_owner
  ON public.insurance_eligibility_checks
  FOR ALL
  TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
  );

ALTER TABLE public.insurance_eligibility_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS insurance_eligibility_events_tenant
  ON public.insurance_eligibility_events;
DROP POLICY IF EXISTS insurance_eligibility_events_unit_select
  ON public.insurance_eligibility_events;
CREATE POLICY insurance_eligibility_events_unit_select
  ON public.insurance_eligibility_events
  FOR SELECT
  TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.insurance_eligibility_checks eligibility
      WHERE eligibility.id = eligibility_check_id
        AND eligibility.company_id = insurance_eligibility_events.company_id
        AND eligibility.unit_id IS NOT NULL
        AND public.org_can_access_unit(
          eligibility.company_id,
          eligibility.unit_id
        )
    )
  );

DROP POLICY IF EXISTS insurance_eligibility_events_reception_owner_insert
  ON public.insurance_eligibility_events;
CREATE POLICY insurance_eligibility_events_reception_owner_insert
  ON public.insurance_eligibility_events
  FOR INSERT
  TO prontomedic_reception_rpc_owner
  WITH CHECK (
    company_id = NULLIF(
      current_setting('request.jwt.claim.company_id', true),
      ''
    )::UUID
  );

REVOKE ALL ON TABLE public.insurance_eligibility_checks
  FROM prontomedic_reception_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON TABLE public.insurance_eligibility_checks
  TO prontomedic_reception_rpc_owner;
REVOKE ALL ON TABLE public.insurance_eligibility_events
  FROM prontomedic_reception_rpc_owner;
GRANT INSERT ON TABLE public.insurance_eligibility_events
  TO prontomedic_reception_rpc_owner;

ALTER FUNCTION public.capture_insurance_eligibility_event()
  OWNER TO prontomedic_reception_rpc_owner;

CREATE OR REPLACE VIEW public.reception_eligibility_checks
WITH (security_invoker = true) AS
SELECT
  id,
  company_id,
  patient_id,
  appointment_id,
  insurance_id,
  insurance_plan_id,
  card_number,
  status,
  protocol_number,
  checked_at,
  checked_by,
  result_detail,
  source,
  created_at,
  unit_id,
  request_channel,
  valid_from,
  valid_until,
  result_code,
  proof_reference,
  proof_sha256,
  proof_content_type,
  proof_received_at,
  external_request_id,
  requested_at,
  completed_at,
  exception_reason,
  exception_granted_by,
  exception_granted_at,
  block_reason,
  blocked_by,
  blocked_at,
  updated_at
FROM public.insurance_eligibility_checks;

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
AS $function$
DECLARE
  v_company_id UUID := public.current_company_id();
  v_effective_unit_id INTEGER := p_unit_id;
  v_row public.insurance_eligibility_checks;
BEGIN
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Empresa do usuario nao identificada'; END IF;
  IF p_request_channel NOT IN ('manual','portal','api') THEN RAISE EXCEPTION 'Canal de consulta invalido'; END IF;
  IF p_status NOT IN ('elegivel','nao_elegivel','pendente','em_analise','portal_indisponivel','nao_obrigatoria','liberado_excecao','bloqueado','expirado','cancelado') THEN RAISE EXCEPTION 'Status de elegibilidade invalido'; END IF;
  IF p_status = 'bloqueado' AND NULLIF(trim(COALESCE(p_block_reason,'')), '') IS NULL THEN RAISE EXCEPTION 'Motivo do bloqueio e obrigatorio'; END IF;
  IF p_status = 'liberado_excecao' AND NULLIF(trim(COALESCE(p_exception_reason,'')), '') IS NULL THEN RAISE EXCEPTION 'Motivo da excecao e obrigatorio'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id=p_patient_id AND company_id=v_company_id) THEN RAISE EXCEPTION 'Paciente fora do tenant'; END IF;
  IF p_appointment_id IS NOT NULL THEN
    SELECT appointment.unit_id
    INTO v_effective_unit_id
    FROM public.appointments appointment
    WHERE appointment.id=p_appointment_id
      AND appointment.company_id=v_company_id
      AND appointment.patient_id=p_patient_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento fora do tenant ou do paciente'; END IF;
    IF p_unit_id IS NOT NULL AND p_unit_id IS DISTINCT FROM v_effective_unit_id THEN
      RAISE EXCEPTION 'Unidade divergente do agendamento';
    END IF;
  END IF;
  IF v_effective_unit_id IS NULL
     OR NOT public.org_can_access_unit(v_company_id, v_effective_unit_id) THEN
    RAISE EXCEPTION 'Unidade nao autorizada';
  END IF;
  IF NOT public.m14_can_operate_eligibility(v_effective_unit_id) THEN
    RAISE EXCEPTION 'Usuario sem permissao para registrar elegibilidade'
      USING ERRCODE = '42501';
  END IF;
  IF p_status = 'liberado_excecao'
     AND NOT public.m14_can_release_eligibility_exception(v_effective_unit_id) THEN
    RAISE EXCEPTION 'Usuario sem permissao para liberar elegibilidade por excecao'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.insurance_eligibility_checks(
    company_id, patient_id, appointment_id, insurance_id, insurance_plan_id, unit_id,
    card_number, request_channel, source, status, protocol_number, valid_from,
    valid_until, result_code, result_detail, proof_reference, proof_sha256,
    proof_content_type, proof_received_at, external_request_id, requested_at,
    completed_at, exception_reason, exception_granted_by, exception_granted_at,
    block_reason, blocked_by, blocked_at, checked_at, checked_by
  ) VALUES (
    v_company_id, p_patient_id, p_appointment_id, p_insurance_id, p_insurance_plan_id, v_effective_unit_id,
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
$function$;

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
AS $function$
DECLARE
  v_company_id UUID := public.current_company_id();
  v_old public.insurance_eligibility_checks;
  v_new public.insurance_eligibility_checks;
  v_status TEXT;
BEGIN
  SELECT * INTO v_old
  FROM public.insurance_eligibility_checks eligibility
  WHERE eligibility.id=p_eligibility_id
    AND eligibility.company_id=v_company_id
    AND eligibility.unit_id IS NOT NULL
    AND public.org_can_access_unit(
      eligibility.company_id,
      eligibility.unit_id
    )
  FOR UPDATE;
  IF v_company_id IS NULL
     OR NOT FOUND
     OR v_old.company_id <> v_company_id THEN
    RAISE EXCEPTION 'Elegibilidade fora do tenant ou da unidade autorizada';
  END IF;
  IF NOT public.m14_can_operate_eligibility(v_old.unit_id) THEN
    RAISE EXCEPTION 'Usuario sem permissao para atualizar elegibilidade'
      USING ERRCODE = '42501';
  END IF;
  v_status := COALESCE(p_status, v_old.status);
  IF v_status NOT IN ('elegivel','nao_elegivel','pendente','em_analise','portal_indisponivel','nao_obrigatoria','liberado_excecao','bloqueado','expirado','cancelado') THEN RAISE EXCEPTION 'Status de elegibilidade invalido'; END IF;
  IF COALESCE(p_request_channel, v_old.request_channel) NOT IN ('manual','portal','api') THEN RAISE EXCEPTION 'Canal de consulta invalido'; END IF;
  IF v_status = 'bloqueado' AND NULLIF(trim(COALESCE(p_block_reason, v_old.block_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Motivo do bloqueio e obrigatorio'; END IF;
  IF v_status = 'liberado_excecao' AND NULLIF(trim(COALESCE(p_exception_reason, v_old.exception_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Motivo da excecao e obrigatorio'; END IF;
  IF v_status = 'liberado_excecao'
     AND NOT public.m14_can_release_eligibility_exception(v_old.unit_id) THEN
    RAISE EXCEPTION 'Usuario sem permissao para liberar elegibilidade por excecao'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.insurance_eligibility_checks SET
    status=v_status,
    request_channel=COALESCE(p_request_channel,request_channel),
    source=COALESCE(p_request_channel,source),
    protocol_number=COALESCE(NULLIF(trim(COALESCE(p_protocol_number,'')),''),protocol_number),
    valid_from=COALESCE(p_valid_from,valid_from),
    valid_until=COALESCE(p_valid_until,valid_until),
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
  WHERE id=p_eligibility_id
  RETURNING * INTO v_new;
  RETURN to_jsonb(v_new);
END;
$function$;

ALTER FUNCTION public.create_insurance_eligibility_check_secure(
  BIGINT, BIGINT, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE, DATE,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.update_insurance_eligibility_check_secure(
  UUID, TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;

CREATE OR REPLACE FUNCTION public.get_reception_exception_capability(
  p_appointment_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_actor RECORD;
  v_unit_id INTEGER;
  v_allowed BOOLEAN;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional';
  END IF;

  SELECT appointment.unit_id
  INTO v_unit_id
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_actor.company_id
    AND appointment.unit_id IS NOT NULL
    AND public.org_can_access_unit(appointment.company_id, appointment.unit_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento fora do escopo da recepcao';
  END IF;

  v_allowed := private.reception_can_release_exception(
    v_actor.user_id,
    v_actor.company_id,
    v_unit_id,
    v_actor.role_name
  );

  RETURN jsonb_build_object(
    'appointment_id', p_appointment_id,
    'unit_id', v_unit_id,
    'allowed', COALESCE(v_allowed, FALSE)
  );
END;
$function$;

ALTER FUNCTION public.get_reception_exception_capability(BIGINT)
  OWNER TO prontomedic_reception_rpc_owner;

CREATE OR REPLACE FUNCTION public.transition_reception_queue_ticket_secure(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.reception_queue_tickets ticket
    WHERE ticket.id = p_ticket_id
      AND ticket.ticket_date = CURRENT_DATE
  ) THEN
    RAISE EXCEPTION 'Senha de recepcao nao pertence ao dia operacional atual';
  END IF;

  RETURN private.transition_reception_queue_ticket(
    p_ticket_id,
    p_to_status,
    p_reason,
    NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.transition_reception_queue_ticket_secure(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT,
  p_destination_unit_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.reception_queue_tickets ticket
    WHERE ticket.id = p_ticket_id
      AND ticket.ticket_date = CURRENT_DATE
  ) THEN
    RAISE EXCEPTION 'Senha de recepcao nao pertence ao dia operacional atual';
  END IF;

  RETURN private.transition_reception_queue_ticket(
    p_ticket_id,
    p_to_status,
    p_reason,
    p_destination_unit_id
  );
END;
$function$;

ALTER FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT, INTEGER
) OWNER TO prontomedic_reception_rpc_owner;

DROP FUNCTION IF EXISTS public.m14_can_operate_eligibility();
REVOKE ALL ON FUNCTION public.m14_can_operate_eligibility(INTEGER)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m14_can_operate_eligibility(INTEGER)
  TO prontomedic_reception_rpc_owner;
REVOKE ALL ON FUNCTION public.m14_can_release_eligibility_exception(INTEGER)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m14_can_release_eligibility_exception(INTEGER)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.get_my_company_id()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.org_is_manager()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.current_company_id()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.current_user_id()
  TO prontomedic_reception_rpc_owner;
GRANT SELECT ON TABLE public.units, public.user_profiles, public.unit_access
  TO prontomedic_reception_rpc_owner;

DROP POLICY IF EXISTS m11_reception_owner_units_read ON public.units;
CREATE POLICY m11_reception_owner_units_read
  ON public.units
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = private.current_company_id()
    AND lg_ativo = TRUE
  );

DROP POLICY IF EXISTS m11_reception_owner_profiles_read ON public.user_profiles;
CREATE POLICY m11_reception_owner_profiles_read
  ON public.user_profiles
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = private.current_company_id()
    AND (
      id = private.current_user_id()
      OR user_id = private.current_user_id()
    )
    AND lg_ativo = TRUE
  );

DROP POLICY IF EXISTS m11_reception_owner_unit_access_read ON public.unit_access;
CREATE POLICY m11_reception_owner_unit_access_read
  ON public.unit_access
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = private.current_company_id()
    AND user_id = private.current_user_id()
  );

REVOKE ALL ON FUNCTION public.get_reception_exception_capability(BIGINT)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.update_reception_authorization_secure(
  UUID, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.update_reception_eligibility_secure(
  UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;

REVOKE ALL ON FUNCTION public.create_insurance_eligibility_check_secure(
  BIGINT, BIGINT, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE, DATE,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_insurance_eligibility_check_secure(
  UUID, TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_insurance_authorization_secure(
  UUID, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, INTEGER, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_insurance_eligibility_check_secure(
  BIGINT, BIGINT, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE, DATE,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.update_insurance_eligibility_check_secure(
  UUID, TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.transition_insurance_authorization_secure(
  UUID, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, INTEGER, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.get_reception_exception_capability(BIGINT)
  TO authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT, INTEGER
) TO authenticated, app_prontomedic;

DO $ledger$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename)
    VALUES ('20260726182320_module11_reception_pending_security_closure.sql')
    ON CONFLICT (filename) DO NOTHING;
  END IF;
END
$ledger$;

COMMIT;

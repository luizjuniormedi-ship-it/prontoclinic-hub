-- The advisory lock already serializes check-in creation for an appointment.
-- Avoid requiring UPDATE on appointments only to read the scoped source row.

CREATE OR REPLACE FUNCTION private.m11_start_workflow(
  p_appointment_id BIGINT,
  p_idempotency_key TEXT,
  p_request_payload JSONB
)
RETURNS public.reception_checkin_workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_company UUID;
  v_unit INTEGER;
  v_actor UUID;
  v_appointment public.appointments;
  v_workflow public.reception_checkin_workflows;
  v_hash TEXT;
  v_requires_tiss BOOLEAN;
  v_requires_financial BOOLEAN;
BEGIN
  IF p_idempotency_key IS NULL
     OR length(p_idempotency_key) NOT BETWEEN 8 AND 120
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'Chave de idempotencia invalida';
  END IF;
  IF p_request_payload IS NULL OR jsonb_typeof(p_request_payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload do workflow deve ser um objeto JSON';
  END IF;
  IF octet_length(p_request_payload::TEXT) > 8192 THEN
    RAISE EXCEPTION 'Payload do workflow excede o limite';
  END IF;

  v_company := public.current_company_id();
  v_unit := public.active_unit_id();
  IF v_company IS NULL OR v_unit IS NULL THEN
    RAISE EXCEPTION 'Contexto ativo de empresa e unidade ausente';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('reception_checkin:' || p_appointment_id::TEXT, 0)
  );
  PERFORM set_config(
    'app.reception.appointment_id',
    p_appointment_id::TEXT,
    TRUE
  );
  PERFORM set_config('app.reception.company_id', v_company::TEXT, TRUE);
  PERFORM set_config('app.reception.unit_id', v_unit::TEXT, TRUE);

  SELECT * INTO v_appointment
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company
    AND appointment.unit_id = v_unit;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado no tenant'; END IF;
  IF v_appointment.unit_id IS NULL OR v_appointment.patient_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento sem unidade ou paciente nao pode iniciar check-in';
  END IF;

  v_actor := private.m11_assert_actor(
    v_company,
    v_appointment.unit_id,
    ARRAY['admin','gestor','recepcao','faturista','financeiro']::TEXT[]
  );
  v_hash := private.m11_request_hash(p_request_payload);
  v_requires_tiss := COALESCE((p_request_payload->>'requires_tiss')::BOOLEAN, FALSE);
  v_requires_financial := COALESCE((p_request_payload->>'requires_financial')::BOOLEAN, FALSE);

  SELECT * INTO v_workflow
  FROM public.reception_checkin_workflows workflow
  WHERE workflow.company_id = v_company
    AND workflow.operation = 'reception_checkin'
    AND workflow.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO v_workflow
    FROM public.reception_checkin_workflows workflow
    WHERE workflow.company_id = v_company
      AND workflow.operation = 'reception_checkin'
      AND workflow.appointment_id = p_appointment_id
    FOR UPDATE;
  END IF;

  IF FOUND THEN
    IF v_workflow.appointment_id <> p_appointment_id
       OR v_workflow.request_hash <> v_hash
       OR v_workflow.request_payload IS DISTINCT FROM p_request_payload THEN
      RAISE EXCEPTION 'Agendamento possui workflow com payload diferente';
    END IF;
    UPDATE public.reception_checkin_workflows
    SET attempt_count = attempt_count + 1,
        version = version + 1,
        status = CASE WHEN status IN ('blocked','failed') THEN 'in_progress' ELSE status END,
        error_code = NULL,
        error_message = NULL,
        updated_by = v_actor,
        updated_at = NOW(),
        last_attempt_at = NOW()
    WHERE id = v_workflow.id
    RETURNING * INTO v_workflow;
    RETURN v_workflow;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reception_checkin_workflows workflow
    WHERE workflow.company_id = v_company
      AND workflow.appointment_id = p_appointment_id
  ) THEN
    RAISE EXCEPTION 'Agendamento ja possui workflow incompativel';
  END IF;

  INSERT INTO public.reception_checkin_workflows(
    company_id, unit_id, appointment_id, patient_id, operation,
    idempotency_key, request_hash, request_payload, requires_tiss,
    requires_financial, created_by, updated_by
  ) VALUES (
    v_company, v_appointment.unit_id, v_appointment.id, v_appointment.patient_id,
    'reception_checkin', p_idempotency_key, v_hash, p_request_payload,
    v_requires_tiss, v_requires_financial, v_actor, v_actor
  )
  RETURNING * INTO v_workflow;

  RETURN v_workflow;
END;
$function$;

ALTER FUNCTION private.m11_start_workflow(BIGINT, TEXT, JSONB)
  OWNER TO prontomedic_reception_rpc_owner;
REVOKE ALL ON FUNCTION private.m11_start_workflow(BIGINT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.m11_start_workflow(BIGINT, TEXT, JSONB)
  TO prontomedic_reception_rpc_owner;


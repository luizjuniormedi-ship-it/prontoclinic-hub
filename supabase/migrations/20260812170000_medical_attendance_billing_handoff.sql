BEGIN;

CREATE OR REPLACE FUNCTION public.m17_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT public.current_company_id();
$$;

CREATE OR REPLACE FUNCTION public.m18_finalize_appointment_with_billing_secure(
  p_appointment_id BIGINT,
  p_payload JSONB,
  p_disposition TEXT DEFAULT 'FINALIZED'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company UUID := public.current_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_appointment public.appointments;
  v_encounter public.encounters;
  v_billing JSONB;
BEGIN
  IF p_appointment_id IS NULL OR v_company IS NULL OR v_unit IS NULL OR NOT public.m18_can_edit_attendance() THEN
    RAISE EXCEPTION 'Contexto clínico inválido para finalizar atendimento';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_company::TEXT || ':' || p_appointment_id::TEXT, 0));
  SELECT * INTO v_appointment
    FROM public.appointments
   WHERE id = p_appointment_id
     AND company_id = v_company
     AND unit_id = v_unit
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado no contexto ativo'; END IF;

  v_encounter := public.m18_open_attendance_secure(
    p_appointment_id,
    v_appointment.unit_id,
    v_appointment.professional_id
  );
  v_encounter := public.m18_complete_attendance_secure(v_encounter.id, p_payload, p_disposition);

  PERFORM public.update_appointment_status_secure(
    p_appointment_id,
    'completed',
    'Atendimento finalizado pelo contrato clínico M18'
  );
  PERFORM set_config('app.reception.appointment_id', p_appointment_id::TEXT, TRUE);
  PERFORM set_config('app.reception.company_id', v_company::TEXT, TRUE);
  PERFORM set_config('app.reception.unit_id', v_unit::TEXT, TRUE);
  v_billing := public.sync_completed_appointment_billing_secure(
    p_appointment_id,
    'Faturamento consolidado pelo encontro ' || v_encounter.id::TEXT
  );

  RETURN jsonb_build_object('encounter', to_jsonb(v_encounter), 'billing', v_billing);
END;
$$;

REVOKE ALL ON FUNCTION public.m18_finalize_appointment_with_billing_secure(BIGINT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m18_finalize_appointment_with_billing_secure(BIGINT, JSONB, TEXT) TO authenticated, app_prontomedic;

COMMIT;

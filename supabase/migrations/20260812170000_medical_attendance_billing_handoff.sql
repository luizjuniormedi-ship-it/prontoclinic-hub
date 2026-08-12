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
  v_encounter public.encounters;
  v_billing JSONB;
BEGIN
  IF p_appointment_id IS NULL OR v_company IS NULL OR NOT public.m18_can_edit_attendance() THEN
    RAISE EXCEPTION 'Contexto clínico inválido para finalizar atendimento';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_company::TEXT || ':' || p_appointment_id::TEXT, 0));
  v_encounter := public.m18_open_attendance_secure(
    p_appointment_id,
    NULL,
    NULL
  );
  v_encounter := public.m18_complete_attendance_secure(v_encounter.id, p_payload, p_disposition);

  PERFORM public.update_appointment_status_secure(
    p_appointment_id,
    'completed',
    'Atendimento finalizado pelo contrato clínico M18'
  );
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

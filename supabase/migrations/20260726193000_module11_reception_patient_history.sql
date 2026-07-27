-- Module 11: read-only patient appointment history for Reception.
-- This deliberately avoids the broader Module 9 scheduling mutation surface.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.get_reception_patient_appointments_secure(
  p_patient_id BIGINT,
  p_limit INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_company_id UUID := public.current_company_id();
  v_actor_id UUID := public.audit_current_user_id();
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_result JSONB;
BEGIN
  IF v_company_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Reception patient history requires authenticated context';
  END IF;

  IF p_patient_id IS NULL OR p_patient_id <= 0 THEN
    RAISE EXCEPTION 'Reception patient history requires a valid patient';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', appointment.id::TEXT,
        'appointmentDate', appointment.appointment_date::TEXT,
        'startTime', appointment.start_time::TEXT,
        'endTime', appointment.end_time::TEXT,
        'status', appointment.status,
        'unitId', appointment.unit_id,
        'professionalId', appointment.professional_id,
        'appointmentTypeId', appointment.appointment_type_id
      )
      ORDER BY appointment.appointment_date DESC,
               appointment.start_time DESC,
               appointment.id DESC
    ),
    '[]'::JSONB
  )
  INTO v_result
  FROM (
    SELECT scoped.*
    FROM public.appointments scoped
    WHERE scoped.company_id = v_company_id
      AND scoped.patient_id = p_patient_id
      AND (
        scoped.unit_id IS NULL
        OR private.reception_actor_can_access_unit(
          scoped.company_id,
          scoped.unit_id
        )
      )
    ORDER BY scoped.appointment_date DESC,
             scoped.start_time DESC,
             scoped.id DESC
    LIMIT v_limit
  ) appointment;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.get_reception_patient_appointments_secure(
  BIGINT, INTEGER
) OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.get_reception_patient_appointments_secure(
  BIGINT, INTEGER
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_reception_patient_appointments_secure(
  BIGINT, INTEGER
) TO authenticated, app_prontomedic;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260726193000_module11_reception_patient_history.sql')
ON CONFLICT (filename) DO NOTHING;

COMMENT ON FUNCTION public.get_reception_patient_appointments_secure(
  BIGINT, INTEGER
) IS 'Read-only, tenant/unit-scoped appointment history for Reception.';

COMMIT;

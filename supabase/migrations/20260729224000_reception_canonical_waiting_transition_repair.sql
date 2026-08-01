CREATE OR REPLACE FUNCTION private.reception_mark_appointment_waiting(
  p_appointment_id BIGINT,
  p_reason TEXT
)
RETURNS public.appointments
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
SET row_security = off
AS $$
  SELECT private.transition_appointment_status_core(
    p_appointment_id,
    'waiting',
    p_reason,
    TRUE
  );
$$;

ALTER FUNCTION private.reception_mark_appointment_waiting(BIGINT, TEXT)
  OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION private.reception_mark_appointment_waiting(BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT EXECUTE ON FUNCTION private.reception_mark_appointment_waiting(BIGINT, TEXT)
  TO prontomedic_reception_rpc_owner;

GRANT EXECUTE ON FUNCTION private.transition_appointment_status_core(
  BIGINT,
  TEXT,
  TEXT,
  BOOLEAN
) TO prontomedic_reception_rpc_owner;

DO $$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'private.reception_mark_appointment_waiting(bigint,text)'::regprocedure
  )
  INTO v_definition;

  IF v_definition NOT LIKE '%private.transition_appointment_status_core(%'
     OR v_definition NOT LIKE '%TRUE%' THEN
    RAISE EXCEPTION
      'reception_mark_appointment_waiting must use the canonical transactional transition';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'private.reception_mark_appointment_waiting(bigint,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'authenticated must not execute reception_mark_appointment_waiting directly';
  END IF;

  IF NOT has_function_privilege(
    'prontomedic_reception_rpc_owner',
    'private.transition_appointment_status_core(bigint,text,text,boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'reception RPC owner must execute the canonical appointment transition';
  END IF;
END;
$$;

COMMENT ON FUNCTION private.reception_mark_appointment_waiting(BIGINT, TEXT) IS
  'Transição interna do check-in para waiting pelo núcleo canônico da Agenda; exige os artefatos transacionais completos da Recepção.';

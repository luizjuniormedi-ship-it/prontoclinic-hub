BEGIN;

CREATE OR REPLACE FUNCTION private.enforce_appointment_initial_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'scheduled' THEN
    RAISE EXCEPTION
      'Novo agendamento deve iniciar como scheduled; use o contrato de transicao para estados operacionais.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_appointment_initial_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.enforce_appointment_initial_status() FROM anon;
REVOKE ALL ON FUNCTION private.enforce_appointment_initial_status() FROM authenticated;

DROP TRIGGER IF EXISTS trg_appointments_initial_status_guard ON public.appointments;
CREATE TRIGGER trg_appointments_initial_status_guard
BEFORE INSERT ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION private.enforce_appointment_initial_status();

DO $$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_triggerdef(trigger.oid)
    INTO v_definition
  FROM pg_trigger trigger
  WHERE trigger.tgrelid = 'public.appointments'::regclass
    AND trigger.tgname = 'trg_appointments_initial_status_guard'
    AND NOT trigger.tgisinternal;

  IF v_definition IS NULL
     OR v_definition NOT ILIKE '%BEFORE INSERT%'
     OR v_definition NOT ILIKE '%enforce_appointment_initial_status%' THEN
    RAISE EXCEPTION 'Guarda de estado inicial de appointments nao foi instalada corretamente';
  END IF;
END;
$$;

COMMIT;

-- Make the waiting transition fail closed for every actor and write path.

CREATE OR REPLACE FUNCTION public.update_appointment_status_secure(
  p_appointment_id BIGINT,
  p_new_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
SET row_security = off
AS $function$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_old public.appointments%ROWTYPE;
  v_row public.appointments%ROWTYPE;
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_waiting_authorized BOOLEAN :=
    p_new_status = 'waiting'
    AND private.reception_waiting_transition_authorized(p_appointment_id);
BEGIN
  IF p_new_status = 'waiting' AND NOT v_waiting_authorized THEN
    RAISE EXCEPTION
      'Entrada em espera exige check-in transacional completo'
      USING ERRCODE = '42501';
  END IF;

  IF v_company_id IS NULL
     OR v_unit_id IS NULL
     OR (
       p_new_status <> 'waiting'
       AND NOT public.can_access('agenda', 'edit')
     ) THEN
    RAISE EXCEPTION
      'Contexto AAL2, sessão, unidade ou permissão operacional inválidos'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_old
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company_id
    AND appointment.unit_id = v_unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Agendamento não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_transition_appointment_status(
    v_old.status,
    p_new_status
  ) THEN
    RAISE EXCEPTION
      'Transição inválida: % para %',
      v_old.status,
      p_new_status;
  END IF;

  IF p_new_status IN ('cancelled', 'no_show')
     AND v_reason IS NULL THEN
    RAISE EXCEPTION
      'Motivo é obrigatório para cancelar ou registrar falta';
  END IF;

  UPDATE public.appointments appointment
  SET status = p_new_status,
      notes = COALESCE(v_reason, appointment.notes),
      updated_at = now()
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company_id
    AND appointment.unit_id = v_unit_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Agendamento não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.scheduling_status_history (
    company_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    actor_user_id
  )
  VALUES (
    v_company_id,
    v_row.id,
    v_old.status,
    v_row.status,
    v_reason,
    auth.uid()
  );

  IF p_new_status = 'cancelled' THEN
    INSERT INTO public.scheduling_cancellations (
      company_id,
      appointment_id,
      reason,
      cancelled_by
    )
    VALUES (
      v_company_id,
      v_row.id,
      v_reason,
      auth.uid()
    );
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_clinical_unit_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
SET row_security = off
AS $function$
DECLARE
  v_module TEXT := TG_TABLE_NAME;
  v_alt_module TEXT := CASE TG_TABLE_NAME
    WHEN 'patients' THEN 'pacientes'
    WHEN 'appointments' THEN 'agenda'
    WHEN 'medical_records' THEN 'prontuario'
  END;
  v_action TEXT := CASE TG_OP
    WHEN 'INSERT' THEN 'create'
    WHEN 'UPDATE' THEN 'edit'
  END;
  v_waiting_transition BOOLEAN := FALSE;
  v_waiting_authorized BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    NEW.company_id := COALESCE(
      NEW.company_id,
      public.active_company_id()
    );
    NEW.unit_id := COALESCE(
      NEW.unit_id,
      public.active_unit_id()
    );
  END IF;

  IF NEW.company_id IS NULL
     OR NEW.unit_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.units unit_record
       WHERE unit_record.id = NEW.unit_id
         AND unit_record.company_id = NEW.company_id
         AND unit_record.lg_ativo IS TRUE
     ) THEN
    RAISE EXCEPTION
      'Empresa e unidade clinica devem ser validas e consistentes'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'appointments' AND TG_OP = 'UPDATE' THEN
    v_waiting_transition :=
      NEW.status = 'waiting'
      AND OLD.status IS DISTINCT FROM NEW.status;
    v_waiting_authorized :=
      v_waiting_transition
      AND (
        to_jsonb(NEW) - ARRAY['status', 'notes', 'updated_at']
      ) = (
        to_jsonb(OLD) - ARRAY['status', 'notes', 'updated_at']
      )
      AND private.reception_waiting_transition_authorized(NEW.id);
  END IF;

  IF auth.uid() IS NOT NULL AND (
    NEW.company_id IS DISTINCT FROM public.active_company_id()
    OR NEW.unit_id IS DISTINCT FROM public.active_unit_id()
    OR (
      v_waiting_transition
      AND NOT v_waiting_authorized
    )
    OR (
      NOT v_waiting_transition
      AND NOT (
        public.can_access(v_module, v_action)
        OR public.can_access(v_alt_module, v_action)
      )
    )
  ) THEN
    RAISE EXCEPTION
      'Escrita clinica fora do contexto ativo ou sem permissao'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260728191500_reception_waiting_transition_fail_closed.sql')
ON CONFLICT (filename) DO NOTHING;

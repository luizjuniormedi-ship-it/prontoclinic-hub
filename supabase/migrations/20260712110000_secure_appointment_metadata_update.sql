-- Secure appointment metadata updates.
-- Status and time changes remain on their dedicated RPCs.

CREATE OR REPLACE FUNCTION public.update_appointment_secure(
  p_appointment_id BIGINT,
  p_patch JSONB
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_old public.appointments;
  v_row public.appointments;
  v_key TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_scheduling_permission();

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION 'Nenhum campo editavel informado';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN (
      'patient_id', 'professional_id', 'specialty_id', 'appointment_type_id',
      'unit_id', 'service_id', 'notes', 'is_return', 'is_walkin'
    ) THEN
      RAISE EXCEPTION 'Campo de agendamento nao editavel por este RPC: %', v_key;
    END IF;
  END LOOP;

  SELECT * INTO v_old
    FROM public.appointments
   WHERE id = p_appointment_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado';
  END IF;

  IF v_actor.company_id IS NOT NULL AND v_old.company_id IS DISTINCT FROM v_actor.company_id THEN
    RAISE EXCEPTION 'Agendamento fora da empresa do usuario';
  END IF;

  UPDATE public.appointments
     SET patient_id = CASE WHEN p_patch ? 'patient_id' THEN NULLIF(p_patch->>'patient_id', '')::BIGINT ELSE patient_id END,
         professional_id = CASE WHEN p_patch ? 'professional_id' THEN NULLIF(p_patch->>'professional_id', '')::BIGINT ELSE professional_id END,
         specialty_id = CASE WHEN p_patch ? 'specialty_id' THEN NULLIF(p_patch->>'specialty_id', '')::INTEGER ELSE specialty_id END,
         appointment_type_id = CASE WHEN p_patch ? 'appointment_type_id' THEN NULLIF(p_patch->>'appointment_type_id', '')::BIGINT ELSE appointment_type_id END,
         unit_id = CASE WHEN p_patch ? 'unit_id' THEN NULLIF(p_patch->>'unit_id', '')::INTEGER ELSE unit_id END,
         service_id = CASE WHEN p_patch ? 'service_id' THEN NULLIF(p_patch->>'service_id', '')::BIGINT ELSE service_id END,
         notes = CASE WHEN p_patch ? 'notes' THEN NULLIF(p_patch->>'notes', '') ELSE notes END,
         is_return = CASE WHEN p_patch ? 'is_return' THEN (p_patch->>'is_return')::BOOLEAN ELSE is_return END,
         is_walkin = CASE WHEN p_patch ? 'is_walkin' THEN (p_patch->>'is_walkin')::BOOLEAN ELSE is_walkin END,
         updated_at = NOW()
   WHERE id = p_appointment_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_appointment_secure(BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_appointment_secure(BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_appointment_secure(BIGINT, JSONB) TO service_role;

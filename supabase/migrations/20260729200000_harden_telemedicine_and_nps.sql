-- Onda 0: close tenant/RBAC gaps and keep owner-executed NPS RPCs usable.

ALTER TABLE public.nps_convites NO FORCE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS telemedicina_salas_appointment_unique
  ON public.telemedicina_salas(cd_appointment);

CREATE OR REPLACE FUNCTION public.criar_sala_telemedicina(p_appointment_id BIGINT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, extensions
SET row_security = off
AS $function$
DECLARE
  v_sala_id UUID;
  v_appointment public.appointments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access('telemedicina', 'create') THEN
    RAISE EXCEPTION 'telemedicine room creation not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT appointment.*
    INTO v_appointment
    FROM public.appointments AS appointment
   WHERE appointment.id = p_appointment_id
     AND appointment.company_id = public.active_company_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'appointment unavailable' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.telemedicina_salas (
    company_id,
    cd_appointment,
    cd_paciente,
    cd_medico,
    ds_token_acesso,
    ds_sala_daily
  )
  VALUES (
    v_appointment.company_id,
    v_appointment.id,
    COALESCE(v_appointment.patient_id, v_appointment.cd_paciente),
    COALESCE(v_appointment.professional_id, v_appointment.cd_medico),
    encode(extensions.gen_random_bytes(32), 'hex'),
    'pm-' || v_appointment.id::TEXT
  )
  ON CONFLICT (cd_appointment) DO UPDATE
    SET cd_appointment = EXCLUDED.cd_appointment
  RETURNING id INTO v_sala_id;

  RETURN v_sala_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.criar_sala_telemedicina(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_sala_telemedicina(BIGINT) TO authenticated;

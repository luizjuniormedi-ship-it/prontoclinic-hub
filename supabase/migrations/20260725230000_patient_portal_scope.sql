-- Portal do paciente: leitura exclusivamente propria e transicoes self-service.
-- Esta migration nao importa nem altera qualquer origem DataSIGH.

CREATE INDEX IF NOT EXISTS patients_user_id_idx
  ON public.patients(user_id)
  WHERE user_id IS NOT NULL;

DROP POLICY IF EXISTS patients_access_select ON public.patients;
CREATE POLICY patients_access_select
ON public.patients FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id()
  AND unit_id = public.active_unit_id()
  AND (
    user_id = auth.uid()
    OR (
      NOT EXISTS (
        SELECT 1
        FROM public.user_access_context ctx
        JOIN public.roles r ON r.id = ctx.role_id AND r.lg_ativo = TRUE
        WHERE ctx.user_id = auth.uid()
          AND ctx.session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
          AND lower(r.name) IN ('paciente', 'patient')
      )
      AND (
        public.can_access('patients', 'view')
        OR public.can_access('pacientes', 'view')
      )
    )
  )
);

DROP POLICY IF EXISTS appointments_access_select ON public.appointments;
CREATE POLICY appointments_access_select
ON public.appointments FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id()
  AND unit_id = public.active_unit_id()
  AND (
    EXISTS (
      SELECT 1
      FROM public.patients p
      WHERE p.id = appointments.patient_id
        AND p.user_id = auth.uid()
        AND p.company_id = appointments.company_id
        AND p.unit_id = appointments.unit_id
    )
    OR (
      NOT EXISTS (
        SELECT 1
        FROM public.user_access_context ctx
        JOIN public.roles r ON r.id = ctx.role_id AND r.lg_ativo = TRUE
        WHERE ctx.user_id = auth.uid()
          AND ctx.session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
          AND lower(r.name) IN ('paciente', 'patient')
      )
      AND (
        public.can_access('appointments', 'view')
        OR public.can_access('agenda', 'view')
      )
    )
  )
);

CREATE OR REPLACE FUNCTION public.update_my_appointment_status_secure(
  p_appointment_id BIGINT,
  p_target_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_target TEXT := lower(trim(COALESCE(p_target_status, '')));
  v_appointment public.appointments%ROWTYPE;
BEGIN
  IF v_user_id IS NULL OR public.request_aal() IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Sessao AAL2 obrigatoria' USING ERRCODE = '42501';
  END IF;

  IF v_target NOT IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Transicao do portal nao permitida' USING ERRCODE = '22023';
  END IF;

  SELECT a.* INTO v_appointment
  FROM public.appointments a
  JOIN public.patients p
    ON p.id = a.patient_id
   AND p.user_id = v_user_id
   AND p.company_id = a.company_id
   AND p.unit_id = a.unit_id
  WHERE a.id = p_appointment_id
    AND a.company_id = public.active_company_id()
    AND a.unit_id = public.active_unit_id()
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao pertence ao paciente autenticado'
      USING ERRCODE = '42501';
  END IF;

  IF lower(COALESCE(v_appointment.status, '')) NOT IN ('scheduled', 'agendado', 'confirmed', 'confirmado') THEN
    RAISE EXCEPTION 'Estado atual nao permite confirmacao ou cancelamento pelo portal'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.appointments
  SET status = v_target,
      tp_status = CASE v_target WHEN 'confirmed' THEN 'confirmado' ELSE 'cancelado' END,
      lg_confirmado = (v_target = 'confirmed'),
      notes = CASE
        WHEN v_target = 'cancelled' AND NULLIF(trim(p_reason), '') IS NOT NULL
          THEN concat_ws(E'\n', NULLIF(notes, ''), 'Portal do paciente: ' || left(trim(p_reason), 500))
        ELSE notes
      END,
      updated_at = now()
  WHERE id = v_appointment.id
  RETURNING * INTO v_appointment;

  RETURN to_jsonb(v_appointment);
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_appointment_status_secure(BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_appointment_status_secure(BIGINT, TEXT, TEXT)
  TO authenticated;


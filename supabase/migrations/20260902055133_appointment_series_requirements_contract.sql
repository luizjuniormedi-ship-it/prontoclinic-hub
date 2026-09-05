-- Canonical, atomic appointment-series contract. A series is metadata around
-- the existing secure appointment command; it does not create a second
-- scheduling path or bypass the established requirements ledger.

BEGIN;

DO $role$
BEGIN
  IF to_regrole('prontomedic_schedule_rpc_owner') IS NULL THEN
    CREATE ROLE prontomedic_schedule_rpc_owner
      NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOREPLICATION;
  ELSE
    ALTER ROLE prontomedic_schedule_rpc_owner
      NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END;
$role$;

CREATE TABLE IF NOT EXISTS public.appointment_series (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id),
  unit_id INTEGER NOT NULL REFERENCES public.units(id),
  request_fingerprint TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL CHECK (occurrence_count BETWEEN 1 AND 52),
  interval_days INTEGER NOT NULL CHECK (interval_days BETWEEN 1 AND 365),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.appointment_series_items (
  series_id UUID NOT NULL REFERENCES public.appointment_series(id) ON DELETE CASCADE,
  occurrence_number INTEGER NOT NULL CHECK (occurrence_number > 0),
  appointment_id BIGINT NOT NULL REFERENCES public.appointments(id),
  PRIMARY KEY (series_id, occurrence_number),
  UNIQUE (appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_appointment_series_context
  ON public.appointment_series(company_id, unit_id, created_at DESC);

ALTER TABLE public.appointment_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_series FORCE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_series_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_series_items FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public, auth TO prontomedic_schedule_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO prontomedic_schedule_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_company_id() TO prontomedic_schedule_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_unit_id() TO prontomedic_schedule_rpc_owner;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT) TO prontomedic_schedule_rpc_owner;
GRANT EXECUTE ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  TO prontomedic_schedule_rpc_owner;
GRANT EXECUTE ON FUNCTION public.get_scheduling_requirements(BIGINT, BIGINT, BIGINT, INTEGER, TEXT)
  TO prontomedic_schedule_rpc_owner;
GRANT EXECUTE ON FUNCTION public.create_appointment_with_requirements_secure(
  BIGINT, BIGINT, DATE, TIME, TIME, UUID, INTEGER, INTEGER,
  BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, TEXT
) TO prontomedic_schedule_rpc_owner;
GRANT SELECT, UPDATE ON public.appointments TO prontomedic_schedule_rpc_owner;
GRANT SELECT ON public.insurance_plans TO prontomedic_schedule_rpc_owner;
GRANT SELECT ON public.units TO prontomedic_schedule_rpc_owner;
GRANT SELECT, INSERT ON public.patient_insurances TO prontomedic_schedule_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.patient_insurances_id_seq
  TO prontomedic_schedule_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON public.insurance_eligibility_checks
  TO prontomedic_schedule_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON public.insurance_authorizations
  TO prontomedic_schedule_rpc_owner;
GRANT SELECT, INSERT ON public.appointment_series, public.appointment_series_items
  TO prontomedic_schedule_rpc_owner;

DROP POLICY IF EXISTS appointment_series_owner_access ON public.appointment_series;
CREATE POLICY appointment_series_owner_access
  ON public.appointment_series FOR ALL TO prontomedic_schedule_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.can_access('agenda', 'create')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.can_access('agenda', 'create')
  );

DROP POLICY IF EXISTS appointment_series_items_owner_access ON public.appointment_series_items;
CREATE POLICY appointment_series_items_owner_access
  ON public.appointment_series_items FOR ALL TO prontomedic_schedule_rpc_owner
  USING (
    EXISTS (
      SELECT 1 FROM public.appointment_series series
       WHERE series.id = series_id
         AND series.company_id = public.active_company_id()
         AND series.unit_id = public.active_unit_id()
    )
    AND public.can_access('agenda', 'create')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.appointment_series series
       WHERE series.id = series_id
         AND series.company_id = public.active_company_id()
         AND series.unit_id = public.active_unit_id()
    )
    AND public.can_access('agenda', 'create')
  );

DROP POLICY IF EXISTS appointments_series_owner_select ON public.appointments;
CREATE POLICY appointments_series_owner_select
  ON public.appointments FOR SELECT TO prontomedic_schedule_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.can_access('agenda', 'create')
  );

DROP POLICY IF EXISTS appointments_series_owner_update ON public.appointments;
CREATE POLICY appointments_series_owner_update
  ON public.appointments FOR UPDATE TO prontomedic_schedule_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.can_access('agenda', 'create')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.can_access('agenda', 'create')
  );

DROP POLICY IF EXISTS insurance_plans_series_owner_select ON public.insurance_plans;
CREATE POLICY insurance_plans_series_owner_select
  ON public.insurance_plans FOR SELECT TO prontomedic_schedule_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND lg_ativo = TRUE
    AND public.can_access('agenda', 'create')
  );

DROP POLICY IF EXISTS units_series_owner_select ON public.units;
CREATE POLICY units_series_owner_select
  ON public.units FOR SELECT TO prontomedic_schedule_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND id = public.active_unit_id()
    AND lg_ativo = TRUE
    AND public.can_access('agenda', 'create')
  );

DROP POLICY IF EXISTS patient_insurances_series_owner_select ON public.patient_insurances;
CREATE POLICY patient_insurances_series_owner_select
  ON public.patient_insurances FOR SELECT TO prontomedic_schedule_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND public.can_access('agenda', 'create')
  );
DROP POLICY IF EXISTS patient_insurances_series_owner_insert ON public.patient_insurances;
CREATE POLICY patient_insurances_series_owner_insert
  ON public.patient_insurances FOR INSERT TO prontomedic_schedule_rpc_owner
  WITH CHECK (
    company_id = public.active_company_id()
    AND public.can_access('agenda', 'create')
  );

DROP POLICY IF EXISTS eligibility_series_owner_access ON public.insurance_eligibility_checks;
CREATE POLICY eligibility_series_owner_access
  ON public.insurance_eligibility_checks FOR ALL TO prontomedic_schedule_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.can_access('agenda', 'create')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.can_access('agenda', 'create')
  );

DROP POLICY IF EXISTS authorizations_series_owner_access ON public.insurance_authorizations;
CREATE POLICY authorizations_series_owner_access
  ON public.insurance_authorizations FOR ALL TO prontomedic_schedule_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.can_access('agenda', 'create')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.can_access('agenda', 'create')
  );

CREATE OR REPLACE FUNCTION public.create_appointment_series_with_requirements_secure(
  p_series_id UUID,
  p_patient_id BIGINT,
  p_professional_id BIGINT,
  p_appointment_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_company_id UUID,
  p_unit_id INTEGER,
  p_specialty_id INTEGER,
  p_service_id BIGINT,
  p_appointment_type_id BIGINT,
  p_is_return BOOLEAN,
  p_notes TEXT,
  p_insurance_id INTEGER,
  p_insurance_plan_id INTEGER,
  p_card_number TEXT,
  p_authorization_number TEXT,
  p_occurrences INTEGER,
  p_interval_days INTEGER
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = on
AS $function$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_fingerprint TEXT;
  v_existing_fingerprint TEXT;
  v_plan_company_id INTEGER;
  v_patient_insurance_id BIGINT;
  v_existing_card_number TEXT;
  v_requirements JSONB;
  v_row public.appointments%ROWTYPE;
  v_occurrence INTEGER;
  v_authorization TEXT := NULLIF(trim(COALESCE(p_authorization_number, '')), '');
  v_card_number TEXT := NULLIF(trim(COALESCE(p_card_number, '')), '');
  v_notes TEXT := NULLIF(trim(COALESCE(p_notes, '')), '');
BEGIN
  IF p_series_id IS NULL
     OR v_company_id IS NULL
     OR v_unit_id IS NULL
     OR NOT public.can_access('agenda', 'create')
     OR (p_company_id IS NOT NULL AND p_company_id IS DISTINCT FROM v_company_id)
     OR (p_unit_id IS NOT NULL AND p_unit_id IS DISTINCT FROM v_unit_id) THEN
    RAISE EXCEPTION 'Contexto AAL2, sessão, unidade ou permissão inválidos'
      USING ERRCODE = '42501';
  END IF;

  IF p_occurrences NOT BETWEEN 1 AND 52
     OR p_interval_days NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'Série deve ter entre 1 e 52 ocorrências e intervalo válido';
  END IF;

  IF p_insurance_id IS NULL AND (
    p_insurance_plan_id IS NOT NULL
    OR v_card_number IS NOT NULL
    OR v_authorization IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Plano, carteirinha ou autorização exigem convênio';
  END IF;

  -- Serialize idempotent retries before any canonical insurance side effect.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_series_id::TEXT, 0));

  IF p_insurance_plan_id IS NOT NULL THEN
    -- Different series for the same patient/plan must not create competing
    -- active insurance links. This lock is independent from the series key.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      v_company_id::TEXT || ':' || p_patient_id::TEXT || ':' || p_insurance_plan_id::TEXT,
      0
    ));

    SELECT plan.insurance_company_id
      INTO v_plan_company_id
      FROM public.insurance_plans plan
     WHERE plan.id = p_insurance_plan_id
       AND plan.company_id = v_company_id
       AND plan.lg_ativo = TRUE;
    IF NOT FOUND OR p_insurance_id IS NULL
       OR v_plan_company_id IS DISTINCT FROM p_insurance_id THEN
      RAISE EXCEPTION 'Plano não pertence ao convênio e empresa ativos';
    END IF;

    SELECT patient_insurance.id,
           NULLIF(trim(COALESCE(patient_insurance.card_number, '')), '')
      INTO v_patient_insurance_id, v_existing_card_number
      FROM public.patient_insurances patient_insurance
     WHERE patient_insurance.company_id = v_company_id
       AND patient_insurance.patient_id = p_patient_id
       AND patient_insurance.insurance_plan_id = p_insurance_plan_id
       AND patient_insurance.status = 'active'
     ORDER BY patient_insurance.is_primary DESC,
              patient_insurance.updated_at DESC,
              patient_insurance.id DESC
     LIMIT 1;

    IF FOUND THEN
      IF v_card_number IS NULL THEN
        v_card_number := v_existing_card_number;
      ELSIF v_existing_card_number IS DISTINCT FROM v_card_number THEN
        RAISE EXCEPTION 'Carteirinha diverge do vínculo ativo do paciente';
      END IF;
    ELSIF v_card_number IS NOT NULL THEN
      INSERT INTO public.patient_insurances(
        company_id, patient_id, insurance_plan_id, card_number,
        is_primary, status, created_by
      ) VALUES (
        v_company_id, p_patient_id, p_insurance_plan_id, v_card_number,
        FALSE, 'active', auth.uid()
      )
      RETURNING id INTO v_patient_insurance_id;
    END IF;

    IF v_card_number IS NULL THEN
      RAISE EXCEPTION 'Carteirinha ativa é obrigatória para o plano informado';
    END IF;
  END IF;

  v_fingerprint := md5(jsonb_build_object(
    'patient', p_patient_id,
    'professional', p_professional_id,
    'date', p_appointment_date,
    'start', p_start_time,
    'end', p_end_time,
    'company', v_company_id,
    'unit', v_unit_id,
    'specialty', p_specialty_id,
    'service', p_service_id,
    'appointment_type', p_appointment_type_id,
    'is_return', p_is_return,
    'notes', v_notes,
    'insurance', p_insurance_id,
    'plan', p_insurance_plan_id,
    'card', v_card_number,
    'authorization', v_authorization,
    'occurrences', p_occurrences,
    'interval_days', p_interval_days
  )::TEXT);

  SELECT request_fingerprint
    INTO v_existing_fingerprint
    FROM public.appointment_series
   WHERE id = p_series_id;

  IF FOUND THEN
    IF v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'Chave idempotente já utilizada com outro conteúdo';
    END IF;
    RETURN QUERY
      SELECT appointment.*
        FROM public.appointment_series_items item
        JOIN public.appointments appointment ON appointment.id = item.appointment_id
       WHERE item.series_id = p_series_id
       ORDER BY item.occurrence_number;
    RETURN;
  END IF;

  INSERT INTO public.appointment_series(
    id, company_id, unit_id, request_fingerprint,
    occurrence_count, interval_days, created_by
  ) VALUES (
    p_series_id, v_company_id, v_unit_id, v_fingerprint,
    p_occurrences, p_interval_days, auth.uid()
  );

  v_requirements := public.get_scheduling_requirements(
    p_patient_id, p_professional_id, p_service_id, p_insurance_id, v_card_number
  );

  FOR v_occurrence IN 1..p_occurrences LOOP
    SELECT * INTO v_row
      FROM public.create_appointment_with_requirements_secure(
        p_patient_id,
        p_professional_id,
        p_appointment_date + ((v_occurrence - 1) * p_interval_days),
        p_start_time,
        p_end_time,
        v_company_id,
        v_unit_id,
        p_specialty_id,
        p_service_id,
        p_appointment_type_id,
        'scheduled',
        p_is_return,
        FALSE,
        v_notes,
        p_insurance_id,
        v_card_number,
        v_authorization
      );

    IF p_insurance_plan_id IS NOT NULL THEN
      UPDATE public.appointments
         SET insurance_company_id = p_insurance_id,
             insurance_plan_id = p_insurance_plan_id,
             updated_at = now()
       WHERE id = v_row.id
         AND company_id = v_company_id
         AND unit_id = v_unit_id
      RETURNING * INTO v_row;

      UPDATE public.insurance_eligibility_checks
         SET insurance_plan_id = p_insurance_plan_id,
             updated_at = now()
       WHERE appointment_id = v_row.id
         AND company_id = v_company_id
         AND unit_id = v_unit_id;

      UPDATE public.insurance_authorizations
         SET insurance_plan_id = p_insurance_plan_id,
             updated_at = now()
       WHERE appointment_id = v_row.id
         AND company_id = v_company_id
         AND unit_id = v_unit_id;
    END IF;

    IF v_authorization IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.insurance_authorizations auth_record
          WHERE auth_record.appointment_id = v_row.id
            AND auth_record.company_id = v_company_id
            AND auth_record.unit_id = v_unit_id
       ) THEN
      INSERT INTO public.insurance_authorizations(
        company_id, unit_id, patient_id, appointment_id, insurance_id,
        insurance_plan_id, procedure_id, procedure_desc,
        requester_professional_id, status, authorization_number,
        requested_at, authorized_at, quantity_requested,
        quantity_authorized, created_by, notes
      ) VALUES (
        v_company_id, v_unit_id, p_patient_id, v_row.id, p_insurance_id,
        p_insurance_plan_id, p_service_id, v_requirements->>'service_name',
        p_professional_id, 'autorizada', v_authorization,
        now(), now(), 1, 1, auth.uid(), v_requirements->>'preparation'
      );
    END IF;

    INSERT INTO public.appointment_series_items(
      series_id, occurrence_number, appointment_id
    ) VALUES (p_series_id, v_occurrence, v_row.id);

    RETURN NEXT v_row;
  END LOOP;
END;
$function$;

ALTER FUNCTION public.create_appointment_series_with_requirements_secure(
  UUID, BIGINT, BIGINT, DATE, TIME, TIME, UUID, INTEGER, INTEGER,
  BIGINT, BIGINT, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER
) OWNER TO prontomedic_schedule_rpc_owner;

REVOKE ALL ON FUNCTION public.create_appointment_series_with_requirements_secure(
  UUID, BIGINT, BIGINT, DATE, TIME, TIME, UUID, INTEGER, INTEGER,
  BIGINT, BIGINT, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_appointment_series_with_requirements_secure(
  UUID, BIGINT, BIGINT, DATE, TIME, TIME, UUID, INTEGER, INTEGER,
  BIGINT, BIGINT, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER
) TO authenticated, app_prontomedic;

COMMIT;

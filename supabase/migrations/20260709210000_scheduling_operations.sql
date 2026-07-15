-- Scheduling operations: waitlist, blocks and calculated availability.

-- Canonical weekly professional schedule consumed by slot calculation.
CREATE TABLE IF NOT EXISTS public.professional_schedules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  professional_id BIGINT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  day_of_week VARCHAR(20) NOT NULL,
  lg_habilitado BOOLEAN NOT NULL DEFAULT TRUE,
  slot1_start INTEGER,
  slot1_end INTEGER,
  slot1_duration INTEGER DEFAULT 30,
  slot1_unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  slot2_start INTEGER,
  slot2_end INTEGER,
  slot2_duration INTEGER DEFAULT 30,
  slot2_unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  slot3_start INTEGER,
  slot3_end INTEGER,
  slot3_duration INTEGER DEFAULT 30,
  slot3_unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_professional_schedules_lookup
  ON public.professional_schedules(professional_id, day_of_week, lg_habilitado);

CREATE TABLE IF NOT EXISTS public.scheduling_waitlist (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  professional_id BIGINT REFERENCES public.professionals(id) ON DELETE SET NULL,
  specialty_id INTEGER REFERENCES public.specialties(id) ON DELETE SET NULL,
  appointment_type_id BIGINT REFERENCES public.appointment_types(id) ON DELETE SET NULL,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  preferred_date_from DATE,
  preferred_date_to DATE,
  preferred_period VARCHAR(20) NOT NULL DEFAULT 'any',
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  reason TEXT NOT NULL,
  notes TEXT,
  created_by UUID,
  converted_appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scheduling_waitlist_period_chk CHECK (preferred_period IN ('any', 'morning', 'afternoon', 'evening')),
  CONSTRAINT scheduling_waitlist_priority_chk CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT scheduling_waitlist_status_chk CHECK (status IN ('waiting', 'contacting', 'converted', 'cancelled', 'expired')),
  CONSTRAINT scheduling_waitlist_dates_chk CHECK (preferred_date_to IS NULL OR preferred_date_from IS NULL OR preferred_date_to >= preferred_date_from)
);

CREATE TABLE IF NOT EXISTS public.scheduling_blocks (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  professional_id BIGINT REFERENCES public.professionals(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  block_type VARCHAR(30) NOT NULL DEFAULT 'operational',
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by UUID,
  cancelled_by UUID,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scheduling_blocks_period_chk CHECK (ends_at > starts_at),
  CONSTRAINT scheduling_blocks_scope_chk CHECK (professional_id IS NOT NULL OR unit_id IS NOT NULL),
  CONSTRAINT scheduling_blocks_type_chk CHECK (block_type IN ('operational', 'leave', 'vacation', 'meeting', 'maintenance', 'emergency')),
  CONSTRAINT scheduling_blocks_status_chk CHECK (status IN ('active', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_scheduling_waitlist_queue
  ON public.scheduling_waitlist(status, priority, created_at)
  WHERE status IN ('waiting', 'contacting');
CREATE INDEX IF NOT EXISTS idx_scheduling_waitlist_patient
  ON public.scheduling_waitlist(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduling_blocks_professional_period
  ON public.scheduling_blocks(professional_id, starts_at, ends_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_scheduling_blocks_unit_period
  ON public.scheduling_blocks(unit_id, starts_at, ends_at)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_scheduling_waitlist_updated_at ON public.scheduling_waitlist;
CREATE TRIGGER trg_scheduling_waitlist_updated_at
  BEFORE UPDATE ON public.scheduling_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.touch_scheduling_updated_at();

DROP TRIGGER IF EXISTS trg_scheduling_blocks_updated_at ON public.scheduling_blocks;
CREATE TRIGGER trg_scheduling_blocks_updated_at
  BEFORE UPDATE ON public.scheduling_blocks
  FOR EACH ROW EXECUTE FUNCTION public.touch_scheduling_updated_at();

CREATE OR REPLACE FUNCTION public.scheduling_hhmm_to_time(p_value INTEGER)
RETURNS TIME
LANGUAGE sql
IMMUTABLE
RETURNS NULL ON NULL INPUT
SET search_path = public, pg_temp
AS $$
  SELECT make_time((p_value / 100)::INTEGER, (p_value % 100)::INTEGER, 0)
$$;

CREATE OR REPLACE FUNCTION public.create_waitlist_entry_secure(
  p_patient_id BIGINT,
  p_reason TEXT,
  p_professional_id BIGINT DEFAULT NULL,
  p_specialty_id INTEGER DEFAULT NULL,
  p_appointment_type_id BIGINT DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL,
  p_preferred_date_from DATE DEFAULT NULL,
  p_preferred_date_to DATE DEFAULT NULL,
  p_preferred_period TEXT DEFAULT 'any',
  p_priority TEXT DEFAULT 'normal',
  p_notes TEXT DEFAULT NULL
)
RETURNS public.scheduling_waitlist
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_row public.scheduling_waitlist;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_scheduling_permission();
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo da lista de espera e obrigatorio';
  END IF;
  IF p_preferred_period NOT IN ('any', 'morning', 'afternoon', 'evening') THEN
    RAISE EXCEPTION 'Periodo preferencial invalido';
  END IF;
  IF p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'Prioridade invalida';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.scheduling_waitlist
    WHERE patient_id = p_patient_id
      AND status IN ('waiting', 'contacting')
      AND professional_id IS NOT DISTINCT FROM p_professional_id
      AND specialty_id IS NOT DISTINCT FROM p_specialty_id
  ) THEN
    RAISE EXCEPTION 'Paciente ja possui espera ativa para o mesmo criterio';
  END IF;

  INSERT INTO public.scheduling_waitlist (
    company_id, patient_id, professional_id, specialty_id, appointment_type_id,
    unit_id, preferred_date_from, preferred_date_to, preferred_period,
    priority, reason, notes, created_by
  ) VALUES (
    COALESCE(v_actor.company_id, (SELECT company_id FROM public.patients WHERE id = p_patient_id)),
    p_patient_id, p_professional_id, p_specialty_id, p_appointment_type_id,
    p_unit_id, p_preferred_date_from, p_preferred_date_to, p_preferred_period,
    p_priority, trim(p_reason), NULLIF(trim(COALESCE(p_notes, '')), ''), v_actor.user_id
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_waitlist_entry_secure(
  p_waitlist_id BIGINT,
  p_status TEXT,
  p_reason TEXT
)
RETURNS public.scheduling_waitlist
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.scheduling_waitlist;
BEGIN
  PERFORM public.assert_scheduling_permission();
  IF p_status NOT IN ('cancelled', 'expired') THEN
    RAISE EXCEPTION 'Status de encerramento invalido';
  END IF;
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo do encerramento e obrigatorio';
  END IF;
  UPDATE public.scheduling_waitlist
     SET status = p_status, notes = concat_ws(E'\n', notes, trim(p_reason)), closed_at = NOW()
   WHERE id = p_waitlist_id AND status IN ('waiting', 'contacting')
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Espera ativa nao encontrada'; END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_waitlist_to_appointment_secure(
  p_waitlist_id BIGINT,
  p_appointment_date DATE,
  p_start_time TIME,
  p_end_time TIME DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wait public.scheduling_waitlist;
  v_appointment public.appointments;
BEGIN
  PERFORM public.assert_scheduling_permission();
  SELECT * INTO v_wait FROM public.scheduling_waitlist
   WHERE id = p_waitlist_id FOR UPDATE;
  IF NOT FOUND OR v_wait.status NOT IN ('waiting', 'contacting') THEN
    RAISE EXCEPTION 'Espera ativa nao encontrada';
  END IF;
  IF v_wait.professional_id IS NULL THEN
    RAISE EXCEPTION 'Defina o profissional antes de converter a espera';
  END IF;

  SELECT * INTO v_appointment FROM public.create_appointment_secure(
    v_wait.patient_id, v_wait.professional_id, p_appointment_date, p_start_time,
    p_end_time, v_wait.company_id, v_wait.unit_id, v_wait.specialty_id, NULL,
    v_wait.appointment_type_id, 'scheduled', FALSE, FALSE,
    'Convertido da lista de espera #' || v_wait.id
  );

  UPDATE public.scheduling_waitlist
     SET status = 'converted', converted_appointment_id = v_appointment.id,
         converted_at = NOW(), closed_at = NOW()
   WHERE id = v_wait.id;
  RETURN v_appointment;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_schedule_block_secure(
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_reason TEXT,
  p_professional_id BIGINT DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL,
  p_block_type TEXT DEFAULT 'operational'
)
RETURNS public.scheduling_blocks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor RECORD; v_row public.scheduling_blocks;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_scheduling_permission();
  IF p_professional_id IS NULL AND p_unit_id IS NULL THEN
    RAISE EXCEPTION 'Profissional ou unidade e obrigatorio';
  END IF;
  IF p_ends_at <= p_starts_at THEN RAISE EXCEPTION 'Periodo do bloqueio invalido'; END IF;
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Motivo do bloqueio e obrigatorio'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.scheduling_blocks b
    WHERE b.status = 'active'
      AND b.professional_id IS NOT DISTINCT FROM p_professional_id
      AND b.unit_id IS NOT DISTINCT FROM p_unit_id
      AND p_starts_at < b.ends_at AND p_ends_at > b.starts_at
  ) THEN RAISE EXCEPTION 'Ja existe bloqueio sobreposto para o mesmo recurso'; END IF;

  INSERT INTO public.scheduling_blocks (
    company_id, professional_id, unit_id, starts_at, ends_at, block_type, reason, created_by
  ) VALUES (
    v_actor.company_id, p_professional_id, p_unit_id, p_starts_at, p_ends_at,
    p_block_type, trim(p_reason), v_actor.user_id
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_schedule_block_secure(p_block_id BIGINT)
RETURNS public.scheduling_blocks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor RECORD; v_row public.scheduling_blocks;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_scheduling_permission();
  UPDATE public.scheduling_blocks
     SET status = 'cancelled', cancelled_by = v_actor.user_id, cancelled_at = NOW()
   WHERE id = p_block_id AND status = 'active'
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bloqueio ativo nao encontrado'; END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_professional_available_slots(
  p_professional_id BIGINT,
  p_date DATE,
  p_duration_minutes INTEGER DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL
)
RETURNS TABLE(start_time TIME, end_time TIME, unit_id INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH weekday AS (
    SELECT (ARRAY['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'])[EXTRACT(DOW FROM p_date)::INTEGER + 1] AS name
  ), windows AS (
    SELECT ps.slot1_start AS from_hhmm, ps.slot1_end AS to_hhmm,
           COALESCE(p_duration_minutes, NULLIF(ps.slot1_duration, 0), 30) AS duration_min,
           ps.slot1_unit_id AS schedule_unit
    FROM public.professional_schedules ps, weekday w
    WHERE ps.professional_id = p_professional_id AND ps.lg_habilitado IS TRUE
      AND lower(ps.day_of_week) = w.name
      AND ps.slot1_start IS NOT NULL AND ps.slot1_end IS NOT NULL
      AND (p_unit_id IS NULL OR ps.slot1_unit_id = p_unit_id)
    UNION ALL
    SELECT ps.slot2_start, ps.slot2_end,
           COALESCE(p_duration_minutes, NULLIF(ps.slot2_duration, 0), 30), ps.slot2_unit_id
    FROM public.professional_schedules ps, weekday w
    WHERE ps.professional_id = p_professional_id AND ps.lg_habilitado IS TRUE
      AND lower(ps.day_of_week) = w.name
      AND ps.slot2_start IS NOT NULL AND ps.slot2_end IS NOT NULL
      AND (p_unit_id IS NULL OR ps.slot2_unit_id = p_unit_id)
    UNION ALL
    SELECT ps.slot3_start, ps.slot3_end,
           COALESCE(p_duration_minutes, NULLIF(ps.slot3_duration, 0), 30), ps.slot3_unit_id
    FROM public.professional_schedules ps, weekday w
    WHERE ps.professional_id = p_professional_id AND ps.lg_habilitado IS TRUE
      AND lower(ps.day_of_week) = w.name
      AND ps.slot3_start IS NOT NULL AND ps.slot3_end IS NOT NULL
      AND (p_unit_id IS NULL OR ps.slot3_unit_id = p_unit_id)
  ), candidates AS (
    SELECT gs::TIME AS slot_start,
           (gs + make_interval(mins => w.duration_min))::TIME AS slot_end,
           w.schedule_unit
    FROM windows w
    CROSS JOIN LATERAL generate_series(
      p_date + public.scheduling_hhmm_to_time(w.from_hhmm),
      p_date + public.scheduling_hhmm_to_time(w.to_hhmm) - make_interval(mins => w.duration_min),
      make_interval(mins => w.duration_min)
    ) gs
  )
  SELECT c.slot_start, c.slot_end, c.schedule_unit
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.professional_id = p_professional_id AND a.appointment_date = p_date
      AND a.status NOT IN ('cancelled', 'no_show')
      AND c.slot_start < COALESCE(a.end_time, a.start_time + INTERVAL '30 minutes')
      AND c.slot_end > a.start_time
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.scheduling_blocks b
    WHERE b.status = 'active'
      AND (b.professional_id = p_professional_id OR (b.professional_id IS NULL AND b.unit_id = COALESCE(p_unit_id, c.schedule_unit)))
      AND (p_date + c.slot_start) < b.ends_at
      AND (p_date + c.slot_end) > b.starts_at
  )
  ORDER BY c.slot_start;
$$;

ALTER TABLE public.scheduling_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_blocks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    DROP POLICY IF EXISTS scheduling_waitlist_company ON public.scheduling_waitlist;
    DROP POLICY IF EXISTS scheduling_blocks_company ON public.scheduling_blocks;
    CREATE POLICY scheduling_waitlist_company ON public.scheduling_waitlist FOR SELECT TO authenticated
      USING (company_id = (SELECT company_id FROM public.get_scheduling_actor()));
    CREATE POLICY scheduling_blocks_company ON public.scheduling_blocks FOR SELECT TO authenticated
      USING (company_id = (SELECT company_id FROM public.get_scheduling_actor()));
    GRANT SELECT ON public.scheduling_waitlist, public.scheduling_blocks TO authenticated;
    GRANT EXECUTE ON FUNCTION public.create_waitlist_entry_secure(BIGINT,TEXT,BIGINT,INTEGER,BIGINT,INTEGER,DATE,DATE,TEXT,TEXT,TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.close_waitlist_entry_secure(BIGINT,TEXT,TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.convert_waitlist_to_appointment_secure(BIGINT,DATE,TIME,TIME) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.create_schedule_block_secure(TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BIGINT,INTEGER,TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.cancel_schedule_block_secure(BIGINT) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.get_professional_available_slots(BIGINT,DATE,INTEGER,INTEGER) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    GRANT SELECT ON public.scheduling_waitlist, public.scheduling_blocks TO app_prontomedic;
    GRANT USAGE, SELECT ON SEQUENCE public.scheduling_waitlist_id_seq, public.scheduling_blocks_id_seq TO app_prontomedic;
    GRANT EXECUTE ON FUNCTION public.create_waitlist_entry_secure(BIGINT,TEXT,BIGINT,INTEGER,BIGINT,INTEGER,DATE,DATE,TEXT,TEXT,TEXT) TO app_prontomedic;
    GRANT EXECUTE ON FUNCTION public.close_waitlist_entry_secure(BIGINT,TEXT,TEXT) TO app_prontomedic;
    GRANT EXECUTE ON FUNCTION public.convert_waitlist_to_appointment_secure(BIGINT,DATE,TIME,TIME) TO app_prontomedic;
    GRANT EXECUTE ON FUNCTION public.create_schedule_block_secure(TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BIGINT,INTEGER,TEXT) TO app_prontomedic;
    GRANT EXECUTE ON FUNCTION public.cancel_schedule_block_secure(BIGINT) TO app_prontomedic;
    GRANT EXECUTE ON FUNCTION public.get_professional_available_slots(BIGINT,DATE,INTEGER,INTEGER) TO app_prontomedic;
  END IF;
END $$;

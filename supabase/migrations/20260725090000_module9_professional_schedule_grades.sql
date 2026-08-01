-- Module 9: recurring professional schedule grades, exceptions and publication.
-- Professional habilitations remain owned by Module 4. This migration only
-- references those habilitations and owns availability in Scheduling.
BEGIN;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS room_id BIGINT
    REFERENCES public.organizational_resources(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS equipment_id BIGINT
    REFERENCES public.organizational_resources(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_appointments_room_schedule
  ON public.appointments(company_id, unit_id, room_id, appointment_date, start_time)
  WHERE room_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_equipment_schedule
  ON public.appointments(company_id, unit_id, equipment_id, appointment_date, start_time)
  WHERE equipment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.professional_schedule_grades (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  professional_id BIGINT NOT NULL REFERENCES public.professionals(id) ON DELETE RESTRICT,
  sector_id BIGINT REFERENCES public.sectors(id) ON DELETE RESTRICT,
  specialty_id INTEGER REFERENCES public.specialties(id) ON DELETE RESTRICT,
  name VARCHAR(160) NOT NULL,
  modality VARCHAR(30) NOT NULL DEFAULT 'in_person'
    CHECK (
      modality IN (
        'in_person', 'teleconsult', 'home_care', 'on_call',
        'procedure', 'exam', 'surgery', 'hybrid'
      )
    ),
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
  valid_from DATE NOT NULL,
  valid_until DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (
      status IN (
        'draft', 'pending_validation', 'published', 'active',
        'suspended', 'ended', 'expired', 'cancelled'
      )
    ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  default_duration_minutes SMALLINT NOT NULL DEFAULT 30
    CHECK (default_duration_minutes BETWEEN 5 AND 1440),
  default_capacity SMALLINT NOT NULL DEFAULT 1
    CHECK (default_capacity BETWEEN 1 AND 100),
  default_room_id BIGINT REFERENCES public.organizational_resources(id) ON DELETE RESTRICT,
  default_equipment_id BIGINT REFERENCES public.organizational_resources(id) ON DELETE RESTRICT,
  generation_window_days SMALLINT NOT NULL DEFAULT 90
    CHECK (generation_window_days BETWEEN 1 AND 365),
  published_at TIMESTAMPTZ,
  published_by UUID,
  suspended_at TIMESTAMPTZ,
  suspended_by UUID,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT m9_schedule_grade_dates_valid
    CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT m9_schedule_grade_name_required
    CHECK (length(btrim(name)) BETWEEN 3 AND 160),
  CONSTRAINT m9_schedule_grade_publication_metadata
    CHECK (
      status NOT IN ('published', 'active')
      OR (published_at IS NOT NULL AND published_by IS NOT NULL)
    ),
  CONSTRAINT m9_schedule_grade_scope_unique
    UNIQUE (id, company_id, unit_id)
);

CREATE TABLE IF NOT EXISTS public.professional_schedule_rules (
  id BIGSERIAL PRIMARY KEY,
  grade_id BIGINT NOT NULL,
  company_id UUID NOT NULL,
  unit_id INTEGER NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  break_starts_at TIME,
  break_ends_at TIME,
  service_id BIGINT REFERENCES public.services_catalog(id) ON DELETE RESTRICT,
  appointment_type_id BIGINT REFERENCES public.appointment_types(id) ON DELETE RESTRICT,
  duration_minutes SMALLINT CHECK (duration_minutes BETWEEN 5 AND 1440),
  capacity SMALLINT CHECK (capacity BETWEEN 1 AND 100),
  room_id BIGINT REFERENCES public.organizational_resources(id) ON DELETE RESTRICT,
  equipment_id BIGINT REFERENCES public.organizational_resources(id) ON DELETE RESTRICT,
  allow_return BOOLEAN NOT NULL DEFAULT TRUE,
  allow_walkin BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT m9_schedule_rule_grade_scope_fkey
    FOREIGN KEY (grade_id, company_id, unit_id)
    REFERENCES public.professional_schedule_grades(id, company_id, unit_id)
    ON DELETE CASCADE,
  CONSTRAINT m9_schedule_rule_times_valid CHECK (ends_at > starts_at),
  CONSTRAINT m9_schedule_rule_break_pair CHECK (
    (break_starts_at IS NULL AND break_ends_at IS NULL)
    OR (
      break_starts_at IS NOT NULL
      AND break_ends_at IS NOT NULL
      AND break_starts_at >= starts_at
      AND break_ends_at <= ends_at
      AND break_ends_at > break_starts_at
    )
  )
);

CREATE TABLE IF NOT EXISTS public.professional_schedule_exceptions (
  id BIGSERIAL PRIMARY KEY,
  grade_id BIGINT NOT NULL,
  company_id UUID NOT NULL,
  unit_id INTEGER NOT NULL,
  exception_date DATE NOT NULL,
  is_all_day BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at TIME,
  ends_at TIME,
  exception_type VARCHAR(30) NOT NULL
    CHECK (
      exception_type IN (
        'unavailable', 'extra_availability',
        'resource_override', 'capacity_override'
      )
    ),
  reason TEXT NOT NULL,
  duration_minutes SMALLINT CHECK (duration_minutes BETWEEN 5 AND 1440),
  capacity SMALLINT CHECK (capacity BETWEEN 1 AND 100),
  room_id BIGINT REFERENCES public.organizational_resources(id) ON DELETE RESTRICT,
  equipment_id BIGINT REFERENCES public.organizational_resources(id) ON DELETE RESTRICT,
  affected_appointments_count INTEGER NOT NULL DEFAULT 0
    CHECK (affected_appointments_count >= 0),
  requires_reschedule BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled')),
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT m9_schedule_exception_grade_scope_fkey
    FOREIGN KEY (grade_id, company_id, unit_id)
    REFERENCES public.professional_schedule_grades(id, company_id, unit_id)
    ON DELETE CASCADE,
  CONSTRAINT m9_schedule_exception_reason_required
    CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  CONSTRAINT m9_schedule_exception_times_valid CHECK (
    (is_all_day AND starts_at IS NULL AND ends_at IS NULL)
    OR (
      NOT is_all_day
      AND starts_at IS NOT NULL
      AND ends_at IS NOT NULL
      AND ends_at > starts_at
    )
  ),
  CONSTRAINT m9_schedule_extra_availability_has_time CHECK (
    exception_type <> 'extra_availability' OR NOT is_all_day
  )
);

CREATE TABLE IF NOT EXISTS public.professional_schedule_publications (
  id BIGSERIAL PRIMARY KEY,
  grade_id BIGINT NOT NULL,
  company_id UUID NOT NULL,
  unit_id INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  action VARCHAR(20) NOT NULL
    CHECK (action IN ('published', 'resumed', 'suspended', 'ended', 'cancelled')),
  reason TEXT,
  snapshot JSONB NOT NULL,
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT m9_schedule_publication_grade_scope_fkey
    FOREIGN KEY (grade_id, company_id, unit_id)
    REFERENCES public.professional_schedule_grades(id, company_id, unit_id)
    ON DELETE RESTRICT,
  CONSTRAINT m9_schedule_publication_snapshot_object
    CHECK (jsonb_typeof(snapshot) = 'object')
);

CREATE TABLE IF NOT EXISTS public.professional_schedule_operation_keys (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  operation VARCHAR(60) NOT NULL,
  idempotency_key VARCHAR(200) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response JSONB,
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (company_id, operation, idempotency_key),
  CONSTRAINT m9_schedule_operation_name_required
    CHECK (length(btrim(operation)) BETWEEN 3 AND 60),
  CONSTRAINT m9_schedule_operation_key_required
    CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  CONSTRAINT m9_schedule_operation_hash_valid
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT m9_schedule_operation_response_object
    CHECK (response IS NULL OR jsonb_typeof(response) IN ('object', 'array'))
);

COMMENT ON TABLE public.professional_schedule_grades IS
  'M9 recurring availability owned by Scheduling. Professional identity and habilitations remain owned by M4.';
COMMENT ON TABLE public.professional_schedule_rules IS
  'Weekly recurring windows for a professional schedule grade. Sunday is 0 and Saturday is 6.';
COMMENT ON TABLE public.professional_schedule_exceptions IS
  'Dated availability overrides. Existing appointments are never deleted by an exception.';
COMMENT ON TABLE public.professional_schedule_publications IS
  'Append-only publication and lifecycle history with a complete grade snapshot.';
COMMENT ON TABLE public.professional_schedule_operation_keys IS
  'M9 idempotency ledger keyed by tenant, operation and caller-provided key; request hashes prevent key reuse with different payloads.';
COMMENT ON COLUMN public.professional_schedule_grades.generation_window_days IS
  'Planning horizon for a future slot materializer. This migration resolves windows dynamically and does not erase appointments.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_m9_schedule_grade_business_key
  ON public.professional_schedule_grades(
    company_id, unit_id, professional_id, lower(name), valid_from, version
  );
CREATE INDEX IF NOT EXISTS idx_m9_schedule_grade_availability
  ON public.professional_schedule_grades(
    company_id, unit_id, professional_id, status, valid_from, valid_until
  );
CREATE INDEX IF NOT EXISTS idx_m9_schedule_rule_lookup
  ON public.professional_schedule_rules(
    company_id, unit_id, grade_id, day_of_week, starts_at, ends_at
  )
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_m9_schedule_rule_service
  ON public.professional_schedule_rules(company_id, unit_id, service_id)
  WHERE status = 'active' AND service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_m9_schedule_exception_lookup
  ON public.professional_schedule_exceptions(
    company_id, unit_id, grade_id, exception_date, starts_at, ends_at
  )
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_m9_schedule_publication_history
  ON public.professional_schedule_publications(
    company_id, unit_id, grade_id, created_at DESC
  );
CREATE INDEX IF NOT EXISTS idx_m9_schedule_operation_created
  ON public.professional_schedule_operation_keys(
    company_id, unit_id, created_at DESC
  );

CREATE OR REPLACE FUNCTION public.m9_can_manage_schedule_grade(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
  SELECT p_company_id = public.audit_current_company_id()
    AND public.audit_current_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles profile
      WHERE (
        profile.id = public.audit_current_user_id()
        OR profile.user_id = public.audit_current_user_id()
      )
        AND profile.company_id = p_company_id
        AND profile.lg_ativo = TRUE
    )
    AND public.org_can_access_unit(p_company_id, p_unit_id)
    AND public.org_is_manager()
$fn$;

REVOKE ALL ON FUNCTION public.m9_can_manage_schedule_grade(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m9_can_manage_schedule_grade(UUID, INTEGER)
  TO authenticated, app_prontomedic;

CREATE SCHEMA IF NOT EXISTS m9_private;
REVOKE ALL ON SCHEMA m9_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA m9_private
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;

CREATE OR REPLACE FUNCTION m9_private.schedule_grade_scope_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_company UUID := public.audit_current_company_id();
  v_actor UUID := public.audit_current_user_id();
BEGIN
  IF v_company IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'M9 authenticated tenant context is required';
  END IF;

  IF NEW.company_id IS NULL THEN
    NEW.company_id := v_company;
  ELSIF NEW.company_id <> v_company THEN
    RAISE EXCEPTION 'M9 cross-tenant schedule grade denied';
  END IF;

  IF NOT public.m9_can_manage_schedule_grade(NEW.company_id, NEW.unit_id) THEN
    RAISE EXCEPTION 'M9 schedule grade management is not authorized for this unit';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.units unit_row
    WHERE unit_row.id = NEW.unit_id
      AND unit_row.company_id = NEW.company_id
      AND unit_row.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'M9 active unit does not belong to the tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.professionals professional
    WHERE professional.id = NEW.professional_id
      AND professional.company_id = NEW.company_id
      AND professional.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'M9 active professional does not belong to the tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.professional_units binding
    WHERE binding.company_id = NEW.company_id
      AND binding.professional_id = NEW.professional_id
      AND binding.unit_id = NEW.unit_id
      AND binding.status = 'active'
      AND binding.valid_from <= COALESCE(NEW.valid_until, 'infinity'::DATE)
      AND (binding.valid_until IS NULL OR binding.valid_until >= NEW.valid_from)
      AND (
        NEW.sector_id IS NULL
        OR binding.sector_id IS NULL
        OR binding.sector_id = NEW.sector_id
      )
  ) THEN
    RAISE EXCEPTION 'M9 professional is not habilitated for this unit and validity';
  END IF;

  IF NEW.specialty_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.professional_specialties binding
    WHERE binding.company_id = NEW.company_id
      AND binding.professional_id = NEW.professional_id
      AND binding.specialty_id = NEW.specialty_id
      AND binding.status = 'active'
      AND binding.valid_from <= COALESCE(NEW.valid_until, 'infinity'::DATE)
      AND (binding.valid_until IS NULL OR binding.valid_until >= NEW.valid_from)
  ) THEN
    RAISE EXCEPTION 'M9 professional is not habilitated for this specialty and validity';
  END IF;

  IF NEW.sector_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.sectors sector
    WHERE sector.id = NEW.sector_id
      AND sector.company_id = NEW.company_id
      AND sector.unit_id = NEW.unit_id
      AND sector.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'M9 sector is outside the schedule grade unit';
  END IF;

  IF NEW.default_room_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organizational_resources resource
    WHERE resource.id = NEW.default_room_id
      AND resource.company_id = NEW.company_id
      AND resource.unit_id = NEW.unit_id
      AND resource.resource_type IN ('room', 'office')
      AND resource.status = 'active'
  ) THEN
    RAISE EXCEPTION 'M9 default room is not active in this unit';
  END IF;

  IF NEW.default_equipment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organizational_resources resource
    WHERE resource.id = NEW.default_equipment_id
      AND resource.company_id = NEW.company_id
      AND resource.unit_id = NEW.unit_id
      AND resource.resource_type = 'equipment'
      AND resource.status = 'active'
  ) THEN
    RAISE EXCEPTION 'M9 default equipment is not active in this unit';
  END IF;

  IF TG_OP = 'INSERT'
     AND NEW.status NOT IN ('draft', 'pending_validation') THEN
    RAISE EXCEPTION 'M9 a grade must be created as draft or pending validation';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT (
       OLD.status IN ('draft', 'pending_validation')
       AND NEW.status IN ('draft', 'pending_validation')
     )
     AND current_setting('prontomedic.m9_grade_transition', TRUE) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'M9 lifecycle changes require the secure publication RPC';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('published', 'active', 'suspended')
     AND current_setting('prontomedic.m9_grade_transition', TRUE) IS DISTINCT FROM 'allowed'
     AND to_jsonb(NEW) - ARRAY[
       'status', 'suspended_at', 'suspended_by', 'updated_at', 'updated_by'
     ] IS DISTINCT FROM to_jsonb(OLD) - ARRAY[
       'status', 'suspended_at', 'suspended_by', 'updated_at', 'updated_by'
     ] THEN
    RAISE EXCEPTION 'M9 published grade content is immutable; create a new version';
  END IF;

  NEW.updated_at := NOW();
  NEW.updated_by := v_actor;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, v_actor);
  END IF;

  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION m9_private.schedule_rule_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_grade public.professional_schedule_grades;
  v_actor UUID := public.audit_current_user_id();
  v_rule_id BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO v_grade
    FROM public.professional_schedule_grades
    WHERE id = OLD.grade_id
    FOR UPDATE;

    IF NOT FOUND OR v_grade.status NOT IN ('draft', 'pending_validation') THEN
      RAISE EXCEPTION 'M9 rules can only be removed from a draft grade';
    END IF;
    RETURN OLD;
  END IF;

  SELECT * INTO v_grade
  FROM public.professional_schedule_grades
  WHERE id = NEW.grade_id
    AND company_id = NEW.company_id
    AND unit_id = NEW.unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'M9 schedule rule grade is outside the active scope';
  END IF;
  IF v_grade.status NOT IN ('draft', 'pending_validation') THEN
    RAISE EXCEPTION 'M9 rules can only be changed in a draft grade';
  END IF;
  IF NOT public.m9_can_manage_schedule_grade(v_grade.company_id, v_grade.unit_id) THEN
    RAISE EXCEPTION 'M9 schedule rule management is not authorized';
  END IF;

  IF NEW.service_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.services_catalog service
    JOIN public.professional_services binding
      ON binding.service_id = service.id
     AND binding.company_id = v_grade.company_id
     AND binding.professional_id = v_grade.professional_id
     AND (binding.unit_id IS NULL OR binding.unit_id = v_grade.unit_id)
     AND binding.status = 'active'
     AND binding.valid_from <= COALESCE(v_grade.valid_until, 'infinity'::DATE)
     AND (binding.valid_until IS NULL OR binding.valid_until >= v_grade.valid_from)
    WHERE service.id = NEW.service_id
      AND service.company_id = v_grade.company_id
      AND service.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'M9 service is not active in the professional habilitations';
  END IF;

  IF NEW.appointment_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.appointment_types appointment_type
    WHERE appointment_type.id = NEW.appointment_type_id
      AND appointment_type.company_id = v_grade.company_id
      AND appointment_type.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'M9 appointment type is not active in the tenant';
  END IF;

  IF NEW.room_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organizational_resources resource
    WHERE resource.id = NEW.room_id
      AND resource.company_id = v_grade.company_id
      AND resource.unit_id = v_grade.unit_id
      AND resource.resource_type IN ('room', 'office')
      AND resource.status = 'active'
  ) THEN
    RAISE EXCEPTION 'M9 rule room is not active in this unit';
  END IF;

  IF NEW.equipment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organizational_resources resource
    WHERE resource.id = NEW.equipment_id
      AND resource.company_id = v_grade.company_id
      AND resource.unit_id = v_grade.unit_id
      AND resource.resource_type = 'equipment'
      AND resource.status = 'active'
  ) THEN
    RAISE EXCEPTION 'M9 rule equipment is not active in this unit';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('m9-grade-rules:' || NEW.grade_id::TEXT, 0)
  );
  v_rule_id := CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END;
  IF EXISTS (
    SELECT 1
    FROM public.professional_schedule_rules existing
    WHERE existing.grade_id = NEW.grade_id
      AND existing.day_of_week = NEW.day_of_week
      AND existing.status = 'active'
      AND (v_rule_id IS NULL OR existing.id <> v_rule_id)
      AND NEW.starts_at < existing.ends_at
      AND NEW.ends_at > existing.starts_at
  ) THEN
    RAISE EXCEPTION 'M9 recurring rule overlaps another rule in the grade';
  END IF;

  NEW.updated_at := NOW();
  NEW.updated_by := v_actor;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, v_actor);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION m9_private.schedule_exception_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_grade public.professional_schedule_grades;
  v_actor UUID := public.audit_current_user_id();
BEGIN
  SELECT * INTO v_grade
  FROM public.professional_schedule_grades
  WHERE id = NEW.grade_id
    AND company_id = NEW.company_id
    AND unit_id = NEW.unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'M9 schedule exception grade is outside the active scope';
  END IF;
  IF v_grade.status IN ('ended', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'M9 closed grade cannot receive exceptions';
  END IF;
  IF NEW.exception_date < v_grade.valid_from
     OR (
       v_grade.valid_until IS NOT NULL
       AND NEW.exception_date > v_grade.valid_until
     ) THEN
    RAISE EXCEPTION 'M9 exception date is outside the grade validity';
  END IF;
  IF NOT public.m9_can_manage_schedule_grade(v_grade.company_id, v_grade.unit_id) THEN
    RAISE EXCEPTION 'M9 schedule exception management is not authorized';
  END IF;

  IF NEW.room_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organizational_resources resource
    WHERE resource.id = NEW.room_id
      AND resource.company_id = v_grade.company_id
      AND resource.unit_id = v_grade.unit_id
      AND resource.resource_type IN ('room', 'office')
      AND resource.status = 'active'
  ) THEN
    RAISE EXCEPTION 'M9 exception room is not active in this unit';
  END IF;

  IF NEW.equipment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organizational_resources resource
    WHERE resource.id = NEW.equipment_id
      AND resource.company_id = v_grade.company_id
      AND resource.unit_id = v_grade.unit_id
      AND resource.resource_type = 'equipment'
      AND resource.status = 'active'
  ) THEN
    RAISE EXCEPTION 'M9 exception equipment is not active in this unit';
  END IF;

  NEW.updated_at := NOW();
  NEW.updated_by := v_actor;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, v_actor);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION m9_private.schedule_publication_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
BEGIN
  RAISE EXCEPTION 'M9 schedule publication history is immutable';
END
$fn$;

REVOKE ALL ON FUNCTION m9_private.schedule_grade_scope_guard()
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION m9_private.schedule_rule_guard()
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION m9_private.schedule_exception_guard()
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION m9_private.schedule_publication_immutable()
  FROM PUBLIC, anon, authenticated, app_prontomedic;

DROP TRIGGER IF EXISTS trg_m9_schedule_grade_scope
  ON public.professional_schedule_grades;
CREATE TRIGGER trg_m9_schedule_grade_scope
BEFORE INSERT OR UPDATE ON public.professional_schedule_grades
FOR EACH ROW EXECUTE FUNCTION m9_private.schedule_grade_scope_guard();

DROP TRIGGER IF EXISTS trg_m9_schedule_rule_guard
  ON public.professional_schedule_rules;
CREATE TRIGGER trg_m9_schedule_rule_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.professional_schedule_rules
FOR EACH ROW EXECUTE FUNCTION m9_private.schedule_rule_guard();

DROP TRIGGER IF EXISTS trg_m9_schedule_exception_guard
  ON public.professional_schedule_exceptions;
CREATE TRIGGER trg_m9_schedule_exception_guard
BEFORE INSERT OR UPDATE ON public.professional_schedule_exceptions
FOR EACH ROW EXECUTE FUNCTION m9_private.schedule_exception_guard();

DROP TRIGGER IF EXISTS trg_m9_schedule_publication_immutable
  ON public.professional_schedule_publications;
CREATE TRIGGER trg_m9_schedule_publication_immutable
BEFORE UPDATE OR DELETE ON public.professional_schedule_publications
FOR EACH ROW EXECUTE FUNCTION m9_private.schedule_publication_immutable();

DROP TRIGGER IF EXISTS trg_audit_professional_schedule_grades
  ON public.professional_schedule_grades;
CREATE TRIGGER trg_audit_professional_schedule_grades
AFTER INSERT OR UPDATE OR DELETE ON public.professional_schedule_grades
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_professional_schedule_rules
  ON public.professional_schedule_rules;
CREATE TRIGGER trg_audit_professional_schedule_rules
AFTER INSERT OR UPDATE OR DELETE ON public.professional_schedule_rules
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_professional_schedule_exceptions
  ON public.professional_schedule_exceptions;
CREATE TRIGGER trg_audit_professional_schedule_exceptions
AFTER INSERT OR UPDATE OR DELETE ON public.professional_schedule_exceptions
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_professional_schedule_publications
  ON public.professional_schedule_publications;
CREATE TRIGGER trg_audit_professional_schedule_publications
AFTER INSERT ON public.professional_schedule_publications
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

ALTER TABLE public.professional_schedule_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_schedule_grades FORCE ROW LEVEL SECURITY;
ALTER TABLE public.professional_schedule_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_schedule_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.professional_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_schedule_exceptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.professional_schedule_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_schedule_publications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.professional_schedule_operation_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_schedule_operation_keys FORCE ROW LEVEL SECURITY;

DO $policies$
DECLARE
  v_policy TEXT;
  v_table TEXT;
BEGIN
  FOR v_policy, v_table IN
    SELECT *
    FROM (
      VALUES
        ('m9_schedule_grades_read', 'professional_schedule_grades'),
        ('m9_schedule_grades_insert', 'professional_schedule_grades'),
        ('m9_schedule_grades_update', 'professional_schedule_grades'),
        ('m9_schedule_rules_read', 'professional_schedule_rules'),
        ('m9_schedule_rules_insert', 'professional_schedule_rules'),
        ('m9_schedule_rules_update', 'professional_schedule_rules'),
        ('m9_schedule_rules_delete', 'professional_schedule_rules'),
        ('m9_schedule_exceptions_read', 'professional_schedule_exceptions'),
        ('m9_schedule_exceptions_insert', 'professional_schedule_exceptions'),
        ('m9_schedule_exceptions_update', 'professional_schedule_exceptions'),
        ('m9_schedule_publications_read', 'professional_schedule_publications'),
        ('m9_schedule_publications_insert', 'professional_schedule_publications'),
        ('m9_schedule_operation_keys_read', 'professional_schedule_operation_keys'),
        ('m9_schedule_operation_keys_insert', 'professional_schedule_operation_keys'),
        ('m9_schedule_operation_keys_update', 'professional_schedule_operation_keys')
    ) AS policies(policy_name, table_name)
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      v_policy,
      v_table
    );
  END LOOP;
END
$policies$;

CREATE POLICY m9_schedule_grades_read
  ON public.professional_schedule_grades
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );
CREATE POLICY m9_schedule_grades_insert
  ON public.professional_schedule_grades
  FOR INSERT TO authenticated, app_prontomedic
  WITH CHECK (public.m9_can_manage_schedule_grade(company_id, unit_id));
CREATE POLICY m9_schedule_grades_update
  ON public.professional_schedule_grades
  FOR UPDATE TO authenticated, app_prontomedic
  USING (public.m9_can_manage_schedule_grade(company_id, unit_id))
  WITH CHECK (public.m9_can_manage_schedule_grade(company_id, unit_id));

CREATE POLICY m9_schedule_rules_read
  ON public.professional_schedule_rules
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );
CREATE POLICY m9_schedule_rules_insert
  ON public.professional_schedule_rules
  FOR INSERT TO authenticated, app_prontomedic
  WITH CHECK (public.m9_can_manage_schedule_grade(company_id, unit_id));
CREATE POLICY m9_schedule_rules_update
  ON public.professional_schedule_rules
  FOR UPDATE TO authenticated, app_prontomedic
  USING (public.m9_can_manage_schedule_grade(company_id, unit_id))
  WITH CHECK (public.m9_can_manage_schedule_grade(company_id, unit_id));
CREATE POLICY m9_schedule_rules_delete
  ON public.professional_schedule_rules
  FOR DELETE TO authenticated, app_prontomedic
  USING (public.m9_can_manage_schedule_grade(company_id, unit_id));

CREATE POLICY m9_schedule_exceptions_read
  ON public.professional_schedule_exceptions
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );
CREATE POLICY m9_schedule_exceptions_insert
  ON public.professional_schedule_exceptions
  FOR INSERT TO authenticated, app_prontomedic
  WITH CHECK (public.m9_can_manage_schedule_grade(company_id, unit_id));
CREATE POLICY m9_schedule_exceptions_update
  ON public.professional_schedule_exceptions
  FOR UPDATE TO authenticated, app_prontomedic
  USING (public.m9_can_manage_schedule_grade(company_id, unit_id))
  WITH CHECK (public.m9_can_manage_schedule_grade(company_id, unit_id));

CREATE POLICY m9_schedule_publications_read
  ON public.professional_schedule_publications
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );
CREATE POLICY m9_schedule_publications_insert
  ON public.professional_schedule_publications
  FOR INSERT TO authenticated, app_prontomedic
  WITH CHECK (public.m9_can_manage_schedule_grade(company_id, unit_id));

CREATE POLICY m9_schedule_operation_keys_read
  ON public.professional_schedule_operation_keys
  FOR SELECT TO authenticated, app_prontomedic
  USING (public.m9_can_manage_schedule_grade(company_id, unit_id));
CREATE POLICY m9_schedule_operation_keys_insert
  ON public.professional_schedule_operation_keys
  FOR INSERT TO authenticated, app_prontomedic
  WITH CHECK (public.m9_can_manage_schedule_grade(company_id, unit_id));
CREATE POLICY m9_schedule_operation_keys_update
  ON public.professional_schedule_operation_keys
  FOR UPDATE TO authenticated, app_prontomedic
  USING (public.m9_can_manage_schedule_grade(company_id, unit_id))
  WITH CHECK (public.m9_can_manage_schedule_grade(company_id, unit_id));

REVOKE ALL ON TABLE public.professional_schedule_grades
  FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.professional_schedule_rules
  FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.professional_schedule_exceptions
  FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.professional_schedule_publications
  FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.professional_schedule_operation_keys
  FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON public.professional_schedule_grades
  TO authenticated, app_prontomedic;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_schedule_rules
  TO authenticated, app_prontomedic;
GRANT SELECT, INSERT, UPDATE ON public.professional_schedule_exceptions
  TO authenticated, app_prontomedic;
GRANT SELECT, INSERT ON public.professional_schedule_publications
  TO authenticated, app_prontomedic;
GRANT SELECT, INSERT, UPDATE ON public.professional_schedule_operation_keys
  TO authenticated, app_prontomedic;
GRANT USAGE, SELECT ON SEQUENCE public.professional_schedule_grades_id_seq
  TO authenticated, app_prontomedic;
GRANT USAGE, SELECT ON SEQUENCE public.professional_schedule_rules_id_seq
  TO authenticated, app_prontomedic;
GRANT USAGE, SELECT ON SEQUENCE public.professional_schedule_exceptions_id_seq
  TO authenticated, app_prontomedic;
GRANT USAGE, SELECT ON SEQUENCE public.professional_schedule_publications_id_seq
  TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.m9_save_professional_schedule_grade_secure(
  p_grade JSONB,
  p_rules JSONB DEFAULT '[]'::JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_company UUID := public.audit_current_company_id();
  v_actor UUID := public.audit_current_user_id();
  v_grade public.professional_schedule_grades;
  v_grade_id BIGINT := NULLIF(p_grade->>'id', '')::BIGINT;
  v_unit_id INTEGER := NULLIF(p_grade->>'unitId', '')::INTEGER;
  v_status TEXT := COALESCE(NULLIF(p_grade->>'status', ''), 'draft');
  v_rule JSONB;
  v_request_hash TEXT;
  v_response JSONB;
  v_inserted INTEGER;
  v_existing public.professional_schedule_operation_keys;
BEGIN
  IF v_company IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'M9 authenticated tenant context is required';
  END IF;
  IF jsonb_typeof(p_grade) <> 'object' THEN
    RAISE EXCEPTION 'M9 grade payload must be an object';
  END IF;
  IF jsonb_typeof(COALESCE(p_rules, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'M9 rules payload must be an array';
  END IF;
  IF v_unit_id IS NULL OR v_unit_id <= 0 THEN
    RAISE EXCEPTION 'M9 unit is required';
  END IF;
  IF v_status NOT IN ('draft', 'pending_validation') THEN
    RAISE EXCEPTION 'M9 save only accepts draft or pending validation status';
  END IF;
  IF NOT public.m9_can_manage_schedule_grade(v_company, v_unit_id) THEN
    RAISE EXCEPTION 'M9 schedule grade management is not authorized';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    IF length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200 THEN
      RAISE EXCEPTION 'M9 idempotency key must contain 8 to 200 characters';
    END IF;
    v_request_hash := encode(
      digest(
        convert_to(
          jsonb_build_object(
            'grade', p_grade,
            'rules', COALESCE(p_rules, '[]'::JSONB)
          )::TEXT,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    INSERT INTO public.professional_schedule_operation_keys (
      company_id, unit_id, operation, idempotency_key,
      request_hash, actor_user_id
    ) VALUES (
      v_company, v_unit_id, 'save_grade', btrim(p_idempotency_key),
      v_request_hash, v_actor
    )
    ON CONFLICT (company_id, operation, idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted = 0 THEN
      SELECT * INTO v_existing
      FROM public.professional_schedule_operation_keys
      WHERE company_id = v_company
        AND operation = 'save_grade'
        AND idempotency_key = btrim(p_idempotency_key)
      FOR UPDATE;
      IF v_existing.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'M9 idempotency key was already used with another request';
      END IF;
      IF v_existing.response IS NOT NULL THEN
        RETURN v_existing.response;
      END IF;
      RAISE EXCEPTION 'M9 idempotent operation is still pending';
    END IF;
  END IF;

  IF v_grade_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'm9-grade-version:' || v_company::TEXT || ':' || v_unit_id::TEXT || ':' ||
        COALESCE(p_grade->>'professionalId', '') || ':' ||
        lower(btrim(COALESCE(p_grade->>'name', ''))),
        0
      )
    );
    INSERT INTO public.professional_schedule_grades (
      company_id, unit_id, professional_id, sector_id, specialty_id,
      name, modality, timezone, valid_from, valid_until, status, version,
      default_duration_minutes, default_capacity,
      default_room_id, default_equipment_id, generation_window_days,
      created_by, updated_by
    ) VALUES (
      v_company,
      v_unit_id,
      NULLIF(p_grade->>'professionalId', '')::BIGINT,
      NULLIF(p_grade->>'sectorId', '')::BIGINT,
      NULLIF(p_grade->>'specialtyId', '')::INTEGER,
      btrim(p_grade->>'name'),
      COALESCE(NULLIF(p_grade->>'modality', ''), 'in_person'),
      COALESCE(NULLIF(p_grade->>'timezone', ''), 'America/Sao_Paulo'),
      NULLIF(p_grade->>'validFrom', '')::DATE,
      NULLIF(p_grade->>'validUntil', '')::DATE,
      v_status,
      COALESCE(
        (
          SELECT MAX(existing.version) + 1
          FROM public.professional_schedule_grades existing
          WHERE existing.company_id = v_company
            AND existing.unit_id = v_unit_id
            AND existing.professional_id = NULLIF(p_grade->>'professionalId', '')::BIGINT
            AND lower(existing.name) = lower(btrim(p_grade->>'name'))
        ),
        1
      ),
      COALESCE(NULLIF(p_grade->>'defaultDurationMinutes', '')::SMALLINT, 30),
      COALESCE(NULLIF(p_grade->>'defaultCapacity', '')::SMALLINT, 1),
      NULLIF(p_grade->>'defaultRoomId', '')::BIGINT,
      NULLIF(p_grade->>'defaultEquipmentId', '')::BIGINT,
      COALESCE(NULLIF(p_grade->>'generationWindowDays', '')::SMALLINT, 90),
      v_actor,
      v_actor
    )
    RETURNING * INTO v_grade;
  ELSE
    SELECT * INTO v_grade
    FROM public.professional_schedule_grades
    WHERE id = v_grade_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_grade.company_id <> v_company
       OR v_grade.unit_id <> v_unit_id THEN
      RAISE EXCEPTION 'M9 schedule grade not found in the active scope';
    END IF;
    IF v_grade.status NOT IN ('draft', 'pending_validation') THEN
      RAISE EXCEPTION 'M9 published grade content is immutable; create a new version';
    END IF;

    UPDATE public.professional_schedule_grades
    SET professional_id = NULLIF(p_grade->>'professionalId', '')::BIGINT,
        sector_id = NULLIF(p_grade->>'sectorId', '')::BIGINT,
        specialty_id = NULLIF(p_grade->>'specialtyId', '')::INTEGER,
        name = btrim(p_grade->>'name'),
        modality = COALESCE(NULLIF(p_grade->>'modality', ''), modality),
        timezone = COALESCE(NULLIF(p_grade->>'timezone', ''), timezone),
        valid_from = NULLIF(p_grade->>'validFrom', '')::DATE,
        valid_until = NULLIF(p_grade->>'validUntil', '')::DATE,
        status = v_status,
        default_duration_minutes = COALESCE(
          NULLIF(p_grade->>'defaultDurationMinutes', '')::SMALLINT,
          default_duration_minutes
        ),
        default_capacity = COALESCE(
          NULLIF(p_grade->>'defaultCapacity', '')::SMALLINT,
          default_capacity
        ),
        default_room_id = NULLIF(p_grade->>'defaultRoomId', '')::BIGINT,
        default_equipment_id = NULLIF(p_grade->>'defaultEquipmentId', '')::BIGINT,
        generation_window_days = COALESCE(
          NULLIF(p_grade->>'generationWindowDays', '')::SMALLINT,
          generation_window_days
        ),
        updated_by = v_actor,
        updated_at = NOW()
    WHERE id = v_grade_id
    RETURNING * INTO v_grade;
  END IF;

  DELETE FROM public.professional_schedule_rules
  WHERE grade_id = v_grade.id;

  FOR v_rule IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_rules, '[]'::JSONB))
  LOOP
    INSERT INTO public.professional_schedule_rules (
      grade_id, company_id, unit_id, day_of_week, starts_at, ends_at,
      break_starts_at, break_ends_at, service_id, appointment_type_id,
      duration_minutes, capacity, room_id, equipment_id,
      allow_return, allow_walkin, status, created_by, updated_by
    ) VALUES (
      v_grade.id,
      v_grade.company_id,
      v_grade.unit_id,
      NULLIF(v_rule->>'dayOfWeek', '')::SMALLINT,
      NULLIF(v_rule->>'startsAt', '')::TIME,
      NULLIF(v_rule->>'endsAt', '')::TIME,
      NULLIF(v_rule->>'breakStartsAt', '')::TIME,
      NULLIF(v_rule->>'breakEndsAt', '')::TIME,
      NULLIF(v_rule->>'serviceId', '')::BIGINT,
      NULLIF(v_rule->>'appointmentTypeId', '')::BIGINT,
      NULLIF(v_rule->>'durationMinutes', '')::SMALLINT,
      NULLIF(v_rule->>'capacity', '')::SMALLINT,
      NULLIF(v_rule->>'roomId', '')::BIGINT,
      NULLIF(v_rule->>'equipmentId', '')::BIGINT,
      COALESCE((v_rule->>'allowReturn')::BOOLEAN, TRUE),
      COALESCE((v_rule->>'allowWalkin')::BOOLEAN, FALSE),
      COALESCE(NULLIF(v_rule->>'status', ''), 'active'),
      v_actor,
      v_actor
    );
  END LOOP;

  v_response := jsonb_build_object(
    'grade', to_jsonb(v_grade),
    'rules', COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(rule_row) ORDER BY rule_row.day_of_week, rule_row.starts_at)
        FROM public.professional_schedule_rules rule_row
        WHERE rule_row.grade_id = v_grade.id
      ),
      '[]'::JSONB
    )
  );

  IF p_idempotency_key IS NOT NULL THEN
    UPDATE public.professional_schedule_operation_keys
    SET response = v_response,
        completed_at = NOW()
    WHERE company_id = v_company
      AND operation = 'save_grade'
      AND idempotency_key = btrim(p_idempotency_key)
      AND request_hash = v_request_hash;
  END IF;

  RETURN v_response;
END
$fn$;

CREATE OR REPLACE FUNCTION public.m9_add_schedule_exception_secure(
  p_grade_id BIGINT,
  p_exception_date DATE,
  p_exception_type TEXT,
  p_reason TEXT,
  p_is_all_day BOOLEAN DEFAULT FALSE,
  p_starts_at TIME DEFAULT NULL,
  p_ends_at TIME DEFAULT NULL,
  p_duration_minutes SMALLINT DEFAULT NULL,
  p_capacity SMALLINT DEFAULT NULL,
  p_room_id BIGINT DEFAULT NULL,
  p_equipment_id BIGINT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_company UUID := public.audit_current_company_id();
  v_actor UUID := public.audit_current_user_id();
  v_grade public.professional_schedule_grades;
  v_exception public.professional_schedule_exceptions;
  v_affected INTEGER := 0;
  v_request_hash TEXT;
  v_response JSONB;
  v_inserted INTEGER;
  v_existing public.professional_schedule_operation_keys;
BEGIN
  IF v_company IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'M9 authenticated tenant context is required';
  END IF;
  IF p_exception_type NOT IN (
    'unavailable', 'extra_availability', 'resource_override', 'capacity_override'
  ) THEN
    RAISE EXCEPTION 'M9 invalid schedule exception type';
  END IF;

  SELECT * INTO v_grade
  FROM public.professional_schedule_grades
  WHERE id = p_grade_id
  FOR UPDATE;

  IF NOT FOUND OR v_grade.company_id <> v_company THEN
    RAISE EXCEPTION 'M9 schedule grade not found in the active tenant';
  END IF;
  IF NOT public.m9_can_manage_schedule_grade(v_company, v_grade.unit_id) THEN
    RAISE EXCEPTION 'M9 schedule exception management is not authorized';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    IF length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200 THEN
      RAISE EXCEPTION 'M9 idempotency key must contain 8 to 200 characters';
    END IF;
    v_request_hash := encode(
      digest(
        convert_to(
          jsonb_build_object(
            'gradeId', p_grade_id,
            'date', p_exception_date,
            'type', p_exception_type,
            'reason', p_reason,
            'allDay', p_is_all_day,
            'startsAt', p_starts_at,
            'endsAt', p_ends_at,
            'durationMinutes', p_duration_minutes,
            'capacity', p_capacity,
            'roomId', p_room_id,
            'equipmentId', p_equipment_id
          )::TEXT,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    INSERT INTO public.professional_schedule_operation_keys (
      company_id, unit_id, operation, idempotency_key,
      request_hash, actor_user_id
    ) VALUES (
      v_company, v_grade.unit_id, 'add_exception', btrim(p_idempotency_key),
      v_request_hash, v_actor
    )
    ON CONFLICT (company_id, operation, idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted = 0 THEN
      SELECT * INTO v_existing
      FROM public.professional_schedule_operation_keys
      WHERE company_id = v_company
        AND operation = 'add_exception'
        AND idempotency_key = btrim(p_idempotency_key)
      FOR UPDATE;
      IF v_existing.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'M9 idempotency key was already used with another request';
      END IF;
      IF v_existing.response IS NOT NULL THEN
        RETURN v_existing.response;
      END IF;
      RAISE EXCEPTION 'M9 idempotent operation is still pending';
    END IF;
  END IF;

  IF p_exception_type = 'unavailable' THEN
    SELECT COUNT(*)::INTEGER INTO v_affected
    FROM public.appointments appointment
    WHERE appointment.company_id = v_company
      AND appointment.unit_id = v_grade.unit_id
      AND appointment.professional_id = v_grade.professional_id
      AND appointment.appointment_date = p_exception_date
      AND appointment.deleted_at IS NULL
      AND lower(COALESCE(appointment.status, '')) NOT IN (
        'completed', 'realizado', 'cancelled', 'cancelado',
        'no_show', 'no-show', 'noshow', 'rescheduled', 'remarcado'
      )
      AND (
        p_is_all_day
        OR (
          p_starts_at < COALESCE(
            appointment.end_time,
            appointment.start_time + make_interval(
              mins => COALESCE(appointment.duration_minutes, 30)
            )
          )
          AND p_ends_at > appointment.start_time
        )
      );
  END IF;

  INSERT INTO public.professional_schedule_exceptions (
    grade_id, company_id, unit_id, exception_date,
    is_all_day, starts_at, ends_at, exception_type, reason,
    duration_minutes, capacity, room_id, equipment_id,
    affected_appointments_count, requires_reschedule,
    created_by, updated_by
  ) VALUES (
    v_grade.id, v_grade.company_id, v_grade.unit_id, p_exception_date,
    COALESCE(p_is_all_day, FALSE), p_starts_at, p_ends_at,
    p_exception_type, btrim(p_reason),
    p_duration_minutes, p_capacity, p_room_id, p_equipment_id,
    v_affected, v_affected > 0, v_actor, v_actor
  )
  RETURNING * INTO v_exception;

  v_response := to_jsonb(v_exception);
  IF p_idempotency_key IS NOT NULL THEN
    UPDATE public.professional_schedule_operation_keys
    SET response = v_response,
        completed_at = NOW()
    WHERE company_id = v_company
      AND operation = 'add_exception'
      AND idempotency_key = btrim(p_idempotency_key)
      AND request_hash = v_request_hash;
  END IF;
  RETURN v_response;
END
$fn$;

CREATE OR REPLACE FUNCTION public.m9_publish_schedule_grade_secure(
  p_grade_id BIGINT,
  p_action TEXT DEFAULT 'publish',
  p_reason TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_company UUID := public.audit_current_company_id();
  v_actor UUID := public.audit_current_user_id();
  v_grade public.professional_schedule_grades;
  v_status TEXT;
  v_publication_action TEXT;
  v_snapshot JSONB;
  v_request_hash TEXT;
  v_inserted INTEGER;
  v_existing public.professional_schedule_operation_keys;
BEGIN
  IF v_company IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'M9 authenticated tenant context is required';
  END IF;
  IF p_action NOT IN ('publish', 'resume', 'suspend', 'end', 'cancel') THEN
    RAISE EXCEPTION 'M9 invalid schedule grade lifecycle action';
  END IF;

  SELECT * INTO v_grade
  FROM public.professional_schedule_grades
  WHERE id = p_grade_id
  FOR UPDATE;

  IF NOT FOUND OR v_grade.company_id <> v_company THEN
    RAISE EXCEPTION 'M9 schedule grade not found in the active tenant';
  END IF;
  IF NOT public.m9_can_manage_schedule_grade(v_company, v_grade.unit_id) THEN
    RAISE EXCEPTION 'M9 schedule grade publication is not authorized';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    IF length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200 THEN
      RAISE EXCEPTION 'M9 idempotency key must contain 8 to 200 characters';
    END IF;
    v_request_hash := encode(
      digest(
        convert_to(
          jsonb_build_object(
            'gradeId', p_grade_id,
            'action', p_action,
            'reason', p_reason
          )::TEXT,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    INSERT INTO public.professional_schedule_operation_keys (
      company_id, unit_id, operation, idempotency_key,
      request_hash, actor_user_id
    ) VALUES (
      v_company, v_grade.unit_id, 'grade_transition', btrim(p_idempotency_key),
      v_request_hash, v_actor
    )
    ON CONFLICT (company_id, operation, idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted = 0 THEN
      SELECT * INTO v_existing
      FROM public.professional_schedule_operation_keys
      WHERE company_id = v_company
        AND operation = 'grade_transition'
        AND idempotency_key = btrim(p_idempotency_key)
      FOR UPDATE;
      IF v_existing.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'M9 idempotency key was already used with another request';
      END IF;
      IF v_existing.response IS NOT NULL THEN
        RETURN v_existing.response;
      END IF;
      RAISE EXCEPTION 'M9 idempotent operation is still pending';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'm9-publish:' || v_grade.company_id::TEXT || ':' ||
      v_grade.unit_id::TEXT || ':' || v_grade.professional_id::TEXT,
      0
    )
  );

  IF p_action IN ('publish', 'resume') THEN
    IF p_action = 'publish'
       AND v_grade.status NOT IN ('draft', 'pending_validation') THEN
      RAISE EXCEPTION 'M9 only draft grades can be published';
    END IF;
    IF p_action = 'resume' AND v_grade.status <> 'suspended' THEN
      RAISE EXCEPTION 'M9 only suspended grades can be resumed';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.professional_schedule_rules rule_row
      WHERE rule_row.grade_id = v_grade.id
        AND rule_row.status = 'active'
    ) THEN
      RAISE EXCEPTION 'M9 grade requires at least one active recurring rule';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.professional_schedule_grades other_grade
      JOIN public.professional_schedule_rules other_rule
        ON other_rule.grade_id = other_grade.id
       AND other_rule.status = 'active'
      JOIN public.professional_schedule_rules current_rule
        ON current_rule.grade_id = v_grade.id
       AND current_rule.status = 'active'
       AND current_rule.day_of_week = other_rule.day_of_week
       AND current_rule.starts_at < other_rule.ends_at
       AND current_rule.ends_at > other_rule.starts_at
      WHERE other_grade.id <> v_grade.id
        AND other_grade.company_id = v_grade.company_id
        AND other_grade.unit_id = v_grade.unit_id
        AND other_grade.professional_id = v_grade.professional_id
        AND other_grade.status IN ('published', 'active')
        AND other_grade.valid_from <= COALESCE(v_grade.valid_until, 'infinity'::DATE)
        AND (
          other_grade.valid_until IS NULL
          OR other_grade.valid_until >= v_grade.valid_from
        )
    ) THEN
      RAISE EXCEPTION 'M9 grade conflicts with another published grade';
    END IF;

    v_status := CASE
      WHEN v_grade.valid_from <= CURRENT_DATE
       AND (v_grade.valid_until IS NULL OR v_grade.valid_until >= CURRENT_DATE)
        THEN 'active'
      ELSE 'published'
    END;
    v_publication_action := CASE
      WHEN p_action = 'resume' THEN 'resumed'
      ELSE 'published'
    END;
  ELSIF p_action = 'suspend' THEN
    IF v_grade.status NOT IN ('published', 'active') THEN
      RAISE EXCEPTION 'M9 only a published grade can be suspended';
    END IF;
    v_status := 'suspended';
    v_publication_action := 'suspended';
  ELSIF p_action = 'end' THEN
    IF v_grade.status NOT IN ('published', 'active', 'suspended') THEN
      RAISE EXCEPTION 'M9 only a released grade can be ended';
    END IF;
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'M9 end reason is required';
    END IF;
    v_status := 'ended';
    v_publication_action := 'ended';
  ELSE
    IF v_grade.status NOT IN ('draft', 'pending_validation') THEN
      RAISE EXCEPTION 'M9 only a draft grade can be cancelled';
    END IF;
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'M9 cancellation reason is required';
    END IF;
    v_status := 'cancelled';
    v_publication_action := 'cancelled';
  END IF;

  PERFORM set_config('prontomedic.m9_grade_transition', 'allowed', TRUE);
  UPDATE public.professional_schedule_grades
  SET status = v_status,
      published_at = CASE
        WHEN p_action IN ('publish', 'resume') THEN NOW()
        ELSE published_at
      END,
      published_by = CASE
        WHEN p_action IN ('publish', 'resume') THEN v_actor
        ELSE published_by
      END,
      suspended_at = CASE WHEN p_action = 'suspend' THEN NOW() ELSE NULL END,
      suspended_by = CASE WHEN p_action = 'suspend' THEN v_actor ELSE NULL END,
      updated_by = v_actor,
      updated_at = NOW()
  WHERE id = v_grade.id
  RETURNING * INTO v_grade;

  v_snapshot := jsonb_build_object(
    'grade', to_jsonb(v_grade),
    'rules', COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(rule_row) ORDER BY rule_row.day_of_week, rule_row.starts_at)
        FROM public.professional_schedule_rules rule_row
        WHERE rule_row.grade_id = v_grade.id
      ),
      '[]'::JSONB
    ),
    'exceptions', COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(exception_row) ORDER BY exception_row.exception_date, exception_row.starts_at)
        FROM public.professional_schedule_exceptions exception_row
        WHERE exception_row.grade_id = v_grade.id
      ),
      '[]'::JSONB
    )
  );

  INSERT INTO public.professional_schedule_publications (
    grade_id, company_id, unit_id, version, action,
    reason, snapshot, actor_user_id
  ) VALUES (
    v_grade.id, v_grade.company_id, v_grade.unit_id, v_grade.version,
    v_publication_action, NULLIF(btrim(COALESCE(p_reason, '')), ''),
    v_snapshot, v_actor
  );

  IF p_idempotency_key IS NOT NULL THEN
    UPDATE public.professional_schedule_operation_keys
    SET response = v_snapshot,
        completed_at = NOW()
    WHERE company_id = v_company
      AND operation = 'grade_transition'
      AND idempotency_key = btrim(p_idempotency_key)
      AND request_hash = v_request_hash;
  END IF;

  RETURN v_snapshot;
END
$fn$;

CREATE OR REPLACE FUNCTION public.m9_get_professional_schedule_windows_secure(
  p_professional_id BIGINT,
  p_unit_id INTEGER,
  p_date DATE,
  p_service_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_company UUID := public.audit_current_company_id();
  v_actor UUID := public.audit_current_user_id();
BEGIN
  IF v_company IS NULL OR v_actor IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE (
      profile.id = v_actor
      OR profile.user_id = v_actor
    )
      AND profile.company_id = v_company
      AND profile.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'M9 authenticated active profile is required';
  END IF;
  IF NOT public.org_can_access_unit(v_company, p_unit_id) THEN
    RAISE EXCEPTION 'M9 schedule unit is not authorized';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.professionals professional
    WHERE professional.id = p_professional_id
      AND professional.company_id = v_company
      AND professional.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'M9 professional is outside the active tenant';
  END IF;

  RETURN (
  WITH context AS (
    SELECT v_company AS company_id
  ),
  regular_windows AS (
    SELECT
      grade.id AS grade_id,
      rule_row.id AS rule_id,
      grade.company_id,
      grade.unit_id,
      grade.professional_id,
      p_date AS schedule_date,
      rule_row.starts_at,
      rule_row.ends_at,
      rule_row.break_starts_at,
      rule_row.break_ends_at,
      COALESCE(override_row.duration_minutes, rule_row.duration_minutes, grade.default_duration_minutes)
        AS duration_minutes,
      COALESCE(override_row.capacity, rule_row.capacity, grade.default_capacity)
        AS capacity,
      COALESCE(override_row.room_id, rule_row.room_id, grade.default_room_id)
        AS room_id,
      COALESCE(override_row.equipment_id, rule_row.equipment_id, grade.default_equipment_id)
        AS equipment_id,
      rule_row.service_id,
      rule_row.appointment_type_id,
      rule_row.allow_return,
      rule_row.allow_walkin,
      FALSE AS is_exception
    FROM context
    JOIN public.professional_schedule_grades grade
      ON grade.company_id = context.company_id
     AND grade.unit_id = p_unit_id
     AND grade.professional_id = p_professional_id
     AND grade.status IN ('published', 'active')
     AND grade.valid_from <= p_date
     AND (grade.valid_until IS NULL OR grade.valid_until >= p_date)
    JOIN public.professional_schedule_rules rule_row
      ON rule_row.grade_id = grade.id
     AND rule_row.status = 'active'
     AND rule_row.day_of_week = EXTRACT(DOW FROM p_date)::SMALLINT
     AND (
       p_service_id IS NULL
       OR rule_row.service_id IS NULL
       OR rule_row.service_id = p_service_id
     )
    LEFT JOIN LATERAL (
      SELECT exception_row.*
      FROM public.professional_schedule_exceptions exception_row
      WHERE exception_row.grade_id = grade.id
        AND exception_row.exception_date = p_date
        AND exception_row.status = 'active'
        AND exception_row.exception_type IN ('resource_override', 'capacity_override')
        AND (
          exception_row.is_all_day
          OR (
            exception_row.starts_at < rule_row.ends_at
            AND exception_row.ends_at > rule_row.starts_at
          )
        )
      ORDER BY exception_row.created_at DESC
      LIMIT 1
    ) override_row ON TRUE
    WHERE public.org_can_access_unit(grade.company_id, grade.unit_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.professional_schedule_exceptions unavailable
        WHERE unavailable.grade_id = grade.id
          AND unavailable.exception_date = p_date
          AND unavailable.status = 'active'
          AND unavailable.exception_type = 'unavailable'
          AND (
            unavailable.is_all_day
            OR (
              unavailable.starts_at < rule_row.ends_at
              AND unavailable.ends_at > rule_row.starts_at
            )
          )
      )
  ),
  extra_windows AS (
    SELECT
      grade.id AS grade_id,
      NULL::BIGINT AS rule_id,
      grade.company_id,
      grade.unit_id,
      grade.professional_id,
      exception_row.exception_date AS schedule_date,
      exception_row.starts_at,
      exception_row.ends_at,
      NULL::TIME AS break_starts_at,
      NULL::TIME AS break_ends_at,
      COALESCE(exception_row.duration_minutes, grade.default_duration_minutes)
        AS duration_minutes,
      COALESCE(exception_row.capacity, grade.default_capacity) AS capacity,
      COALESCE(exception_row.room_id, grade.default_room_id) AS room_id,
      COALESCE(exception_row.equipment_id, grade.default_equipment_id) AS equipment_id,
      p_service_id AS service_id,
      NULL::BIGINT AS appointment_type_id,
      TRUE AS allow_return,
      FALSE AS allow_walkin,
      TRUE AS is_exception
    FROM context
    JOIN public.professional_schedule_grades grade
      ON grade.company_id = context.company_id
     AND grade.unit_id = p_unit_id
     AND grade.professional_id = p_professional_id
     AND grade.status IN ('published', 'active')
     AND grade.valid_from <= p_date
     AND (grade.valid_until IS NULL OR grade.valid_until >= p_date)
    JOIN public.professional_schedule_exceptions exception_row
      ON exception_row.grade_id = grade.id
     AND exception_row.exception_date = p_date
     AND exception_row.status = 'active'
     AND exception_row.exception_type = 'extra_availability'
    WHERE public.org_can_access_unit(grade.company_id, grade.unit_id)
  ),
  windows AS (
    SELECT * FROM regular_windows
    UNION ALL
    SELECT * FROM extra_windows
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'gradeId', grade_id,
        'ruleId', rule_id,
        'companyId', company_id,
        'unitId', unit_id,
        'professionalId', professional_id,
        'date', schedule_date,
        'startsAt', starts_at,
        'endsAt', ends_at,
        'breakStartsAt', break_starts_at,
        'breakEndsAt', break_ends_at,
        'durationMinutes', duration_minutes,
        'capacity', capacity,
        'roomId', room_id,
        'equipmentId', equipment_id,
        'serviceId', service_id,
        'appointmentTypeId', appointment_type_id,
        'allowReturn', allow_return,
        'allowWalkin', allow_walkin,
        'isException', is_exception
      )
      ORDER BY starts_at, ends_at
    ),
    '[]'::JSONB
  )
  FROM windows
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.get_professional_available_slots(
  p_professional_id BIGINT,
  p_date DATE,
  p_duration_minutes INTEGER DEFAULT 30,
  p_unit_id INTEGER DEFAULT NULL
)
RETURNS TABLE (
  start_time TIME,
  end_time TIME,
  unit_id INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
  WITH selected_units AS (
    SELECT DISTINCT grade.unit_id
    FROM public.professional_schedule_grades grade
    WHERE grade.company_id = public.audit_current_company_id()
      AND grade.professional_id = p_professional_id
      AND grade.status IN ('published', 'active')
      AND grade.valid_from <= p_date
      AND (grade.valid_until IS NULL OR grade.valid_until >= p_date)
      AND (p_unit_id IS NULL OR grade.unit_id = p_unit_id)
      AND public.org_can_access_unit(grade.company_id, grade.unit_id)
  ),
  windows AS (
    SELECT
      window_row."unitId" AS unit_id,
      window_row."startsAt" AS starts_at,
      window_row."endsAt" AS ends_at,
      window_row."breakStartsAt" AS break_starts_at,
      window_row."breakEndsAt" AS break_ends_at,
      GREATEST(
        5,
        COALESCE(NULLIF(p_duration_minutes, 0), window_row."durationMinutes", 30)
      )::INTEGER AS duration_minutes,
      GREATEST(1, COALESCE(window_row.capacity, 1))::INTEGER AS capacity,
      window_row."roomId" AS room_id,
      window_row."equipmentId" AS equipment_id
    FROM selected_units selected
    CROSS JOIN LATERAL jsonb_to_recordset(
      public.m9_get_professional_schedule_windows_secure(
        p_professional_id,
        selected.unit_id,
        p_date,
        NULL
      )
    ) AS window_row(
      "unitId" INTEGER,
      "startsAt" TIME,
      "endsAt" TIME,
      "breakStartsAt" TIME,
      "breakEndsAt" TIME,
      "durationMinutes" INTEGER,
      capacity INTEGER,
      "roomId" BIGINT,
      "equipmentId" BIGINT
    )
  ),
  weekday AS (
    SELECT (
      ARRAY[
        'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
        'quinta-feira', 'sexta-feira', 'sábado'
      ]
    )[EXTRACT(DOW FROM p_date)::INTEGER + 1] AS name
  ),
  legacy_windows AS (
    SELECT
      legacy_slot.unit_id,
      public.scheduling_hhmm_to_time(legacy_slot.starts_hhmm) AS starts_at,
      public.scheduling_hhmm_to_time(legacy_slot.ends_hhmm) AS ends_at,
      NULL::TIME AS break_starts_at,
      NULL::TIME AS break_ends_at,
      GREATEST(
        5,
        COALESCE(NULLIF(p_duration_minutes, 0), NULLIF(legacy_slot.duration_minutes, 0), 30)
      )::INTEGER AS duration_minutes,
      1::INTEGER AS capacity,
      NULL::BIGINT AS room_id,
      NULL::BIGINT AS equipment_id
    FROM public.professional_schedules legacy_schedule
    CROSS JOIN weekday
    CROSS JOIN LATERAL (
      VALUES
        (
          legacy_schedule.slot1_start,
          legacy_schedule.slot1_end,
          legacy_schedule.slot1_duration,
          legacy_schedule.slot1_unit_id
        ),
        (
          legacy_schedule.slot2_start,
          legacy_schedule.slot2_end,
          legacy_schedule.slot2_duration,
          legacy_schedule.slot2_unit_id
        ),
        (
          legacy_schedule.slot3_start,
          legacy_schedule.slot3_end,
          legacy_schedule.slot3_duration,
          legacy_schedule.slot3_unit_id
        )
    ) AS legacy_slot(starts_hhmm, ends_hhmm, duration_minutes, unit_id)
    WHERE NOT EXISTS (SELECT 1 FROM windows)
      AND public.can_access('agenda', 'view')
      AND legacy_schedule.company_id = public.active_company_id()
      AND legacy_schedule.professional_id = p_professional_id
      AND legacy_schedule.lg_habilitado IS TRUE
      AND lower(legacy_schedule.day_of_week) = weekday.name
      AND legacy_slot.starts_hhmm IS NOT NULL
      AND legacy_slot.ends_hhmm IS NOT NULL
      AND legacy_slot.unit_id = public.active_unit_id()
      AND (p_unit_id IS NULL OR legacy_slot.unit_id = p_unit_id)
  ),
  available_windows AS (
    SELECT * FROM windows
    UNION ALL
    SELECT * FROM legacy_windows
  ),
  candidate_slots AS (
    SELECT
      window_row.*,
      generated_slot.slot_start,
      generated_slot.slot_start
        + make_interval(mins => window_row.duration_minutes) AS slot_end
    FROM available_windows window_row
    CROSS JOIN LATERAL generate_series(
      p_date + window_row.starts_at,
      p_date + window_row.ends_at
        - make_interval(mins => window_row.duration_minutes),
      make_interval(mins => window_row.duration_minutes)
    ) AS generated_slot(slot_start)
    WHERE window_row.ends_at > window_row.starts_at
      AND window_row.duration_minutes BETWEEN 5 AND 1440
  )
  SELECT
    slot.slot_start::TIME AS start_time,
    slot.slot_end::TIME AS end_time,
    slot.unit_id
  FROM candidate_slots slot
  WHERE NOT (
      slot.break_starts_at IS NOT NULL
      AND slot.break_ends_at IS NOT NULL
      AND slot.slot_start::TIME < slot.break_ends_at
      AND slot.slot_end::TIME > slot.break_starts_at
    )
    AND (
      SELECT COUNT(*)
      FROM public.appointments appointment
      WHERE appointment.company_id = public.audit_current_company_id()
        AND appointment.professional_id = p_professional_id
        AND appointment.unit_id = slot.unit_id
        AND appointment.appointment_date = p_date
        AND appointment.status NOT IN ('cancelled', 'no_show')
        AND appointment.start_time < slot.slot_end::TIME
        AND COALESCE(
          appointment.end_time,
          appointment.start_time
            + make_interval(mins => COALESCE(appointment.duration_minutes, 30))
        ) > slot.slot_start::TIME
    ) < slot.capacity
    AND NOT EXISTS (
      SELECT 1
      FROM public.scheduling_blocks schedule_block
      WHERE schedule_block.company_id = public.audit_current_company_id()
        AND schedule_block.status = 'active'
        AND (
          schedule_block.professional_id IS NULL
          OR schedule_block.professional_id = p_professional_id
        )
        AND (
          schedule_block.unit_id IS NULL
          OR schedule_block.unit_id = slot.unit_id
        )
        AND schedule_block.starts_at < slot.slot_end
        AND schedule_block.ends_at > slot.slot_start
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.appointments resource_appointment
      WHERE resource_appointment.company_id = public.audit_current_company_id()
        AND resource_appointment.unit_id = slot.unit_id
        AND resource_appointment.appointment_date = p_date
        AND resource_appointment.status NOT IN ('cancelled', 'no_show')
        AND resource_appointment.start_time < slot.slot_end::TIME
        AND COALESCE(
          resource_appointment.end_time,
          resource_appointment.start_time
            + make_interval(mins => COALESCE(resource_appointment.duration_minutes, 30))
        ) > slot.slot_start::TIME
        AND (
          (slot.room_id IS NOT NULL AND resource_appointment.room_id = slot.room_id)
          OR (
            slot.equipment_id IS NOT NULL
            AND resource_appointment.equipment_id = slot.equipment_id
          )
        )
    )
  ORDER BY slot.unit_id, slot.slot_start;
$fn$;

REVOKE ALL ON FUNCTION public.m9_save_professional_schedule_grade_secure(JSONB, JSONB, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m9_add_schedule_exception_secure(
  BIGINT, DATE, TEXT, TEXT, BOOLEAN, TIME, TIME,
  SMALLINT, SMALLINT, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m9_publish_schedule_grade_secure(BIGINT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m9_get_professional_schedule_windows_secure(
  BIGINT, INTEGER, DATE, BIGINT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_professional_available_slots(
  BIGINT, DATE, INTEGER, INTEGER
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.m9_save_professional_schedule_grade_secure(JSONB, JSONB, TEXT)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m9_add_schedule_exception_secure(
  BIGINT, DATE, TEXT, TEXT, BOOLEAN, TIME, TIME,
  SMALLINT, SMALLINT, BIGINT, BIGINT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m9_publish_schedule_grade_secure(BIGINT, TEXT, TEXT, TEXT)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m9_get_professional_schedule_windows_secure(
  BIGINT, INTEGER, DATE, BIGINT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.get_professional_available_slots(
  BIGINT, DATE, INTEGER, INTEGER
) TO authenticated, app_prontomedic;

COMMENT ON FUNCTION public.m9_save_professional_schedule_grade_secure(JSONB, JSONB, TEXT) IS
  'M9 atomically creates or updates a draft grade and replaces its recurring rules.';
COMMENT ON FUNCTION public.m9_add_schedule_exception_secure(
  BIGINT, DATE, TEXT, TEXT, BOOLEAN, TIME, TIME,
  SMALLINT, SMALLINT, BIGINT, BIGINT, TEXT
) IS
  'M9 adds a dated exception and reports affected appointments without deleting them.';
COMMENT ON FUNCTION public.m9_publish_schedule_grade_secure(BIGINT, TEXT, TEXT, TEXT) IS
  'M9 validates recurring conflicts and records an immutable publication snapshot.';
COMMENT ON FUNCTION public.m9_get_professional_schedule_windows_secure(
  BIGINT, INTEGER, DATE, BIGINT
) IS
  'M9 resolves published recurring windows and dated exceptions for an authorized unit.';

DO $ledger$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES (
      '20260725090000_module9_professional_schedule_grades.sql',
      NOW()
    )
    ON CONFLICT (filename) DO NOTHING;
  END IF;
END
$ledger$;

COMMIT;

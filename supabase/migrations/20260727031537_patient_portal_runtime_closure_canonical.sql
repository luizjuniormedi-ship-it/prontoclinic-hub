-- Patient portal runtime closure rebased on the canonical scheduling baseline.
-- The public API exposes only patient-facing DTOs. Mutations keep JWT claims
-- intact and use a private, transaction-bound context recognized by can_access.

BEGIN;

DO $preflight$
BEGIN
  IF to_regrole('authenticated') IS NULL
     OR to_regrole('anon') IS NULL
     OR to_regrole('app_prontomedic') IS NULL THEN
    RAISE EXCEPTION 'PATIENT_PORTAL_PREFLIGHT: runtime roles are missing';
  END IF;

  IF to_regnamespace('private') IS NULL
     OR to_regnamespace('auth') IS NULL THEN
    RAISE EXCEPTION 'PATIENT_PORTAL_PREFLIGHT: required schemas are missing';
  END IF;

  IF to_regclass('public.patients') IS NULL
     OR to_regclass('public.appointments') IS NULL
     OR to_regclass('public.professionals') IS NULL
     OR to_regclass('public.units') IS NULL
     OR to_regclass('public.professional_schedules') IS NULL
     OR to_regclass('public.scheduling_reschedules') IS NULL
     OR to_regclass('public.scheduling_status_history') IS NULL THEN
    RAISE EXCEPTION 'PATIENT_PORTAL_PREFLIGHT: canonical scheduling tables are missing';
  END IF;

  IF to_regprocedure('public.get_professional_available_slots(bigint,date,integer,integer)') IS NULL
     OR to_regprocedure('public.assert_appointment_slot_available(bigint,date,time without time zone,time without time zone,bigint)') IS NULL
     OR to_regprocedure('public.get_scheduling_actor()') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL
     OR to_regprocedure('public.scheduling_hhmm_to_time(integer)') IS NULL
     OR to_regprocedure('public.can_access(text,text)') IS NULL THEN
    RAISE EXCEPTION 'PATIENT_PORTAL_PREFLIGHT: canonical functions are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns expected
    WHERE (expected.table_schema, expected.table_name, expected.column_name) IN (
      ('public', 'patients', 'company_id'),
      ('public', 'patients', 'lg_ativo'),
      ('public', 'appointments', 'company_id'),
      ('public', 'appointments', 'unit_id'),
      ('public', 'appointments', 'patient_id'),
      ('public', 'appointments', 'professional_id'),
      ('public', 'appointments', 'appointment_date'),
      ('public', 'appointments', 'start_time'),
      ('public', 'appointments', 'end_time'),
      ('public', 'appointments', 'duration_minutes'),
      ('public', 'appointments', 'status'),
      ('public', 'professional_schedules', 'day_of_week')
    )
    HAVING count(*) <> 12
  ) THEN
    RAISE EXCEPTION 'PATIENT_PORTAL_PREFLIGHT: canonical columns are missing';
  END IF;
END
$preflight$;

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS user_id UUID;

DO $role$
DECLARE
  v_membership RECORD;
BEGIN
  IF to_regrole('prontomedic_patient_portal_rpc_owner') IS NULL THEN
    CREATE ROLE prontomedic_patient_portal_rpc_owner;
  END IF;

  FOR v_membership IN
    SELECT granted_role.rolname AS granted_role
    FROM pg_auth_members membership
    JOIN pg_roles granted_role
      ON granted_role.oid = membership.roleid
    WHERE membership.member =
      to_regrole('prontomedic_patient_portal_rpc_owner')::OID
  LOOP
    EXECUTE format(
      'REVOKE %I FROM prontomedic_patient_portal_rpc_owner',
      v_membership.granted_role
    );
  END LOOP;
END
$role$;

ALTER ROLE prontomedic_patient_portal_rpc_owner
  NOLOGIN
  NOINHERIT
  NOBYPASSRLS
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION;

CREATE TABLE IF NOT EXISTS private.patient_portal_mutation_context (
  backend_pid INTEGER NOT NULL,
  transaction_id BIGINT NOT NULL,
  token UUID NOT NULL,
  user_id UUID NOT NULL,
  company_id UUID NOT NULL,
  patient_id BIGINT NOT NULL,
  appointment_id BIGINT NOT NULL,
  operation TEXT NOT NULL CHECK (
    operation IN ('confirm', 'cancel', 'reschedule')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (backend_pid, transaction_id, token)
);

ALTER TABLE private.patient_portal_mutation_context OWNER TO postgres;
REVOKE ALL ON private.patient_portal_mutation_context
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT SELECT, INSERT, DELETE
  ON private.patient_portal_mutation_context
  TO prontomedic_patient_portal_rpc_owner;

CREATE INDEX IF NOT EXISTS patients_company_user_portal_idx
  ON public.patients(company_id, user_id)
  WHERE user_id IS NOT NULL AND lg_ativo IS TRUE;

CREATE INDEX IF NOT EXISTS appointments_company_patient_portal_idx
  ON public.appointments(
    company_id,
    patient_id,
    appointment_date DESC,
    start_time DESC
  );

GRANT USAGE ON SCHEMA public, private, auth
  TO prontomedic_patient_portal_rpc_owner;
GRANT SELECT ON
  public.patients,
  public.appointments,
  public.professionals,
  public.units,
  public.professional_schedules
TO prontomedic_patient_portal_rpc_owner;
GRANT UPDATE ON public.appointments
  TO prontomedic_patient_portal_rpc_owner;
GRANT INSERT ON
  public.scheduling_reschedules,
  public.scheduling_status_history
TO prontomedic_patient_portal_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.scheduling_reschedules_id_seq
  TO prontomedic_patient_portal_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.scheduling_status_history_id_seq
  TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid()
  TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION public.get_scheduling_actor()
  TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION public.get_professional_available_slots(
  BIGINT,
  DATE,
  INTEGER,
  INTEGER
) TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION public.assert_appointment_slot_available(
  BIGINT,
  DATE,
  TIME,
  TIME,
  BIGINT
) TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION public.scheduling_hhmm_to_time(INTEGER)
  TO prontomedic_patient_portal_rpc_owner;

DROP POLICY IF EXISTS patient_portal_owner_patient_read
  ON public.patients;
CREATE POLICY patient_portal_owner_patient_read
  ON public.patients
  FOR SELECT
  TO prontomedic_patient_portal_rpc_owner
  USING (
    company_id = NULLIF(
      current_setting('app.patient_portal.company_id', TRUE),
      ''
    )::UUID
    AND user_id = auth.uid()
    AND lg_ativo IS TRUE
  );

DROP POLICY IF EXISTS patient_portal_owner_appointment_read
  ON public.appointments;
CREATE POLICY patient_portal_owner_appointment_read
  ON public.appointments
  FOR SELECT
  TO prontomedic_patient_portal_rpc_owner
  USING (
    company_id = NULLIF(
      current_setting('app.patient_portal.company_id', TRUE),
      ''
    )::UUID
    AND patient_id = NULLIF(
      current_setting('app.patient_portal.patient_id', TRUE),
      ''
    )::BIGINT
  );

DROP POLICY IF EXISTS patient_portal_owner_appointment_update
  ON public.appointments;
CREATE POLICY patient_portal_owner_appointment_update
  ON public.appointments
  FOR UPDATE
  TO prontomedic_patient_portal_rpc_owner
  USING (
    company_id = NULLIF(
      current_setting('app.patient_portal.company_id', TRUE),
      ''
    )::UUID
    AND patient_id = NULLIF(
      current_setting('app.patient_portal.patient_id', TRUE),
      ''
    )::BIGINT
  )
  WITH CHECK (
    company_id = NULLIF(
      current_setting('app.patient_portal.company_id', TRUE),
      ''
    )::UUID
    AND patient_id = NULLIF(
      current_setting('app.patient_portal.patient_id', TRUE),
      ''
    )::BIGINT
  );

DROP POLICY IF EXISTS patient_portal_owner_professional_read
  ON public.professionals;
CREATE POLICY patient_portal_owner_professional_read
  ON public.professionals
  FOR SELECT
  TO prontomedic_patient_portal_rpc_owner
  USING (
    company_id = NULLIF(
      current_setting('app.patient_portal.company_id', TRUE),
      ''
    )::UUID
  );

DROP POLICY IF EXISTS patient_portal_owner_unit_read
  ON public.units;
CREATE POLICY patient_portal_owner_unit_read
  ON public.units
  FOR SELECT
  TO prontomedic_patient_portal_rpc_owner
  USING (
    company_id = NULLIF(
      current_setting('app.patient_portal.company_id', TRUE),
      ''
    )::UUID
  );

DROP POLICY IF EXISTS patient_portal_owner_schedule_read
  ON public.professional_schedules;
CREATE POLICY patient_portal_owner_schedule_read
  ON public.professional_schedules
  FOR SELECT
  TO prontomedic_patient_portal_rpc_owner
  USING (
    company_id = NULLIF(
      current_setting('app.patient_portal.company_id', TRUE),
      ''
    )::UUID
    AND lg_habilitado IS TRUE
  );

DROP POLICY IF EXISTS patient_portal_owner_reschedule_insert
  ON public.scheduling_reschedules;
CREATE POLICY patient_portal_owner_reschedule_insert
  ON public.scheduling_reschedules
  FOR INSERT
  TO prontomedic_patient_portal_rpc_owner
  WITH CHECK (
    company_id = NULLIF(
      current_setting('app.patient_portal.company_id', TRUE),
      ''
    )::UUID
    AND appointment_id IN (
      SELECT appointment.id
      FROM public.appointments appointment
      WHERE appointment.company_id = NULLIF(
        current_setting('app.patient_portal.company_id', TRUE),
        ''
      )::UUID
        AND appointment.patient_id = NULLIF(
          current_setting('app.patient_portal.patient_id', TRUE),
          ''
        )::BIGINT
    )
  );

DROP POLICY IF EXISTS patient_portal_owner_status_history_insert
  ON public.scheduling_status_history;
CREATE POLICY patient_portal_owner_status_history_insert
  ON public.scheduling_status_history
  FOR INSERT
  TO prontomedic_patient_portal_rpc_owner
  WITH CHECK (
    company_id = NULLIF(
      current_setting('app.patient_portal.company_id', TRUE),
      ''
    )::UUID
    AND appointment_id IN (
      SELECT appointment.id
      FROM public.appointments appointment
      WHERE appointment.company_id = NULLIF(
        current_setting('app.patient_portal.company_id', TRUE),
        ''
      )::UUID
        AND appointment.patient_id = NULLIF(
          current_setting('app.patient_portal.patient_id', TRUE),
          ''
        )::BIGINT
    )
  );

CREATE OR REPLACE FUNCTION public.can_access(
  p_module TEXT,
  p_action TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
SET row_security = off
AS $function$
  SELECT COALESCE(
    (
      lower(trim(p_module)) IN ('appointments', 'agenda')
      AND lower(trim(p_action)) IN ('edit', 'update')
      AND EXISTS (
        SELECT 1
        FROM private.patient_portal_mutation_context mutation_context
        JOIN public.patients patient
          ON patient.id = mutation_context.patient_id
         AND patient.company_id = mutation_context.company_id
         AND patient.user_id = mutation_context.user_id
         AND patient.lg_ativo IS TRUE
        WHERE mutation_context.backend_pid = pg_backend_pid()
          AND mutation_context.transaction_id = txid_current()
          AND mutation_context.token::TEXT = NULLIF(
            current_setting(
              'app.patient_portal.mutation_token',
              TRUE
            ),
            ''
          )
          AND mutation_context.operation = NULLIF(
            current_setting(
              'app.patient_portal.mutation_operation',
              TRUE
            ),
            ''
          )
          AND mutation_context.user_id = auth.uid()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_access_context access_context
      JOIN public.memberships membership
        ON membership.id = access_context.membership_id
       AND membership.user_id = access_context.user_id
       AND membership.status = 'active'
      JOIN public.membership_roles membership_role
        ON membership_role.membership_id = access_context.membership_id
       AND membership_role.role_id = access_context.role_id
      LEFT JOIN public.membership_units membership_unit
        ON membership_unit.membership_id = access_context.membership_id
       AND membership_unit.unit_id = access_context.unit_id
      LEFT JOIN public.units unit_record
        ON unit_record.id = access_context.unit_id
       AND unit_record.company_id = membership.company_id
       AND unit_record.lg_ativo = TRUE
      JOIN public.roles role_record
        ON role_record.id = access_context.role_id
       AND role_record.lg_ativo = TRUE
      JOIN public.role_permissions permission_record
        ON permission_record.company_id = membership.company_id
       AND permission_record.role_id = access_context.role_id
       AND lower(permission_record.module) = lower(trim(p_module))
      WHERE access_context.user_id = auth.uid()
        AND access_context.session_id =
          NULLIF(auth.jwt()->>'session_id', '')::UUID
        AND public.request_aal() = 'aal2'
        AND (
          (
            access_context.unit_id IS NULL
            AND lower(role_record.name) IN (
              'admin',
              'administrador',
              'gestor',
              'financeiro',
              'auditor',
              'dpo',
              'superadmin',
              'super_admin'
            )
          )
          OR (
            membership_unit.unit_id IS NOT NULL
            AND unit_record.id IS NOT NULL
          )
        )
        AND CASE lower(trim(p_action))
          WHEN 'view' THEN permission_record.can_view
          WHEN 'read' THEN permission_record.can_view
          WHEN 'select' THEN permission_record.can_view
          WHEN 'create' THEN permission_record.can_create
          WHEN 'insert' THEN permission_record.can_create
          WHEN 'edit' THEN permission_record.can_edit
          WHEN 'update' THEN permission_record.can_edit
          WHEN 'delete' THEN permission_record.can_delete
          WHEN 'export' THEN permission_record.can_export
          ELSE FALSE
        END
    ),
    FALSE
  );
$function$;

ALTER FUNCTION public.can_access(TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_access(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION private.resolve_authenticated_patient_context()
RETURNS TABLE (
  user_id UUID,
  company_id UUID,
  patient_id BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_actor RECORD;
  v_company_id UUID;
  v_patient_ids BIGINT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'JWT válido obrigatório' USING ERRCODE = '28000';
  END IF;

  SELECT *
    INTO v_actor
    FROM public.get_scheduling_actor();

  v_company_id := public.current_company_id();
  IF v_actor.user_id IS NULL
     OR v_actor.company_id IS NULL
     OR v_company_id IS NULL
     OR v_actor.company_id IS DISTINCT FROM v_company_id
     OR lower(COALESCE(v_actor.role_name, '')) NOT IN (
       'patient',
       'paciente'
     ) THEN
    RAISE EXCEPTION 'Conta sem contexto ativo de paciente'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config(
    'app.patient_portal.company_id',
    v_company_id::TEXT,
    TRUE
  );

  SELECT array_agg(patient.id ORDER BY patient.id)
    INTO v_patient_ids
    FROM public.patients patient
   WHERE patient.company_id = v_company_id
     AND patient.user_id = v_actor.user_id
     AND patient.lg_ativo IS TRUE;

  IF COALESCE(cardinality(v_patient_ids), 0) <> 1 THEN
    RAISE EXCEPTION
      'Conta deve possuir exatamente um vínculo ativo com paciente'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config(
    'app.patient_portal.patient_id',
    v_patient_ids[1]::TEXT,
    TRUE
  );

  RETURN QUERY
  SELECT v_actor.user_id, v_company_id, v_patient_ids[1];
END;
$function$;

CREATE OR REPLACE FUNCTION private.apply_patient_portal_appointment_mutation(
  p_user_id UUID,
  p_company_id UUID,
  p_patient_id BIGINT,
  p_appointment_id BIGINT,
  p_operation TEXT,
  p_new_appointment_date DATE DEFAULT NULL,
  p_new_start_time TIME DEFAULT NULL,
  p_new_end_time TIME DEFAULT NULL,
  p_duration_minutes INTEGER DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private
AS $function$
DECLARE
  v_token UUID := gen_random_uuid();
  v_old public.appointments;
  v_row public.appointments;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id
     OR p_company_id IS DISTINCT FROM NULLIF(
       current_setting('app.patient_portal.company_id', TRUE),
       ''
     )::UUID
     OR p_patient_id IS DISTINCT FROM NULLIF(
       current_setting('app.patient_portal.patient_id', TRUE),
       ''
     )::BIGINT
     OR p_operation NOT IN ('confirm', 'cancel', 'reschedule') THEN
    RAISE EXCEPTION 'Contexto de mutação do portal inválido'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_old
    FROM public.appointments appointment
   WHERE appointment.id = p_appointment_id
     AND appointment.company_id = p_company_id
     AND appointment.patient_id = p_patient_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado no portal do paciente'
      USING ERRCODE = '42501';
  END IF;

  IF p_operation = 'confirm'
     AND lower(COALESCE(v_old.status, '')) NOT IN (
       'scheduled',
       'agendado'
     ) THEN
    RAISE EXCEPTION 'Transição de confirmação inválida';
  ELSIF p_operation = 'cancel'
        AND lower(COALESCE(v_old.status, '')) NOT IN (
          'scheduled',
          'agendado',
          'confirmed',
          'confirmado'
        ) THEN
    RAISE EXCEPTION 'Transição de cancelamento inválida';
  ELSIF p_operation = 'reschedule'
        AND (
          lower(COALESCE(v_old.status, '')) NOT IN (
            'scheduled',
            'agendado',
            'confirmed',
            'confirmado'
          )
          OR p_new_appointment_date IS NULL
          OR p_new_start_time IS NULL
          OR p_new_end_time IS NULL
          OR p_duration_minutes IS NULL
        ) THEN
    RAISE EXCEPTION 'Transição de reagendamento inválida';
  END IF;

  INSERT INTO private.patient_portal_mutation_context(
    backend_pid,
    transaction_id,
    token,
    user_id,
    company_id,
    patient_id,
    appointment_id,
    operation
  ) VALUES (
    pg_backend_pid(),
    txid_current(),
    v_token,
    p_user_id,
    p_company_id,
    p_patient_id,
    p_appointment_id,
    p_operation
  );

  PERFORM set_config(
    'app.patient_portal.mutation_token',
    v_token::TEXT,
    TRUE
  );
  PERFORM set_config(
    'app.patient_portal.mutation_operation',
    p_operation,
    TRUE
  );

  IF p_operation = 'confirm' THEN
    UPDATE public.appointments appointment
       SET status = 'confirmed',
           lg_confirmado = TRUE,
           updated_at = clock_timestamp()
     WHERE appointment.id = p_appointment_id
       AND appointment.company_id = p_company_id
       AND appointment.patient_id = p_patient_id
    RETURNING appointment.* INTO v_row;
  ELSIF p_operation = 'cancel' THEN
    UPDATE public.appointments appointment
       SET status = 'cancelled',
           lg_confirmado = FALSE,
           updated_at = clock_timestamp()
     WHERE appointment.id = p_appointment_id
       AND appointment.company_id = p_company_id
       AND appointment.patient_id = p_patient_id
    RETURNING appointment.* INTO v_row;
  ELSE
    UPDATE public.appointments appointment
       SET appointment_date = p_new_appointment_date,
           start_time = p_new_start_time,
           end_time = p_new_end_time,
           duration_minutes = p_duration_minutes,
           status = 'scheduled',
           lg_confirmado = FALSE,
           updated_at = clock_timestamp()
     WHERE appointment.id = p_appointment_id
       AND appointment.company_id = p_company_id
       AND appointment.patient_id = p_patient_id
    RETURNING appointment.* INTO v_row;
  END IF;

  DELETE FROM private.patient_portal_mutation_context context_record
   WHERE context_record.backend_pid = pg_backend_pid()
     AND context_record.transaction_id = txid_current()
     AND context_record.token = v_token;
  PERFORM set_config('app.patient_portal.mutation_token', '', TRUE);
  PERFORM set_config('app.patient_portal.mutation_operation', '', TRUE);

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Mutação do portal não alterou o agendamento'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN v_row;
EXCEPTION WHEN OTHERS THEN
  DELETE FROM private.patient_portal_mutation_context context_record
   WHERE context_record.backend_pid = pg_backend_pid()
     AND context_record.transaction_id = txid_current()
     AND context_record.token = v_token;
  PERFORM set_config('app.patient_portal.mutation_token', '', TRUE);
  PERFORM set_config('app.patient_portal.mutation_operation', '', TRUE);
  RAISE;
END;
$function$;

ALTER FUNCTION private.resolve_authenticated_patient_context()
  OWNER TO prontomedic_patient_portal_rpc_owner;
ALTER FUNCTION private.apply_patient_portal_appointment_mutation(
  UUID,
  UUID,
  BIGINT,
  BIGINT,
  TEXT,
  DATE,
  TIME,
  TIME,
  INTEGER
) OWNER TO prontomedic_patient_portal_rpc_owner;

REVOKE ALL ON FUNCTION private.resolve_authenticated_patient_context()
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.apply_patient_portal_appointment_mutation(
  UUID,
  UUID,
  BIGINT,
  BIGINT,
  TEXT,
  DATE,
  TIME,
  TIME,
  INTEGER
) FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.resolve_authenticated_patient_context()
  TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION private.apply_patient_portal_appointment_mutation(
  UUID,
  UUID,
  BIGINT,
  BIGINT,
  TEXT,
  DATE,
  TIME,
  TIME,
  INTEGER
) TO prontomedic_patient_portal_rpc_owner;

DROP FUNCTION IF EXISTS public.patient_portal_list_appointments_secure();
DROP FUNCTION IF EXISTS public.patient_portal_confirm_appointment_secure(
  BIGINT
);
DROP FUNCTION IF EXISTS public.patient_portal_cancel_appointment_secure(
  BIGINT,
  TEXT
);
DROP FUNCTION IF EXISTS public.patient_portal_reschedule_appointment_secure(
  BIGINT,
  DATE,
  TIME,
  TIME,
  TEXT
);

CREATE FUNCTION public.patient_portal_list_appointments_secure()
RETURNS TABLE (
  id BIGINT,
  appointment_date DATE,
  start_time TIME,
  end_time TIME,
  status TEXT,
  is_return BOOLEAN,
  professional_name TEXT,
  unit_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private
AS $function$
DECLARE
  v_context RECORD;
BEGIN
  SELECT *
    INTO v_context
    FROM private.resolve_authenticated_patient_context();

  RETURN QUERY
  SELECT
    appointment.id,
    appointment.appointment_date,
    appointment.start_time,
    appointment.end_time,
    CASE lower(COALESCE(appointment.status, ''))
      WHEN 'agendado' THEN 'scheduled'
      WHEN 'confirmado' THEN 'confirmed'
      WHEN 'atendido' THEN 'completed'
      WHEN 'cancelado' THEN 'cancelled'
      WHEN 'faltou' THEN 'no_show'
      ELSE lower(COALESCE(appointment.status, ''))
    END,
    appointment.is_return,
    professional.full_name::TEXT,
    unit_record.ds_nome::TEXT
  FROM public.appointments appointment
  LEFT JOIN public.professionals professional
    ON professional.company_id = appointment.company_id
   AND professional.id = appointment.professional_id
  LEFT JOIN public.units unit_record
    ON unit_record.company_id = appointment.company_id
   AND unit_record.id = appointment.unit_id
  WHERE appointment.company_id = v_context.company_id
    AND appointment.patient_id = v_context.patient_id
  ORDER BY
    appointment.appointment_date DESC,
    appointment.start_time DESC,
    appointment.id DESC;
END;
$function$;

CREATE FUNCTION public.patient_portal_confirm_appointment_secure(
  p_appointment_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private
SET TimeZone = 'America/Sao_Paulo'
AS $function$
DECLARE
  v_context RECORD;
  v_old public.appointments;
  v_row public.appointments;
BEGIN
  SELECT *
    INTO v_context
    FROM private.resolve_authenticated_patient_context();

  SELECT *
    INTO v_old
    FROM public.appointments appointment
   WHERE appointment.id = p_appointment_id
     AND appointment.company_id = v_context.company_id
     AND appointment.patient_id = v_context.patient_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado no portal do paciente'
      USING ERRCODE = '42501';
  END IF;
  IF lower(COALESCE(v_old.status, '')) NOT IN (
    'scheduled',
    'agendado'
  ) THEN
    RAISE EXCEPTION 'Somente agendamento agendado pode ser confirmado';
  END IF;
  IF v_old.appointment_date < CURRENT_DATE
     OR v_old.appointment_date > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION
      'Confirmação disponível somente no dia anterior ou no dia do atendimento';
  END IF;

  v_row := private.apply_patient_portal_appointment_mutation(
    v_context.user_id,
    v_context.company_id,
    v_context.patient_id,
    v_old.id,
    'confirm'
  );

  INSERT INTO public.scheduling_status_history(
    company_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    actor_user_id
  ) VALUES (
    v_context.company_id,
    v_row.id,
    v_old.status,
    v_row.status,
    'Presença confirmada pelo portal do paciente',
    v_context.user_id
  );

  RETURN jsonb_build_object(
    'id', v_row.id,
    'appointment_date', v_row.appointment_date,
    'start_time', v_row.start_time,
    'end_time', v_row.end_time,
    'status', 'confirmed',
    'is_return', v_row.is_return,
    'professional_name', (
      SELECT professional.full_name::TEXT
      FROM public.professionals professional
      WHERE professional.id = v_row.professional_id
        AND professional.company_id = v_context.company_id
    ),
    'unit_name', (
      SELECT unit_record.ds_nome::TEXT
      FROM public.units unit_record
      WHERE unit_record.id = v_row.unit_id
        AND unit_record.company_id = v_context.company_id
    )
  );
END;
$function$;

CREATE FUNCTION public.patient_portal_cancel_appointment_secure(
  p_appointment_id BIGINT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private
SET TimeZone = 'America/Sao_Paulo'
AS $function$
DECLARE
  v_context RECORD;
  v_reason TEXT := COALESCE(
    NULLIF(btrim(p_reason), ''),
    'Cancelado pelo paciente'
  );
  v_old public.appointments;
  v_row public.appointments;
BEGIN
  SELECT *
    INTO v_context
    FROM private.resolve_authenticated_patient_context();

  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Motivo do cancelamento excede 500 caracteres';
  END IF;

  SELECT *
    INTO v_old
    FROM public.appointments appointment
   WHERE appointment.id = p_appointment_id
     AND appointment.company_id = v_context.company_id
     AND appointment.patient_id = v_context.patient_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado no portal do paciente'
      USING ERRCODE = '42501';
  END IF;
  IF lower(COALESCE(v_old.status, '')) NOT IN (
    'scheduled',
    'agendado',
    'confirmed',
    'confirmado'
  ) THEN
    RAISE EXCEPTION
      'Agendamento no status % não pode ser cancelado',
      v_old.status;
  END IF;
  IF (v_old.appointment_date + v_old.start_time) <= LOCALTIMESTAMP THEN
    RAISE EXCEPTION 'Agendamento passado não pode ser cancelado pelo portal';
  END IF;

  v_row := private.apply_patient_portal_appointment_mutation(
    v_context.user_id,
    v_context.company_id,
    v_context.patient_id,
    v_old.id,
    'cancel'
  );

  INSERT INTO public.scheduling_status_history(
    company_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    actor_user_id
  ) VALUES (
    v_context.company_id,
    v_row.id,
    v_old.status,
    v_row.status,
    v_reason,
    v_context.user_id
  );

  RETURN jsonb_build_object(
    'id', v_row.id,
    'appointment_date', v_row.appointment_date,
    'start_time', v_row.start_time,
    'end_time', v_row.end_time,
    'status', 'cancelled',
    'is_return', v_row.is_return,
    'professional_name', (
      SELECT professional.full_name::TEXT
      FROM public.professionals professional
      WHERE professional.id = v_row.professional_id
        AND professional.company_id = v_context.company_id
    ),
    'unit_name', (
      SELECT unit_record.ds_nome::TEXT
      FROM public.units unit_record
      WHERE unit_record.id = v_row.unit_id
        AND unit_record.company_id = v_context.company_id
    )
  );
END;
$function$;

CREATE FUNCTION public.patient_portal_reschedule_appointment_secure(
  p_appointment_id BIGINT,
  p_new_appointment_date DATE,
  p_new_start_time TIME,
  p_new_end_time TIME DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private
SET TimeZone = 'America/Sao_Paulo'
AS $function$
DECLARE
  v_context RECORD;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_old public.appointments;
  v_row public.appointments;
  v_new_end_time TIME;
  v_duration_minutes INTEGER;
  v_slot_available BOOLEAN := FALSE;
BEGIN
  SELECT *
    INTO v_context
    FROM private.resolve_authenticated_patient_context();

  IF v_reason IS NULL OR char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Motivo do reagendamento é obrigatório';
  END IF;
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Motivo do reagendamento excede 500 caracteres';
  END IF;
  IF p_new_appointment_date IS NULL OR p_new_start_time IS NULL THEN
    RAISE EXCEPTION 'Nova data e horário são obrigatórios';
  END IF;

  SELECT *
    INTO v_old
    FROM public.appointments appointment
   WHERE appointment.id = p_appointment_id
     AND appointment.company_id = v_context.company_id
     AND appointment.patient_id = v_context.patient_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado no portal do paciente'
      USING ERRCODE = '42501';
  END IF;
  IF lower(COALESCE(v_old.status, '')) NOT IN (
    'scheduled',
    'agendado',
    'confirmed',
    'confirmado'
  ) THEN
    RAISE EXCEPTION
      'Agendamento no status % não pode ser reagendado',
      v_old.status;
  END IF;
  IF v_old.professional_id IS NULL OR v_old.unit_id IS NULL THEN
    RAISE EXCEPTION
      'Agendamento sem profissional ou unidade não pode ser reagendado no portal';
  END IF;

  v_duration_minutes := GREATEST(
    5,
    LEAST(
      480,
      COALESCE(
        (
          EXTRACT(EPOCH FROM (v_old.end_time - v_old.start_time)) / 60
        )::INTEGER,
        v_old.duration_minutes,
        30
      )
    )
  );
  v_new_end_time := COALESCE(
    p_new_end_time,
    p_new_start_time + make_interval(mins => v_duration_minutes)
  );

  IF v_new_end_time <= p_new_start_time THEN
    RAISE EXCEPTION 'Intervalo de reagendamento inválido';
  END IF;
  IF (
    EXTRACT(EPOCH FROM (v_new_end_time - p_new_start_time)) / 60
  )::INTEGER <> v_duration_minutes THEN
    RAISE EXCEPTION 'O reagendamento deve preservar a duração original';
  END IF;
  IF (p_new_appointment_date + p_new_start_time) <= LOCALTIMESTAMP THEN
    RAISE EXCEPTION 'Novo horário deve estar no futuro';
  END IF;
  IF p_new_appointment_date = v_old.appointment_date
     AND p_new_start_time = v_old.start_time
     AND v_new_end_time = COALESCE(
       v_old.end_time,
       v_old.start_time + INTERVAL '30 minutes'
     ) THEN
    RAISE EXCEPTION 'O novo horário é igual ao horário atual';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.get_professional_available_slots(
      v_old.professional_id,
      p_new_appointment_date,
      v_duration_minutes,
      v_old.unit_id
    ) slot_record
    WHERE slot_record.start_time = p_new_start_time
      AND slot_record.end_time = v_new_end_time
      AND slot_record.unit_id = v_old.unit_id
  )
  INTO v_slot_available;

  IF NOT v_slot_available THEN
    WITH schedule_windows AS (
      SELECT
        schedule.slot1_start AS start_hhmm,
        schedule.slot1_end AS end_hhmm,
        COALESCE(schedule.slot1_unit_id, schedule.unit_id) AS unit_id
      FROM public.professional_schedules schedule
      WHERE schedule.company_id = v_context.company_id
        AND schedule.professional_id = v_old.professional_id
        AND schedule.lg_habilitado IS TRUE
        AND lower(schedule.day_of_week) = (
          ARRAY[
            'domingo',
            'segunda-feira',
            'terça-feira',
            'quarta-feira',
            'quinta-feira',
            'sexta-feira',
            'sábado'
          ]
        )[EXTRACT(DOW FROM p_new_appointment_date)::INTEGER + 1]
      UNION ALL
      SELECT
        schedule.slot2_start,
        schedule.slot2_end,
        COALESCE(schedule.slot2_unit_id, schedule.unit_id)
      FROM public.professional_schedules schedule
      WHERE schedule.company_id = v_context.company_id
        AND schedule.professional_id = v_old.professional_id
        AND schedule.lg_habilitado IS TRUE
        AND lower(schedule.day_of_week) = (
          ARRAY[
            'domingo',
            'segunda-feira',
            'terça-feira',
            'quarta-feira',
            'quinta-feira',
            'sexta-feira',
            'sábado'
          ]
        )[EXTRACT(DOW FROM p_new_appointment_date)::INTEGER + 1]
      UNION ALL
      SELECT
        schedule.slot3_start,
        schedule.slot3_end,
        COALESCE(schedule.slot3_unit_id, schedule.unit_id)
      FROM public.professional_schedules schedule
      WHERE schedule.company_id = v_context.company_id
        AND schedule.professional_id = v_old.professional_id
        AND schedule.lg_habilitado IS TRUE
        AND lower(schedule.day_of_week) = (
          ARRAY[
            'domingo',
            'segunda-feira',
            'terça-feira',
            'quarta-feira',
            'quinta-feira',
            'sexta-feira',
            'sábado'
          ]
        )[EXTRACT(DOW FROM p_new_appointment_date)::INTEGER + 1]
    )
    SELECT EXISTS (
      SELECT 1
      FROM schedule_windows schedule_window
      WHERE schedule_window.start_hhmm IS NOT NULL
        AND schedule_window.end_hhmm IS NOT NULL
        AND schedule_window.unit_id = v_old.unit_id
        AND p_new_start_time >= public.scheduling_hhmm_to_time(
          schedule_window.start_hhmm
        )
        AND v_new_end_time <= public.scheduling_hhmm_to_time(
          schedule_window.end_hhmm
        )
        AND MOD(
          (
            EXTRACT(
              EPOCH FROM (
                p_new_start_time
                - public.scheduling_hhmm_to_time(
                  schedule_window.start_hhmm
                )
              )
            ) / 60
          )::INTEGER,
          v_duration_minutes
        ) = 0
    )
    INTO v_slot_available;
  END IF;

  IF NOT v_slot_available THEN
    RAISE EXCEPTION 'Horário fora da grade canônica do profissional';
  END IF;

  PERFORM public.assert_appointment_slot_available(
    v_old.professional_id,
    p_new_appointment_date,
    p_new_start_time,
    v_new_end_time,
    v_old.id
  );

  v_row := private.apply_patient_portal_appointment_mutation(
    v_context.user_id,
    v_context.company_id,
    v_context.patient_id,
    v_old.id,
    'reschedule',
    p_new_appointment_date,
    p_new_start_time,
    v_new_end_time,
    v_duration_minutes
  );

  INSERT INTO public.scheduling_reschedules(
    company_id,
    appointment_id,
    old_appointment_date,
    old_start_time,
    old_end_time,
    new_appointment_date,
    new_start_time,
    new_end_time,
    reason,
    rescheduled_by
  ) VALUES (
    v_context.company_id,
    v_row.id,
    v_old.appointment_date,
    v_old.start_time,
    v_old.end_time,
    v_row.appointment_date,
    v_row.start_time,
    v_row.end_time,
    v_reason,
    v_context.user_id
  );

  INSERT INTO public.scheduling_status_history(
    company_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    actor_user_id
  ) VALUES (
    v_context.company_id,
    v_row.id,
    v_old.status,
    v_row.status,
    'Reagendamento pelo portal: ' || v_reason,
    v_context.user_id
  );

  RETURN jsonb_build_object(
    'id', v_row.id,
    'appointment_date', v_row.appointment_date,
    'start_time', v_row.start_time,
    'end_time', v_row.end_time,
    'status', 'scheduled',
    'is_return', v_row.is_return,
    'professional_name', (
      SELECT professional.full_name::TEXT
      FROM public.professionals professional
      WHERE professional.id = v_row.professional_id
        AND professional.company_id = v_context.company_id
    ),
    'unit_name', (
      SELECT unit_record.ds_nome::TEXT
      FROM public.units unit_record
      WHERE unit_record.id = v_row.unit_id
        AND unit_record.company_id = v_context.company_id
    )
  );
END;
$function$;

ALTER FUNCTION public.patient_portal_list_appointments_secure()
  OWNER TO prontomedic_patient_portal_rpc_owner;
ALTER FUNCTION public.patient_portal_confirm_appointment_secure(BIGINT)
  OWNER TO prontomedic_patient_portal_rpc_owner;
ALTER FUNCTION public.patient_portal_cancel_appointment_secure(BIGINT, TEXT)
  OWNER TO prontomedic_patient_portal_rpc_owner;
ALTER FUNCTION public.patient_portal_reschedule_appointment_secure(
  BIGINT,
  DATE,
  TIME,
  TIME,
  TEXT
) OWNER TO prontomedic_patient_portal_rpc_owner;

REVOKE ALL ON FUNCTION public.patient_portal_list_appointments_secure()
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.patient_portal_confirm_appointment_secure(BIGINT)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.patient_portal_cancel_appointment_secure(
  BIGINT,
  TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.patient_portal_reschedule_appointment_secure(
  BIGINT,
  DATE,
  TIME,
  TIME,
  TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT EXECUTE ON FUNCTION public.patient_portal_list_appointments_secure()
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.patient_portal_confirm_appointment_secure(
  BIGINT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.patient_portal_cancel_appointment_secure(
  BIGINT,
  TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.patient_portal_reschedule_appointment_secure(
  BIGINT,
  DATE,
  TIME,
  TIME,
  TEXT
) TO authenticated, app_prontomedic;

COMMENT ON FUNCTION public.patient_portal_list_appointments_secure()
  IS 'Lista DTO mínimo dos agendamentos do paciente AAL2 autenticado.';
COMMENT ON FUNCTION public.patient_portal_confirm_appointment_secure(BIGINT)
  IS 'Confirma o próprio agendamento sem alterar claims JWT.';
COMMENT ON FUNCTION public.patient_portal_cancel_appointment_secure(
  BIGINT,
  TEXT
) IS 'Cancela o próprio agendamento sem alterar claims JWT.';
COMMENT ON FUNCTION public.patient_portal_reschedule_appointment_secure(
  BIGINT,
  DATE,
  TIME,
  TIME,
  TEXT
) IS 'Reagenda o próprio agendamento em grade canônica sem alterar claims JWT.';

COMMIT;

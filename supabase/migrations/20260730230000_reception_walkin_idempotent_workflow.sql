-- Reception walk-in: idempotent appointment creation and handoff to the
-- canonical reception check-in workflow. Additive only. DataSIGH is untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS private.reception_walkin_operations (
  company_id UUID NOT NULL REFERENCES public.companies(id),
  unit_id INTEGER NOT NULL REFERENCES public.units(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_payload JSONB NOT NULL,
  appointment_id BIGINT NULL REFERENCES public.appointments(id),
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'appointment_ready')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reception_walkin_operations_company_key_uq
    UNIQUE (company_id, idempotency_key),
  CONSTRAINT reception_walkin_operations_company_appointment_uq
    UNIQUE (company_id, appointment_id),
  CONSTRAINT reception_walkin_operations_key_format_ck
    CHECK (
      length(idempotency_key) BETWEEN 8 AND 120
      AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
    ),
  CONSTRAINT reception_walkin_operations_request_hash_ck
    CHECK (request_hash ~ '^[0-9a-f]{64}$')
);

REVOKE ALL ON TABLE private.reception_walkin_operations
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT SELECT, INSERT, UPDATE ON TABLE private.reception_walkin_operations
  TO prontomedic_reception_rpc_owner;
GRANT SELECT ON TABLE
  public.patients,
  public.appointment_types,
  public.professionals,
  public.services_catalog
TO prontomedic_reception_rpc_owner;

DROP POLICY IF EXISTS appointment_types_reception_walkin_rpc_select
  ON public.appointment_types;
CREATE POLICY appointment_types_reception_walkin_rpc_select
  ON public.appointment_types
  FOR SELECT
  TO prontomedic_reception_rpc_owner
  USING (
    (company_id IS NULL OR company_id = public.current_company_id())
    AND COALESCE(lg_ativo, TRUE)
  );

DROP POLICY IF EXISTS professionals_reception_walkin_rpc_select
  ON public.professionals;
CREATE POLICY professionals_reception_walkin_rpc_select
  ON public.professionals
  FOR SELECT
  TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND COALESCE(lg_ativo, TRUE)
  );

DROP POLICY IF EXISTS services_catalog_reception_walkin_rpc_select
  ON public.services_catalog;
CREATE POLICY services_catalog_reception_walkin_rpc_select
  ON public.services_catalog
  FOR SELECT
  TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND COALESCE(lg_ativo, TRUE)
  );

DROP POLICY IF EXISTS appointments_reception_walkin_rpc_select
  ON public.appointments;
CREATE POLICY appointments_reception_walkin_rpc_select
  ON public.appointments
  FOR SELECT
  TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND is_walkin IS TRUE
    AND private.reception_actor_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS appointments_reception_walkin_rpc_insert
  ON public.appointments;

CREATE OR REPLACE FUNCTION private.reception_insert_walkin_appointment(
  p_company_id UUID,
  p_patient_id BIGINT,
  p_unit_id INTEGER,
  p_appointment_type_id BIGINT,
  p_professional_id BIGINT,
  p_service_id BIGINT,
  p_appointment_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_notes TEXT
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $function$
DECLARE
  v_row public.appointments;
  v_subject TEXT := current_setting('request.jwt.claim.sub', TRUE);
BEGIN
  -- The public RPC has already validated actor, tenant, unit and catalogs.
  -- Clearing only auth.uid prevents the generic Agenda trigger from requiring
  -- agenda.create for this reception-owned operation. The trigger still
  -- validates company/unit consistency.
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
  INSERT INTO public.appointments(
    company_id,
    patient_id,
    unit_id,
    appointment_type_id,
    professional_id,
    service_id,
    appointment_date,
    start_time,
    end_time,
    status,
    notes,
    is_walkin
  )
  VALUES (
    p_company_id,
    p_patient_id,
    p_unit_id,
    p_appointment_type_id,
    p_professional_id,
    p_service_id,
    p_appointment_date,
    p_start_time,
    p_end_time,
    'scheduled',
    p_notes,
    TRUE
  )
  RETURNING * INTO v_row;
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_subject, ''), TRUE);
  RETURN v_row;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_subject, ''), TRUE);
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION private.reception_insert_walkin_appointment(
  UUID, BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, DATE, TIME, TIME, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.reception_insert_walkin_appointment(
  UUID, BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, DATE, TIME, TIME, TEXT
) TO prontomedic_reception_rpc_owner;

DROP FUNCTION IF EXISTS public.create_reception_walkin_secure(
  BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, TEXT, TEXT
);

CREATE FUNCTION public.create_reception_walkin_secure(
  p_patient_id BIGINT,
  p_unit_id INTEGER,
  p_appointment_type_id BIGINT,
  p_professional_id BIGINT,
  p_service_id BIGINT,
  p_notes TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_actor RECORD;
  v_operation private.reception_walkin_operations;
  v_appointment public.appointments;
  v_payload JSONB;
  v_request_hash TEXT;
  v_duration INTEGER;
  v_local_timestamp TIMESTAMP :=
    timezone('America/Sao_Paulo', clock_timestamp());
  v_workflow public.reception_checkin_workflows;
BEGIN
  IF p_idempotency_key IS NULL
     OR length(p_idempotency_key) NOT BETWEEN 8 AND 120
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'Chave de idempotencia invalida';
  END IF;

  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional';
  END IF;
  IF COALESCE(v_actor.role_name, '') NOT IN ('admin', 'gestor', 'recepcao') THEN
    RAISE EXCEPTION 'Perfil sem permissao para atendimento espontaneo';
  END IF;
  IF p_unit_id IS NULL
     OR NOT private.reception_actor_can_access_unit(
       v_actor.company_id,
       p_unit_id
     ) THEN
    RAISE EXCEPTION 'Unidade fora do escopo';
  END IF;

  v_payload := jsonb_build_object(
    'patient_id', p_patient_id,
    'unit_id', p_unit_id,
    'appointment_type_id', p_appointment_type_id,
    'professional_id', p_professional_id,
    'service_id', p_service_id,
    'notes', NULLIF(btrim(COALESCE(p_notes, '')), '')
  );
  v_request_hash := private.m11_request_hash(v_payload);

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_actor.company_id::TEXT || ':walkin:' || p_idempotency_key,
      0
    )
  );

  SELECT * INTO v_operation
    FROM private.reception_walkin_operations operation
   WHERE operation.company_id = v_actor.company_id
     AND operation.idempotency_key = p_idempotency_key
   FOR UPDATE;

  IF FOUND THEN
    IF v_operation.request_hash <> v_request_hash
       OR v_operation.request_payload IS DISTINCT FROM v_payload
       OR v_operation.unit_id <> p_unit_id THEN
      RAISE EXCEPTION
        'Mesma chave de idempotencia com dados de atendimento diferentes';
    END IF;
    IF v_operation.appointment_id IS NULL THEN
      RAISE EXCEPTION
        'Operacao de atendimento espontaneo incompleta; tente novamente';
    END IF;

    SELECT * INTO v_appointment
      FROM public.appointments appointment
     WHERE appointment.id = v_operation.appointment_id
       AND appointment.company_id = v_actor.company_id
       AND appointment.unit_id = p_unit_id
       AND appointment.patient_id = p_patient_id
       AND appointment.is_walkin IS TRUE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Operacao idempotente aponta para atendimento fora do escopo';
    END IF;

    SELECT * INTO v_workflow
      FROM public.reception_checkin_workflows workflow
     WHERE workflow.company_id = v_actor.company_id
       AND workflow.appointment_id = v_appointment.id;

    RETURN jsonb_build_object(
      'appointment_id', v_appointment.id,
      'idempotency_key', p_idempotency_key,
      'idempotent', TRUE,
      'workflow_id', v_workflow.id,
      'workflow_status', v_workflow.status,
      'workflow_required', v_workflow.id IS NULL
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.patients patient
     WHERE patient.id = p_patient_id
       AND patient.company_id = v_actor.company_id
  ) THEN
    RAISE EXCEPTION 'Paciente fora do tenant';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.appointment_types appointment_type
     WHERE appointment_type.id = p_appointment_type_id
       AND (
         appointment_type.company_id IS NULL
         OR appointment_type.company_id = v_actor.company_id
       )
       AND COALESCE(appointment_type.lg_ativo, TRUE)
  ) THEN
    RAISE EXCEPTION 'Tipo de atendimento invalido';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.professionals professional
     WHERE professional.id = p_professional_id
       AND professional.company_id = v_actor.company_id
       AND COALESCE(professional.lg_ativo, TRUE)
  ) THEN
    RAISE EXCEPTION 'Profissional fora do tenant ou inativo';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.services_catalog service
     WHERE service.id = p_service_id
       AND COALESCE(service.lg_ativo, TRUE)
  ) THEN
    RAISE EXCEPTION 'Servico invalido ou inativo';
  END IF;

  SELECT GREATEST(COALESCE(default_duration, 30), 5)
    INTO v_duration
    FROM public.appointment_types
   WHERE id = p_appointment_type_id;

  INSERT INTO private.reception_walkin_operations(
    company_id,
    unit_id,
    idempotency_key,
    request_hash,
    request_payload,
    created_by
  )
  VALUES (
    v_actor.company_id,
    p_unit_id,
    p_idempotency_key,
    v_request_hash,
    v_payload,
    v_actor.user_id
  )
  RETURNING * INTO v_operation;

  v_appointment := private.reception_insert_walkin_appointment(
    v_actor.company_id,
    p_patient_id,
    p_unit_id,
    p_appointment_type_id,
    p_professional_id,
    p_service_id,
    v_local_timestamp::DATE,
    v_local_timestamp::TIME(0),
    v_local_timestamp::TIME(0) + make_interval(mins => v_duration),
    NULLIF(btrim(COALESCE(p_notes, '')), '')
  );

  UPDATE private.reception_walkin_operations
     SET appointment_id = v_appointment.id,
         status = 'appointment_ready',
         updated_at = NOW()
   WHERE company_id = v_actor.company_id
     AND idempotency_key = p_idempotency_key;

  INSERT INTO public.reception_admin_history(
    company_id,
    unit_id,
    entity_type,
    entity_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    details,
    actor_user_id
  )
  VALUES (
    v_actor.company_id,
    p_unit_id,
    'walkin',
    v_appointment.id::TEXT,
    v_appointment.id,
    NULL,
    'scheduled',
    'Atendimento espontaneo criado',
    v_payload || jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'workflow_handoff', 'reception_checkin'
    ),
    v_actor.user_id
  );

  RETURN jsonb_build_object(
    'appointment_id', v_appointment.id,
    'idempotency_key', p_idempotency_key,
    'idempotent', FALSE,
    'workflow_id', NULL,
    'workflow_status', NULL,
    'workflow_required', TRUE
  );
END;
$function$;

ALTER FUNCTION public.create_reception_walkin_secure(
  BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, TEXT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.create_reception_walkin_secure(
  BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_reception_walkin_secure(
  BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, TEXT, TEXT
) TO authenticated, app_prontomedic;

-- Compatibility wrapper for older clients. New clients must always send their
-- own stable operation key so retries can resume across network failures.
CREATE OR REPLACE FUNCTION public.create_reception_walkin_secure(
  p_patient_id BIGINT,
  p_unit_id INTEGER,
  p_appointment_type_id BIGINT,
  p_professional_id BIGINT,
  p_service_id BIGINT,
  p_notes TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT (
    public.create_reception_walkin_secure(
      p_patient_id,
      p_unit_id,
      p_appointment_type_id,
      p_professional_id,
      p_service_id,
      p_notes,
      'legacy:' || gen_random_uuid()::TEXT
    )->>'appointment_id'
  )::BIGINT
$function$;

ALTER FUNCTION public.create_reception_walkin_secure(
  BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.create_reception_walkin_secure(
  BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_reception_walkin_secure(
  BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, TEXT
) TO authenticated, app_prontomedic;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260730230000_reception_walkin_idempotent_workflow.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

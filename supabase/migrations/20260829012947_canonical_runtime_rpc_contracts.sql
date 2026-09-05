BEGIN;

CREATE OR REPLACE FUNCTION public.nursing_bedside_check_secure(
  p_admin_id BIGINT,
  p_patient_confirmado BIGINT
)
RETURNS TABLE(certo TEXT, ok BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
BEGIN
  IF v_company IS NULL OR v_unit IS NULL
     OR NOT public.can_access('prontuario', 'edit') THEN
    RAISE EXCEPTION 'Contexto de enfermagem autorizado e obrigatorio'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH administration AS (
    SELECT medication.patient_id,
           medication.medication,
           medication.dose,
           medication.via,
           medication.scheduled_at,
           medication.prepared_by
     FROM public.nursing_medication_administrations AS medication
     WHERE medication.id = p_admin_id
       AND medication.company_id = v_company
       AND medication.unit_id = v_unit
       AND medication.status IN ('pendente', 'em_preparo', 'atrasado')
  )
  SELECT check_item.certo, check_item.ok
    FROM administration,
         LATERAL (VALUES
           ('paciente', administration.patient_id = p_patient_confirmado),
           ('medicamento', NULLIF(BTRIM(administration.medication), '') IS NOT NULL),
           ('dose', NULLIF(BTRIM(COALESCE(administration.dose, '')), '') IS NOT NULL),
           ('via', NULLIF(BTRIM(COALESCE(administration.via, '')), '') IS NOT NULL),
           ('horario', administration.scheduled_at IS NOT NULL AND
             administration.scheduled_at BETWEEN NOW() - INTERVAL '2 hours'
                                               AND NOW() + INTERVAL '2 hours'),
           ('preparo', administration.prepared_by IS NOT NULL)
         ) AS check_item(certo, ok)
  ;
END
$function$;

CREATE OR REPLACE FUNCTION public.nursing_administer_medication_secure(
  p_admin_id BIGINT,
  p_patient_confirmado BIGINT
)
RETURNS public.nursing_medication_administrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_professional_id BIGINT;
  v_result public.nursing_medication_administrations;
BEGIN
  IF v_company IS NULL OR v_unit IS NULL OR NOT public.can_access('prontuario', 'edit') THEN
    RAISE EXCEPTION 'Contexto de enfermagem autorizado e obrigatorio'
      USING ERRCODE = '42501';
  END IF;

  SELECT professional.id INTO v_professional_id
    FROM public.professionals AS professional
   WHERE professional.company_id = v_company
     AND professional.user_id = auth.uid()
     AND professional.lg_ativo
   ORDER BY professional.id
   LIMIT 1;
  IF v_professional_id IS NULL THEN
    RAISE EXCEPTION 'Profissional de enfermagem ativo nao encontrado'
      USING ERRCODE = '42501';
  END IF;

  SELECT medication.* INTO v_result
    FROM public.nursing_medication_administrations AS medication
   WHERE medication.id = p_admin_id
     AND medication.company_id = v_company
     AND medication.unit_id = v_unit
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administracao nao encontrada no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_result.status NOT IN ('pendente', 'em_preparo', 'atrasado') THEN
    RAISE EXCEPTION 'Administracao em estado terminal ou incompatível'
      USING ERRCODE = '23514';
  END IF;
  IF v_result.patient_id <> p_patient_confirmado
     OR NULLIF(BTRIM(v_result.medication), '') IS NULL
     OR NULLIF(BTRIM(COALESCE(v_result.dose, '')), '') IS NULL
     OR NULLIF(BTRIM(COALESCE(v_result.via, '')), '') IS NULL
     OR v_result.scheduled_at IS NULL
     OR v_result.scheduled_at NOT BETWEEN NOW() - INTERVAL '2 hours'
                                      AND NOW() + INTERVAL '2 hours'
     OR v_result.prepared_by IS NULL THEN
    RAISE EXCEPTION 'Checagem beira-leito reprovada'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.nursing_medication_administrations
     SET status = 'administrado',
         bedside_check_ok = TRUE,
         administered_at = NOW(),
         administered_by = v_professional_id,
         updated_at = NOW()
   WHERE id = p_admin_id
   RETURNING * INTO v_result;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.nursing_refuse_medication_secure(
  p_admin_id BIGINT,
  p_reason TEXT
)
RETURNS public.nursing_medication_administrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_result public.nursing_medication_administrations;
BEGIN
  IF v_company IS NULL OR v_unit IS NULL OR NOT public.can_access('prontuario', 'edit') THEN
    RAISE EXCEPTION 'Contexto de enfermagem autorizado e obrigatorio'
      USING ERRCODE = '42501';
  END IF;
  IF NULLIF(BTRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo da recusa e obrigatorio' USING ERRCODE = '22023';
  END IF;

  UPDATE public.nursing_medication_administrations
     SET status = 'recusado', refusal_reason = BTRIM(p_reason), updated_at = NOW()
   WHERE id = p_admin_id
     AND company_id = v_company
     AND unit_id = v_unit
     AND status IN ('pendente', 'em_preparo', 'atrasado')
   RETURNING * INTO v_result;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administracao nao encontrada ou estado incompativel'
      USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.check_prescription_safety(
  p_patient_id BIGINT,
  p_medication TEXT
)
RETURNS TABLE(alert_type TEXT, severity TEXT, descricao TEXT)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_medication TEXT := LOWER(BTRIM(COALESCE(p_medication, '')));
BEGIN
  IF v_company IS NULL OR v_medication = '' THEN
    RAISE EXCEPTION 'Contexto ativo e medicamento sao obrigatorios'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.patients AS patient
     WHERE patient.id = p_patient_id
       AND patient.company_id = v_company
       AND patient.lg_ativo
  ) THEN
    RAISE EXCEPTION 'Paciente nao encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT 'alergia'::TEXT,
         CASE allergy.severity
           WHEN 'HIGH' THEN 'grave'
           WHEN 'MODERATE' THEN 'moderada'
           ELSE 'informativa'
         END::TEXT,
         ('Alergia registrada: ' || allergy.allergen ||
           COALESCE(' - reacao: ' || NULLIF(allergy.reaction, ''), ''))::TEXT
    FROM public.patient_allergies AS allergy
   WHERE allergy.company_id = v_company
     AND allergy.patient_id = p_patient_id
     AND allergy.status = 'ACTIVE'
     AND LOWER(BTRIM(allergy.allergen)) = v_medication;

  RETURN QUERY
  SELECT 'duplicidade'::TEXT,
         'moderada'::TEXT,
         ('Medicamento ja prescrito: ' || item.medication_name)::TEXT
    FROM public.electronic_prescriptions AS prescription
    JOIN public.electronic_prescription_items AS item
      ON item.prescription_id = prescription.id
     AND item.company_id = v_company
   WHERE prescription.company_id = v_company
     AND prescription.patient_id = p_patient_id
     AND prescription.status IN ('signed', 'active')
     AND item.item_type = 'medication'
     AND LOWER(BTRIM(COALESCE(NULLIF(item.active_ingredient, ''), item.medication_name))) = v_medication;
END
$function$;

CREATE OR REPLACE FUNCTION public.m9_check_patient_appointment_conflicts_secure(
  p_patient_id BIGINT,
  p_appointment_date DATE,
  p_start_time TIME,
  p_end_time TIME DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL,
  p_professional_id BIGINT DEFAULT NULL,
  p_specialty_id INTEGER DEFAULT NULL,
  p_service_id BIGINT DEFAULT NULL,
  p_exclude_appointment_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_end_time TIME := COALESCE(p_end_time, p_start_time + INTERVAL '30 minutes');
  v_conflicts JSONB;
  v_blocked BOOLEAN;
BEGIN
  IF v_company IS NULL OR p_patient_id IS NULL OR p_appointment_date IS NULL
     OR p_start_time IS NULL OR v_end_time <= p_start_time THEN
    RAISE EXCEPTION 'Contexto, paciente, data e intervalo validos sao obrigatorios'
      USING ERRCODE = '22023';
  END IF;
  IF NOT (
    public.can_access('agenda', 'create')
    OR public.can_access('agenda', 'edit')
  ) THEN
    RAISE EXCEPTION 'Permissao para alterar a agenda negada'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.patients AS patient
     WHERE patient.id = p_patient_id
       AND patient.company_id = v_company
       AND patient.lg_ativo
  ) THEN
    RAISE EXCEPTION 'Paciente nao encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.units AS unit_record
     WHERE unit_record.id = p_unit_id
       AND unit_record.company_id = v_company
       AND unit_record.lg_ativo
  ) THEN
    RAISE EXCEPTION 'Unidade nao encontrada no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_professional_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.professionals AS professional
     WHERE professional.id = p_professional_id
       AND professional.company_id = v_company
       AND professional.lg_ativo
  ) THEN
    RAISE EXCEPTION 'Profissional nao encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_exclude_appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments AS excluded_appointment
     WHERE excluded_appointment.id = p_exclude_appointment_id
       AND excluded_appointment.company_id = v_company
       AND excluded_appointment.patient_id = p_patient_id
  ) THEN
    RAISE EXCEPTION 'Agendamento excluido nao pertence ao paciente e contexto ativos'
      USING ERRCODE = 'P0002';
  END IF;

  WITH candidates AS (
    SELECT appointment.id,
           appointment.appointment_date,
           appointment.start_time,
           appointment.end_time,
           appointment.status,
           unit_record.ds_nome AS unit_name,
           professional.full_name AS professional_name,
           service_record.name AS service_name,
           CASE
             WHEN appointment.appointment_date = p_appointment_date
              AND appointment.start_time < v_end_time
              AND COALESCE(
                    appointment.end_time,
                    appointment.start_time + make_interval(
                      mins => COALESCE(appointment.duration_minutes, 30)
                    )
                  ) > p_start_time THEN 'blocking'
             WHEN p_specialty_id IS NOT NULL
              AND appointment.specialty_id = p_specialty_id
              AND appointment.appointment_date = p_appointment_date THEN 'attention'
             ELSE 'informative'
           END AS conflict_level,
           CASE
             WHEN appointment.appointment_date = p_appointment_date
              AND appointment.start_time < v_end_time
              AND COALESCE(
                    appointment.end_time,
                    appointment.start_time + make_interval(
                      mins => COALESCE(appointment.duration_minutes, 30)
                    )
                  ) > p_start_time THEN 'Horario sobreposto para o mesmo paciente'
             WHEN p_specialty_id IS NOT NULL
              AND appointment.specialty_id = p_specialty_id THEN 'Mesma especialidade no mesmo dia'
             ELSE 'Procedimento semelhante ja agendado'
           END AS conflict_reason
      FROM public.appointments AS appointment
      LEFT JOIN public.units AS unit_record ON unit_record.id = appointment.unit_id
      LEFT JOIN public.professionals AS professional ON professional.id = appointment.professional_id
      LEFT JOIN public.services_catalog AS service_record ON service_record.id = appointment.service_id
     WHERE appointment.company_id = v_company
       AND appointment.patient_id = p_patient_id
       AND (p_unit_id IS NULL OR appointment.unit_id = p_unit_id)
       AND (p_exclude_appointment_id IS NULL OR appointment.id <> p_exclude_appointment_id)
       AND LOWER(appointment.status) NOT IN
           ('completed','realizado','cancelled','cancelado','no_show','no-show','noshow','rescheduled','remarcado')
       AND (
         (appointment.appointment_date = p_appointment_date
          AND appointment.start_time < v_end_time
          AND COALESCE(appointment.end_time,
                appointment.start_time + make_interval(mins => COALESCE(appointment.duration_minutes, 30))) > p_start_time)
         OR (p_specialty_id IS NOT NULL AND appointment.specialty_id = p_specialty_id
             AND appointment.appointment_date = p_appointment_date)
         OR (p_service_id IS NOT NULL AND appointment.service_id = p_service_id
             AND appointment.appointment_date BETWEEN p_appointment_date - 30 AND p_appointment_date + 30)
       )
  )
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
           'appointmentId', candidate.id::TEXT,
           'level', candidate.conflict_level,
           'reason', candidate.conflict_reason,
           'appointmentDate', candidate.appointment_date::TEXT,
           'startTime', candidate.start_time::TEXT,
           'endTime', candidate.end_time::TEXT,
           'unitName', candidate.unit_name,
           'professionalName', candidate.professional_name,
           'serviceName', candidate.service_name,
           'status', candidate.status
         ) ORDER BY candidate.appointment_date, candidate.start_time), '[]'::JSONB),
         COALESCE(BOOL_OR(candidate.conflict_level = 'blocking'), FALSE)
    INTO v_conflicts, v_blocked
    FROM candidates AS candidate;

  RETURN JSONB_BUILD_OBJECT(
    'hasConflict', JSONB_ARRAY_LENGTH(v_conflicts) > 0,
    'blocked', v_blocked,
    'justificationRequired', v_blocked,
    'canOverride', FALSE,
    'conflicts', v_conflicts
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.m9_get_patient_appointments_timeline_secure(
  p_patient_id BIGINT,
  p_filters JSONB DEFAULT '{}'::JSONB,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_page INTEGER := GREATEST(COALESCE(p_page, 1), 1);
  v_page_size INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  v_today DATE := timezone('America/Sao_Paulo', NOW())::DATE;
  v_patient public.patients%ROWTYPE;
  v_groups JSONB;
  v_summary JSONB;
  v_total INTEGER;
BEGIN
  IF v_company IS NULL OR NOT public.can_access('agenda', 'view') THEN
    RAISE EXCEPTION 'Acesso a agenda negado' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM JSONB_OBJECT_KEYS(COALESCE(p_filters, '{}'::JSONB)) AS filter_key(key)
     WHERE filter_key.key NOT IN (
       'from', 'to', 'status', 'appointmentType', 'unitId',
       'professionalId', 'specialtyId', 'serviceId', 'insuranceId',
       'isReturn', 'isWalkin', 'section'
     )
  ) THEN
    RAISE EXCEPTION 'Filtro de timeline ainda nao suportado pelo contrato canonico'
      USING ERRCODE = '22023';
  END IF;

  SELECT patient.* INTO v_patient
    FROM public.patients AS patient
   WHERE patient.id = p_patient_id
     AND patient.company_id = v_company
     AND patient.lg_ativo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente nao encontrado no contexto ativo' USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*)::INTEGER
    INTO v_total
    FROM public.appointments AS appointment
   WHERE appointment.company_id = v_company
     AND appointment.patient_id = p_patient_id
     AND (NULLIF(p_filters->>'from', '') IS NULL OR appointment.appointment_date >= (p_filters->>'from')::DATE)
     AND (NULLIF(p_filters->>'to', '') IS NULL OR appointment.appointment_date <= (p_filters->>'to')::DATE)
     AND (NULLIF(p_filters->>'status', '') IS NULL OR LOWER(appointment.status) = LOWER(p_filters->>'status'))
     AND (NULLIF(p_filters->>'unitId', '') IS NULL OR appointment.unit_id = (p_filters->>'unitId')::INTEGER)
     AND (NULLIF(p_filters->>'professionalId', '') IS NULL OR appointment.professional_id = (p_filters->>'professionalId')::BIGINT)
     AND (NULLIF(p_filters->>'specialtyId', '') IS NULL OR appointment.specialty_id = (p_filters->>'specialtyId')::INTEGER)
     AND (NULLIF(p_filters->>'serviceId', '') IS NULL OR appointment.service_id = (p_filters->>'serviceId')::BIGINT)
     AND (NULLIF(p_filters->>'insuranceId', '') IS NULL OR appointment.insurance_company_id = (p_filters->>'insuranceId')::INTEGER)
     AND (NULLIF(p_filters->>'isReturn', '') IS NULL OR COALESCE(appointment.is_return, FALSE) = (p_filters->>'isReturn')::BOOLEAN)
     AND (NULLIF(p_filters->>'isWalkin', '') IS NULL OR COALESCE(appointment.is_walkin, FALSE) = (p_filters->>'isWalkin')::BOOLEAN)
     AND (
       NULLIF(p_filters->>'appointmentType', '') IS NULL
       OR EXISTS (
         SELECT 1 FROM public.appointment_types AS type_record
          WHERE type_record.id = appointment.appointment_type_id
            AND LOWER(type_record.name) = LOWER(p_filters->>'appointmentType')
       )
     )
     AND (
       COALESCE(NULLIF(p_filters->>'section', ''), 'all') = 'all'
       OR CASE
            WHEN appointment.appointment_date = v_today THEN 'today'
            WHEN appointment.appointment_date < v_today OR LOWER(appointment.status) IN
              ('completed','realizado','cancelled','cancelado','no_show','no-show','noshow','rescheduled','remarcado')
              THEN 'history'
            ELSE 'upcoming'
          END = p_filters->>'section'
     );

  WITH filtered AS (
    SELECT appointment.*,
           CASE
             WHEN appointment.appointment_date = v_today THEN 'today'
             WHEN appointment.appointment_date < v_today OR LOWER(appointment.status) IN
               ('completed','realizado','cancelled','cancelado','no_show','no-show','noshow','rescheduled','remarcado')
               THEN 'history'
             ELSE 'upcoming'
           END AS section,
           unit_record.ds_nome AS unit_name,
           professional.full_name AS professional_name,
           specialty.name AS specialty_name,
           service_record.name AS service_name,
           appointment_type.name AS appointment_type_name,
           insurance.name AS insurance_name,
           insurance_plan.name AS insurance_plan_name,
           patient_insurance.card_number
      FROM public.appointments AS appointment
      LEFT JOIN public.units AS unit_record ON unit_record.id = appointment.unit_id
      LEFT JOIN public.professionals AS professional ON professional.id = appointment.professional_id
      LEFT JOIN public.specialties AS specialty ON specialty.id = appointment.specialty_id
      LEFT JOIN public.services_catalog AS service_record ON service_record.id = appointment.service_id
      LEFT JOIN public.appointment_types AS appointment_type ON appointment_type.id = appointment.appointment_type_id
      LEFT JOIN public.insurance_companies AS insurance ON insurance.id = appointment.insurance_company_id
      LEFT JOIN public.insurance_plans AS insurance_plan ON insurance_plan.id = appointment.insurance_plan_id
      LEFT JOIN LATERAL (
        SELECT linked_insurance.card_number
          FROM public.patient_insurances AS linked_insurance
         WHERE linked_insurance.company_id = v_company
           AND linked_insurance.patient_id = p_patient_id
           AND linked_insurance.status = 'active'
           AND (appointment.insurance_plan_id IS NULL OR
                linked_insurance.insurance_plan_id = appointment.insurance_plan_id)
         ORDER BY linked_insurance.is_primary DESC, linked_insurance.updated_at DESC
         LIMIT 1
      ) AS patient_insurance ON TRUE
     WHERE appointment.company_id = v_company
       AND appointment.patient_id = p_patient_id
       AND (NULLIF(p_filters->>'from', '') IS NULL OR appointment.appointment_date >= (p_filters->>'from')::DATE)
       AND (NULLIF(p_filters->>'to', '') IS NULL OR appointment.appointment_date <= (p_filters->>'to')::DATE)
       AND (NULLIF(p_filters->>'status', '') IS NULL OR LOWER(appointment.status) = LOWER(p_filters->>'status'))
       AND (NULLIF(p_filters->>'unitId', '') IS NULL OR appointment.unit_id = (p_filters->>'unitId')::INTEGER)
       AND (NULLIF(p_filters->>'professionalId', '') IS NULL OR appointment.professional_id = (p_filters->>'professionalId')::BIGINT)
       AND (NULLIF(p_filters->>'specialtyId', '') IS NULL OR appointment.specialty_id = (p_filters->>'specialtyId')::INTEGER)
       AND (NULLIF(p_filters->>'serviceId', '') IS NULL OR appointment.service_id = (p_filters->>'serviceId')::BIGINT)
       AND (NULLIF(p_filters->>'insuranceId', '') IS NULL OR appointment.insurance_company_id = (p_filters->>'insuranceId')::INTEGER)
       AND (NULLIF(p_filters->>'isReturn', '') IS NULL OR COALESCE(appointment.is_return, FALSE) = (p_filters->>'isReturn')::BOOLEAN)
       AND (NULLIF(p_filters->>'isWalkin', '') IS NULL OR COALESCE(appointment.is_walkin, FALSE) = (p_filters->>'isWalkin')::BOOLEAN)
       AND (
         NULLIF(p_filters->>'appointmentType', '') IS NULL
         OR LOWER(appointment_type.name) = LOWER(p_filters->>'appointmentType')
       )
  ), scoped AS (
    SELECT * FROM filtered
     WHERE COALESCE(NULLIF(p_filters->>'section', ''), 'all') = 'all'
        OR section = p_filters->>'section'
  ), numbered AS (
    SELECT scoped.*
      FROM scoped
     ORDER BY
       CASE scoped.section WHEN 'today' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END,
       CASE WHEN scoped.section = 'history' THEN NULL ELSE scoped.appointment_date END ASC,
       CASE WHEN scoped.section = 'history' THEN scoped.appointment_date END DESC,
       scoped.start_time
     OFFSET (v_page - 1) * v_page_size
     LIMIT v_page_size
  ), records AS (
    SELECT numbered.section,
           numbered.appointment_date,
           numbered.start_time,
           JSONB_BUILD_OBJECT(
             'id', numbered.id::TEXT,
             'appointmentDate', numbered.appointment_date::TEXT,
             'startTime', numbered.start_time::TEXT,
             'endTime', numbered.end_time::TEXT,
             'timezone', 'America/Sao_Paulo',
             'status', numbered.status,
             'appointmentType', numbered.appointment_type_name,
             'isReturn', COALESCE(numbered.is_return, FALSE),
             'isWalkin', COALESCE(numbered.is_walkin, FALSE),
             'isTeleconsult', FALSE,
             'unitId', numbered.unit_id,
             'unitName', numbered.unit_name,
             'professionalId', numbered.professional_id::TEXT,
             'professionalName', numbered.professional_name,
             'specialtyId', numbered.specialty_id::TEXT,
             'specialtyName', numbered.specialty_name,
             'serviceId', numbered.service_id::TEXT,
             'serviceName', numbered.service_name,
             'roomName', NULL,
             'equipmentName', NULL,
             'insuranceName', numbered.insurance_name,
             'insuranceId', numbered.insurance_company_id,
             'insurancePlanName', numbered.insurance_plan_name,
             'cardNumber', numbered.card_number,
             'authorizationStatus', NULL,
             'authorizationNumber', NULL,
             'paymentStatus', NULL,
             'preparationStatus', NULL,
             'confirmationStatus', CASE WHEN numbered.lg_confirmado THEN 'confirmed' ELSE 'pending' END,
             'sourceChannel', NULL,
             'operatorName', NULL,
             'rescheduledFromId', NULL,
             'rescheduledToId', NULL,
             'notes', COALESCE(numbered.notes, numbered.ds_observacoes),
             'createdAt', numbered.created_at,
             'updatedAt', numbered.updated_at,
             'allowedActions', CASE
               WHEN public.can_access('agenda', 'edit') AND LOWER(numbered.status) NOT IN
                 ('completed','realizado','cancelled','cancelado')
               THEN '["reschedule","cancel"]'::JSONB ELSE '[]'::JSONB END
           ) AS payload,
           numbered.id AS stable_order_id
      FROM numbered
  ), grouped AS (
    SELECT records.section,
           records.appointment_date,
           JSONB_AGG(records.payload ORDER BY records.start_time, records.stable_order_id) AS appointments
      FROM records
     GROUP BY records.section, records.appointment_date
  )
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
           'date', grouped.appointment_date::TEXT,
           'section', grouped.section,
           'appointments', grouped.appointments
         ) ORDER BY CASE grouped.section WHEN 'today' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END,
                    CASE WHEN grouped.section = 'history' THEN grouped.appointment_date END DESC,
                    CASE WHEN grouped.section <> 'history' THEN grouped.appointment_date END ASC), '[]'::JSONB)
    INTO v_groups
    FROM grouped;

  SELECT JSONB_BUILD_OBJECT(
    'nextAppointment', (
      SELECT JSONB_BUILD_OBJECT('id', appointment.id::TEXT,
               'appointmentDate', appointment.appointment_date::TEXT,
               'startTime', appointment.start_time::TEXT,
               'status', appointment.status,
               'timezone', 'America/Sao_Paulo')
        FROM public.appointments AS appointment
       WHERE appointment.company_id = v_company AND appointment.patient_id = p_patient_id
         AND appointment.appointment_date >= v_today
         AND LOWER(appointment.status) NOT IN ('completed','realizado','cancelled','cancelado','no_show','no-show','noshow')
       ORDER BY appointment.appointment_date, appointment.start_time LIMIT 1
    ),
    'todayCount', COUNT(*) FILTER (WHERE appointment_date = v_today),
    'upcomingCount', COUNT(*) FILTER (WHERE appointment_date > v_today),
    'completedCount', COUNT(*) FILTER (WHERE LOWER(status) IN ('completed','realizado')),
    'cancelledCount', COUNT(*) FILTER (WHERE LOWER(status) IN ('cancelled','cancelado')),
    'noShowCount', COUNT(*) FILTER (WHERE LOWER(status) IN ('no_show','no-show','noshow')),
    'pendingConfirmationCount', COUNT(*) FILTER (WHERE NOT COALESCE(lg_confirmado, FALSE)),
    'pendingAuthorizationCount', 0,
    'pendingPaymentCount', 0,
    'pendingPreparationCount', 0
  ) INTO v_summary
  FROM public.appointments
  WHERE company_id = v_company AND patient_id = p_patient_id;

  RETURN JSONB_BUILD_OBJECT(
    'patient', JSONB_BUILD_OBJECT(
      'id', v_patient.id::TEXT,
      'name', v_patient.full_name,
      'socialName', v_patient.social_name,
      'birthDate', COALESCE(v_patient.birth_date, v_patient.dt_nascimento)::TEXT,
      'cpfMasked', CASE WHEN COALESCE(v_patient.cpf, v_patient.nr_cpf, v_patient.cd_cpf) IS NULL THEN NULL
                        ELSE '***.***.***-' || RIGHT(REGEXP_REPLACE(COALESCE(v_patient.cpf, v_patient.nr_cpf, v_patient.cd_cpf), '\\D', '', 'g'), 2) END,
      'phone', COALESCE(v_patient.phone, v_patient.nr_telefone),
      'insuranceName', NULL
    ),
    'summary', v_summary,
    'groups', v_groups,
    'pagination', JSONB_BUILD_OBJECT(
      'page', v_page,
      'pageSize', v_page_size,
      'total', v_total,
      'totalPages', CASE WHEN v_total = 0 THEN 0 ELSE CEIL(v_total::NUMERIC / v_page_size)::INTEGER END
    ),
    'permissions', JSONB_BUILD_OBJECT(
      'viewFinancial', public.can_access('faturamento', 'view'),
      'viewAuthorization', public.can_access('recepcao', 'view'),
      'reschedule', public.can_access('agenda', 'edit'),
      'cancel', public.can_access('agenda', 'edit'),
      'overrideConflict', public.current_context_is_company_admin(v_company),
      'viewAudit', public.can_access('auditoria', 'view')
    )
  );
END
$function$;

DO $owner_contract$
BEGIN
  IF to_regrole('prontomedic_rpc_owner') IS NULL THEN
    RAISE EXCEPTION 'prontomedic_rpc_owner is required for nursing commands';
  END IF;
END
$owner_contract$;

GRANT USAGE ON SCHEMA public, auth TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_company_id() TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_unit_id() TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT) TO prontomedic_rpc_owner;
GRANT SELECT ON public.professionals TO prontomedic_rpc_owner;
GRANT SELECT, UPDATE ON public.nursing_medication_administrations
  TO prontomedic_rpc_owner;

ALTER FUNCTION public.nursing_administer_medication_secure(BIGINT, BIGINT)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION public.nursing_refuse_medication_secure(BIGINT, TEXT)
  OWNER TO prontomedic_rpc_owner;

REVOKE UPDATE ON public.nursing_medication_administrations
  FROM PUBLIC, anon, authenticated, app_prontomedic;

REVOKE ALL ON FUNCTION public.nursing_bedside_check_secure(BIGINT, BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nursing_administer_medication_secure(BIGINT, BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nursing_refuse_medication_secure(BIGINT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_prescription_safety(BIGINT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m9_check_patient_appointment_conflicts_secure(
  BIGINT, DATE, TIME, TIME, INTEGER, BIGINT, INTEGER, BIGINT, BIGINT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m9_get_patient_appointments_timeline_secure(
  BIGINT, JSONB, INTEGER, INTEGER
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.nursing_bedside_check_secure(BIGINT, BIGINT)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.nursing_administer_medication_secure(BIGINT, BIGINT)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.nursing_refuse_medication_secure(BIGINT, TEXT)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.check_prescription_safety(BIGINT, TEXT)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m9_check_patient_appointment_conflicts_secure(
  BIGINT, DATE, TIME, TIME, INTEGER, BIGINT, INTEGER, BIGINT, BIGINT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m9_get_patient_appointments_timeline_secure(
  BIGINT, JSONB, INTEGER, INTEGER
) TO authenticated, app_prontomedic;

COMMIT;

-- Module 11: close insurance-card and procedure-authorization integrity gaps.
-- Keep the prior pre-check as the canonical document/consent evaluator and
-- add the payer-specific constraints without weakening tenant/unit checks.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.get_reception_precheckin_context_legacy(bigint)') IS NULL THEN
    ALTER FUNCTION public.get_reception_precheckin_context(BIGINT)
      RENAME TO get_reception_precheckin_context_legacy;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_reception_precheckin_context(
  p_appointment_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_context JSONB;
  v_appointment public.appointments;
  v_extra_insurance_issues JSONB := '[]'::JSONB;
  v_extra_authorization_issues JSONB := '[]'::JSONB;
  v_authorization_required BOOLEAN := FALSE;
  v_has_card BOOLEAN := FALSE;
  v_authorization_ok BOOLEAN := FALSE;
  v_card_number TEXT;
  v_authorization_number TEXT;
  v_authorization_password TEXT;
  v_authorization_valid_until DATE;
  v_authorization_procedure_id BIGINT;
  v_authorization_procedure_desc TEXT;
  v_insurance_issues JSONB;
  v_authorization_issues JSONB;
  v_issues JSONB;
BEGIN
  v_context := public.get_reception_precheckin_context_legacy(p_appointment_id);

  SELECT * INTO v_appointment
    FROM public.appointments
   WHERE id = p_appointment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado';
  END IF;

  IF v_appointment.insurance_plan_id IS NOT NULL
     AND v_appointment.patient_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.patient_insurances pi
       WHERE pi.company_id = v_appointment.company_id
         AND pi.patient_id = v_appointment.patient_id
         AND pi.insurance_plan_id = v_appointment.insurance_plan_id
         AND COALESCE(NULLIF(lower(pi.status), ''), 'active') = 'active'
         AND (pi.valid_until IS NULL OR pi.valid_until >= CURRENT_DATE)
         AND NULLIF(btrim(COALESCE(pi.card_number, '')), '') IS NOT NULL
    ) INTO v_has_card;

    SELECT pi.card_number
      INTO v_card_number
      FROM public.patient_insurances pi
     WHERE pi.company_id = v_appointment.company_id
       AND pi.patient_id = v_appointment.patient_id
       AND pi.insurance_plan_id = v_appointment.insurance_plan_id
       AND COALESCE(NULLIF(lower(pi.status), ''), 'active') = 'active'
       AND (pi.valid_until IS NULL OR pi.valid_until >= CURRENT_DATE)
       AND NULLIF(btrim(COALESCE(pi.card_number, '')), '') IS NOT NULL
     ORDER BY pi.updated_at DESC NULLS LAST, pi.created_at DESC
     LIMIT 1;

    IF NOT v_has_card THEN
      v_extra_insurance_issues := jsonb_build_array(jsonb_build_object(
        'type', 'insurance_card',
        'severity', 'blocking',
        'description', 'Numero da carteirinha do convenio ausente ou invalido'
      ));
    END IF;

    SELECT COALESCE(company.lg_autorizac_obrigatorio, FALSE)
      INTO v_authorization_required
      FROM public.insurance_plans plan
      JOIN public.insurance_companies company
        ON company.id = plan.insurance_company_id
       AND company.company_id = plan.company_id
     WHERE plan.id = v_appointment.insurance_plan_id
       AND plan.company_id = v_appointment.company_id
     LIMIT 1;

    IF v_authorization_required THEN
      SELECT auth_row.authorization_number,
             auth_row.password_number,
             auth_row.valid_until,
             auth_row.procedure_id,
             auth_row.procedure_desc
        INTO v_authorization_number,
             v_authorization_password,
             v_authorization_valid_until,
             v_authorization_procedure_id,
             v_authorization_procedure_desc
        FROM public.reception_authorizations auth_row
       WHERE auth_row.company_id = v_appointment.company_id
         AND auth_row.patient_id = v_appointment.patient_id
         AND auth_row.appointment_id = v_appointment.id
       ORDER BY auth_row.updated_at DESC NULLS LAST,
                auth_row.created_at DESC
       LIMIT 1;

      SELECT EXISTS (
        SELECT 1
          FROM public.reception_authorizations auth_row
         WHERE auth_row.company_id = v_appointment.company_id
           AND auth_row.patient_id = v_appointment.patient_id
           AND auth_row.appointment_id = v_appointment.id
           AND auth_row.status IN (
             'autorizada',
             'parcialmente_autorizada',
             'liberada_excecao'
           )
           AND (auth_row.valid_until IS NULL OR auth_row.valid_until >= CURRENT_DATE)
           AND (
             auth_row.quantity_authorized IS NULL
             OR auth_row.quantity_authorized > COALESCE(auth_row.quantity_used, 0)
           )
           AND (
             auth_row.status = 'liberada_excecao'
             OR (
               NULLIF(btrim(COALESCE(auth_row.authorization_number, '')), '') IS NOT NULL
               AND (
                 v_appointment.service_id IS NULL
                 OR auth_row.procedure_id = v_appointment.service_id
               )
             )
           )
      ) INTO v_authorization_ok;

      IF NOT v_authorization_ok THEN
        v_extra_authorization_issues := jsonb_build_array(jsonb_build_object(
          'type', 'authorization_integrity',
          'severity', 'blocking',
          'description', 'Autorizacao sem numero valido ou vinculada a outro procedimento'
        ));
      END IF;
    END IF;
  END IF;

  v_insurance_issues := COALESCE(v_context->'insurance_issues', '[]'::JSONB)
    || v_extra_insurance_issues;
  v_authorization_issues := COALESCE(v_context->'authorization_issues', '[]'::JSONB)
    || v_extra_authorization_issues;
  v_issues := COALESCE(v_context->'document_issues', '[]'::JSONB)
    || COALESCE(v_context->'consent_issues', '[]'::JSONB)
    || v_insurance_issues
    || v_authorization_issues;

  RETURN v_context || jsonb_build_object(
    'ready', jsonb_array_length(v_issues) = 0,
    'has_insurance_pending', jsonb_array_length(v_insurance_issues) > 0,
    'has_authorization_pending', jsonb_array_length(v_authorization_issues) > 0,
    'insurance_issues', v_insurance_issues,
    'authorization_issues', v_authorization_issues,
    'insurance_card_number', v_card_number,
    'authorization_required', v_authorization_required,
    'authorization_number', v_authorization_number,
    'authorization_password', v_authorization_password,
    'authorization_valid_until', v_authorization_valid_until,
    'authorization_procedure_id', v_authorization_procedure_id,
    'authorization_procedure_desc', v_authorization_procedure_desc,
    'issues', v_issues
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_reception_precheckin_context(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reception_precheckin_context(BIGINT)
  TO authenticated, app_prontomedic;

DO $$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.prontomedic_deployment_migrations
        WHERE filename = '20260731113000_reception_insurance_authorization_integrity.sql'
     ) THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260731113000_reception_insurance_authorization_integrity.sql', NOW());
  END IF;
END
$$;

COMMIT;

BEGIN;

DO $rpc$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_rpc_owner') THEN
    CREATE ROLE prontomedic_rpc_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
END
$rpc$;

ALTER ROLE prontomedic_rpc_owner
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;

DO $rpc$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT authenticated TO prontomedic_rpc_owner;
  END IF;
END
$rpc$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $rpc$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'app_prontomedic']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', role_name);
    END IF;
  END LOOP;
END
$rpc$;

DO $rpc$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    ALTER ROLE app_prontomedic NOINHERIT NOBYPASSRLS;
  END IF;
END
$rpc$;

GRANT USAGE ON SCHEMA public TO prontomedic_rpc_owner;
-- PostgreSQL exige CREATE no schema durante a troca de owner; o grant e
-- estritamente temporario e e revogado antes do COMMIT.
GRANT CREATE ON SCHEMA public TO prontomedic_rpc_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO prontomedic_rpc_owner;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public
  TO prontomedic_rpc_owner;

CREATE TEMP TABLE rpc_proxy_contract (
  fn REGPROCEDURE PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO rpc_proxy_contract(fn) VALUES
  ('public.administer_nursing_medication_secure(bigint,bigint,uuid)'::REGPROCEDURE),
  ('public.bedside_check(bigint,bigint)'::REGPROCEDURE),
  ('public.calcular_valor_estoque(uuid)'::REGPROCEDURE),
  ('public.calc_imc(numeric,numeric)'::REGPROCEDURE),
  ('public.call_nursing_triage_secure(bigint,uuid)'::REGPROCEDURE),
  ('public.cancel_schedule_block_secure(bigint)'::REGPROCEDURE),
  ('public.close_waitlist_entry_secure(bigint,text,text)'::REGPROCEDURE),
  ('public.complete_nursing_triage_secure(bigint,bigint,integer,jsonb,uuid)'::REGPROCEDURE),
  ('public.convert_waitlist_to_appointment_secure(bigint,date,time without time zone,time without time zone)'::REGPROCEDURE),
  ('public.create_appointment_secure(bigint,bigint,date,time without time zone,time without time zone,uuid,integer,integer,bigint,bigint,text,boolean,boolean,text)'::REGPROCEDURE),
  ('public.create_appointment_with_requirements_secure(bigint,bigint,date,time without time zone,time without time zone,uuid,integer,integer,bigint,bigint,text,boolean,boolean,text,integer,text,text)'::REGPROCEDURE),
  ('public.create_billing_secure(bigint,numeric,text,text)'::REGPROCEDURE),
  ('public.create_medical_record_secure(bigint,bigint,bigint,date,text,text,text,text,jsonb,text)'::REGPROCEDURE),
  ('public.create_nursing_medication_secure(bigint,text,text,text,timestamp with time zone,uuid)'::REGPROCEDURE),
  ('public.create_nursing_shift_handoff_secure(date,text,text,jsonb,jsonb,text,uuid)'::REGPROCEDURE),
  ('public.create_professional_payment(uuid,bigint,bigint,date,text,integer,numeric,numeric,text,numeric,text)'::REGPROCEDURE),
  ('public.create_schedule_block_secure(timestamp with time zone,timestamp with time zone,text,bigint,integer,text)'::REGPROCEDURE),
  ('public.create_waitlist_entry_secure(bigint,text,bigint,integer,bigint,integer,date,date,text,text,text)'::REGPROCEDURE),
  ('public.current_company_id()'::REGPROCEDURE),
  ('public.dispensar_estoque(uuid,bigint,jsonb,bigint,bigint,text)'::REGPROCEDURE),
  ('public.enqueue_nursing_triage_secure(bigint,text,integer,uuid)'::REGPROCEDURE),
  ('public.finalize_medical_attendance_secure(bigint,date,text,text,text,text,jsonb,text)'::REGPROCEDURE),
  ('public.get_billing_balance_secure(bigint)'::REGPROCEDURE),
  ('public.get_professional_available_slots(bigint,date,integer,integer)'::REGPROCEDURE),
  ('public.get_reception_checkin_readiness(bigint)'::REGPROCEDURE),
  ('public.get_scheduling_requirements(bigint,bigint,bigint,integer,text)'::REGPROCEDURE),
  ('public.list_billing_financial_summary_secure()'::REGPROCEDURE),
  ('public.list_billing_production_secure()'::REGPROCEDURE),
  ('public.list_professional_payments(bigint,bigint,text,date,date,integer,integer,text)'::REGPROCEDURE),
  ('public.list_tiss_glosas_read_secure(bigint)'::REGPROCEDURE),
  ('public.list_tiss_protocols_read_secure()'::REGPROCEDURE),
  ('public.list_tiss_read_model_secure(integer,integer,integer)'::REGPROCEDURE),
  ('public.mark_overdue_appointments_no_show_secure(date,integer)'::REGPROCEDURE),
  ('public.perform_reception_checkin_secure(bigint,text,text)'::REGPROCEDURE),
  ('public.record_billing_receipt_secure(bigint,numeric,text,uuid)'::REGPROCEDURE),
  ('public.record_confirmation_attempt_secure(bigint,text,text,text)'::REGPROCEDURE),
  ('public.record_nursing_procedure_secure(bigint,text,text,boolean,uuid)'::REGPROCEDURE),
  ('public.registrar_movimentacao_estoque(bigint,character varying,integer,text,bigint,bigint,bigint,text)'::REGPROCEDURE),
  ('public.refresh_confirmation_queue_secure(integer)'::REGPROCEDURE),
  ('public.refuse_nursing_medication_secure(bigint,text,uuid)'::REGPROCEDURE),
  ('public.report_nursing_incident_secure(bigint,text,text,text,uuid)'::REGPROCEDURE),
  ('public.reschedule_appointment_secure(bigint,date,time without time zone,time without time zone,text)'::REGPROCEDURE),
  ('public.reverse_billing_receipt_secure(bigint,text,uuid)'::REGPROCEDURE),
  ('public.save_or_release_lab_result_secure(bigint,text,uuid,jsonb,boolean)'::REGPROCEDURE),
  ('public.sign_medical_record_secure(bigint)'::REGPROCEDURE),
  ('public.transition_professional_payment(uuid,bigint,text,text,date)'::REGPROCEDURE),
  ('public.update_appointment_status_secure(bigint,text,text)'::REGPROCEDURE),
  ('public.update_billing_status_secure(bigint,text,text)'::REGPROCEDURE),
  ('public.update_medical_record_secure(bigint,jsonb)'::REGPROCEDURE),
  ('public.update_reception_authorization_secure(uuid,text,text,text,text,date,integer,text)'::REGPROCEDURE),
  ('public.update_reception_eligibility_secure(uuid,text,text,text)'::REGPROCEDURE);

DO $rpc$
DECLARE
  function_ref REGPROCEDURE;
  owner_is_unsafe BOOLEAN;
  role_name TEXT;
BEGIN
  IF (SELECT COUNT(*) FROM rpc_proxy_contract) <> 51 THEN
    RAISE EXCEPTION 'RPC proxy contract must contain exactly 51 signatures';
  END IF;

  FOR function_ref IN SELECT fn FROM rpc_proxy_contract
  LOOP
    SELECT function_row.prosecdef
           AND (owner_role.rolsuper OR owner_role.rolbypassrls)
      INTO owner_is_unsafe
      FROM pg_proc function_row
      JOIN pg_roles owner_role ON owner_role.oid = function_row.proowner
     WHERE function_row.oid = function_ref::OID;

    IF owner_is_unsafe THEN
      EXECUTE format('ALTER FUNCTION %s OWNER TO prontomedic_rpc_owner', function_ref);
    END IF;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', function_ref);
    FOREACH role_name IN ARRAY ARRAY['anon', 'app_prontomedic']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', function_ref, role_name);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', function_ref);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', function_ref);
    END IF;
  END LOOP;
END
$rpc$;

DO $rpc$
DECLARE
  function_ref REGPROCEDURE;
  role_name TEXT;
BEGIN
  FOR function_ref IN
    SELECT function_row.oid::REGPROCEDURE
      FROM pg_proc function_row
      JOIN pg_namespace namespace_row ON namespace_row.oid = function_row.pronamespace
     WHERE namespace_row.nspname = 'public'
       AND function_row.proname = ANY (ARRAY[
         'anonymize_patient',
         'calcular_kpis_diarios',
         'cancel_pending_appointment_notifications',
         'cancel_pre_cadastro',
         'complete_call_center_task_secure',
         'confirm_pre_cadastro',
         'create_call_center_contact_secure',
         'create_call_center_task_secure',
         'create_pre_cadastro',
         'criar_sala_telemedicina',
         'detectar_alertas_bi',
         'finalizar_sala_telemedicina',
         'find_price',
         'get_my_notification_preferences',
         'log_data_access',
         'mark_all_my_notifications_read',
         'mark_my_notification_read',
         'pre_confirm_pre_cadastro',
         'promote_pre_cadastro',
         'publish_dicom_report',
         'queue_notification',
         'registrar_consentimento_gravacao',
         'renew_pre_cadastro_confirmation',
         'retry_notification',
         'set_my_notification_preference',
         'set_notification_preference',
         'update_appointment_secure',
         'update_patient_secure',
         'update_user_profile_secure'
       ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', function_ref);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'app_prontomedic']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', function_ref, role_name);
      END IF;
    END LOOP;
  END LOOP;
END
$rpc$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE CREATE ON SCHEMA public FROM prontomedic_rpc_owner;

COMMIT;


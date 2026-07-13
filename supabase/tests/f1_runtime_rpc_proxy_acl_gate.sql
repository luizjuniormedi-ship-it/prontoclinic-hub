\set ON_ERROR_STOP on

DO $gate$
DECLARE
  proxy_names TEXT[] := ARRAY[
    'administer_nursing_medication_secure', 'bedside_check', 'calc_imc',
    'calcular_valor_estoque', 'call_nursing_triage_secure',
    'cancel_schedule_block_secure',
    'close_waitlist_entry_secure', 'complete_nursing_triage_secure',
    'convert_waitlist_to_appointment_secure', 'create_appointment_secure',
    'create_appointment_with_requirements_secure', 'create_billing_secure',
    'create_medical_record_secure', 'create_nursing_medication_secure',
    'create_nursing_shift_handoff_secure', 'create_professional_payment',
    'create_schedule_block_secure', 'create_waitlist_entry_secure',
    'current_company_id', 'dispensar_estoque',
    'enqueue_nursing_triage_secure',
    'finalize_medical_attendance_secure', 'get_billing_balance_secure',
    'get_professional_available_slots', 'get_reception_checkin_readiness',
    'get_scheduling_requirements', 'list_billing_financial_summary_secure',
    'list_billing_production_secure', 'list_professional_payments',
    'list_tiss_glosas_read_secure', 'list_tiss_protocols_read_secure',
    'list_tiss_read_model_secure', 'mark_overdue_appointments_no_show_secure',
    'perform_reception_checkin_secure', 'record_billing_receipt_secure',
    'record_confirmation_attempt_secure', 'record_nursing_procedure_secure',
    'registrar_movimentacao_estoque',
    'refresh_confirmation_queue_secure', 'refuse_nursing_medication_secure',
    'report_nursing_incident_secure', 'reschedule_appointment_secure',
    'reverse_billing_receipt_secure', 'save_or_release_lab_result_secure',
    'sign_medical_record_secure', 'transition_professional_payment',
    'update_appointment_status_secure', 'update_billing_status_secure',
    'update_medical_record_secure', 'update_reception_authorization_secure',
    'update_reception_eligibility_secure'
  ];
  unsafe_owner_count INTEGER;
  public_execute_count INTEGER;
  anon_execute_count INTEGER;
  backend_execute_count INTEGER;
  authenticated_missing_count INTEGER;
  blocked_rpc_exposure_count INTEGER;
  billing_helper_exposure_count INTEGER;
  medical_record_policy_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = 'prontomedic_rpc_owner'
       AND NOT rolcanlogin
       AND NOT rolsuper
       AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'prontomedic_rpc_owner is missing or unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_auth_members membership
     WHERE membership.roleid = to_regrole('authenticated')::oid
       AND membership.member = to_regrole('prontomedic_rpc_owner')::oid
       AND membership.inherit_option
       AND NOT membership.set_option
       AND NOT membership.admin_option
  ) THEN
    RAISE EXCEPTION 'prontomedic_rpc_owner membership options are unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = 'app_prontomedic'
       AND NOT rolinherit
       AND NOT rolsuper
       AND NOT rolbypassrls
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_auth_members membership
     WHERE membership.roleid = to_regrole('authenticated')::oid
       AND membership.member = to_regrole('app_prontomedic')::oid
       AND NOT membership.inherit_option
       AND membership.set_option
       AND NOT membership.admin_option
  ) THEN
    RAISE EXCEPTION 'app_prontomedic must assume authenticated explicitly without inherited privileges';
  END IF;

  SELECT COUNT(*)
    INTO unsafe_owner_count
    FROM pg_proc function_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = function_row.pronamespace
    JOIN pg_roles owner_role ON owner_role.oid = function_row.proowner
   WHERE namespace_row.nspname = 'public'
     AND function_row.proname = ANY (ARRAY[
       'cancel_schedule_block_secure', 'close_waitlist_entry_secure',
       'convert_waitlist_to_appointment_secure', 'create_appointment_secure',
       'create_appointment_with_requirements_secure', 'create_billing_secure',
       'create_medical_record_secure', 'create_schedule_block_secure',
       'create_waitlist_entry_secure', 'current_company_id',
       'finalize_medical_attendance_secure', 'get_billing_balance_secure',
       'get_reception_checkin_readiness', 'get_scheduling_requirements',
       'list_billing_financial_summary_secure', 'list_billing_production_secure',
       'list_tiss_glosas_read_secure', 'list_tiss_protocols_read_secure',
       'list_tiss_read_model_secure', 'mark_overdue_appointments_no_show_secure',
       'perform_reception_checkin_secure', 'record_billing_receipt_secure',
       'record_confirmation_attempt_secure', 'refresh_confirmation_queue_secure',
       'reschedule_appointment_secure', 'reverse_billing_receipt_secure',
       'sign_medical_record_secure', 'update_appointment_status_secure',
       'update_billing_status_secure', 'update_medical_record_secure',
       'update_reception_authorization_secure', 'update_reception_eligibility_secure'
     ])
     AND (owner_role.rolsuper OR owner_role.rolbypassrls);

  IF unsafe_owner_count <> 0 THEN
    RAISE EXCEPTION 'unsafe SECURITY DEFINER owners remain: %', unsafe_owner_count;
  END IF;

  IF (
    SELECT COUNT(*)
      FROM pg_proc function_row
      JOIN pg_namespace namespace_row ON namespace_row.oid = function_row.pronamespace
     WHERE namespace_row.nspname = 'public'
       AND function_row.proname = ANY (proxy_names)
  ) <> 51 THEN
    RAISE EXCEPTION 'proxy catalog must contain exactly 51 non-overloaded functions';
  END IF;

  SELECT COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1
             FROM aclexplode(COALESCE(
               function_row.proacl,
               acldefault('f', function_row.proowner)
             )) acl
            WHERE acl.grantee = 0
              AND acl.privilege_type = 'EXECUTE'
         )),
         COUNT(*) FILTER (WHERE has_function_privilege('anon', function_row.oid, 'EXECUTE')),
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1
             FROM aclexplode(COALESCE(
               function_row.proacl,
               acldefault('f', function_row.proowner)
             )) acl
            WHERE acl.grantee = to_regrole('app_prontomedic')::oid
              AND acl.privilege_type = 'EXECUTE'
         )),
         COUNT(*) FILTER (WHERE NOT has_function_privilege('authenticated', function_row.oid, 'EXECUTE'))
    INTO public_execute_count, anon_execute_count, backend_execute_count,
         authenticated_missing_count
    FROM pg_proc function_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = function_row.pronamespace
   WHERE namespace_row.nspname = 'public'
     AND function_row.proname = ANY (proxy_names);

  IF public_execute_count <> 0
     OR anon_execute_count <> 0
     OR backend_execute_count <> 0
     OR authenticated_missing_count <> 0 THEN
    RAISE EXCEPTION 'proxy ACL mismatch public=% anon=% backend=% authenticated_missing=%',
      public_execute_count, anon_execute_count, backend_execute_count,
      authenticated_missing_count;
  END IF;

  SELECT COUNT(*)
    INTO blocked_rpc_exposure_count
    FROM pg_proc function_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = function_row.pronamespace
   WHERE namespace_row.nspname = 'public'
     AND function_row.proname = ANY (ARRAY[
       'anonymize_patient', 'calcular_kpis_diarios',
       'cancel_pending_appointment_notifications', 'cancel_pre_cadastro',
       'complete_call_center_task_secure', 'confirm_pre_cadastro',
       'create_call_center_contact_secure', 'create_call_center_task_secure',
       'create_pre_cadastro', 'criar_sala_telemedicina', 'detectar_alertas_bi',
       'finalizar_sala_telemedicina', 'find_price',
       'get_my_notification_preferences', 'log_data_access',
       'mark_all_my_notifications_read', 'mark_my_notification_read',
       'pre_confirm_pre_cadastro', 'promote_pre_cadastro', 'publish_dicom_report',
       'queue_notification', 'registrar_consentimento_gravacao',
       'renew_pre_cadastro_confirmation',
       'retry_notification', 'set_my_notification_preference',
       'set_notification_preference', 'update_appointment_secure',
       'update_patient_secure', 'update_user_profile_secure'
     ])
     AND (
       EXISTS (
         SELECT 1
           FROM aclexplode(COALESCE(
             function_row.proacl,
             acldefault('f', function_row.proowner)
           )) acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       )
       OR has_function_privilege('anon', function_row.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1
           FROM aclexplode(COALESCE(
             function_row.proacl,
             acldefault('f', function_row.proowner)
           )) acl
          WHERE acl.grantee = to_regrole('app_prontomedic')::oid
            AND acl.privilege_type = 'EXECUTE'
       )
     );

  IF blocked_rpc_exposure_count <> 0 THEN
    RAISE EXCEPTION 'blocked RPCs remain exposed: %', blocked_rpc_exposure_count;
  END IF;

  IF NOT has_function_privilege(
    'prontomedic_rpc_owner',
    'public.assert_billing_permission(boolean)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'prontomedic_rpc_owner',
    'public.can_transition_billing_status(text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'billing private helpers are unavailable to prontomedic_rpc_owner';
  END IF;

  SELECT COUNT(*)
    INTO billing_helper_exposure_count
    FROM pg_proc function_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = function_row.pronamespace
   WHERE namespace_row.nspname = 'public'
     AND function_row.proname = ANY (ARRAY[
       'assert_billing_permission', 'can_transition_billing_status'
     ])
     AND (function_row.proowner <> to_regrole('prontomedic_rpc_owner')::oid OR
       EXISTS (
         SELECT 1
           FROM aclexplode(COALESCE(
             function_row.proacl,
             acldefault('f', function_row.proowner)
           )) acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       )
       OR has_function_privilege('anon', function_row.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
     );

  IF billing_helper_exposure_count <> 0 THEN
    RAISE EXCEPTION 'billing private helpers have unsafe owner or API exposure: %',
      billing_helper_exposure_count;
  END IF;

  SELECT COUNT(*)
    INTO medical_record_policy_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'medical_records'
     AND policyname = ANY (ARRAY[
       'rpc_proxy_medical_records_insert',
       'rpc_proxy_medical_records_update'
     ])
     AND roles = ARRAY['prontomedic_rpc_owner']::name[]
     AND cmd IN ('INSERT', 'UPDATE');

  IF medical_record_policy_count <> 2 THEN
    RAISE EXCEPTION 'medical_records RPC owner policies are incomplete';
  END IF;

  RAISE NOTICE 'F1_RUNTIME_RPC_PROXY_ACL_GATE=PASS';
END
$gate$;


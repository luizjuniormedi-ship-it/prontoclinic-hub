-- M24 static contract. Run only after the M24 migration.
DO $contract$
DECLARE
  v_definition TEXT;
  v_owner TEXT;
  v_security_definer BOOLEAN;
  v_defaults SMALLINT;
  v_signature REGPROCEDURE;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_dicom_exam_by_appointment(bigint)'::REGPROCEDURE,
    'public.publish_dicom_report(bigint,boolean)'::REGPROCEDURE,
    'public.publish_dicom_report(bigint,boolean,uuid)'::REGPROCEDURE,
    'public.m24_receive_pacs_study_secure(text,text,date,text,text,text,text,uuid)'::REGPROCEDURE,
    'public.m24_create_imaging_order_secure(bigint,text,text,jsonb,text)'::REGPROCEDURE,
    'public.m24_cancel_imaging_order_secure(uuid,text)'::REGPROCEDURE
  ] LOOP
    SELECT role_record.rolname, procedure_record.prosecdef,
           procedure_record.pronargdefaults
      INTO v_owner, v_security_definer, v_defaults
    FROM pg_proc AS procedure_record
    JOIN pg_roles AS role_record ON role_record.oid = procedure_record.proowner
    WHERE procedure_record.oid = v_signature;

    IF v_owner <> 'prontomedic_worklist_rpc_owner' OR NOT v_security_definer THEN
      RAISE EXCEPTION 'M24 contract: unsafe owner/security for %', v_signature;
    END IF;
    IF NOT has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('app_prontomedic', v_signature, 'EXECUTE')
       OR has_function_privilege('anon', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'M24 contract: invalid grants for %', v_signature;
    END IF;
    IF has_function_privilege('public', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'M24 contract: PUBLIC executes %', v_signature;
    END IF;
  END LOOP;

  SELECT pronargdefaults INTO v_defaults
  FROM pg_proc
  WHERE oid = 'public.publish_dicom_report(bigint,boolean)'::REGPROCEDURE;
  IF v_defaults <> 0 THEN
    RAISE EXCEPTION 'M24 contract: two-argument publish keeps defaults';
  END IF;

  SELECT pronargdefaults INTO v_defaults
  FROM pg_proc
  WHERE oid = 'public.publish_dicom_report(bigint,boolean,uuid)'::REGPROCEDURE;
  IF v_defaults <> 0 THEN
    RAISE EXCEPTION 'M24 contract: three-argument publish keeps defaults';
  END IF;

  SELECT pg_get_functiondef(
    'public.create_report_for_received_study()'::REGPROCEDURE
  ) INTO v_definition;
  IF v_definition NOT ILIKE '%INSERT INTO public.reports%'
     OR v_definition ILIKE '%radiology_reports%'
     OR v_definition LIKE '%NEW.imaging_order_item_id ~*%' THEN
    RAISE EXCEPTION 'M24 contract: report trigger is not canonical/UUID-safe';
  END IF;

  SELECT pg_get_functiondef(
    'public.m24_receive_pacs_study_secure(text,text,date,text,text,text,text,uuid)'::REGPROCEDURE
  ) INTO v_definition;
  IF v_definition NOT ILIKE '%FROM public.dicom_worklist_queue%'
     OR v_definition NOT ILIKE '%INSERT INTO public.pacs_studies%'
     OR v_definition NOT ILIKE '%pg_advisory_xact_lock%'
     OR v_definition NOT ILIKE '%scheduled_procedure_step_id%'
     OR v_definition NOT ILIKE '%replay payload differs from canonical study%'
     OR v_definition NOT ILIKE '%source_node_id is distinct from%'
     OR v_definition NOT ILIKE '%station_aetitle is distinct from%'
     OR v_definition ILIKE '%radiology_reports%' THEN
    RAISE EXCEPTION 'M24 contract: PACS ingest is not anchored in canonical Worklist';
  END IF;

  SELECT pg_get_functiondef(
    'public.m24_create_imaging_order_secure(bigint,text,text,jsonb,text)'::REGPROCEDURE
  ) INTO v_definition;
  IF v_definition NOT ILIKE '%a.scheduled_at%'
     OR v_definition ILIKE '%America/Sao_Paulo%' THEN
    RAISE EXCEPTION 'M24 contract: imaging creation does not preserve canonical appointment scheduled_at';
  END IF;

  SELECT pg_get_functiondef(
    'public.m24_cancel_imaging_order_secure(uuid,text)'::REGPROCEDURE
  ) INTO v_definition;
  IF v_definition NOT ILIKE '%pg_advisory_xact_lock%'
     OR v_definition NOT ILIKE '%after acquisition/PACS%' THEN
    RAISE EXCEPTION 'M24 contract: cancellation is not serialized with PACS ingestion';
  END IF;

  IF NOT has_table_privilege(
    'prontomedic_worklist_rpc_owner', 'public.dicom_nodes', 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'm24_dicom_nodes_rpc_select'
      AND 'prontomedic_worklist_rpc_owner' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'M24 contract: PACS source node access is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'm24_pacs_studies_rpc_access'
      AND 'prontomedic_worklist_rpc_owner' = ANY(roles)
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'm24_reports_rpc_access'
      AND 'prontomedic_worklist_rpc_owner' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'M24 contract: owner-scoped RLS policies are missing';
  END IF;
END;
$contract$;

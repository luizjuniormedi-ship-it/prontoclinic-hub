-- Run after the corresponding rollback in a disposable database.
DO $guard$
DECLARE
  v_definition TEXT;
BEGIN
  IF current_database() !~ '^prontomedic_reception_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'M24 rollback contract is restricted to disposable reception databases';
  END IF;
  IF to_regprocedure(
    'public.m24_receive_pacs_study_secure(text,text,date,text,text,text,text,uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'M24 rollback did not remove PACS ingest RPC';
  END IF;
  IF to_regprocedure('public.m24_create_imaging_order_secure(bigint,text,text,jsonb,text)') IS NOT NULL OR to_regprocedure('public.m24_cancel_imaging_order_secure(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'M24 rollback did not remove order RPCs';
  END IF;
  IF NOT has_function_privilege(
    'public', 'public.get_dicom_exam_by_appointment(bigint)', 'EXECUTE'
  ) OR NOT has_function_privilege(
    'public', 'public.publish_dicom_report(bigint,boolean)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'M24 rollback did not restore legacy grants';
  END IF;
  IF (SELECT pronargdefaults FROM pg_proc
      WHERE oid = 'public.publish_dicom_report(bigint,boolean)'::REGPROCEDURE) <> 1
     OR (SELECT pronargdefaults FROM pg_proc
         WHERE oid = 'public.publish_dicom_report(bigint,boolean,uuid)'::REGPROCEDURE) <> 2 THEN
    RAISE EXCEPTION 'M24 rollback did not restore legacy defaults';
  END IF;
  SELECT pg_get_functiondef(
    'public.create_report_for_received_study()'::REGPROCEDURE
  ) INTO v_definition;
  IF v_definition NOT LIKE '%NEW.imaging_order_item_id ~*%' THEN
    RAISE EXCEPTION 'M24 rollback did not restore the exact prior trigger';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND policyname LIKE 'm24_%'
  ) THEN
    RAISE EXCEPTION 'M24 rollback left M24 RLS policies installed';
  END IF;
  IF NOT has_table_privilege(
    'prontomedic_worklist_rpc_owner', 'public.imaging_orders', 'SELECT'
  ) OR NOT has_table_privilege(
    'prontomedic_worklist_rpc_owner', 'public.imaging_order_items', 'SELECT,UPDATE'
  ) OR NOT has_table_privilege(
    'prontomedic_worklist_rpc_owner', 'public.dicom_worklist_queue', 'SELECT,UPDATE'
  ) THEN
    RAISE EXCEPTION 'M24 rollback removed pre-existing M10 owner privileges';
  END IF;
END;
$guard$;

DO $$
DECLARE
  v_policies INTEGER;
BEGIN
  SELECT count(*) INTO v_policies
  FROM pg_policies
  WHERE policyname IN (
    'app_imaging_patients_scoped', 'app_imaging_orders_select',
    'app_imaging_orders_insert', 'app_imaging_orders_update',
    'app_imaging_order_items_select', 'app_imaging_order_items_insert',
    'app_imaging_order_items_update', 'app_imaging_worklist_scoped',
    'app_imaging_worklist_update'
  );
  IF v_policies <> 9 THEN
    RAISE EXCEPTION 'policies endurecidas DICOM incompletas: %', v_policies;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname IN (
      'app_imaging_patients_tenant', 'app_imaging_appointments_tenant',
      'app_imaging_worklist_read', 'imaging_orders_scoped_select',
      'imaging_orders_owner_insert', 'dicom_worklist_queue_tenant_write'
    )
  ) THEN
    RAISE EXCEPTION 'policy DICOM permissiva permaneceu aplicada';
  END IF;
END
$$;

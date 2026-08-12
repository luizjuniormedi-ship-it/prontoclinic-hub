DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname IN (
      'app_imaging_patients_scoped', 'app_imaging_orders_select',
      'app_imaging_orders_insert', 'app_imaging_orders_update',
      'app_imaging_order_items_select', 'app_imaging_order_items_insert',
      'app_imaging_order_items_update', 'app_imaging_worklist_scoped',
      'app_imaging_worklist_update'
    )
  ) THEN
    RAISE EXCEPTION 'policies endurecidas DICOM ja existem antes da migration';
  END IF;
END
$$;

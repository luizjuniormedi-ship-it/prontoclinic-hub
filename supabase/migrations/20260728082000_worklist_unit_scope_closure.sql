BEGIN;

-- Worklist contains PHI and must never fall back to company-wide access when
-- the operational unit context is absent.
DROP POLICY IF EXISTS m10_imaging_orders_select ON public.imaging_orders;
CREATE POLICY m10_imaging_orders_select ON public.imaging_orders
  FOR SELECT TO authenticated
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (public.can_access('dicom', 'view') OR public.can_access('worklist', 'view'))
  );

DROP POLICY IF EXISTS m10_imaging_order_items_select ON public.imaging_order_items;
CREATE POLICY m10_imaging_order_items_select ON public.imaging_order_items
  FOR SELECT TO authenticated
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (public.can_access('dicom', 'view') OR public.can_access('worklist', 'view'))
  );

DROP POLICY IF EXISTS m10_worklist_queue_select ON public.dicom_worklist_queue;
CREATE POLICY m10_worklist_queue_select ON public.dicom_worklist_queue
  FOR SELECT TO authenticated
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (
      public.can_access('dicom', 'view')
      OR public.can_access('worklist', 'view')
      OR public.can_access('recepcao', 'view')
    )
  );

DROP POLICY IF EXISTS m10_imaging_orders_rpc_select ON public.imaging_orders;
CREATE POLICY m10_imaging_orders_rpc_select ON public.imaging_orders
  FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS m10_imaging_orders_rpc_update ON public.imaging_orders;
CREATE POLICY m10_imaging_orders_rpc_update ON public.imaging_orders
  FOR UPDATE TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS m10_imaging_order_items_rpc_select ON public.imaging_order_items;
CREATE POLICY m10_imaging_order_items_rpc_select ON public.imaging_order_items
  FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS m10_imaging_order_items_rpc_update ON public.imaging_order_items;
CREATE POLICY m10_imaging_order_items_rpc_update ON public.imaging_order_items
  FOR UPDATE TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS m10_worklist_queue_rpc_access ON public.dicom_worklist_queue;
CREATE POLICY m10_worklist_queue_rpc_access ON public.dicom_worklist_queue
  FOR ALL TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

COMMIT;

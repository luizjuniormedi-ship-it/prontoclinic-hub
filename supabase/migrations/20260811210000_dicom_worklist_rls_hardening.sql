-- Remove permissive imaging policies superseded by the unit-scoped M10/M11 contract.
-- DataSIGH is neither read nor changed by this migration.

BEGIN;

DROP POLICY IF EXISTS app_imaging_patients_tenant ON public.patients;
DROP POLICY IF EXISTS app_imaging_appointments_tenant ON public.appointments;
DROP POLICY IF EXISTS app_imaging_worklist_read ON public.dicom_worklist_queue;

DROP POLICY IF EXISTS imaging_orders_scoped_select ON public.imaging_orders;
DROP POLICY IF EXISTS imaging_orders_owner_insert ON public.imaging_orders;
DROP POLICY IF EXISTS imaging_orders_scoped_update ON public.imaging_orders;

DROP POLICY IF EXISTS imaging_order_items_scoped_select ON public.imaging_order_items;
DROP POLICY IF EXISTS imaging_order_items_scoped_insert ON public.imaging_order_items;
DROP POLICY IF EXISTS imaging_order_items_scoped_update ON public.imaging_order_items;

DROP POLICY IF EXISTS dicom_worklist_queue_tenant_write ON public.dicom_worklist_queue;

DROP POLICY IF EXISTS app_imaging_patients_scoped ON public.patients;
CREATE POLICY app_imaging_patients_scoped ON public.patients
  FOR SELECT TO app_prontomedic
  USING (
    company_id = public.active_company_id()
    AND public.active_unit_id() IS NOT NULL
    AND public.org_can_access_unit(company_id, public.active_unit_id())
    AND (
      public.can_access('patients', 'view')
      OR public.can_access('pacientes', 'view')
    )
  );

DROP POLICY IF EXISTS app_imaging_orders_scoped ON public.imaging_orders;
DROP POLICY IF EXISTS app_imaging_orders_select ON public.imaging_orders;
CREATE POLICY app_imaging_orders_select ON public.imaging_orders
  FOR SELECT TO app_prontomedic
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (
      public.can_access('dicom', 'view')
      OR public.can_access('worklist', 'view')
    )
  );

DROP POLICY IF EXISTS app_imaging_orders_insert ON public.imaging_orders;
CREATE POLICY app_imaging_orders_insert ON public.imaging_orders
  FOR INSERT TO app_prontomedic
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (
      public.can_access('dicom', 'create')
      OR public.can_access('dicom', 'edit')
    )
    AND (
      appointment_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.appointments appointment
        WHERE appointment.id = imaging_orders.appointment_id
          AND appointment.company_id = imaging_orders.company_id
          AND appointment.unit_id = imaging_orders.unit_id
          AND appointment.patient_id = imaging_orders.patient_id
      )
    )
  );

DROP POLICY IF EXISTS app_imaging_orders_update ON public.imaging_orders;
CREATE POLICY app_imaging_orders_update ON public.imaging_orders
  FOR UPDATE TO app_prontomedic
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.can_access('dicom', 'edit')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.can_access('dicom', 'edit')
    AND (
      appointment_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.appointments appointment
        WHERE appointment.id = imaging_orders.appointment_id
          AND appointment.company_id = imaging_orders.company_id
          AND appointment.unit_id = imaging_orders.unit_id
          AND appointment.patient_id = imaging_orders.patient_id
      )
    )
  );

DROP POLICY IF EXISTS app_imaging_order_items_scoped ON public.imaging_order_items;
DROP POLICY IF EXISTS app_imaging_order_items_select ON public.imaging_order_items;
CREATE POLICY app_imaging_order_items_select ON public.imaging_order_items
  FOR SELECT TO app_prontomedic
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (
      public.can_access('dicom', 'view')
      OR public.can_access('worklist', 'view')
    )
  );

DROP POLICY IF EXISTS app_imaging_order_items_insert ON public.imaging_order_items;
CREATE POLICY app_imaging_order_items_insert ON public.imaging_order_items
  FOR INSERT TO app_prontomedic
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (
      public.can_access('dicom', 'create')
      OR public.can_access('dicom', 'edit')
    )
    AND EXISTS (
      SELECT 1 FROM public.imaging_orders imaging_order
      WHERE imaging_order.id = imaging_order_items.imaging_order_id
        AND imaging_order.company_id = imaging_order_items.company_id
        AND imaging_order.unit_id = imaging_order_items.unit_id
    )
  );

DROP POLICY IF EXISTS app_imaging_order_items_update ON public.imaging_order_items;
CREATE POLICY app_imaging_order_items_update ON public.imaging_order_items
  FOR UPDATE TO app_prontomedic
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.can_access('dicom', 'edit')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.can_access('dicom', 'edit')
    AND EXISTS (
      SELECT 1 FROM public.imaging_orders imaging_order
      WHERE imaging_order.id = imaging_order_items.imaging_order_id
        AND imaging_order.company_id = imaging_order_items.company_id
        AND imaging_order.unit_id = imaging_order_items.unit_id
    )
  );

DROP POLICY IF EXISTS app_imaging_worklist_scoped ON public.dicom_worklist_queue;
CREATE POLICY app_imaging_worklist_scoped ON public.dicom_worklist_queue
  FOR SELECT TO app_prontomedic
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

DROP POLICY IF EXISTS app_imaging_worklist_update ON public.dicom_worklist_queue;
CREATE POLICY app_imaging_worklist_update ON public.dicom_worklist_queue
  FOR UPDATE TO app_prontomedic
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.can_access('dicom', 'edit')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.can_access('dicom', 'edit')
  );

COMMIT;

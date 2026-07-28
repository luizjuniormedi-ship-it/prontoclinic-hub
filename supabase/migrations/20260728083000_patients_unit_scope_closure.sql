BEGIN;

DROP POLICY IF EXISTS patients_access_select ON public.patients;
CREATE POLICY patients_access_select ON public.patients
  FOR SELECT TO authenticated
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (
      public.can_access('patients', 'view')
      OR public.can_access('pacientes', 'view')
    )
  );

DROP POLICY IF EXISTS patients_access_insert ON public.patients;
CREATE POLICY patients_access_insert ON public.patients
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (
      public.can_access('patients', 'create')
      OR public.can_access('pacientes', 'create')
    )
  );

DROP POLICY IF EXISTS patients_access_update ON public.patients;
CREATE POLICY patients_access_update ON public.patients
  FOR UPDATE TO authenticated
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (
      public.can_access('patients', 'edit')
      OR public.can_access('pacientes', 'edit')
    )
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (
      public.can_access('patients', 'edit')
      OR public.can_access('pacientes', 'edit')
    )
  );

DROP POLICY IF EXISTS patients_access_delete ON public.patients;
CREATE POLICY patients_access_delete ON public.patients
  FOR DELETE TO authenticated
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (
      public.can_access('patients', 'delete')
      OR public.can_access('pacientes', 'delete')
    )
  );

COMMIT;

-- Onda 0: explicit Orthanc mapping and active-company RLS for telemedicine.

ALTER TABLE public.dicom_equipment
  ADD COLUMN IF NOT EXISTS ds_orthanc_alias VARCHAR(100);

COMMENT ON COLUMN public.dicom_equipment.ds_orthanc_alias IS
  'Alias da modalidade cadastrada no Orthanc. Nao confundir com o AE Title DICOM.';

DROP POLICY IF EXISTS "telemed_salas_select" ON public.telemedicina_salas;
DROP POLICY IF EXISTS "telemed_salas_insert" ON public.telemedicina_salas;
DROP POLICY IF EXISTS "telemed_salas_update" ON public.telemedicina_salas;

CREATE POLICY "telemed_salas_select"
  ON public.telemedicina_salas FOR SELECT TO authenticated
  USING (
    company_id = public.active_company_id()
    AND (
      EXISTS (
        SELECT 1 FROM public.professionals
        WHERE id = telemedicina_salas.cd_medico AND user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.patients
        WHERE id = telemedicina_salas.cd_paciente AND user_id = auth.uid()
      )
      OR public.can_access('telemedicina', 'view')
    )
  );

CREATE POLICY "telemed_salas_insert"
  ON public.telemedicina_salas FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.active_company_id()
    AND public.can_access('telemedicina', 'create')
  );

CREATE POLICY "telemed_salas_update"
  ON public.telemedicina_salas FOR UPDATE TO authenticated
  USING (
    company_id = public.active_company_id()
    AND (
      EXISTS (
        SELECT 1 FROM public.professionals
        WHERE id = telemedicina_salas.cd_medico AND user_id = auth.uid()
      )
      OR public.can_access('telemedicina', 'edit')
    )
  )
  WITH CHECK (company_id = public.active_company_id());

DROP POLICY IF EXISTS "telemed_part_select" ON public.telemedicina_participantes;
DROP POLICY IF EXISTS "telemed_part_insert" ON public.telemedicina_participantes;
DROP POLICY IF EXISTS "telemed_part_update" ON public.telemedicina_participantes;

CREATE POLICY "telemed_part_select"
  ON public.telemedicina_participantes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.telemedicina_salas AS sala
      WHERE sala.id = telemedicina_participantes.cd_sala
        AND sala.company_id = public.active_company_id()
    )
  );

CREATE POLICY "telemed_part_insert"
  ON public.telemedicina_participantes FOR INSERT TO authenticated
  WITH CHECK (
    cd_usuario = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.telemedicina_salas AS sala
      WHERE sala.id = telemedicina_participantes.cd_sala
        AND sala.company_id = public.active_company_id()
    )
  );

CREATE POLICY "telemed_part_update"
  ON public.telemedicina_participantes FOR UPDATE TO authenticated
  USING (
    cd_usuario = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.telemedicina_salas AS sala
      WHERE sala.id = telemedicina_participantes.cd_sala
        AND sala.company_id = public.active_company_id()
    )
  )
  WITH CHECK (cd_usuario = auth.uid());

-- Fecha lacunas de tenant/unidade em agenda e convênios.
-- Linhas legadas ambíguas bloqueiam a migration; nunca recebem unidade arbitrária.

CREATE OR REPLACE FUNCTION public.enforce_professional_schedule_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.company_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.professionals p
    WHERE p.id = NEW.professional_id
      AND p.company_id = NEW.company_id
      AND p.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Profissional não pertence à empresa ativa da escala'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      NEW.unit_id, NEW.slot1_unit_id, NEW.slot2_unit_id, NEW.slot3_unit_id
    ]) AS scope(unit_id)
    LEFT JOIN public.units u
      ON u.id = scope.unit_id
     AND u.company_id = NEW.company_id
     AND u.lg_ativo = TRUE
    WHERE scope.unit_id IS NOT NULL AND u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Unidade da escala não pertence à empresa ou está inativa'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_professional_schedules_scope ON public.professional_schedules;
CREATE TRIGGER trg_professional_schedules_scope
BEFORE INSERT OR UPDATE OF company_id, professional_id, unit_id,
  slot1_unit_id, slot2_unit_id, slot3_unit_id
ON public.professional_schedules
FOR EACH ROW EXECUTE FUNCTION public.enforce_professional_schedule_scope();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.professional_schedules ps
    LEFT JOIN public.professionals p
      ON p.id = ps.professional_id AND p.company_id = ps.company_id
    WHERE ps.company_id IS NULL OR p.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.professional_schedules ps
    CROSS JOIN LATERAL unnest(ARRAY[
      ps.unit_id, ps.slot1_unit_id, ps.slot2_unit_id, ps.slot3_unit_id
    ]) scope(unit_id)
    LEFT JOIN public.units u
      ON u.id = scope.unit_id AND u.company_id = ps.company_id
    WHERE scope.unit_id IS NOT NULL AND u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'OPERATIONAL_RLS_PREFLIGHT: existem escalas sem tenant/unidade reconciliados';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_professional_schedules_company_lookup
  ON public.professional_schedules(company_id, professional_id, day_of_week, lg_habilitado);
ALTER TABLE public.professional_schedules ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'professional_schedules'
      AND policyname NOT IN (
        'professional_schedules_select_context',
        'professional_schedules_insert_context',
        'professional_schedules_update_context',
        'professional_schedules_delete_context'
      )
  LOOP
    RAISE EXCEPTION 'OPERATIONAL_RLS_UNKNOWN_POLICY: public.professional_schedules.%',
      v_policy.policyname;
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS professional_schedules_select_context ON public.professional_schedules;
CREATE POLICY professional_schedules_select_context
ON public.professional_schedules FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.can_access('agenda', 'view')
  AND (
    public.active_unit_id() IS NULL
    OR unit_id = public.active_unit_id()
    OR slot1_unit_id = public.active_unit_id()
    OR slot2_unit_id = public.active_unit_id()
    OR slot3_unit_id = public.active_unit_id()
  )
);
DROP POLICY IF EXISTS professional_schedules_insert_context ON public.professional_schedules;
CREATE POLICY professional_schedules_insert_context
ON public.professional_schedules FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.active_company_id()
  AND public.active_unit_id() IS NULL
  AND public.can_access('agenda', 'create')
);
DROP POLICY IF EXISTS professional_schedules_update_context ON public.professional_schedules;
CREATE POLICY professional_schedules_update_context
ON public.professional_schedules FOR UPDATE TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.active_unit_id() IS NULL
  AND public.can_access('agenda', 'edit')
)
WITH CHECK (
  company_id = public.active_company_id()
  AND public.active_unit_id() IS NULL
  AND public.can_access('agenda', 'edit')
);
DROP POLICY IF EXISTS professional_schedules_delete_context ON public.professional_schedules;
CREATE POLICY professional_schedules_delete_context
ON public.professional_schedules FOR DELETE TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.active_unit_id() IS NULL
  AND public.can_access('agenda', 'delete')
);
REVOKE ALL ON public.professional_schedules FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_schedules TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.professional_schedules_id_seq TO authenticated;

-- Disponibilidade precisa respeitar a empresa, a unidade e a sessão AAL2 atuais,
-- mesmo sendo SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.get_professional_available_slots(
  p_professional_id BIGINT,
  p_date DATE,
  p_duration_minutes INTEGER DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL
)
RETURNS TABLE(start_time TIME, end_time TIME, unit_id INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  WITH access_scope AS (
    SELECT public.active_company_id() AS company_id,
           public.active_unit_id() AS unit_id
    WHERE public.can_access('agenda', 'view')
      AND p_date IS NOT NULL
      AND p_duration_minutes IS DISTINCT FROM 0
  ), weekday AS (
    SELECT (ARRAY['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'])
      [EXTRACT(DOW FROM p_date)::INTEGER + 1] AS name
  ), windows AS (
    SELECT ps.slot1_start AS from_hhmm, ps.slot1_end AS to_hhmm,
           COALESCE(p_duration_minutes, NULLIF(ps.slot1_duration, 0), 30) AS duration_min,
           ps.slot1_unit_id AS schedule_unit, scope.company_id
    FROM public.professional_schedules ps, weekday w, access_scope scope
    WHERE ps.company_id = scope.company_id
      AND ps.professional_id = p_professional_id AND ps.lg_habilitado IS TRUE
      AND lower(ps.day_of_week) = w.name
      AND ps.slot1_start IS NOT NULL AND ps.slot1_end IS NOT NULL
      AND (scope.unit_id IS NULL OR ps.slot1_unit_id = scope.unit_id)
      AND (p_unit_id IS NULL OR ps.slot1_unit_id = p_unit_id)
    UNION ALL
    SELECT ps.slot2_start, ps.slot2_end,
           COALESCE(p_duration_minutes, NULLIF(ps.slot2_duration, 0), 30),
           ps.slot2_unit_id, scope.company_id
    FROM public.professional_schedules ps, weekday w, access_scope scope
    WHERE ps.company_id = scope.company_id
      AND ps.professional_id = p_professional_id AND ps.lg_habilitado IS TRUE
      AND lower(ps.day_of_week) = w.name
      AND ps.slot2_start IS NOT NULL AND ps.slot2_end IS NOT NULL
      AND (scope.unit_id IS NULL OR ps.slot2_unit_id = scope.unit_id)
      AND (p_unit_id IS NULL OR ps.slot2_unit_id = p_unit_id)
    UNION ALL
    SELECT ps.slot3_start, ps.slot3_end,
           COALESCE(p_duration_minutes, NULLIF(ps.slot3_duration, 0), 30),
           ps.slot3_unit_id, scope.company_id
    FROM public.professional_schedules ps, weekday w, access_scope scope
    WHERE ps.company_id = scope.company_id
      AND ps.professional_id = p_professional_id AND ps.lg_habilitado IS TRUE
      AND lower(ps.day_of_week) = w.name
      AND ps.slot3_start IS NOT NULL AND ps.slot3_end IS NOT NULL
      AND (scope.unit_id IS NULL OR ps.slot3_unit_id = scope.unit_id)
      AND (p_unit_id IS NULL OR ps.slot3_unit_id = p_unit_id)
  ), candidates AS (
    SELECT gs::TIME AS slot_start,
           (gs + make_interval(mins => w.duration_min))::TIME AS slot_end,
           w.schedule_unit, w.company_id
    FROM windows w
    CROSS JOIN LATERAL generate_series(
      p_date + public.scheduling_hhmm_to_time(w.from_hhmm),
      p_date + public.scheduling_hhmm_to_time(w.to_hhmm) - make_interval(mins => w.duration_min),
      make_interval(mins => w.duration_min)
    ) gs
  )
  SELECT c.slot_start, c.slot_end, c.schedule_unit
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.company_id = c.company_id
      AND a.unit_id = c.schedule_unit
      AND a.professional_id = p_professional_id AND a.appointment_date = p_date
      AND a.status NOT IN ('cancelled', 'no_show')
      AND c.slot_start < COALESCE(a.end_time, a.start_time + INTERVAL '30 minutes')
      AND c.slot_end > a.start_time
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.scheduling_blocks b
    WHERE b.company_id = c.company_id
      AND b.status = 'active'
      AND (b.professional_id = p_professional_id
        OR (b.professional_id IS NULL AND b.unit_id = c.schedule_unit))
      AND (p_date + c.slot_start) < b.ends_at
      AND (p_date + c.slot_end) > b.starts_at
  )
  ORDER BY c.slot_start;
$$;
REVOKE ALL ON FUNCTION public.get_professional_available_slots(BIGINT, DATE, INTEGER, INTEGER)
  FROM PUBLIC, anon;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    REVOKE ALL ON FUNCTION public.get_professional_available_slots(BIGINT, DATE, INTEGER, INTEGER)
      FROM app_prontomedic;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_professional_available_slots(BIGINT, DATE, INTEGER, INTEGER)
  TO authenticated;

-- Convênios carregam PHI e precisam herdar unidade de fontes clínicas inequívocas.
ALTER TABLE public.insurance_authorizations ADD COLUMN IF NOT EXISTS unit_id INTEGER;
ALTER TABLE public.insurance_eligibility_checks ADD COLUMN IF NOT EXISTS unit_id INTEGER;

UPDATE public.insurance_authorizations ia
SET unit_id = a.unit_id
FROM public.appointments a
WHERE ia.unit_id IS NULL AND ia.appointment_id = a.id
  AND ia.company_id = a.company_id AND a.unit_id IS NOT NULL;
UPDATE public.insurance_eligibility_checks ie
SET unit_id = a.unit_id
FROM public.appointments a
WHERE ie.unit_id IS NULL AND ie.appointment_id = a.id
  AND ie.company_id = a.company_id AND a.unit_id IS NOT NULL;
UPDATE public.insurance_authorizations ia
SET unit_id = p.unit_id
FROM public.patients p
WHERE ia.unit_id IS NULL AND ia.patient_id = p.id
  AND ia.company_id = p.company_id AND p.unit_id IS NOT NULL;
UPDATE public.insurance_eligibility_checks ie
SET unit_id = p.unit_id
FROM public.patients p
WHERE ie.unit_id IS NULL AND ie.patient_id = p.id
  AND ie.company_id = p.company_id AND p.unit_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.insurance_authorizations record
       LEFT JOIN public.units unit ON unit.id = record.unit_id AND unit.company_id = record.company_id
       WHERE record.company_id IS NULL OR record.unit_id IS NULL OR unit.id IS NULL
     ) OR EXISTS (
       SELECT 1 FROM public.insurance_eligibility_checks record
       LEFT JOIN public.units unit ON unit.id = record.unit_id AND unit.company_id = record.company_id
       WHERE record.company_id IS NULL OR record.unit_id IS NULL OR unit.id IS NULL
     ) THEN
    RAISE EXCEPTION 'OPERATIONAL_RLS_PREFLIGHT: registros de convênio possuem empresa/unidade ausente ou inconsistente';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.insurance_authorizations'::regclass
      AND conname = 'insurance_authorizations_unit_id_fkey'
  ) THEN
    ALTER TABLE public.insurance_authorizations
      ADD CONSTRAINT insurance_authorizations_unit_id_fkey
      FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.insurance_eligibility_checks'::regclass
      AND conname = 'insurance_eligibility_checks_unit_id_fkey'
  ) THEN
    ALTER TABLE public.insurance_eligibility_checks
      ADD CONSTRAINT insurance_eligibility_checks_unit_id_fkey
      FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END;
$$;
ALTER TABLE public.insurance_authorizations
  VALIDATE CONSTRAINT insurance_authorizations_unit_id_fkey;
ALTER TABLE public.insurance_eligibility_checks
  VALIDATE CONSTRAINT insurance_eligibility_checks_unit_id_fkey;
CREATE INDEX IF NOT EXISTS idx_insurance_authorizations_company_unit
  ON public.insurance_authorizations(company_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_insurance_eligibility_company_unit
  ON public.insurance_eligibility_checks(company_id, unit_id);

CREATE OR REPLACE FUNCTION public.enforce_insurance_record_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action TEXT := CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'edit' END;
BEGIN
  IF NEW.company_id IS NULL OR NEW.unit_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.units u
    WHERE u.id = NEW.unit_id AND u.company_id = NEW.company_id AND u.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Empresa e unidade do registro de convênio são inválidas'
      USING ERRCODE = '23514';
  END IF;
  IF auth.uid() IS NOT NULL AND (
    NEW.company_id IS DISTINCT FROM public.active_company_id()
    OR NEW.unit_id IS DISTINCT FROM public.active_unit_id()
    OR NOT (
      public.can_access('recepcao', v_action)
      OR public.can_access('faturamento', v_action)
      OR (TG_OP = 'INSERT' AND public.can_access('agenda', 'create'))
    )
  ) THEN
    RAISE EXCEPTION 'Registro de convênio fora do contexto ativo ou sem permissão'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_insurance_authorizations_scope ON public.insurance_authorizations;
CREATE TRIGGER trg_insurance_authorizations_scope
BEFORE INSERT OR UPDATE ON public.insurance_authorizations
FOR EACH ROW EXECUTE FUNCTION public.enforce_insurance_record_scope();
DROP TRIGGER IF EXISTS trg_insurance_eligibility_scope ON public.insurance_eligibility_checks;
CREATE TRIGGER trg_insurance_eligibility_scope
BEFORE INSERT OR UPDATE ON public.insurance_eligibility_checks
FOR EACH ROW EXECUTE FUNCTION public.enforce_insurance_record_scope();

ALTER TABLE public.insurance_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_eligibility_checks ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('insurance_authorizations', 'insurance_eligibility_checks')
      AND policyname NOT IN (
        'insurance_authorizations_select_unit',
        'insurance_authorizations_insert_unit',
        'insurance_authorizations_update_unit',
        'insurance_eligibility_select_unit',
        'insurance_eligibility_insert_unit',
        'insurance_eligibility_update_unit'
      )
  LOOP
    RAISE EXCEPTION 'OPERATIONAL_RLS_UNKNOWN_POLICY: public.%.%',
      v_policy.tablename, v_policy.policyname;
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS insurance_authorizations_select_unit ON public.insurance_authorizations;
CREATE POLICY insurance_authorizations_select_unit
ON public.insurance_authorizations FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id() AND unit_id = public.active_unit_id()
  AND (public.can_access('recepcao', 'view') OR public.can_access('faturamento', 'view') OR public.can_access('agenda', 'view'))
);
DROP POLICY IF EXISTS insurance_authorizations_insert_unit ON public.insurance_authorizations;
CREATE POLICY insurance_authorizations_insert_unit
ON public.insurance_authorizations FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.active_company_id() AND unit_id = public.active_unit_id()
  AND (public.can_access('recepcao', 'create') OR public.can_access('faturamento', 'create') OR public.can_access('agenda', 'create'))
);
DROP POLICY IF EXISTS insurance_authorizations_update_unit ON public.insurance_authorizations;
CREATE POLICY insurance_authorizations_update_unit
ON public.insurance_authorizations FOR UPDATE TO authenticated
USING (
  company_id = public.active_company_id() AND unit_id = public.active_unit_id()
  AND (public.can_access('recepcao', 'edit') OR public.can_access('faturamento', 'edit'))
)
WITH CHECK (
  company_id = public.active_company_id() AND unit_id = public.active_unit_id()
  AND (public.can_access('recepcao', 'edit') OR public.can_access('faturamento', 'edit'))
);

DROP POLICY IF EXISTS insurance_eligibility_select_unit ON public.insurance_eligibility_checks;
CREATE POLICY insurance_eligibility_select_unit
ON public.insurance_eligibility_checks FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id() AND unit_id = public.active_unit_id()
  AND (public.can_access('recepcao', 'view') OR public.can_access('faturamento', 'view') OR public.can_access('agenda', 'view'))
);
DROP POLICY IF EXISTS insurance_eligibility_insert_unit ON public.insurance_eligibility_checks;
CREATE POLICY insurance_eligibility_insert_unit
ON public.insurance_eligibility_checks FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.active_company_id() AND unit_id = public.active_unit_id()
  AND (public.can_access('recepcao', 'create') OR public.can_access('faturamento', 'create') OR public.can_access('agenda', 'create'))
);
DROP POLICY IF EXISTS insurance_eligibility_update_unit ON public.insurance_eligibility_checks;
CREATE POLICY insurance_eligibility_update_unit
ON public.insurance_eligibility_checks FOR UPDATE TO authenticated
USING (
  company_id = public.active_company_id() AND unit_id = public.active_unit_id()
  AND (public.can_access('recepcao', 'edit') OR public.can_access('faturamento', 'edit'))
)
WITH CHECK (
  company_id = public.active_company_id() AND unit_id = public.active_unit_id()
  AND (public.can_access('recepcao', 'edit') OR public.can_access('faturamento', 'edit'))
);

REVOKE ALL ON public.insurance_authorizations, public.insurance_eligibility_checks FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.insurance_authorizations, public.insurance_eligibility_checks TO authenticated;

-- Refresh compatibility aliases after adding unit_id to the authoritative tables.
CREATE OR REPLACE VIEW public.reception_authorizations
WITH (security_invoker = true)
AS SELECT * FROM public.insurance_authorizations;
CREATE OR REPLACE VIEW public.reception_eligibility_checks
WITH (security_invoker = true)
AS SELECT * FROM public.insurance_eligibility_checks;

DROP FUNCTION IF EXISTS public.update_reception_authorization_secure(
  UUID, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, TEXT
);
DROP FUNCTION IF EXISTS public.update_reception_eligibility_secure(
  UUID, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.update_reception_authorization_secure(
  p_authorization_id UUID,
  p_status TEXT,
  p_protocol_number TEXT DEFAULT NULL,
  p_authorization_number TEXT DEFAULT NULL,
  p_password_number TEXT DEFAULT NULL,
  p_valid_until DATE DEFAULT NULL,
  p_quantity_authorized INTEGER DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.reception_authorizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_old public.insurance_authorizations%ROWTYPE;
  v_row public.insurance_authorizations%ROWTYPE;
BEGIN
  IF v_company_id IS NULL OR v_unit_id IS NULL OR NOT (
    public.can_access('recepcao', 'edit') OR public.can_access('faturamento', 'edit')
  ) THEN
    RAISE EXCEPTION 'Contexto AAL2, sessão, unidade ou permissão inválidos'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old
  FROM public.insurance_authorizations
  WHERE id = p_authorization_id
    AND company_id = v_company_id
    AND unit_id = v_unit_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Autorização não encontrada no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_status NOT IN (
    'pendente','solicitada','em_analise','autorizada','parcialmente_autorizada',
    'negada','vencida','cancelada','reenviada','liberada_excecao'
  ) THEN
    RAISE EXCEPTION 'Status de autorização inválido';
  END IF;
  IF p_status IN ('autorizada','parcialmente_autorizada')
     AND NULLIF(trim(COALESCE(p_authorization_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Número da autorização é obrigatório';
  END IF;
  IF p_status = 'negada' AND NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo da negativa é obrigatório';
  END IF;
  IF p_status = 'liberada_excecao' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_access_context ctx
      JOIN public.roles r ON r.id = ctx.role_id AND r.lg_ativo = TRUE
      WHERE ctx.user_id = auth.uid()
        AND ctx.session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
        AND lower(r.name) IN (
          'admin','administrador','gestor','supervisor','supervisor_recepcao','diretoria'
        )
    ) THEN
      RAISE EXCEPTION 'Perfil sem permissão para liberar exceção'
        USING ERRCODE = '42501';
    END IF;
    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Justificativa da exceção é obrigatória';
    END IF;
  END IF;

  UPDATE public.insurance_authorizations
  SET status = p_status,
      protocol_number = COALESCE(NULLIF(trim(COALESCE(p_protocol_number, '')), ''), protocol_number),
      authorization_number = COALESCE(NULLIF(trim(COALESCE(p_authorization_number, '')), ''), authorization_number),
      password_number = COALESCE(NULLIF(trim(COALESCE(p_password_number, '')), ''), password_number),
      valid_until = COALESCE(p_valid_until, valid_until),
      quantity_authorized = COALESCE(p_quantity_authorized, quantity_authorized),
      authorized_at = CASE WHEN p_status IN ('autorizada','parcialmente_autorizada','liberada_excecao') THEN now() ELSE authorized_at END,
      denied_at = CASE WHEN p_status = 'negada' THEN now() ELSE denied_at END,
      denial_reason = CASE WHEN p_status = 'negada' THEN p_reason ELSE denial_reason END,
      notes = concat_ws(E'\n', notes, NULLIF(trim(COALESCE(p_reason, '')), '')),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_authorization_id
    AND company_id = v_company_id
    AND unit_id = v_unit_id
  RETURNING * INTO v_row;

  IF v_row.appointment_id IS NOT NULL
     AND p_status IN ('autorizada','parcialmente_autorizada') THEN
    UPDATE public.appointments
    SET cd_autorizacao = v_row.authorization_number,
        updated_at = now()
    WHERE id = v_row.appointment_id
      AND company_id = v_company_id
      AND unit_id = v_unit_id;
  END IF;

  INSERT INTO public.reception_admin_history(
    company_id, entity_type, entity_id, appointment_id, from_status,
    to_status, reason, details, actor_user_id
  ) VALUES (
    v_row.company_id, 'authorization', v_row.id::TEXT, v_row.appointment_id,
    v_old.status, v_row.status, p_reason,
    jsonb_build_object(
      'protocol', v_row.protocol_number,
      'authorization_number', v_row.authorization_number,
      'valid_until', v_row.valid_until
    ),
    auth.uid()
  );
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_reception_eligibility_secure(
  p_eligibility_id UUID,
  p_status TEXT,
  p_protocol_number TEXT DEFAULT NULL,
  p_result_detail TEXT DEFAULT NULL
)
RETURNS public.reception_eligibility_checks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_old public.insurance_eligibility_checks%ROWTYPE;
  v_row public.insurance_eligibility_checks%ROWTYPE;
BEGIN
  IF v_company_id IS NULL OR v_unit_id IS NULL OR NOT (
    public.can_access('recepcao', 'edit') OR public.can_access('faturamento', 'edit')
  ) THEN
    RAISE EXCEPTION 'Contexto AAL2, sessão, unidade ou permissão inválidos'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old
  FROM public.insurance_eligibility_checks
  WHERE id = p_eligibility_id
    AND company_id = v_company_id
    AND unit_id = v_unit_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Elegibilidade não encontrada no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_status NOT IN (
    'elegivel','nao_elegivel','pendente','em_analise','portal_indisponivel',
    'nao_obrigatoria','liberado_excecao'
  ) THEN
    RAISE EXCEPTION 'Status de elegibilidade inválido';
  END IF;
  IF p_status IN ('nao_elegivel','portal_indisponivel')
     AND NULLIF(trim(COALESCE(p_result_detail, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Detalhe do resultado é obrigatório';
  END IF;
  IF p_status = 'liberado_excecao' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_access_context ctx
      JOIN public.roles r ON r.id = ctx.role_id AND r.lg_ativo = TRUE
      WHERE ctx.user_id = auth.uid()
        AND ctx.session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
        AND lower(r.name) IN (
          'admin','administrador','gestor','supervisor','supervisor_recepcao','diretoria'
        )
    ) THEN
      RAISE EXCEPTION 'Perfil sem permissão para liberar exceção'
        USING ERRCODE = '42501';
    END IF;
    IF NULLIF(trim(COALESCE(p_result_detail, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Justificativa da exceção é obrigatória';
    END IF;
  END IF;

  UPDATE public.insurance_eligibility_checks
  SET status = p_status,
      protocol_number = COALESCE(NULLIF(trim(COALESCE(p_protocol_number, '')), ''), protocol_number),
      result_detail = COALESCE(NULLIF(trim(COALESCE(p_result_detail, '')), ''), result_detail),
      checked_at = CASE WHEN p_status NOT IN ('pendente','em_analise') THEN now() ELSE checked_at END,
      checked_by = auth.uid(),
      updated_at = now()
  WHERE id = p_eligibility_id
    AND company_id = v_company_id
    AND unit_id = v_unit_id
  RETURNING * INTO v_row;

  INSERT INTO public.reception_admin_history(
    company_id, entity_type, entity_id, appointment_id, from_status,
    to_status, reason, details, actor_user_id
  ) VALUES (
    v_row.company_id, 'eligibility', v_row.id::TEXT, v_row.appointment_id,
    v_old.status, v_row.status, p_result_detail,
    jsonb_build_object('protocol', v_row.protocol_number), auth.uid()
  );
  RETURN v_row;
END;
$$;

-- Alinha o cadastro ao contrato já consumido pelas telas de paciente. O plano é
-- apenas o padrão cadastral; o agendamento pode substituí-lo por episódio.
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS insurance_plan_id INTEGER,
  ADD COLUMN IF NOT EXISTS insurance_card_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS social_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS marital_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS responsible_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS allergies TEXT,
  ADD COLUMN IF NOT EXISTS clinical_alerts TEXT,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS clinical_notes TEXT,
  ADD COLUMN IF NOT EXISTS registration_status VARCHAR(20) NOT NULL DEFAULT 'incomplete',
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.patients'::regclass
      AND conname = 'patients_insurance_plan_id_fkey'
  ) THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_insurance_plan_id_fkey
      FOREIGN KEY (insurance_plan_id)
      REFERENCES public.insurance_plans(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_patients_insurance_plan
  ON public.patients(company_id, insurance_plan_id)
  WHERE insurance_plan_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_patient_insurance_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF NEW.insurance_plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.insurance_plans ip
    WHERE ip.id = NEW.insurance_plan_id
      AND ip.company_id = NEW.company_id
      AND ip.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Plano de convênio inexistente, inativo ou de outra empresa'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patients_insurance_scope ON public.patients;
CREATE TRIGGER trg_patients_insurance_scope
BEFORE INSERT OR UPDATE OF company_id, insurance_plan_id
ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_insurance_scope();

REVOKE ALL ON FUNCTION public.enforce_patient_insurance_scope() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.enforce_insurance_plan_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.insurance_companies ic
    WHERE ic.id = NEW.insurance_company_id
      AND ic.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Operadora e plano devem pertencer à mesma empresa'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_insurance_plans_company ON public.insurance_plans;
CREATE TRIGGER trg_insurance_plans_company
BEFORE INSERT OR UPDATE OF company_id, insurance_company_id
ON public.insurance_plans
FOR EACH ROW EXECUTE FUNCTION public.enforce_insurance_plan_company();
REVOKE ALL ON FUNCTION public.enforce_insurance_plan_company()
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'insurance_plans'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.insurance_plans', v_policy.policyname);
  END LOOP;
END;
$$;

ALTER TABLE public.insurance_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY insurance_plans_select_context
ON public.insurance_plans FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id()
  AND (
    public.can_access('insurance_plans', 'view')
    OR public.can_access('convenios', 'view')
    OR public.can_access('faturamento', 'view')
    OR public.can_access('patients', 'view')
    OR public.can_access('pacientes', 'view')
    OR public.can_access('agenda', 'view')
  )
);
CREATE POLICY insurance_plans_insert_context
ON public.insurance_plans FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.active_company_id()
  AND (
    public.can_access('insurance_plans', 'create')
    OR public.can_access('convenios', 'create')
    OR public.can_access('faturamento', 'create')
  )
);
CREATE POLICY insurance_plans_update_context
ON public.insurance_plans FOR UPDATE TO authenticated
USING (
  company_id = public.active_company_id()
  AND (
    public.can_access('insurance_plans', 'edit')
    OR public.can_access('convenios', 'edit')
    OR public.can_access('faturamento', 'edit')
  )
)
WITH CHECK (
  company_id = public.active_company_id()
  AND (
    public.can_access('insurance_plans', 'edit')
    OR public.can_access('convenios', 'edit')
    OR public.can_access('faturamento', 'edit')
  )
);
CREATE POLICY insurance_plans_delete_context
ON public.insurance_plans FOR DELETE TO authenticated
USING (
  company_id = public.active_company_id()
  AND (
    public.can_access('insurance_plans', 'delete')
    OR public.can_access('convenios', 'delete')
    OR public.can_access('faturamento', 'delete')
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurance_plans TO authenticated;

CREATE OR REPLACE FUNCTION public.get_scheduling_requirements(
  p_patient_id BIGINT,
  p_professional_id BIGINT,
  p_service_id BIGINT DEFAULT NULL,
  p_insurance_id INTEGER DEFAULT NULL,
  p_card_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_patient public.patients%ROWTYPE;
  v_plan public.insurance_plans%ROWTYPE;
  v_service public.services_catalog%ROWTYPE;
  v_insurance public.insurance_companies%ROWTYPE;
  v_effective_insurance_id INTEGER;
  v_card TEXT;
  v_errors JSONB := '[]'::JSONB;
  v_requires_authorization BOOLEAN := FALSE;
  v_requires_eligibility BOOLEAN := FALSE;
  v_credentialed BOOLEAN := TRUE;
BEGIN
  IF v_company_id IS NULL OR v_unit_id IS NULL OR NOT (
    public.can_access('agenda', 'view') OR public.can_access('agenda', 'create')
  ) THEN
    RAISE EXCEPTION 'Contexto AAL2, sessão, unidade ou permissão inválidos'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_patient
  FROM public.patients p
  WHERE p.id = p_patient_id
    AND p.company_id = v_company_id
    AND p.unit_id = v_unit_id
    AND p.lg_ativo = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_patient.insurance_plan_id IS NOT NULL THEN
    SELECT * INTO v_plan
    FROM public.insurance_plans ip
    WHERE ip.id = v_patient.insurance_plan_id
      AND ip.company_id = v_company_id
      AND ip.lg_ativo = TRUE;
  END IF;

  v_effective_insurance_id := COALESCE(p_insurance_id, v_plan.insurance_company_id);
  v_card := NULLIF(trim(COALESCE(p_card_number, '')), '');
  IF v_card IS NULL AND v_effective_insurance_id = v_plan.insurance_company_id THEN
    v_card := NULLIF(trim(COALESCE(v_patient.insurance_card_number, '')), '');
  END IF;

  PERFORM 1 FROM public.professionals p
  WHERE p.id = p_professional_id
    AND p.company_id = v_company_id
    AND p.lg_ativo = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profissional não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_service_id IS NOT NULL THEN
    SELECT * INTO v_service
    FROM public.services_catalog s
    WHERE s.id = p_service_id
      AND s.company_id = v_company_id
      AND s.lg_ativo = TRUE;
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array('Serviço inexistente ou inativo');
    END IF;
  END IF;

  IF v_effective_insurance_id IS NOT NULL THEN
    SELECT * INTO v_insurance
    FROM public.insurance_companies i
    WHERE i.id = v_effective_insurance_id
      AND i.company_id = v_company_id
      AND i.lg_ativo = TRUE;
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array('Convênio inexistente ou inativo');
    ELSE
      v_requires_authorization := COALESCE(v_insurance.lg_autorizac_obrigatorio, FALSE);
      v_requires_eligibility := COALESCE(v_insurance.lg_val_matricula, FALSE)
        OR COALESCE(v_insurance.lg_verificar_associacao, FALSE)
        OR COALESCE(v_insurance.lg_validade_matricula, FALSE);

      IF COALESCE(v_insurance.lg_matric_obrigatorio, FALSE) AND v_card IS NULL THEN
        v_errors := v_errors || jsonb_build_array('Carteirinha/matrícula obrigatória para o convênio');
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.professional_insurances pi
        WHERE pi.company_id = v_company_id
          AND pi.professional_id = p_professional_id
          AND pi.insurance_company_id = v_effective_insurance_id
          AND COALESCE(pi.lg_ativo, TRUE)
          AND (pi.dt_fim_vinculo IS NULL OR pi.dt_fim_vinculo >= CURRENT_DATE)
      ) INTO v_credentialed;
      IF NOT v_credentialed THEN
        v_errors := v_errors || jsonb_build_array('Profissional não credenciado para o convênio');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'insurance_id', v_effective_insurance_id,
    'insurance_plan_id', CASE
      WHEN v_effective_insurance_id = v_plan.insurance_company_id THEN v_plan.id
      ELSE NULL
    END,
    'insurance_name', v_insurance.name,
    'card_number', v_card,
    'professional_credentialed', v_credentialed,
    'requires_authorization', v_requires_authorization,
    'requires_eligibility', v_requires_eligibility,
    'preparation', NULL,
    'service_name', v_service.name,
    'private_price', v_service.price,
    'errors', v_errors
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_appointment_with_requirements_secure(
  p_patient_id BIGINT,
  p_professional_id BIGINT,
  p_appointment_date DATE,
  p_start_time TIME,
  p_end_time TIME DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL,
  p_specialty_id INTEGER DEFAULT NULL,
  p_service_id BIGINT DEFAULT NULL,
  p_appointment_type_id BIGINT DEFAULT NULL,
  p_status TEXT DEFAULT 'scheduled',
  p_is_return BOOLEAN DEFAULT FALSE,
  p_is_walkin BOOLEAN DEFAULT FALSE,
  p_notes TEXT DEFAULT NULL,
  p_insurance_id INTEGER DEFAULT NULL,
  p_card_number TEXT DEFAULT NULL,
  p_authorization_number TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_requirements JSONB;
  v_errors JSONB;
  v_effective_insurance_id INTEGER;
  v_effective_plan_id INTEGER;
  v_row public.appointments%ROWTYPE;
  v_auth_status TEXT;
  v_eligibility_status TEXT;
BEGIN
  IF v_company_id IS NULL OR v_unit_id IS NULL OR NOT public.can_access('agenda', 'create')
     OR (p_company_id IS NOT NULL AND p_company_id IS DISTINCT FROM v_company_id)
     OR (p_unit_id IS NOT NULL AND p_unit_id IS DISTINCT FROM v_unit_id) THEN
    RAISE EXCEPTION 'Contexto AAL2, sessão, unidade ou permissão inválidos'
      USING ERRCODE = '42501';
  END IF;

  v_requirements := public.get_scheduling_requirements(
    p_patient_id, p_professional_id, p_service_id, p_insurance_id, p_card_number
  );
  v_errors := v_requirements->'errors';
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'Validação do agendamento: %', v_errors::TEXT;
  END IF;
  v_effective_insurance_id := NULLIF(v_requirements->>'insurance_id', '')::INTEGER;
  v_effective_plan_id := NULLIF(v_requirements->>'insurance_plan_id', '')::INTEGER;

  SELECT * INTO v_row FROM public.create_appointment_secure(
    p_patient_id, p_professional_id, p_appointment_date, p_start_time, p_end_time,
    v_company_id, v_unit_id, p_specialty_id, p_service_id, p_appointment_type_id,
    p_status, p_is_return, p_is_walkin, p_notes
  );

  UPDATE public.appointments
  SET insurance_company_id = v_effective_insurance_id,
      insurance_plan_id = v_effective_plan_id
  WHERE id = v_row.id
    AND company_id = v_company_id
    AND unit_id = v_unit_id
  RETURNING * INTO v_row;

  IF v_effective_insurance_id IS NOT NULL THEN
    v_eligibility_status := CASE
      WHEN (v_requirements->>'requires_eligibility')::BOOLEAN THEN 'pendente'
      ELSE 'nao_obrigatoria'
    END;
    INSERT INTO public.insurance_eligibility_checks (
      company_id, unit_id, patient_id, appointment_id, insurance_id,
      insurance_plan_id, card_number, status, checked_by, source, result_detail
    ) VALUES (
      v_company_id, v_unit_id, v_row.patient_id, v_row.id, v_effective_insurance_id,
      v_effective_plan_id, v_requirements->>'card_number', v_eligibility_status,
      auth.uid(), 'agendamento', 'Gerado automaticamente no agendamento'
    );
  END IF;

  IF (v_requirements->>'requires_authorization')::BOOLEAN THEN
    v_auth_status := CASE
      WHEN NULLIF(trim(COALESCE(p_authorization_number, '')), '') IS NULL THEN 'pendente'
      ELSE 'autorizada'
    END;
    INSERT INTO public.insurance_authorizations (
      company_id, unit_id, patient_id, appointment_id, insurance_id,
      insurance_plan_id, procedure_id, procedure_desc, requester_professional_id,
      status, authorization_number, requested_at, authorized_at,
      quantity_requested, quantity_authorized, created_by, notes
    ) VALUES (
      v_company_id, v_unit_id, v_row.patient_id, v_row.id, v_effective_insurance_id,
      v_effective_plan_id, p_service_id, v_requirements->>'service_name',
      p_professional_id, v_auth_status,
      NULLIF(trim(COALESCE(p_authorization_number, '')), ''), now(),
      CASE WHEN v_auth_status = 'autorizada' THEN now() ELSE NULL END,
      1, CASE WHEN v_auth_status = 'autorizada' THEN 1 ELSE 0 END,
      auth.uid(), v_requirements->>'preparation'
    );
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_reception_authorization_secure(
  UUID, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_reception_eligibility_secure(
  UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_scheduling_requirements(
  BIGINT, BIGINT, BIGINT, INTEGER, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_appointment_secure(
  BIGINT, BIGINT, DATE, TIME, TIME, UUID, INTEGER, INTEGER,
  BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.update_appointment_status_secure(
  p_appointment_id BIGINT,
  p_new_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_old public.appointments%ROWTYPE;
  v_row public.appointments%ROWTYPE;
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_company_id IS NULL
     OR v_unit_id IS NULL
     OR NOT public.can_access('agenda', 'edit') THEN
    RAISE EXCEPTION
      'Contexto AAL2, sessão, unidade ou permissão de agenda inválidos'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_old
  FROM public.appointments a
  WHERE a.id = p_appointment_id
    AND a.company_id = v_company_id
    AND a.unit_id = v_unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Mensagem uniforme evita confirmar existência em outro tenant.
    RAISE EXCEPTION
      'Agendamento não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_transition_appointment_status(
    v_old.status,
    p_new_status
  ) THEN
    RAISE EXCEPTION
      'Transição inválida: % para %',
      v_old.status,
      p_new_status;
  END IF;

  IF p_new_status IN ('cancelled', 'no_show')
     AND v_reason IS NULL THEN
    RAISE EXCEPTION
      'Motivo é obrigatório para cancelar ou registrar falta';
  END IF;

  UPDATE public.appointments a
  SET status = p_new_status,
      notes = COALESCE(v_reason, a.notes),
      updated_at = now()
  WHERE a.id = p_appointment_id
    AND a.company_id = v_company_id
    AND a.unit_id = v_unit_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Agendamento não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.scheduling_status_history (
    company_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    actor_user_id
  )
  VALUES (
    v_company_id,
    v_row.id,
    v_old.status,
    v_row.status,
    v_reason,
    auth.uid()
  );

  IF p_new_status = 'cancelled' THEN
    INSERT INTO public.scheduling_cancellations (
      company_id,
      appointment_id,
      reason,
      cancelled_by
    )
    VALUES (
      v_company_id,
      v_row.id,
      v_reason,
      auth.uid()
    );
  END IF;

  RETURN v_row;
END;
$$;
CREATE OR REPLACE FUNCTION public.reschedule_appointment_secure(
  p_appointment_id BIGINT,
  p_new_appointment_date DATE,
  p_new_start_time TIME,
  p_new_end_time TIME DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_old public.appointments%ROWTYPE;
  v_row public.appointments%ROWTYPE;
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_new_end_time TIME :=
    COALESCE(p_new_end_time, p_new_start_time + INTERVAL '30 minutes');
BEGIN
  IF v_company_id IS NULL
     OR v_unit_id IS NULL
     OR NOT public.can_access('agenda', 'edit') THEN
    RAISE EXCEPTION
      'Contexto AAL2, sessão, unidade ou permissão de agenda inválidos'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_appointment_date IS NULL
     OR p_new_start_time IS NULL
     OR v_new_end_time <= p_new_start_time THEN
    RAISE EXCEPTION 'Data ou intervalo da remarcação inválido';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Motivo da remarcação é obrigatório';
  END IF;

  SELECT *
  INTO v_old
  FROM public.appointments a
  WHERE a.id = p_appointment_id
    AND a.company_id = v_company_id
    AND a.unit_id = v_unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Agendamento não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_old.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION
      'Agendamento % não pode ser remarcado no status %',
      p_appointment_id,
      v_old.status;
  END IF;

  PERFORM public.assert_appointment_slot_available(
    v_old.professional_id,
    p_new_appointment_date,
    p_new_start_time,
    v_new_end_time,
    p_appointment_id
  );

  UPDATE public.appointments a
  SET appointment_date = p_new_appointment_date,
      start_time = p_new_start_time,
      end_time = v_new_end_time,
      status = 'scheduled',
      notes = v_reason,
      updated_at = now()
  WHERE a.id = p_appointment_id
    AND a.company_id = v_company_id
    AND a.unit_id = v_unit_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Agendamento não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.scheduling_reschedules (
    company_id,
    appointment_id,
    old_appointment_date,
    old_start_time,
    old_end_time,
    new_appointment_date,
    new_start_time,
    new_end_time,
    reason,
    rescheduled_by
  )
  VALUES (
    v_company_id,
    v_row.id,
    v_old.appointment_date,
    v_old.start_time,
    v_old.end_time,
    v_row.appointment_date,
    v_row.start_time,
    v_row.end_time,
    v_reason,
    auth.uid()
  );

  INSERT INTO public.scheduling_status_history (
    company_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    actor_user_id
  )
  VALUES (
    v_company_id,
    v_row.id,
    v_old.status,
    v_row.status,
    'Remarcação: ' || v_reason,
    auth.uid()
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_appointment_status_secure(
  BIGINT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reschedule_appointment_secure(
  BIGINT, DATE, TIME, TIME, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_appointment_with_requirements_secure(
  BIGINT, BIGINT, DATE, TIME, TIME, UUID, INTEGER, INTEGER,
  BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, TEXT
) FROM PUBLIC, anon;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    REVOKE ALL ON FUNCTION public.update_reception_authorization_secure(
      UUID, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, TEXT
    ) FROM app_prontomedic;
    REVOKE ALL ON FUNCTION public.update_reception_eligibility_secure(
      UUID, TEXT, TEXT, TEXT
    ) FROM app_prontomedic;
    REVOKE ALL ON FUNCTION public.get_scheduling_requirements(
      BIGINT, BIGINT, BIGINT, INTEGER, TEXT
    ) FROM app_prontomedic;
    REVOKE ALL ON FUNCTION public.create_appointment_secure(
      BIGINT, BIGINT, DATE, TIME, TIME, UUID, INTEGER, INTEGER,
      BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN, TEXT
    ) FROM app_prontomedic;
    REVOKE ALL ON FUNCTION public.update_appointment_status_secure(
      BIGINT, TEXT, TEXT
    ) FROM app_prontomedic;
    REVOKE ALL ON FUNCTION public.reschedule_appointment_secure(
      BIGINT, DATE, TIME, TIME, TEXT
    ) FROM app_prontomedic;
    REVOKE ALL ON FUNCTION public.create_appointment_with_requirements_secure(
      BIGINT, BIGINT, DATE, TIME, TIME, UUID, INTEGER, INTEGER,
      BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, TEXT
    ) FROM app_prontomedic;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_appointment_status_secure(
  BIGINT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_appointment_secure(
  BIGINT, DATE, TIME, TIME, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_reception_authorization_secure(
  UUID, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_reception_eligibility_secure(
  UUID, TEXT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_scheduling_requirements(
  BIGINT, BIGINT, BIGINT, INTEGER, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_appointment_with_requirements_secure(
  BIGINT, BIGINT, DATE, TIME, TIME, UUID, INTEGER, INTEGER,
  BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, TEXT
) TO authenticated;

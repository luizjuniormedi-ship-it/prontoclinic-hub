-- Fundação incremental de contexto de acesso multiempresa/multiunidade.
-- O contexto é derivado exclusivamente de vínculos persistidos e só pode ser
-- selecionado por sessão autenticada em AAL2.

-- ---------------------------------------------------------------------------
-- Vínculos normalizados: usuário -> empresa -> papéis/unidades
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, company_id),
  UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS public.membership_roles (
  membership_id UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (membership_id, role_id)
);

CREATE TABLE IF NOT EXISTS public.membership_units (
  membership_id UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (membership_id, unit_id)
);

CREATE TABLE IF NOT EXISTS public.user_access_context (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  role_id INTEGER NOT NULL,
  unit_id INTEGER,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, session_id),
  CONSTRAINT user_access_context_membership_user_fkey
    FOREIGN KEY (membership_id, user_id)
    REFERENCES public.memberships(id, user_id) ON DELETE CASCADE,
  CONSTRAINT user_access_context_membership_role_fkey
    FOREIGN KEY (membership_id, role_id)
    REFERENCES public.membership_roles(membership_id, role_id) ON DELETE CASCADE,
  CONSTRAINT user_access_context_membership_unit_fkey
    FOREIGN KEY (membership_id, unit_id)
    REFERENCES public.membership_units(membership_id, unit_id) ON DELETE CASCADE
);

-- Versões intermediárias tornaram unit_id obrigatório. Perfis corporativos
-- validados abaixo precisam representar explicitamente contexto sem unidade.
ALTER TABLE public.user_access_context ALTER COLUMN unit_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS memberships_user_status_idx
  ON public.memberships(user_id, status);
CREATE INDEX IF NOT EXISTS memberships_company_status_idx
  ON public.memberships(company_id, status);
CREATE INDEX IF NOT EXISTS membership_roles_role_idx
  ON public.membership_roles(role_id, membership_id);
CREATE INDEX IF NOT EXISTS membership_units_unit_idx
  ON public.membership_units(unit_id, membership_id);

-- Uma unidade vinculada precisa pertencer à mesma empresa do vínculo.
CREATE OR REPLACE FUNCTION public.enforce_membership_unit_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.units u
      ON u.id = NEW.unit_id
     AND u.company_id = m.company_id
    WHERE m.id = NEW.membership_id
      AND u.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Unidade não pertence à empresa do vínculo ou está inativa'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_units_company ON public.membership_units;
CREATE TRIGGER trg_membership_units_company
BEFORE INSERT OR UPDATE OF membership_id, unit_id
ON public.membership_units
FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_unit_company();

-- Migração segura do vínculo legado. Não seleciona contexto automaticamente:
-- isso exige uma chamada explícita AAL2 à RPC abaixo.
INSERT INTO public.memberships (user_id, company_id, status)
SELECT up.id, up.company_id,
       CASE WHEN up.lg_ativo THEN 'active' ELSE 'suspended' END
FROM public.user_profiles up
WHERE up.company_id IS NOT NULL
ON CONFLICT (user_id, company_id) DO UPDATE
SET status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO public.membership_roles (membership_id, role_id)
SELECT m.id, up.role_id
FROM public.user_profiles up
JOIN public.memberships m
  ON m.user_id = up.id
 AND m.company_id = up.company_id
JOIN public.roles r
  ON r.id = up.role_id
 AND r.lg_ativo = TRUE
WHERE up.role_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.membership_units (membership_id, unit_id)
SELECT m.id, up.primary_unit_id
FROM public.user_profiles up
JOIN public.memberships m
  ON m.user_id = up.id
 AND m.company_id = up.company_id
JOIN public.units u
  ON u.id = up.primary_unit_id
 AND u.company_id = m.company_id
 AND u.lg_ativo = TRUE
WHERE up.primary_unit_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Se a empresa possui exatamente uma unidade ativa, ela é a única inferência
-- sem ambiguidade possível para perfis legados sem primary_unit_id.
INSERT INTO public.membership_units (membership_id, unit_id)
SELECT m.id, MIN(u.id)
FROM public.memberships m
JOIN public.units u
  ON u.company_id = m.company_id
 AND u.lg_ativo = TRUE
LEFT JOIN public.membership_units mu ON mu.membership_id = m.id
WHERE mu.membership_id IS NULL
GROUP BY m.id
HAVING COUNT(*) = 1
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Claims, seleção de contexto e helpers server-side
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_aal()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.aal', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal'
  );
$$;

CREATE OR REPLACE FUNCTION public.set_access_context(
  p_membership_id UUID,
  p_role_id INTEGER,
  p_unit_id INTEGER
)
RETURNS public.user_access_context
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_session_id UUID;
  v_context public.user_access_context;
  v_role_name TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória' USING ERRCODE = '42501';
  END IF;

  IF public.request_aal() IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 obrigatório para selecionar contexto de acesso'
      USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_session_id := NULLIF(auth.jwt()->>'session_id', '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'session_id inválido no JWT' USING ERRCODE = '42501';
  END;
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada sem session_id' USING ERRCODE = '42501';
  END IF;

  -- O lock evita selecionar um vínculo enquanto ele é suspenso/revogado.
  PERFORM 1
  FROM public.memberships m
  JOIN public.companies c
    ON c.id = m.company_id
   AND c.lg_ativo = TRUE
  WHERE m.id = p_membership_id
    AND m.user_id = v_user_id
    AND m.status = 'active'
  FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vínculo ativo não pertence ao usuário autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT lower(r.name) INTO v_role_name
  FROM public.membership_roles mr
  JOIN public.roles r ON r.id = mr.role_id AND r.lg_ativo = TRUE
  WHERE mr.membership_id = p_membership_id
    AND mr.role_id = p_role_id;
  IF v_role_name IS NULL THEN
    RAISE EXCEPTION 'Papel não está vinculado ao vínculo ativo'
      USING ERRCODE = '42501';
  END IF;

  IF p_unit_id IS NULL THEN
    IF v_role_name NOT IN ('admin', 'administrador', 'gestor', 'financeiro', 'auditor', 'dpo', 'superadmin', 'super_admin') THEN
      RAISE EXCEPTION 'Unidade é obrigatória para papel operacional'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.membership_units mu
    JOIN public.units u ON u.id = mu.unit_id AND u.lg_ativo = TRUE
    JOIN public.memberships m
      ON m.id = mu.membership_id
     AND m.company_id = u.company_id
    WHERE mu.membership_id = p_membership_id
      AND mu.unit_id = p_unit_id
  ) THEN
    RAISE EXCEPTION 'Unidade não está vinculada ao vínculo ativo'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_access_context (
    user_id, session_id, membership_id, role_id, unit_id, selected_at
  ) VALUES (
    v_user_id, v_session_id, p_membership_id, p_role_id, p_unit_id, NOW()
  )
  ON CONFLICT (user_id, session_id) DO UPDATE
  SET membership_id = EXCLUDED.membership_id,
      role_id = EXCLUDED.role_id,
      unit_id = EXCLUDED.unit_id,
      selected_at = EXCLUDED.selected_at
  RETURNING * INTO v_context;

  RETURN v_context;
END;
$$;

CREATE OR REPLACE FUNCTION public.active_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT m.company_id
  FROM public.user_access_context ctx
  JOIN public.memberships m
    ON m.id = ctx.membership_id
   AND m.user_id = ctx.user_id
   AND m.status = 'active'
  JOIN public.membership_roles mr
    ON mr.membership_id = ctx.membership_id
   AND mr.role_id = ctx.role_id
  JOIN public.roles r
    ON r.id = ctx.role_id
   AND r.lg_ativo = TRUE
  LEFT JOIN public.membership_units mu
    ON mu.membership_id = ctx.membership_id
   AND mu.unit_id = ctx.unit_id
  LEFT JOIN public.units u
    ON u.id = ctx.unit_id
   AND u.company_id = m.company_id
   AND u.lg_ativo = TRUE
  JOIN public.companies c
    ON c.id = m.company_id
   AND c.lg_ativo = TRUE
  WHERE ctx.user_id = auth.uid()
    AND ctx.session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
    AND public.request_aal() = 'aal2'
    AND (
      (ctx.unit_id IS NULL AND lower(r.name) IN ('admin', 'administrador', 'gestor', 'financeiro', 'auditor', 'dpo', 'superadmin', 'super_admin'))
      OR (mu.unit_id IS NOT NULL AND u.id IS NOT NULL)
    );
$$;

CREATE OR REPLACE FUNCTION public.active_unit_id()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT ctx.unit_id
  FROM public.user_access_context ctx
  JOIN public.memberships m
    ON m.id = ctx.membership_id
   AND m.user_id = ctx.user_id
   AND m.status = 'active'
  JOIN public.membership_roles mr
    ON mr.membership_id = ctx.membership_id
   AND mr.role_id = ctx.role_id
  JOIN public.roles r
    ON r.id = ctx.role_id
   AND r.lg_ativo = TRUE
  LEFT JOIN public.membership_units mu
    ON mu.membership_id = ctx.membership_id
   AND mu.unit_id = ctx.unit_id
  LEFT JOIN public.units u
    ON u.id = ctx.unit_id
   AND u.company_id = m.company_id
   AND u.lg_ativo = TRUE
  WHERE ctx.user_id = auth.uid()
    AND ctx.session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
    AND public.request_aal() = 'aal2'
    AND (
      (ctx.unit_id IS NULL AND lower(r.name) IN ('admin', 'administrador', 'gestor', 'financeiro', 'auditor', 'dpo', 'superadmin', 'super_admin'))
      OR (mu.unit_id IS NOT NULL AND u.id IS NOT NULL)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access(p_module TEXT, p_action TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.user_access_context ctx
    JOIN public.memberships m
      ON m.id = ctx.membership_id
     AND m.user_id = ctx.user_id
     AND m.status = 'active'
    JOIN public.membership_roles mr
      ON mr.membership_id = ctx.membership_id
     AND mr.role_id = ctx.role_id
    LEFT JOIN public.membership_units mu
      ON mu.membership_id = ctx.membership_id
     AND mu.unit_id = ctx.unit_id
    LEFT JOIN public.units u
      ON u.id = ctx.unit_id
     AND u.company_id = m.company_id
     AND u.lg_ativo = TRUE
    JOIN public.roles r
      ON r.id = ctx.role_id
     AND r.lg_ativo = TRUE
    JOIN public.role_permissions rp
      ON rp.company_id = m.company_id
     AND rp.role_id = ctx.role_id
     AND lower(rp.module) = lower(trim(p_module))
    WHERE ctx.user_id = auth.uid()
      AND ctx.session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
      AND public.request_aal() = 'aal2'
      AND (
        (ctx.unit_id IS NULL AND lower(r.name) IN ('admin', 'administrador', 'gestor', 'financeiro', 'auditor', 'dpo', 'superadmin', 'super_admin'))
        OR (mu.unit_id IS NOT NULL AND u.id IS NOT NULL)
      )
      AND CASE lower(trim(p_action))
        WHEN 'view' THEN rp.can_view
        WHEN 'read' THEN rp.can_view
        WHEN 'select' THEN rp.can_view
        WHEN 'create' THEN rp.can_create
        WHEN 'insert' THEN rp.can_create
        WHEN 'edit' THEN rp.can_edit
        WHEN 'update' THEN rp.can_edit
        WHEN 'delete' THEN rp.can_delete
        WHEN 'export' THEN rp.can_export
        ELSE FALSE
      END
  ), FALSE);
$$;

REVOKE ALL ON FUNCTION public.request_aal() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_access_context(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.active_company_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.active_unit_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_aal() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_access_context(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.active_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.active_unit_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT) TO authenticated;

-- As tabelas de vínculo são leitura própria; toda mutação de contexto ocorre via RPC.
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_access_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memberships_select_own ON public.memberships;
CREATE POLICY memberships_select_own ON public.memberships
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS membership_roles_select_own ON public.membership_roles;
CREATE POLICY membership_roles_select_own ON public.membership_roles
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.memberships m
  WHERE m.id = membership_roles.membership_id
    AND m.user_id = auth.uid()
));

DROP POLICY IF EXISTS membership_units_select_own ON public.membership_units;
CREATE POLICY membership_units_select_own ON public.membership_units
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.memberships m
  WHERE m.id = membership_units.membership_id
    AND m.user_id = auth.uid()
));

DROP POLICY IF EXISTS user_access_context_select_own ON public.user_access_context;
CREATE POLICY user_access_context_select_own ON public.user_access_context
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  AND session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
  AND public.request_aal() = 'aal2'
);

REVOKE ALL ON public.memberships, public.membership_roles, public.membership_units,
  public.user_access_context FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.memberships, public.membership_roles,
  public.membership_units, public.user_access_context FROM authenticated;
GRANT SELECT ON public.memberships, public.membership_roles, public.membership_units,
  public.user_access_context TO authenticated;

-- ---------------------------------------------------------------------------
-- Escopo clínico inicial por unidade. Tudo é condicional para instalações onde
-- alguma tabela central ainda não existe. Linhas sem unidade ficam inacessíveis.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_clinical_unit_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_module TEXT := TG_TABLE_NAME;
  v_alt_module TEXT := CASE TG_TABLE_NAME
    WHEN 'patients' THEN 'pacientes'
    WHEN 'appointments' THEN 'agenda'
    WHEN 'medical_records' THEN 'prontuario'
  END;
  v_action TEXT := CASE TG_OP
    WHEN 'INSERT' THEN 'create'
    WHEN 'UPDATE' THEN 'edit'
  END;
BEGIN
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    NEW.company_id := COALESCE(NEW.company_id, public.active_company_id());
    NEW.unit_id := COALESCE(NEW.unit_id, public.active_unit_id());
  END IF;

  IF NEW.company_id IS NULL OR NEW.unit_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.units u
    WHERE u.id = NEW.unit_id
      AND u.company_id = NEW.company_id
      AND u.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Empresa e unidade clínica devem ser válidas e consistentes'
      USING ERRCODE = '23514';
  END IF;

  -- Esta checagem também protege escritas feitas por RPCs SECURITY DEFINER
  -- legadas, que poderiam ignorar RLS do owner da tabela.
  IF auth.uid() IS NOT NULL AND (
    NEW.company_id IS DISTINCT FROM public.active_company_id()
    OR NEW.unit_id IS DISTINCT FROM public.active_unit_id()
    OR NOT (
      public.can_access(v_module, v_action)
      OR public.can_access(v_alt_module, v_action)
    )
  ) THEN
    RAISE EXCEPTION 'Escrita clínica fora do contexto ativo ou sem permissão'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table TEXT;
  v_module TEXT;
  v_alt_module TEXT;
  v_policy RECORD;
  v_constraint_name TEXT;
  v_has_unscoped BOOLEAN;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['patients', 'appointments', 'medical_records'] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS unit_id INTEGER', v_table);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(company_id, unit_id)',
                   'idx_' || v_table || '_company_unit', v_table);

    -- FK incremental não valida o legado; novas escritas são validadas.
    v_constraint_name := v_table || '_unit_id_fkey';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', v_table)::regclass
        AND conname = v_constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (unit_id) REFERENCES public.units(id) NOT VALID',
        v_table, v_constraint_name
      );
    END IF;
  END LOOP;

  -- Backfill somente quando a unidade é inferível sem ambiguidade.
  IF to_regclass('public.patients') IS NOT NULL
     AND to_regclass('public.appointments') IS NOT NULL THEN
    UPDATE public.patients p
       SET unit_id = x.unit_id
      FROM (
        SELECT patient_id, MIN(unit_id) AS unit_id
        FROM public.appointments
        WHERE patient_id IS NOT NULL AND unit_id IS NOT NULL
        GROUP BY patient_id
        HAVING COUNT(DISTINCT unit_id) = 1
      ) x
     WHERE p.id = x.patient_id
       AND p.unit_id IS NULL
       AND EXISTS (
         SELECT 1 FROM public.units u
         WHERE u.id = x.unit_id AND u.company_id = p.company_id
       );

    UPDATE public.appointments a
       SET unit_id = p.unit_id
      FROM public.patients p
     WHERE a.patient_id = p.id
       AND a.company_id = p.company_id
       AND a.unit_id IS NULL
       AND p.unit_id IS NOT NULL;
  END IF;

  IF to_regclass('public.medical_records') IS NOT NULL
     AND to_regclass('public.appointments') IS NOT NULL THEN
    UPDATE public.medical_records mr
       SET unit_id = a.unit_id
      FROM public.appointments a
     WHERE mr.appointment_id = a.id
       AND mr.company_id = a.company_id
       AND mr.unit_id IS NULL
       AND a.unit_id IS NOT NULL;
  END IF;

  FOREACH v_table IN ARRAY ARRAY['patients', 'appointments', 'medical_records'] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format($sql$
      UPDATE public.%I t
         SET unit_id = only_unit.unit_id
        FROM (
          SELECT company_id, MIN(id) AS unit_id
          FROM public.units
          WHERE lg_ativo = TRUE
          GROUP BY company_id
          HAVING COUNT(*) = 1
        ) only_unit
       WHERE t.company_id = only_unit.company_id
         AND t.unit_id IS NULL
    $sql$, v_table);

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE company_id IS NULL OR unit_id IS NULL)',
      v_table
    ) INTO v_has_unscoped;
    IF v_has_unscoped THEN
      RAISE EXCEPTION
        'ACCESS_CONTEXT_PREFLIGHT: % contém dados sem empresa/unidade; reconciliação manual obrigatória',
        v_table;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',
                   'trg_' || v_table || '_unit_company', v_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_clinical_unit_company()',
      'trg_' || v_table || '_unit_company', v_table
    );

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);

    -- Policies permissivas são combinadas por OR; remova todas para garantir
    -- que só a matriz abaixo autorize acesso às tabelas clínicas centrais.
    FOR v_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;

    v_module := v_table;
    v_alt_module := CASE v_table
      WHEN 'patients' THEN 'pacientes'
      WHEN 'appointments' THEN 'agenda'
      WHEN 'medical_records' THEN 'prontuario'
    END;

    EXECUTE format($policy$
      CREATE POLICY %I ON public.%I
      FOR SELECT TO authenticated
      USING (
        company_id = public.active_company_id()
        AND unit_id = public.active_unit_id()
        AND (public.can_access(%L, 'view') OR public.can_access(%L, 'view'))
      )
    $policy$, v_table || '_access_select', v_table, v_module, v_alt_module);

    EXECUTE format($policy$
      CREATE POLICY %I ON public.%I
      FOR INSERT TO authenticated
      WITH CHECK (
        company_id = public.active_company_id()
        AND unit_id = public.active_unit_id()
        AND (public.can_access(%L, 'create') OR public.can_access(%L, 'create'))
      )
    $policy$, v_table || '_access_insert', v_table, v_module, v_alt_module);

    EXECUTE format($policy$
      CREATE POLICY %I ON public.%I
      FOR UPDATE TO authenticated
      USING (
        company_id = public.active_company_id()
        AND unit_id = public.active_unit_id()
        AND (public.can_access(%L, 'edit') OR public.can_access(%L, 'edit'))
      )
      WITH CHECK (
        company_id = public.active_company_id()
        AND unit_id = public.active_unit_id()
        AND (public.can_access(%L, 'edit') OR public.can_access(%L, 'edit'))
      )
    $policy$, v_table || '_access_update', v_table,
       v_module, v_alt_module, v_module, v_alt_module);

    EXECUTE format($policy$
      CREATE POLICY %I ON public.%I
      FOR DELETE TO authenticated
      USING (
        company_id = public.active_company_id()
        AND unit_id = public.active_unit_id()
        AND (public.can_access(%L, 'delete') OR public.can_access(%L, 'delete'))
      )
    $policy$, v_table || '_access_delete', v_table, v_module, v_alt_module);

    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', v_table);
  END LOOP;
END;
$$;

COMMENT ON TABLE public.memberships IS
  'Vínculos normalizados de um usuário com múltiplas empresas.';
COMMENT ON TABLE public.user_access_context IS
  'Contexto ativo persistido, selecionado exclusivamente via RPC AAL2 validada.';
COMMENT ON FUNCTION public.can_access(TEXT, TEXT) IS
  'Autoriza módulo/ação usando apenas vínculo, papel, empresa e unidade do contexto ativo validado.';

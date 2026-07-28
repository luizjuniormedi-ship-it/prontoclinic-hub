-- Module 19: unit-scoped, atomic nursing triage foundation.
-- Additive migration. It never reads from or writes to DataSIGH.
--
-- Security model:
-- - public RPCs are SECURITY DEFINER wrappers owned by a dedicated NOLOGIN role;
-- - privileged writes live in the non-exposed private schema;
-- - actor/company are derived from authenticated request claims;
-- - direct writes are revoked from application roles;
-- - legacy rows without unit_id remain readable inside their company, but every
--   new triage and reclassification requires an authorized unit.

BEGIN;

DO $owner$
DECLARE
  v_executor_is_superuser BOOLEAN;
BEGIN
  SELECT rolsuper
    INTO v_executor_is_superuser
    FROM pg_roles
   WHERE rolname = CURRENT_USER;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_rpc_owner'
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION
        'M19 requires a superuser to create prontomedic_rpc_owner';
    END IF;
    EXECUTE
      'CREATE ROLE prontomedic_rpc_owner NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  ELSIF EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = 'prontomedic_rpc_owner'
       AND (rolcanlogin OR NOT rolbypassrls OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication)
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION
        'M19 cannot harden the existing prontomedic_rpc_owner without a superuser';
    END IF;
    EXECUTE
      'ALTER ROLE prontomedic_rpc_owner NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  END IF;
END
$owner$;

DO $$
BEGIN
  IF to_regclass('public.triagens') IS NULL
     OR to_regclass('public.news2_avaliacoes') IS NULL
     OR to_regclass('public.triagem_fila') IS NULL
     OR to_regclass('public.mnct_classificacao_risco') IS NULL
     OR to_regclass('public.mnct_fluxograma') IS NULL
     OR to_regclass('public.companies') IS NULL
     OR to_regclass('public.units') IS NULL
     OR to_regclass('public.patients') IS NULL
     OR to_regclass('public.appointments') IS NULL
     OR to_regclass('public.user_profiles') IS NULL
     OR to_regclass('public.permissions') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
     OR to_regclass('public.user_permissions') IS NULL THEN
    RAISE EXCEPTION 'Module 19 dependencies are missing';
  END IF;

  IF to_regprocedure('public.audit_current_user_id()') IS NULL
     OR to_regprocedure('public.audit_current_company_id()') IS NULL
     OR to_regprocedure('public.audit_has_role(text[])') IS NULL
     OR to_regprocedure('public.org_can_access_unit(uuid,integer)') IS NULL
     OR to_regprocedure('private.transition_triage_queue(bigint,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Module 19 security or Module 12 queue contracts are missing';
  END IF;
END
$$;

INSERT INTO public.permissions (module, action, label, description)
VALUES
  ('triagem_clinica', 'view', 'Visualizar triagem clínica', 'Consultar triagens e classificações de risco'),
  ('triagem_clinica', 'create', 'Concluir triagem clínica', 'Registrar triagem, classificação e avaliação NEWS2'),
  ('triagem_clinica', 'edit', 'Reclassificar triagem clínica', 'Registrar reclassificação clínica auditável')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (
  role_id, company_id, module, can_view, can_create, can_edit, can_delete, can_export
)
SELECT r.id, c.id, 'triagem_clinica', TRUE, TRUE, TRUE, FALSE, FALSE
FROM public.roles r
CROSS JOIN public.companies c
WHERE r.name IN ('admin', 'gestor', 'medico', 'enfermagem', 'tecnico_enfermagem')
ON CONFLICT DO NOTHING;

UPDATE public.role_permissions rp
SET can_view = FALSE,
    can_create = FALSE,
    can_edit = FALSE,
    can_delete = FALSE,
    can_export = FALSE,
    updated_at = NOW()
FROM public.roles r
WHERE r.id = rp.role_id
  AND rp.module = 'triagem_clinica'
  AND r.name NOT IN ('admin', 'gestor', 'medico', 'enfermagem', 'tecnico_enfermagem')
  AND (rp.can_view OR rp.can_create OR rp.can_edit OR rp.can_delete OR rp.can_export);

ALTER TABLE public.triagens
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS triagem_fila_id BIGINT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.news2_avaliacoes
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS cd_usuario_avaliador UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.triagens'::regclass
       AND conname = 'm19_triagens_unit_fkey'
  ) THEN
    ALTER TABLE public.triagens
      ADD CONSTRAINT m19_triagens_unit_fkey
      FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.triagens'::regclass
       AND conname = 'm19_triagens_queue_fkey'
  ) THEN
    ALTER TABLE public.triagens
      ADD CONSTRAINT m19_triagens_queue_fkey
      FOREIGN KEY (triagem_fila_id) REFERENCES public.triagem_fila(id) ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.news2_avaliacoes'::regclass
       AND conname = 'm19_news2_unit_fkey'
  ) THEN
    ALTER TABLE public.news2_avaliacoes
      ADD CONSTRAINT m19_news2_unit_fkey
      FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.news2_avaliacoes'::regclass
       AND conname = 'm19_news2_actor_fkey'
  ) THEN
    ALTER TABLE public.news2_avaliacoes
      ADD CONSTRAINT m19_news2_actor_fkey
      FOREIGN KEY (cd_usuario_avaliador) REFERENCES auth.users(id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_m19_triagens_scope
  ON public.triagens(company_id, unit_id, dt_triagem DESC);
CREATE INDEX IF NOT EXISTS idx_m19_triagens_appointment
  ON public.triagens(company_id, unit_id, cd_appointment)
  WHERE cd_appointment IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_m19_triagens_queue
  ON public.triagens(company_id, unit_id, triagem_fila_id)
  WHERE triagem_fila_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_m19_news2_scope
  ON public.news2_avaliacoes(company_id, unit_id, dt_avaliacao DESC);

DO $validate$
DECLARE
  v_orphans BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_orphans
    FROM public.triagens t
    LEFT JOIN public.units u ON u.id = t.unit_id
   WHERE t.unit_id IS NOT NULL AND u.id IS NULL;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'M19 cannot validate m19_triagens_unit_fkey: % orphan rows', v_orphans;
  END IF;

  SELECT COUNT(*) INTO v_orphans
    FROM public.triagens t
    LEFT JOIN public.triagem_fila q ON q.id = t.triagem_fila_id
   WHERE t.triagem_fila_id IS NOT NULL AND q.id IS NULL;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'M19 cannot validate m19_triagens_queue_fkey: % orphan rows', v_orphans;
  END IF;

  SELECT COUNT(*) INTO v_orphans
    FROM public.news2_avaliacoes n
    LEFT JOIN public.units u ON u.id = n.unit_id
   WHERE n.unit_id IS NOT NULL AND u.id IS NULL;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'M19 cannot validate m19_news2_unit_fkey: % orphan rows', v_orphans;
  END IF;

  SELECT COUNT(*) INTO v_orphans
    FROM public.news2_avaliacoes n
    LEFT JOIN auth.users u ON u.id = n.cd_usuario_avaliador
   WHERE n.cd_usuario_avaliador IS NOT NULL AND u.id IS NULL;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'M19 cannot validate m19_news2_actor_fkey: % orphan rows', v_orphans;
  END IF;

  ALTER TABLE public.triagens
    VALIDATE CONSTRAINT m19_triagens_unit_fkey;
  ALTER TABLE public.triagens
    VALIDATE CONSTRAINT m19_triagens_queue_fkey;
  ALTER TABLE public.news2_avaliacoes
    VALIDATE CONSTRAINT m19_news2_unit_fkey;
  ALTER TABLE public.news2_avaliacoes
    VALIDATE CONSTRAINT m19_news2_actor_fkey;
END
$validate$;

CREATE TABLE IF NOT EXISTS public.triagem_reclassificacoes (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  triagem_id BIGINT NOT NULL REFERENCES public.triagens(id) ON DELETE RESTRICT,
  classificacao_anterior_id INTEGER REFERENCES public.mnct_classificacao_risco(id) ON DELETE RESTRICT,
  classificacao_nova_id INTEGER NOT NULL REFERENCES public.mnct_classificacao_risco(id) ON DELETE RESTRICT,
  motivo TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'RECLASSIFICACAO'
    CHECK (tipo IN ('CLASSIFICACAO_INICIAL', 'RECLASSIFICACAO')),
  ator_usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT m19_reclassification_reason_required
    CHECK (length(btrim(motivo)) BETWEEN 3 AND 1000),
  CONSTRAINT m19_reclassification_changes_value
    CHECK (
      tipo = 'CLASSIFICACAO_INICIAL'
      OR classificacao_anterior_id IS DISTINCT FROM classificacao_nova_id
    )
);

CREATE INDEX IF NOT EXISTS idx_m19_reclassification_triage
  ON public.triagem_reclassificacoes(company_id, unit_id, triagem_id, created_at DESC);

COMMENT ON TABLE public.triagem_reclassificacoes IS
  'Append-only audit trail for initial nursing classification and subsequent risk reclassification.';
COMMENT ON COLUMN public.triagem_reclassificacoes.motivo IS
  'Clinical reason. Mandatory for initial classification and every reclassification.';

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION private.org_is_manager_runtime()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_profiles up
     WHERE (
       up.id = private.current_user_id()
       OR up.user_id = private.current_user_id()
     )
       AND up.lg_ativo = TRUE
       AND lower(coalesce(up.role_name, '')) IN (
         'admin', 'administrador', 'gestor', 'gerente', 'administrativo'
       )
  )
$fn$;

CREATE OR REPLACE FUNCTION private.org_can_access_unit_runtime(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
  SELECT p_company_id = private.current_company_id()
    AND EXISTS (
      SELECT 1
        FROM public.units u
       WHERE u.id = p_unit_id
         AND u.company_id = p_company_id
         AND u.lg_ativo = TRUE
         AND (
           private.org_is_manager_runtime()
           OR EXISTS (
             SELECT 1
               FROM public.user_profiles up
              WHERE (
                up.id = private.current_user_id()
                OR up.user_id = private.current_user_id()
              )
                AND up.company_id = p_company_id
                AND up.primary_unit_id = p_unit_id
                AND up.lg_ativo = TRUE
           )
           OR EXISTS (
             SELECT 1
               FROM public.unit_access ua
              WHERE ua.user_id = private.current_user_id()
                AND ua.company_id = p_company_id
                AND ua.unit_id = p_unit_id
                AND ua.valid_from <= CURRENT_DATE
                AND (ua.valid_until IS NULL OR ua.valid_until >= CURRENT_DATE)
           )
         )
    )
$fn$;

ALTER FUNCTION private.org_is_manager_runtime()
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION private.org_can_access_unit_runtime(UUID, INTEGER)
  OWNER TO prontomedic_rpc_owner;

REVOKE ALL ON FUNCTION private.org_is_manager_runtime()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.org_can_access_unit_runtime(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.org_is_manager_runtime()
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.org_can_access_unit_runtime(UUID, INTEGER)
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;

CREATE OR REPLACE FUNCTION public.org_is_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, private
AS $fn$
  SELECT private.org_is_manager_runtime()
$fn$;

CREATE OR REPLACE FUNCTION public.org_can_access_unit(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, private
AS $fn$
  SELECT private.org_can_access_unit_runtime(p_company_id, p_unit_id)
$fn$;

REVOKE ALL ON FUNCTION public.org_is_manager()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_is_manager()
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;

CREATE OR REPLACE FUNCTION private.prontomedic_module_action_allowed(
  p_module TEXT,
  p_action TEXT,
  p_unit_id INTEGER,
  p_default BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
  WITH actor_profile AS (
    SELECT CASE lower(coalesce(up.role_name, ''))
      WHEN 'administrador' THEN 'admin'
      WHEN 'admin_master' THEN 'admin'
      WHEN 'master' THEN 'admin'
      WHEN 'gerente' THEN 'gestor'
      WHEN 'médico' THEN 'medico'
      WHEN 'doctor' THEN 'medico'
      WHEN 'enfermeiro' THEN 'enfermagem'
      WHEN 'enfermeira' THEN 'enfermagem'
      WHEN 'nurse' THEN 'enfermagem'
      WHEN 'técnico' THEN 'tecnico_enfermagem'
      WHEN 'tecnico' THEN 'tecnico_enfermagem'
      WHEN 'técnico_enfermagem' THEN 'tecnico_enfermagem'
      WHEN 'farmaceutico' THEN 'farmacia'
      WHEN 'farmacêutico' THEN 'farmacia'
      WHEN 'pharmacist' THEN 'farmacia'
      WHEN 'laboratório' THEN 'laboratorio'
      WHEN 'radiologia' THEN 'diagnostico'
      ELSE lower(coalesce(up.role_name, ''))
    END AS role_name
    FROM public.user_profiles up
    WHERE (up.id = auth.uid() OR up.user_id = auth.uid())
      AND up.company_id = public.audit_current_company_id()
      AND up.lg_ativo = TRUE
    LIMIT 1
  ),
  matching_override AS (
    SELECT up.effect
    FROM public.user_permissions up
    JOIN public.permissions p ON p.id = up.permission_id
    WHERE up.user_id = auth.uid()
      AND up.company_id = public.audit_current_company_id()
      AND p.module = p_module
      AND p.action = p_action
      AND up.valid_from <= NOW()
      AND (up.valid_until IS NULL OR up.valid_until >= NOW())
      AND up.sector_code IS NULL
      AND (
        up.unit_id IS NULL
        OR (p_unit_id IS NOT NULL AND up.unit_id = p_unit_id)
      )
  ),
  role_matrix AS (
    SELECT CASE p_action
      WHEN 'view' THEN rp.can_view
      WHEN 'create' THEN rp.can_create
      WHEN 'edit' THEN rp.can_edit
      WHEN 'delete' THEN rp.can_delete
      WHEN 'export' THEN rp.can_export
      ELSE FALSE
    END AS allowed
    FROM actor_profile ap
    JOIN public.roles r ON lower(r.name) = ap.role_name
    JOIN public.role_permissions rp
      ON rp.role_id = r.id
     AND rp.module = p_module
    WHERE r.lg_ativo = TRUE
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM matching_override WHERE effect = 'deny') THEN FALSE
    WHEN EXISTS (SELECT 1 FROM matching_override WHERE effect = 'grant') THEN TRUE
    WHEN EXISTS (SELECT 1 FROM role_matrix WHERE allowed) THEN TRUE
    ELSE COALESCE(p_default, FALSE)
  END
$fn$;

REVOKE ALL ON FUNCTION private.prontomedic_module_action_allowed(
  TEXT, TEXT, INTEGER, BOOLEAN
) FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.prontomedic_module_action_allowed(
  TEXT, TEXT, INTEGER, BOOLEAN
) TO prontomedic_rpc_owner;

CREATE OR REPLACE FUNCTION private.m19_guard_reclassification_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION 'Historico de reclassificacao e imutavel';
END;
$fn$;

REVOKE ALL ON FUNCTION private.m19_guard_reclassification_immutable()
  FROM PUBLIC, anon, authenticated, app_prontomedic;

DROP TRIGGER IF EXISTS trg_m19_reclassification_immutable
  ON public.triagem_reclassificacoes;
CREATE TRIGGER trg_m19_reclassification_immutable
  BEFORE UPDATE OR DELETE ON public.triagem_reclassificacoes
  FOR EACH ROW
  EXECUTE FUNCTION private.m19_guard_reclassification_immutable();

-- Replace permissive legacy catalog policies. Global rows remain visible, but
-- tenant-owned rows can only be read inside their company.
DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname, tablename
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('mnct_classificacao_risco', 'mnct_fluxograma')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      v_policy.policyname,
      v_policy.tablename
    );
  END LOOP;
END
$$;

DROP POLICY IF EXISTS m19_classification_catalog_read
  ON public.mnct_classificacao_risco;
CREATE POLICY m19_classification_catalog_read
  ON public.mnct_classificacao_risco
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id IS NULL
    OR company_id = public.audit_current_company_id()
  );

DROP POLICY IF EXISTS m19_flowchart_catalog_read
  ON public.mnct_fluxograma;
CREATE POLICY m19_flowchart_catalog_read
  ON public.mnct_fluxograma
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id IS NULL
    OR company_id = public.audit_current_company_id()
  );

ALTER TABLE public.triagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triagens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.news2_avaliacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news2_avaliacoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.triagem_reclassificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triagem_reclassificacoes FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname, tablename
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('triagens', 'news2_avaliacoes', 'triagem_reclassificacoes')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      v_policy.policyname,
      v_policy.tablename
    );
  END LOOP;
END
$$;

CREATE POLICY m19_triagens_read
  ON public.triagens
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND (
      unit_id IS NULL
      OR public.org_can_access_unit(company_id, unit_id)
    )
  );

CREATE POLICY m19_triagens_worker_insert
  ON public.triagens
  FOR INSERT TO app_prontomedic
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
    AND cd_usuario_enfermeiro = public.audit_current_user_id()
  );

CREATE POLICY m19_triagens_worker_update
  ON public.triagens
  FOR UPDATE TO app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
  )
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
  );

-- Temporary compatibility bridge for the legacy triage UI. It remains
-- tenant/unit/actor scoped and intentionally does not allow DELETE.
CREATE POLICY m19_triagens_legacy_insert
  ON public.triagens
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND (
      unit_id IS NULL
      OR public.org_can_access_unit(company_id, unit_id)
    )
    AND cd_usuario_enfermeiro = public.audit_current_user_id()
  );

CREATE POLICY m19_triagens_legacy_update
  ON public.triagens
  FOR UPDATE TO authenticated
  USING (
    company_id = public.audit_current_company_id()
    AND (
      unit_id IS NULL
      OR public.org_can_access_unit(company_id, unit_id)
    )
  )
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND (
      unit_id IS NULL
      OR public.org_can_access_unit(company_id, unit_id)
    )
    AND cd_usuario_enfermeiro = public.audit_current_user_id()
  );

CREATE POLICY m19_news2_read
  ON public.news2_avaliacoes
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND (
      unit_id IS NULL
      OR public.org_can_access_unit(company_id, unit_id)
    )
  );

CREATE POLICY m19_news2_worker_insert
  ON public.news2_avaliacoes
  FOR INSERT TO app_prontomedic
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
    AND cd_usuario_avaliador = public.audit_current_user_id()
  );

CREATE POLICY m19_news2_legacy_insert
  ON public.news2_avaliacoes
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND (
      unit_id IS NULL
      OR public.org_can_access_unit(company_id, unit_id)
    )
    AND (
      cd_usuario_avaliador IS NULL
      OR cd_usuario_avaliador = public.audit_current_user_id()
    )
  );

CREATE POLICY m19_reclassification_read
  ON public.triagem_reclassificacoes
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

CREATE POLICY m19_reclassification_worker_insert
  ON public.triagem_reclassificacoes
  FOR INSERT TO app_prontomedic
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND ator_usuario_id = public.audit_current_user_id()
  );

REVOKE ALL ON TABLE public.triagens,
  public.news2_avaliacoes,
  public.triagem_reclassificacoes
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT SELECT ON TABLE public.triagens,
  public.news2_avaliacoes,
  public.triagem_reclassificacoes
  TO authenticated, app_prontomedic;
GRANT INSERT, UPDATE ON TABLE public.triagens TO authenticated, app_prontomedic;
GRANT INSERT ON TABLE public.news2_avaliacoes TO authenticated, app_prontomedic;
REVOKE INSERT, UPDATE, DELETE
  ON public.mnct_classificacao_risco, public.mnct_fluxograma
  FROM authenticated, app_prontomedic;
GRANT SELECT ON public.mnct_classificacao_risco, public.mnct_fluxograma
  TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION private.m19_complete_triage(
  p_unit_id INTEGER,
  p_patient_id BIGINT,
  p_appointment_id BIGINT DEFAULT NULL,
  p_queue_id BIGINT DEFAULT NULL,
  p_classification_id INTEGER DEFAULT NULL,
  p_classification_reason TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::JSONB,
  p_news2 JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
DECLARE
  v_actor UUID := public.audit_current_user_id();
  v_company UUID := public.audit_current_company_id();
  v_reason TEXT := NULLIF(btrim(coalesce(p_classification_reason, '')), '');
  v_appointment public.appointments;
  v_queue public.triagem_fila;
  v_triage public.triagens;
  v_news public.news2_avaliacoes;
  v_existing public.triagens;
BEGIN
  IF v_actor IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Sessao autenticada com empresa e ator e obrigatoria';
  END IF;
  IF NOT private.prontomedic_module_action_allowed(
    'triagem_clinica',
    'create',
    p_unit_id,
    FALSE
  ) THEN
    RAISE EXCEPTION 'Perfil sem permissao para concluir triagem';
  END IF;
  IF p_unit_id IS NULL
     OR p_patient_id IS NULL
     OR p_classification_id IS NULL THEN
    RAISE EXCEPTION 'Unidade, paciente e classificacao sao obrigatorios';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Motivo clinico da classificacao e obrigatorio';
  END IF;
  IF jsonb_typeof(coalesce(p_payload, '{}'::JSONB)) <> 'object' THEN
    RAISE EXCEPTION 'Payload da triagem deve ser um objeto JSON';
  END IF;
  IF p_news2 IS NOT NULL AND jsonb_typeof(p_news2) <> 'object' THEN
    RAISE EXCEPTION 'Payload NEWS2 deve ser um objeto JSON';
  END IF;
  IF NOT public.org_can_access_unit(v_company, p_unit_id) THEN
    RAISE EXCEPTION 'Unidade fora do escopo autorizado';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.patients
     WHERE id = p_patient_id
       AND company_id = v_company
       AND lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Paciente fora do tenant ou inativo';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.mnct_classificacao_risco
     WHERE id = p_classification_id
       AND lg_ativo = TRUE
       AND (company_id IS NULL OR company_id = v_company)
  ) THEN
    RAISE EXCEPTION 'Classificacao fora do tenant ou inativa';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      format(
        'm19:%s:%s:%s:%s:%s',
        v_company,
        p_unit_id,
        p_patient_id,
        coalesce(p_appointment_id, 0),
        coalesce(p_queue_id, 0)
      ),
      0
    )
  );

  IF p_appointment_id IS NOT NULL THEN
    SELECT *
      INTO v_appointment
      FROM public.appointments
     WHERE id = p_appointment_id
       AND company_id = v_company
       AND patient_id = p_patient_id
       AND (unit_id IS NULL OR unit_id = p_unit_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Agendamento fora do tenant, paciente ou unidade';
    END IF;
  END IF;

  IF p_queue_id IS NOT NULL THEN
    SELECT *
      INTO v_queue
      FROM public.triagem_fila
     WHERE id = p_queue_id
       AND company_id = v_company
       AND unit_id = p_unit_id
       AND cd_paciente = p_patient_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Senha de triagem fora do tenant, paciente ou unidade';
    END IF;
    IF v_queue.tp_status NOT IN ('CHAMADO', 'EM_TRIAGEM', 'TRIADO') THEN
      RAISE EXCEPTION 'Senha precisa estar chamada ou em triagem';
    END IF;
  END IF;

  SELECT *
    INTO v_existing
    FROM public.triagens
   WHERE company_id = v_company
     AND unit_id = p_unit_id
     AND (
       (p_queue_id IS NOT NULL AND triagem_fila_id = p_queue_id)
       OR (
         p_queue_id IS NULL
         AND p_appointment_id IS NOT NULL
         AND cd_appointment = p_appointment_id
       )
     )
   ORDER BY dt_triagem DESC, id DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF p_queue_id IS NOT NULL AND v_queue.tp_status <> 'TRIADO' THEN
      PERFORM private.transition_triage_queue(
        p_queue_id,
        'TRIADO',
        'Triagem M19 concluida'
      );
    END IF;
    RETURN jsonb_build_object(
      'triage', to_jsonb(v_existing),
      'news2', NULL,
      'idempotent', TRUE
    );
  END IF;

  INSERT INTO public.triagens (
    company_id,
    unit_id,
    triagem_fila_id,
    cd_paciente,
    cd_appointment,
    dt_triagem,
    cd_classificacao_id,
    cd_usuario_enfermeiro,
    vl_pressao_sistolica,
    vl_pressao_diastolica,
    vl_frequencia_cardiaca,
    vl_frequencia_respiratoria,
    vl_temperatura,
    vl_saturacao_o2,
    vl_glicemia,
    vl_escala_dor,
    vl_peso_kg,
    vl_altura_cm,
    vl_glasgow_ocular,
    vl_glasgow_verbal,
    vl_glasgow_motor,
    ds_queixa_principal,
    ds_historia_doenca_atual,
    ds_medicamentos_uso,
    ds_alergias,
    ds_observacoes_enfermagem,
    tp_status,
    updated_at
  )
  VALUES (
    v_company,
    p_unit_id,
    p_queue_id,
    p_patient_id,
    p_appointment_id,
    NOW(),
    p_classification_id,
    v_actor,
    NULLIF(p_payload->>'systolicBloodPressure', '')::SMALLINT,
    NULLIF(p_payload->>'diastolicBloodPressure', '')::SMALLINT,
    NULLIF(p_payload->>'heartRate', '')::SMALLINT,
    NULLIF(p_payload->>'respiratoryRate', '')::SMALLINT,
    NULLIF(p_payload->>'temperature', '')::DECIMAL(4,1),
    NULLIF(p_payload->>'oxygenSaturation', '')::SMALLINT,
    NULLIF(p_payload->>'bloodGlucose', '')::SMALLINT,
    NULLIF(p_payload->>'painScale', '')::SMALLINT,
    NULLIF(p_payload->>'weightKg', '')::DECIMAL(5,2),
    NULLIF(p_payload->>'heightCm', '')::DECIMAL(5,1),
    NULLIF(p_payload->>'glasgowEye', '')::SMALLINT,
    NULLIF(p_payload->>'glasgowVerbal', '')::SMALLINT,
    NULLIF(p_payload->>'glasgowMotor', '')::SMALLINT,
    NULLIF(btrim(p_payload->>'chiefComplaint'), ''),
    NULLIF(btrim(p_payload->>'currentIllnessHistory'), ''),
    NULLIF(btrim(p_payload->>'currentMedications'), ''),
    NULLIF(btrim(p_payload->>'allergies'), ''),
    NULLIF(btrim(p_payload->>'nursingNotes'), ''),
    'TRIADO',
    NOW()
  )
  RETURNING * INTO v_triage;

  INSERT INTO public.triagem_reclassificacoes (
    company_id,
    unit_id,
    triagem_id,
    classificacao_anterior_id,
    classificacao_nova_id,
    motivo,
    tipo,
    ator_usuario_id
  )
  VALUES (
    v_company,
    p_unit_id,
    v_triage.id,
    NULL,
    p_classification_id,
    v_reason,
    'CLASSIFICACAO_INICIAL',
    v_actor
  );

  IF p_news2 IS NOT NULL THEN
    INSERT INTO public.news2_avaliacoes (
      company_id,
      unit_id,
      cd_triagem,
      cd_usuario_avaliador,
      nr_frequencia_respiratoria,
      nr_saturacao_o2,
      nr_temperatura,
      nr_pressao_sistolica,
      nr_frequencia_cardiaca,
      nr_nivel_consciencia,
      cd_classificacao_risco,
      dt_avaliacao
    )
    VALUES (
      v_company,
      p_unit_id,
      v_triage.id,
      v_actor,
      NULLIF(p_news2->>'respiratoryRateScore', '')::SMALLINT,
      NULLIF(p_news2->>'oxygenSaturationScore', '')::SMALLINT,
      NULLIF(p_news2->>'temperatureScore', '')::SMALLINT,
      NULLIF(p_news2->>'systolicBloodPressureScore', '')::SMALLINT,
      NULLIF(p_news2->>'heartRateScore', '')::SMALLINT,
      NULLIF(p_news2->>'consciousnessScore', '')::SMALLINT,
      NULLIF(btrim(p_news2->>'risk'), ''),
      NOW()
    )
    RETURNING * INTO v_news;
  END IF;

  IF p_queue_id IS NOT NULL AND v_queue.tp_status <> 'TRIADO' THEN
    PERFORM private.transition_triage_queue(
      p_queue_id,
      'TRIADO',
      'Triagem M19 concluida'
    );
  END IF;

  RETURN jsonb_build_object(
    'triage', to_jsonb(v_triage),
    'news2', CASE WHEN v_news.id IS NULL THEN NULL ELSE to_jsonb(v_news) END,
    'idempotent', FALSE
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.m19_complete_triage_secure(
  p_unit_id INTEGER,
  p_patient_id BIGINT,
  p_appointment_id BIGINT DEFAULT NULL,
  p_queue_id BIGINT DEFAULT NULL,
  p_classification_id INTEGER DEFAULT NULL,
  p_classification_reason TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::JSONB,
  p_news2 JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
BEGIN
  RETURN private.m19_complete_triage(
    p_unit_id,
    p_patient_id,
    p_appointment_id,
    p_queue_id,
    p_classification_id,
    p_classification_reason,
    p_payload,
    p_news2
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION private.m19_reclassify_triage(
  p_triage_id BIGINT,
  p_classification_id INTEGER,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
DECLARE
  v_actor UUID := public.audit_current_user_id();
  v_company UUID := public.audit_current_company_id();
  v_reason TEXT := NULLIF(btrim(coalesce(p_reason, '')), '');
  v_triage public.triagens;
  v_history public.triagem_reclassificacoes;
BEGIN
  IF v_actor IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Sessao autenticada com empresa e ator e obrigatoria';
  END IF;
  IF p_triage_id IS NULL OR p_classification_id IS NULL THEN
    RAISE EXCEPTION 'Triagem e nova classificacao sao obrigatorias';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Motivo clinico da reclassificacao e obrigatorio';
  END IF;

  SELECT *
    INTO v_triage
    FROM public.triagens
   WHERE id = p_triage_id
     AND company_id = v_company
     AND unit_id IS NOT NULL
   FOR UPDATE;
  IF NOT FOUND OR NOT public.org_can_access_unit(v_company, v_triage.unit_id) THEN
    RAISE EXCEPTION 'Triagem fora do tenant ou unidade autorizada';
  END IF;
  IF NOT private.prontomedic_module_action_allowed(
    'triagem_clinica',
    'edit',
    v_triage.unit_id,
    FALSE
  ) THEN
    RAISE EXCEPTION 'Perfil sem permissao para reclassificar triagem';
  END IF;
  IF v_triage.cd_classificacao_id IS NOT DISTINCT FROM p_classification_id THEN
    RAISE EXCEPTION 'Nova classificacao deve ser diferente da atual';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.mnct_classificacao_risco
     WHERE id = p_classification_id
       AND lg_ativo = TRUE
       AND (company_id IS NULL OR company_id = v_company)
  ) THEN
    RAISE EXCEPTION 'Classificacao fora do tenant ou inativa';
  END IF;

  INSERT INTO public.triagem_reclassificacoes (
    company_id,
    unit_id,
    triagem_id,
    classificacao_anterior_id,
    classificacao_nova_id,
    motivo,
    tipo,
    ator_usuario_id
  )
  VALUES (
    v_company,
    v_triage.unit_id,
    v_triage.id,
    v_triage.cd_classificacao_id,
    p_classification_id,
    v_reason,
    'RECLASSIFICACAO',
    v_actor
  )
  RETURNING * INTO v_history;

  UPDATE public.triagens
     SET cd_classificacao_id = p_classification_id,
         updated_at = NOW()
   WHERE id = v_triage.id
   RETURNING * INTO v_triage;

  RETURN jsonb_build_object(
    'triage', to_jsonb(v_triage),
    'reclassification', to_jsonb(v_history)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.m19_reclassify_triage_secure(
  p_triage_id BIGINT,
  p_classification_id INTEGER,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
BEGIN
  RETURN private.m19_reclassify_triage(
    p_triage_id,
    p_classification_id,
    p_reason
  );
END;
$fn$;

REVOKE ALL ON FUNCTION private.m19_complete_triage(
  INTEGER, BIGINT, BIGINT, BIGINT, INTEGER, TEXT, JSONB, JSONB
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m19_reclassify_triage(
  BIGINT, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.m19_complete_triage(
  INTEGER, BIGINT, BIGINT, BIGINT, INTEGER, TEXT, JSONB, JSONB
) TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m19_reclassify_triage(
  BIGINT, INTEGER, TEXT
) TO prontomedic_rpc_owner;

REVOKE ALL ON FUNCTION public.m19_complete_triage_secure(
  INTEGER, BIGINT, BIGINT, BIGINT, INTEGER, TEXT, JSONB, JSONB
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m19_reclassify_triage_secure(
  BIGINT, INTEGER, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m19_complete_triage_secure(
  INTEGER, BIGINT, BIGINT, BIGINT, INTEGER, TEXT, JSONB, JSONB
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m19_reclassify_triage_secure(
  BIGINT, INTEGER, TEXT
) TO authenticated, app_prontomedic;

GRANT USAGE ON SCHEMA public, private, auth TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.audit_current_user_id()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.audit_current_company_id()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.audit_has_role(TEXT[])
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.current_user_id()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.current_company_id()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.is_module_admin()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.org_is_manager()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.transition_triage_queue(BIGINT, TEXT, TEXT)
  TO prontomedic_rpc_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.triagens,
  public.news2_avaliacoes,
  public.triagem_reclassificacoes
TO prontomedic_rpc_owner;
GRANT SELECT ON TABLE
  public.appointments,
  public.patients,
  public.triagem_fila,
  public.mnct_classificacao_risco,
  public.units,
  public.unit_access,
  public.user_profiles,
  public.permissions,
  public.user_permissions,
  public.roles,
  public.role_permissions
TO prontomedic_rpc_owner;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prontomedic_rpc_owner;

DO $ownership$
DECLARE
  v_function REGPROCEDURE;
BEGIN
  FOR v_function IN
    SELECT p.oid::REGPROCEDURE
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'private')
       AND p.proname LIKE 'm19_%'
       AND p.prosecdef
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s OWNER TO prontomedic_rpc_owner',
      v_function
    );
  END LOOP;
END
$ownership$;

COMMENT ON FUNCTION public.m19_complete_triage_secure(
  INTEGER, BIGINT, BIGINT, BIGINT, INTEGER, TEXT, JSONB, JSONB
) IS
  'Atomically records unit-scoped nursing triage, optional NEWS2 and Module 12 queue completion.';
COMMENT ON FUNCTION public.m19_reclassify_triage_secure(
  BIGINT, INTEGER, TEXT
) IS
  'Reclassifies a triage and appends an immutable clinical reason/actor history entry.';

DO $$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.prontomedic_deployment_migrations
        WHERE filename = '20260724014153_module19_nursing_triage_foundation.sql'
     ) THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE
      ON public.prontomedic_deployment_migrations
      FROM authenticated, app_prontomedic;
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260724014153_module19_nursing_triage_foundation.sql', NOW());
  END IF;
END
$$;

COMMIT;

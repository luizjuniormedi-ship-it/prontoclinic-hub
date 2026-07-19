-- Módulo 2: usuários, perfis e permissões.
-- Artefato local; não foi aplicado a nenhum banco remoto nesta rodada.
-- A migration é incremental para instalações que já possuem user_profiles.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS admission_date DATE,
  ADD COLUMN IF NOT EXISTS discharge_date DATE,
  ADD COLUMN IF NOT EXISTS access_valid_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sector_code TEXT,
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

CREATE TABLE IF NOT EXISTS public.roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id BIGSERIAL PRIMARY KEY,
  module VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  label VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(module, action)
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id BIGSERIAL PRIMARY KEY,
  role_id INTEGER NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  module VARCHAR(100) NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT FALSE,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  can_export BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role_id, module)
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE CASCADE,
  granted_by UUID,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE IF NOT EXISTS public.user_permissions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  effect VARCHAR(10) NOT NULL DEFAULT 'grant' CHECK (effect IN ('grant', 'deny')),
  unit_id INTEGER REFERENCES public.units(id) ON DELETE CASCADE,
  sector_code TEXT,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  UNIQUE(user_id, company_id, permission_id, unit_id, sector_code)
);

CREATE TABLE IF NOT EXISTS public.unit_access (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  granted_by UUID,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, unit_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE IF NOT EXISTS public.sector_access (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sector_code VARCHAR(80) NOT NULL,
  granted_by UUID,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, sector_code),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE IF NOT EXISTS public.delegations (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  delegator_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delegate_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module VARCHAR(100) NOT NULL,
  actions TEXT[] NOT NULL DEFAULT '{}',
  unit_id INTEGER REFERENCES public.units(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  approval_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'revoked')),
  approved_by UUID,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at),
  CHECK (delegator_user_id <> delegate_user_id)
);

CREATE TABLE IF NOT EXISTS public.access_expirations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  reason TEXT NOT NULL DEFAULT '',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.approval_policies (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  module VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  requires_dual_approval BOOLEAN NOT NULL DEFAULT FALSE,
  approver_roles TEXT[] NOT NULL DEFAULT '{}',
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, module, action)
);

CREATE INDEX IF NOT EXISTS idx_roles_company ON public.roles(company_id);
CREATE INDEX IF NOT EXISTS idx_permissions_module ON public.permissions(module);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON public.role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id, company_id, valid_until);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON public.user_permissions(user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_unit_access_user ON public.unit_access(user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_sector_access_user ON public.sector_access(user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_delegations_active ON public.delegations(company_id, delegate_user_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_access_expirations_user ON public.access_expirations(user_id, company_id, expires_at);

INSERT INTO public.roles (name, description, is_system)
VALUES
  ('admin', 'Administrador do sistema', TRUE),
  ('recepcao', 'Recepção e atendimento administrativo', TRUE),
  ('supervisor_recepcao', 'Supervisão da recepção', TRUE),
  ('callcenter', 'Operação de call center', TRUE),
  ('medico', 'Profissional médico', TRUE),
  ('medico_laudador', 'Médico laudador', TRUE),
  ('enfermagem', 'Enfermagem e triagem', TRUE),
  ('tecnico_enfermagem', 'Técnico de enfermagem', TRUE),
  ('financeiro', 'Financeiro e faturamento', TRUE),
  ('auditor', 'Auditoria', TRUE),
  ('gestor', 'Gestão operacional', TRUE),
  ('farmacia', 'Farmácia', TRUE),
  ('laboratorio', 'Laboratório', TRUE),
  ('diagnostico', 'Diagnóstico por imagem', TRUE),
  ('paciente', 'Portal do paciente', TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.permissions (module, action, label, description)
VALUES
  ('admin', 'view', 'Visualizar administração', 'Acessar telas administrativas'),
  ('admin', 'create_user', 'Cadastrar usuário', 'Convidar usuário para a empresa'),
  ('admin', 'edit_user', 'Editar usuário', 'Alterar dados administrativos do usuário'),
  ('admin', 'toggle_user', 'Ativar/inativar usuário', 'Bloquear ou liberar acesso'),
  ('admin', 'edit_permissions', 'Alterar permissões', 'Alterar perfis, exceções e acessos'),
  ('admin', 'approve', 'Aprovar alterações', 'Aprovar alterações administrativas críticas'),
  ('patients', 'view', 'Visualizar pacientes', 'Acessar cadastro administrativo do paciente'),
  ('patients', 'sensitive_data', 'Dados sensíveis', 'Visualizar informações clínicas sensíveis'),
  ('schedule', 'view', 'Visualizar agenda', 'Consultar agenda'),
  ('reception', 'checkin', 'Check-in', 'Realizar entrada do paciente'),
  ('reception', 'release_exception', 'Liberar exceção', 'Liberar pendência por exceção'),
  ('reception', 'cancel', 'Cancelar atendimento', 'Cancelar operações de recepção'),
  ('records', 'view', 'Visualizar prontuário', 'Consultar prontuário'),
  ('records', 'edit', 'Editar prontuário', 'Alterar conteúdo clínico'),
  ('records', 'sign', 'Assinar prontuário', 'Assinar documentos clínicos'),
  ('records', 'print', 'Imprimir prontuário', 'Imprimir documentos permitidos'),
  ('records', 'share', 'Compartilhar prontuário', 'Compartilhar documentos autorizados'),
  ('billing', 'view', 'Visualizar faturamento', 'Consultar produção e faturamento'),
  ('billing', 'change_values', 'Alterar valores', 'Alterar valores financeiros'),
  ('billing', 'approve', 'Aprovar faturamento', 'Aprovar lotes e exceções financeiras'),
  ('audit', 'view', 'Acessar auditoria', 'Consultar trilhas de auditoria'),
  ('audit', 'export', 'Exportar auditoria', 'Exportar trilhas de auditoria'),
  ('configuration', 'change_rules', 'Alterar regras', 'Alterar regras institucionais')
ON CONFLICT (module, action) DO NOTHING;

-- Matriz compatível com a tela atual: uma linha por perfil e módulo.
INSERT INTO public.role_permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_export)
SELECT r.id, m.module,
  r.name = 'admin'
  OR (r.name IN ('gestor') AND m.module IN ('dashboard','patients','schedule','reception','billing','financial','audit'))
  OR (r.name IN ('recepcao','supervisor_recepcao') AND m.module IN ('dashboard','patients','schedule','reception','callcenter'))
  OR (r.name = 'callcenter' AND m.module IN ('dashboard','patients','schedule','callcenter'))
  OR (r.name IN ('medico','medico_laudador') AND m.module IN ('dashboard','patients','schedule','records','encounters','attendance','dicom'))
  OR (r.name IN ('enfermagem','tecnico_enfermagem') AND m.module IN ('dashboard','patients','reception','nursing'))
  OR (r.name IN ('financeiro','auditor') AND m.module IN ('dashboard','billing','financial')),
  r.name = 'admin'
  OR (r.name IN ('recepcao','supervisor_recepcao','callcenter') AND m.module IN ('patients','schedule','reception','callcenter')),
  r.name = 'admin' OR r.name IN ('gestor','supervisor_recepcao'),
  r.name = 'admin',
  r.name IN ('admin','gestor','auditor','financeiro')
FROM public.roles r
CROSS JOIN (VALUES ('dashboard'),('patients'),('schedule'),('callcenter'),('reception'),('records'),('attendance'),('encounters'),('nursing'),('billing'),('financial'),('dicom'),('audit'),('admin')) AS modules(module)
ON CONFLICT (role_id, module) DO NOTHING;

CREATE OR REPLACE FUNCTION private.is_module_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE (up.id = auth.uid() OR up.user_id = auth.uid())
      AND lower(COALESCE(up.role_name, '')) IN ('admin', 'administrador')
      AND up.lg_ativo = TRUE
      AND (up.access_valid_until IS NULL OR up.access_valid_until > NOW())
      AND up.blocked_at IS NULL
  )
$$;

REVOKE ALL ON FUNCTION private.is_module_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_module_admin() TO authenticated;

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sector_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_expirations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.roles, public.permissions, public.role_permissions, public.user_roles,
  public.user_permissions, public.unit_access, public.sector_access,
  public.delegations, public.access_expirations, public.approval_policies
FROM PUBLIC, anon;
GRANT SELECT ON public.roles, public.permissions, public.role_permissions, public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permissions, public.unit_access,
  public.sector_access, public.delegations, public.access_expirations,
  public.approval_policies TO authenticated;

DROP POLICY IF EXISTS module_roles_select ON public.roles;
CREATE POLICY module_roles_select ON public.roles FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id = public.get_my_company_id());
DROP POLICY IF EXISTS module_roles_admin ON public.roles;
CREATE POLICY module_roles_admin ON public.roles FOR ALL TO authenticated
  USING (private.is_module_admin() AND (company_id IS NULL OR company_id = public.get_my_company_id()))
  WITH CHECK (private.is_module_admin() AND (company_id IS NULL OR company_id = public.get_my_company_id()));

DROP POLICY IF EXISTS module_permissions_select ON public.permissions;
CREATE POLICY module_permissions_select ON public.permissions FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS module_role_permissions_select ON public.role_permissions;
CREATE POLICY module_role_permissions_select ON public.role_permissions FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS module_role_permissions_admin ON public.role_permissions;
CREATE POLICY module_role_permissions_admin ON public.role_permissions FOR ALL TO authenticated
  USING (private.is_module_admin()) WITH CHECK (private.is_module_admin());

DROP POLICY IF EXISTS module_user_roles_access ON public.user_roles;
CREATE POLICY module_user_roles_access ON public.user_roles FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND (user_id = auth.uid() OR private.is_module_admin()));
DROP POLICY IF EXISTS module_user_roles_admin ON public.user_roles;
CREATE POLICY module_user_roles_admin ON public.user_roles FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND private.is_module_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND private.is_module_admin());

DROP POLICY IF EXISTS module_user_permissions_access ON public.user_permissions;
CREATE POLICY module_user_permissions_access ON public.user_permissions FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND (user_id = auth.uid() OR private.is_module_admin()));
DROP POLICY IF EXISTS module_user_permissions_admin ON public.user_permissions;
CREATE POLICY module_user_permissions_admin ON public.user_permissions FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND private.is_module_admin());
CREATE POLICY module_user_permissions_admin_update ON public.user_permissions FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND private.is_module_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND private.is_module_admin());
CREATE POLICY module_user_permissions_admin_delete ON public.user_permissions FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND private.is_module_admin());

DROP POLICY IF EXISTS module_unit_access_access ON public.unit_access;
CREATE POLICY module_unit_access_access ON public.unit_access FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND (user_id = auth.uid() OR private.is_module_admin()));
CREATE POLICY module_unit_access_admin ON public.unit_access FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND private.is_module_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND private.is_module_admin());

DROP POLICY IF EXISTS module_sector_access_access ON public.sector_access;
CREATE POLICY module_sector_access_access ON public.sector_access FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND (user_id = auth.uid() OR private.is_module_admin()));
CREATE POLICY module_sector_access_admin ON public.sector_access FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND private.is_module_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND private.is_module_admin());

DROP POLICY IF EXISTS module_delegations_access ON public.delegations;
CREATE POLICY module_delegations_access ON public.delegations FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND (delegator_user_id = auth.uid() OR delegate_user_id = auth.uid() OR private.is_module_admin()));
CREATE POLICY module_delegations_admin ON public.delegations FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND private.is_module_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND private.is_module_admin());

DROP POLICY IF EXISTS module_expirations_access ON public.access_expirations;
CREATE POLICY module_expirations_access ON public.access_expirations FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND (user_id = auth.uid() OR private.is_module_admin()));
CREATE POLICY module_expirations_admin ON public.access_expirations FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND private.is_module_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND private.is_module_admin());

DROP POLICY IF EXISTS module_approval_select ON public.approval_policies;
CREATE POLICY module_approval_select ON public.approval_policies FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());
CREATE POLICY module_approval_admin ON public.approval_policies FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND private.is_module_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND private.is_module_admin());

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT sequence_schema, sequence_name FROM information_schema.sequences
    WHERE sequence_schema = 'public' AND sequence_name IN (
      'roles_id_seq','permissions_id_seq','role_permissions_id_seq','user_permissions_id_seq',
      'user_roles_id_seq','unit_access_id_seq','sector_access_id_seq','delegations_id_seq','access_expirations_id_seq','approval_policies_id_seq'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %I.%I FROM PUBLIC, anon', r.sequence_schema, r.sequence_name);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I.%I TO authenticated', r.sequence_schema, r.sequence_name);
  END LOOP;
END $$;

COMMIT;

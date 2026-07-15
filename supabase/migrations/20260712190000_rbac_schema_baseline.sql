-- Canonical RBAC schema. Direct browser mutations remain disabled until secure RPCs exist.

CREATE TABLE IF NOT EXISTS public.roles (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id BIGSERIAL PRIMARY KEY,
  role_id BIGINT NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT FALSE,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  can_export BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT role_permissions_role_module_uq UNIQUE (role_id, module)
);

INSERT INTO public.roles (name, description)
VALUES
  ('admin', 'Administrador do sistema'),
  ('gestor', 'Gestor da unidade'),
  ('medico', 'Profissional medico'),
  ('enfermagem', 'Equipe de enfermagem'),
  ('recepcao', 'Recepcao e atendimento'),
  ('financeiro', 'Equipe financeira'),
  ('farmacia', 'Equipe de farmacia')
ON CONFLICT (name) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_profiles_role_id_fkey'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_role_id_fkey
      FOREIGN KEY (role_id) REFERENCES public.roles(id);
  END IF;
END $$;

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roles_select_authenticated ON public.roles;
CREATE POLICY roles_select_authenticated
  ON public.roles FOR SELECT TO authenticated
  USING (lg_ativo = TRUE);

DROP POLICY IF EXISTS role_permissions_select_authenticated ON public.role_permissions;
CREATE POLICY role_permissions_select_authenticated
  ON public.role_permissions FOR SELECT TO authenticated
  USING (TRUE);

REVOKE ALL ON public.roles FROM anon, authenticated;
REVOKE ALL ON public.role_permissions FROM anon, authenticated;
GRANT SELECT ON public.roles TO authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.roles FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.role_permissions FROM anon, authenticated;

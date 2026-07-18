-- Provisionamento administrativo transacional do perfil funcional e vínculos.
-- As operações de Auth continuam na Edge Function; toda a escrita relacional
-- desta migration ocorre em uma única transação PostgreSQL.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.clear_required_password_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
BEGIN
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    UPDATE public.user_profiles
    SET must_change_password = FALSE,
        updated_at = NOW()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_user_password_changed ON auth.users;
CREATE TRIGGER trg_auth_user_password_changed
AFTER UPDATE OF encrypted_password ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.clear_required_password_change();
REVOKE ALL ON FUNCTION public.clear_required_password_change() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_context_is_company_admin(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.user_access_context ctx
    JOIN public.memberships m
      ON m.id = ctx.membership_id
     AND m.user_id = ctx.user_id
     AND m.company_id = p_company_id
     AND m.status = 'active'
    JOIN public.membership_roles mr
      ON mr.membership_id = m.id
     AND mr.role_id = ctx.role_id
    JOIN public.roles r
      ON r.id = ctx.role_id
     AND r.lg_ativo = TRUE
     AND lower(r.name) IN ('admin', 'administrador', 'superadmin', 'super_admin')
    JOIN public.companies c
      ON c.id = m.company_id
     AND c.lg_ativo = TRUE
    JOIN public.user_profiles up
      ON up.id = ctx.user_id
     AND up.lg_ativo = TRUE
    WHERE ctx.user_id = auth.uid()
      AND ctx.session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
      AND public.request_aal() = 'aal2'
      AND public.current_application_session_is_active()
  ), FALSE);
$$;
REVOKE ALL ON FUNCTION public.current_context_is_company_admin(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_context_is_company_admin(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_role_permission(
  p_role_id INTEGER,
  p_module TEXT,
  p_can_view BOOLEAN,
  p_can_create BOOLEAN,
  p_can_edit BOOLEAN,
  p_can_delete BOOLEAN,
  p_can_export BOOLEAN
)
RETURNS public.role_permissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_module TEXT := lower(btrim(p_module));
  v_permission public.role_permissions%ROWTYPE;
BEGIN
  IF v_company_id IS NULL
     OR NOT public.current_context_is_company_admin(v_company_id) THEN
    RAISE EXCEPTION 'Alteração de permissões exige contexto administrativo AAL2'
      USING ERRCODE = '42501';
  END IF;
  IF p_role_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.roles WHERE id = p_role_id AND lg_ativo = TRUE) THEN
    RAISE EXCEPTION 'Papel inexistente ou inativo' USING ERRCODE = '23514';
  END IF;
  IF v_module = '' OR length(v_module) > 100 OR v_module !~ '^[a-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Módulo inválido' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.role_permissions (
    company_id, role_id, module,
    can_view, can_create, can_edit, can_delete, can_export, updated_at
  ) VALUES (
    v_company_id, p_role_id, v_module,
    p_can_view, p_can_create, p_can_edit, p_can_delete, p_can_export, NOW()
  )
  ON CONFLICT (company_id, role_id, module) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete,
      can_export = EXCLUDED.can_export,
      updated_at = NOW()
  RETURNING * INTO v_permission;

  RETURN v_permission;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_role_permission(INTEGER, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_role_permission(INTEGER, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN)
  TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.role_permissions FROM authenticated;

CREATE OR REPLACE FUNCTION public.provision_user_access(
  p_user_id UUID,
  p_email TEXT,
  p_full_name TEXT,
  p_company_id UUID,
  p_role_id INTEGER,
  p_primary_unit_id INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_membership_id UUID;
  v_role_name TEXT;
  v_email TEXT := lower(btrim(p_email));
  v_full_name TEXT := btrim(p_full_name);
BEGIN
  IF COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  ) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Provisionamento restrito ao service_role'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR v_email = '' OR position('@' IN v_email) < 2 OR v_full_name = '' THEN
    RAISE EXCEPTION 'Dados de usuário inválidos' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Usuário Auth não encontrado' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id = p_company_id AND lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Empresa inexistente ou inativa' USING ERRCODE = '23514';
  END IF;

  SELECT name INTO v_role_name
  FROM public.roles
  WHERE id = p_role_id AND lg_ativo = TRUE
  FOR SHARE;
  IF v_role_name IS NULL THEN
    RAISE EXCEPTION 'Papel inexistente ou inativo' USING ERRCODE = '23514';
  END IF;

  IF p_primary_unit_id IS NULL THEN
    IF lower(v_role_name) NOT IN ('admin', 'administrador', 'gestor', 'superadmin', 'super_admin') THEN
      RAISE EXCEPTION 'Unidade principal obrigatória para papel operacional'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.units
    WHERE id = p_primary_unit_id
      AND company_id = p_company_id
      AND lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Unidade não pertence à empresa ou está inativa'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = p_user_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Vínculo funcional já existe nesta empresa' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = p_user_id AND lower(email) = v_email
    ) THEN
      RAISE EXCEPTION 'E-mail não corresponde ao perfil funcional existente'
        USING ERRCODE = '23514';
    END IF;
    UPDATE public.user_profiles
    SET lg_ativo = TRUE,
        updated_at = NOW()
    WHERE id = p_user_id;
  ELSE
    INSERT INTO public.user_profiles (
      id, user_id, email, full_name, company_id, role_id, role_name,
      primary_unit_id, lg_ativo, must_change_password
    ) VALUES (
      p_user_id, p_user_id, v_email, v_full_name, p_company_id, p_role_id,
      v_role_name, p_primary_unit_id, TRUE, TRUE
    );
  END IF;

  INSERT INTO public.memberships (user_id, company_id, status)
  VALUES (p_user_id, p_company_id, 'active')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_roles (membership_id, role_id)
  VALUES (v_membership_id, p_role_id);

  IF p_primary_unit_id IS NOT NULL THEN
    INSERT INTO public.membership_units (membership_id, unit_id)
    VALUES (v_membership_id, p_primary_unit_id);
  END IF;

  RETURN v_membership_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_access_active(
  p_user_id UUID,
  p_company_id UUID,
  p_active BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_membership_id UUID;
BEGIN
  IF COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  ) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Alteração administrativa restrita ao service_role'
      USING ERRCODE = '42501';
  END IF;
  IF p_active IS NULL THEN
    RAISE EXCEPTION 'Estado ativo é obrigatório' USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.user_profiles
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT id INTO v_membership_id
  FROM public.memberships
  WHERE user_id = p_user_id
    AND company_id = p_company_id
  FOR UPDATE;
  IF v_membership_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.memberships WHERE user_id = p_user_id) THEN
      RETURN FALSE;
    END IF;
    RAISE EXCEPTION 'Perfil funcional sem vínculo correspondente'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.memberships
  SET status = CASE WHEN p_active THEN 'active' ELSE 'suspended' END,
      updated_at = NOW()
  WHERE id = v_membership_id;

  IF NOT p_active THEN
    DELETE FROM public.user_access_context
    WHERE user_id = p_user_id
      AND membership_id IN (
        SELECT id FROM public.memberships
        WHERE user_id = p_user_id AND company_id = p_company_id
      );
  END IF;

  UPDATE public.user_profiles
  SET lg_ativo = EXISTS (
        SELECT 1
        FROM public.memberships
        WHERE user_id = p_user_id AND status = 'active'
      ),
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_user_access(UUID, TEXT, TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_user_access(UUID, TEXT, TEXT, UUID, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.provision_user_access(UUID, TEXT, TEXT, UUID, INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.set_user_access_active(UUID, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_user_access_active(UUID, UUID, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_access_active(UUID, UUID, BOOLEAN) TO service_role;

COMMENT ON FUNCTION public.provision_user_access(UUID, TEXT, TEXT, UUID, INTEGER, INTEGER) IS
  'Cria perfil, vínculo, papel e unidade atomicamente. Uso exclusivo do service_role pela Edge Function auth-admin.';
COMMENT ON FUNCTION public.set_user_access_active(UUID, UUID, BOOLEAN) IS
  'Ativa/inativa perfil e vínculos em uma transação; inativação remove contextos ativos. Uso exclusivo do service_role.';

-- Alterações de autorização/status não podem contornar a Edge Function.
-- O frontend autenticado mantém somente os campos cadastrais não privilegiados.
REVOKE INSERT, UPDATE ON public.user_profiles FROM authenticated;
GRANT UPDATE (full_name, phone, cpf) ON public.user_profiles TO authenticated;

-- O perfil próprio continua disponível durante o bootstrap de autenticação.
-- A leitura/edição de outros usuários, porém, exige o contexto administrativo
-- AAL2 e a sessão da aplicação validados por current_context_is_company_admin.
DROP POLICY IF EXISTS user_profiles_select_authorized ON public.user_profiles;
CREATE POLICY user_profiles_select_authorized
ON public.user_profiles
FOR SELECT TO authenticated
USING (
  (id = auth.uid() AND lg_ativo = TRUE)
  OR EXISTS (
    SELECT 1
    FROM public.memberships target_membership
    WHERE target_membership.user_id = user_profiles.id
      AND target_membership.company_id = public.active_company_id()
      AND public.current_context_is_company_admin(target_membership.company_id)
  )
);

DROP POLICY IF EXISTS user_profiles_update_company_admin ON public.user_profiles;
CREATE POLICY user_profiles_update_company_admin
ON public.user_profiles
FOR UPDATE TO authenticated
USING (
  (id = auth.uid() AND lg_ativo = TRUE)
  OR EXISTS (
    SELECT 1
    FROM public.memberships target_membership
    WHERE target_membership.user_id = user_profiles.id
      AND target_membership.company_id = public.active_company_id()
      AND public.current_context_is_company_admin(target_membership.company_id)
  )
)
WITH CHECK (
  (id = auth.uid() AND lg_ativo = TRUE)
  OR EXISTS (
    SELECT 1
    FROM public.memberships target_membership
    WHERE target_membership.user_id = user_profiles.id
      AND target_membership.company_id = public.active_company_id()
      AND public.current_context_is_company_admin(target_membership.company_id)
  )
);

-- Transição administrativa com estado anterior e compensação CAS.
-- Mantém set_user_access_active por compatibilidade; a Edge Function usa estas RPCs.

-- Ativação é bifásica: pending_activation jamais é aceito pelos helpers/RLS que
-- exigem status = 'active'. Isso elimina a janela entre PostgreSQL e GoTrue.
ALTER TABLE public.memberships
  DROP CONSTRAINT IF EXISTS memberships_status_check;
ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_status_check
  CHECK (status IN ('active', 'suspended', 'revoked', 'pending_activation')) NOT VALID;
ALTER TABLE public.memberships
  VALIDATE CONSTRAINT memberships_status_check;

CREATE OR REPLACE FUNCTION public.prepare_user_access_active(
  p_user_id UUID,
  p_company_id UUID,
  p_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_requested_status TEXT := CASE WHEN p_active THEN 'active' ELSE 'suspended' END;
  v_staged_status TEXT;
  v_previous_status TEXT;
  v_changed BOOLEAN;
  v_active_memberships INTEGER;
  v_auth_active_memberships INTEGER;
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

  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;

  PERFORM id
  FROM public.memberships
  WHERE user_id = p_user_id
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_membership
  FROM public.memberships
  WHERE user_id = p_user_id AND company_id = p_company_id;
  IF v_membership.id IS NULL THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  IF v_membership.status = 'revoked' THEN
    RAISE EXCEPTION 'Vínculo revogado não admite alteração de atividade'
      USING ERRCODE = '23514';
  END IF;

  v_previous_status := v_membership.status;
  v_changed := v_membership.status IS DISTINCT FROM v_requested_status;
  v_staged_status := CASE
    WHEN p_active AND v_changed THEN 'pending_activation'
    ELSE v_requested_status
  END;
  IF v_changed THEN
    UPDATE public.memberships
    SET status = v_staged_status, updated_at = clock_timestamp()
    WHERE id = v_membership.id
    RETURNING * INTO v_membership;
  END IF;

  SELECT count(*)::INTEGER INTO v_active_memberships
  FROM public.memberships
  WHERE user_id = p_user_id AND status = 'active';

  v_auth_active_memberships := v_active_memberships
    + CASE WHEN p_active AND v_changed THEN 1 ELSE 0 END;

  UPDATE public.user_profiles
  SET lg_ativo = v_active_memberships > 0,
      updated_at = clock_timestamp()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'found', TRUE,
    'changed', v_changed,
    'membership_id', v_membership.id,
    'previous_status', v_previous_status,
    'requested_status', v_staged_status,
    'final_status', v_requested_status,
    'expected_updated_at', v_membership.updated_at,
    'active_memberships', v_auth_active_memberships
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_user_access_active(
  p_user_id UUID,
  p_membership_id UUID,
  p_requested_status TEXT,
  p_previous_status TEXT,
  p_expected_updated_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
BEGIN
  IF COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  ) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Compensação administrativa restrita ao service_role'
      USING ERRCODE = '42501';
  END IF;
  IF p_requested_status NOT IN ('active', 'suspended', 'pending_activation')
     OR p_previous_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Status de compensação inválido' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  PERFORM id
  FROM public.memberships
  WHERE user_id = p_user_id
  ORDER BY id
  FOR UPDATE;

  UPDATE public.memberships
  SET status = p_previous_status, updated_at = clock_timestamp()
  WHERE id = p_membership_id
    AND user_id = p_user_id
    AND status = p_requested_status
    AND updated_at = p_expected_updated_at;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.user_profiles
  SET lg_ativo = EXISTS (
        SELECT 1 FROM public.memberships
        WHERE user_id = p_user_id AND status = 'active'
      ),
      updated_at = clock_timestamp()
  WHERE id = p_user_id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_user_access_active(
  p_user_id UUID,
  p_membership_id UUID,
  p_requested_status TEXT,
  p_expected_updated_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_final_status TEXT;
BEGIN
  IF COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  ) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Finalização administrativa restrita ao service_role'
      USING ERRCODE = '42501';
  END IF;
  IF p_requested_status NOT IN ('active', 'suspended', 'pending_activation') THEN
    RAISE EXCEPTION 'Status de finalização inválido' USING ERRCODE = '23514';
  END IF;
  v_final_status := CASE
    WHEN p_requested_status = 'pending_activation' THEN 'active'
    ELSE p_requested_status
  END;

  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  PERFORM id
  FROM public.memberships
  WHERE user_id = p_user_id
  ORDER BY id
  FOR UPDATE;

  UPDATE public.memberships
  SET status = v_final_status,
      updated_at = CASE
        WHEN status IS DISTINCT FROM v_final_status THEN clock_timestamp()
        ELSE updated_at
      END
  WHERE id = p_membership_id
    AND user_id = p_user_id
    AND status = p_requested_status
    AND updated_at = p_expected_updated_at;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_final_status = 'suspended' THEN
    DELETE FROM public.user_access_context
    WHERE user_id = p_user_id AND membership_id = p_membership_id;
  END IF;

  UPDATE public.user_profiles
  SET lg_ativo = EXISTS (
        SELECT 1 FROM public.memberships
        WHERE user_id = p_user_id AND status = 'active'
      ),
      updated_at = clock_timestamp()
  WHERE id = p_user_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_user_access_active(UUID, UUID, BOOLEAN) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.restore_user_access_active(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.finalize_user_access_active(UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_user_access_active(UUID, UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_user_access_active(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_user_access_active(UUID, UUID, TEXT, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.list_company_users_admin()
RETURNS TABLE(
  id UUID,
  email TEXT,
  full_name TEXT,
  role_id INTEGER,
  role_name TEXT,
  company_id UUID,
  primary_unit_id INTEGER,
  phone TEXT,
  cpf TEXT,
  lg_ativo BOOLEAN,
  membership_status TEXT,
  role_names TEXT[],
  unit_ids INTEGER[],
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_company_id UUID := public.active_company_id();
BEGIN
  IF v_company_id IS NULL
     OR NOT public.current_context_is_company_admin(v_company_id) THEN
    RAISE EXCEPTION 'Contexto administrativo AAL2 e sessão ativa obrigatórios'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    up.id,
    up.email::TEXT,
    up.full_name::TEXT,
    min(r.id)::INTEGER,
    min(r.name)::TEXT,
    m.company_id,
    min(mu.unit_id)::INTEGER,
    up.phone::TEXT,
    up.cpf::TEXT,
    (m.status = 'active'),
    m.status::TEXT,
    COALESCE(array_agg(DISTINCT r.name::TEXT) FILTER (WHERE r.id IS NOT NULL), ARRAY[]::TEXT[]),
    COALESCE(array_agg(DISTINCT mu.unit_id) FILTER (WHERE mu.unit_id IS NOT NULL), ARRAY[]::INTEGER[]),
    up.created_at,
    up.updated_at
  FROM public.memberships m
  JOIN public.user_profiles up ON up.id = m.user_id
  LEFT JOIN public.membership_roles mr ON mr.membership_id = m.id
  LEFT JOIN public.roles r ON r.id = mr.role_id
  LEFT JOIN public.membership_units mu ON mu.membership_id = m.id
  WHERE m.company_id = v_company_id
  GROUP BY up.id, up.email, up.full_name, m.company_id, up.phone, up.cpf,
           m.status, up.created_at, up.updated_at
  ORDER BY up.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.list_company_users_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_company_users_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_context_can_access_profile(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
  SELECT EXISTS (
      SELECT 1
      FROM public.memberships target_membership
      WHERE target_membership.user_id = p_user_id
        AND target_membership.company_id = public.active_company_id()
        AND public.current_context_is_company_admin(target_membership.company_id)
    );
$$;

REVOKE ALL ON FUNCTION public.current_context_can_access_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_context_can_access_profile(UUID) TO authenticated;

DROP POLICY IF EXISTS user_profiles_select_authorized ON public.user_profiles;
CREATE POLICY user_profiles_select_authorized
ON public.user_profiles FOR SELECT TO authenticated
USING (
  (id = auth.uid() AND lg_ativo = TRUE)
  OR public.current_context_can_access_profile(id)
);

DROP POLICY IF EXISTS user_profiles_update_company_admin ON public.user_profiles;
CREATE POLICY user_profiles_update_company_admin
ON public.user_profiles FOR UPDATE TO authenticated
USING (
  (id = auth.uid() AND lg_ativo = TRUE)
  OR public.current_context_can_access_profile(id)
)
WITH CHECK (
  (id = auth.uid() AND lg_ativo = TRUE)
  OR public.current_context_can_access_profile(id)
);

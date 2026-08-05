-- Fecha invariantes da transição administrativa bifásica sem criar outro fluxo.

BEGIN;

DROP FUNCTION IF EXISTS public.prepare_user_access_active(UUID, UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.prepare_user_access_active(
  p_actor_user_id UUID,
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
  v_target_is_admin BOOLEAN;
BEGIN
  IF COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  ) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Alteração administrativa restrita ao service_role'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL OR p_user_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION 'Executor, usuário e empresa são obrigatórios'
      USING ERRCODE = '23502';
  END IF;
  IF p_active IS NULL THEN
    RAISE EXCEPTION 'Estado ativo é obrigatório' USING ERRCODE = '23514';
  END IF;

  -- Serializa todas as suspensões administrativas do mesmo tenant.
  PERFORM 1
  FROM public.companies
  WHERE id = p_company_id AND lg_ativo = TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empresa ativa não encontrada' USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships actor_membership
    JOIN public.membership_roles actor_membership_role
      ON actor_membership_role.membership_id = actor_membership.id
    JOIN public.roles actor_role
      ON actor_role.id = actor_membership_role.role_id
     AND actor_role.lg_ativo = TRUE
     AND lower(actor_role.name) IN ('admin', 'administrador', 'superadmin', 'super_admin')
    WHERE actor_membership.user_id = p_actor_user_id
      AND actor_membership.company_id = p_company_id
      AND actor_membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Executor não possui administração ativa nesta empresa'
      USING ERRCODE = '42501';
  END IF;
  IF NOT p_active AND p_actor_user_id = p_user_id THEN
    RAISE EXCEPTION 'Não é permitido suspender o próprio acesso'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  PERFORM id FROM public.memberships
  WHERE user_id = p_user_id ORDER BY id FOR UPDATE;

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

  SELECT EXISTS (
    SELECT 1
    FROM public.membership_roles target_membership_role
    JOIN public.roles target_role
      ON target_role.id = target_membership_role.role_id
     AND target_role.lg_ativo = TRUE
     AND lower(target_role.name) IN ('admin', 'administrador', 'superadmin', 'super_admin')
    WHERE target_membership_role.membership_id = v_membership.id
  ) INTO v_target_is_admin;

  IF NOT p_active AND v_membership.status = 'active' AND v_target_is_admin THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.memberships replacement
      JOIN public.membership_roles replacement_membership_role
        ON replacement_membership_role.membership_id = replacement.id
      JOIN public.roles replacement_role
        ON replacement_role.id = replacement_membership_role.role_id
       AND replacement_role.lg_ativo = TRUE
       AND lower(replacement_role.name) IN ('admin', 'administrador', 'superadmin', 'super_admin')
      WHERE replacement.company_id = p_company_id
        AND replacement.user_id <> p_user_id
        AND replacement.status = 'active'
    ) THEN
      RAISE EXCEPTION 'A empresa deve manter ao menos um administrador ativo'
        USING ERRCODE = '23514';
    END IF;

    -- Cada unidade coberta pelo alvo precisa continuar coberta por outro admin.
    IF EXISTS (
      SELECT 1
      FROM public.membership_units target_unit
      WHERE target_unit.membership_id = v_membership.id
        AND NOT EXISTS (
          SELECT 1
          FROM public.memberships replacement
          JOIN public.membership_roles replacement_membership_role
            ON replacement_membership_role.membership_id = replacement.id
          JOIN public.roles replacement_role
            ON replacement_role.id = replacement_membership_role.role_id
           AND replacement_role.lg_ativo = TRUE
           AND lower(replacement_role.name) IN ('admin', 'administrador', 'superadmin', 'super_admin')
          WHERE replacement.company_id = p_company_id
            AND replacement.user_id <> p_user_id
            AND replacement.status = 'active'
            AND (
              NOT EXISTS (
                SELECT 1 FROM public.membership_units corporate_scope
                WHERE corporate_scope.membership_id = replacement.id
              )
              OR EXISTS (
                SELECT 1 FROM public.membership_units replacement_unit
                WHERE replacement_unit.membership_id = replacement.id
                  AND replacement_unit.unit_id = target_unit.unit_id
              )
            )
        )
    ) THEN
      RAISE EXCEPTION 'A suspensão deixaria unidade sem administrador ativo'
        USING ERRCODE = '23514';
    END IF;

    -- Admin sem membership_units é corporativo e cobre todas as unidades ativas.
    IF NOT EXISTS (
      SELECT 1 FROM public.membership_units target_scope
      WHERE target_scope.membership_id = v_membership.id
    ) AND EXISTS (
      SELECT 1
      FROM public.units company_unit
      WHERE company_unit.company_id = p_company_id
        AND company_unit.lg_ativo = TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM public.memberships replacement
          JOIN public.membership_roles replacement_membership_role
            ON replacement_membership_role.membership_id = replacement.id
          JOIN public.roles replacement_role
            ON replacement_role.id = replacement_membership_role.role_id
           AND replacement_role.lg_ativo = TRUE
           AND lower(replacement_role.name) IN ('admin', 'administrador', 'superadmin', 'super_admin')
          WHERE replacement.company_id = p_company_id
            AND replacement.user_id <> p_user_id
            AND replacement.status = 'active'
            AND (
              NOT EXISTS (
                SELECT 1 FROM public.membership_units corporate_scope
                WHERE corporate_scope.membership_id = replacement.id
              )
              OR EXISTS (
                SELECT 1 FROM public.membership_units replacement_unit
                WHERE replacement_unit.membership_id = replacement.id
                  AND replacement_unit.unit_id = company_unit.id
              )
            )
        )
    ) THEN
      RAISE EXCEPTION 'A suspensão deixaria unidade ativa sem cobertura administrativa'
        USING ERRCODE = '23514';
    END IF;
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

CREATE OR REPLACE FUNCTION public.admin_record_auth_operation(
  p_actor_user_id UUID,
  p_target_user_id UUID,
  p_company_id UUID,
  p_action TEXT,
  p_session_scope TEXT,
  p_request_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_actor_name TEXT;
  v_actor_role TEXT;
  v_action TEXT := lower(btrim(p_action));
  v_scope TEXT := lower(btrim(p_session_scope));
  v_request_id TEXT := left(btrim(p_request_id), 64);
BEGIN
  IF COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  ) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Auditoria administrativa restrita ao service_role'
      USING ERRCODE = '42501';
  END IF;
  IF v_action NOT IN (
    'invite_user', 'send_recovery', 'activate_user', 'suspend_user', 'logout_global'
  ) OR v_scope NOT IN ('none', 'company', 'global') OR v_request_id = '' THEN
    RAISE EXCEPTION 'Contrato de auditoria administrativa inválido'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships actor_membership
    JOIN public.membership_roles actor_membership_role
      ON actor_membership_role.membership_id = actor_membership.id
    JOIN public.roles actor_role
      ON actor_role.id = actor_membership_role.role_id
     AND actor_role.lg_ativo = TRUE
     AND lower(actor_role.name) IN ('admin', 'administrador', 'superadmin', 'super_admin')
    WHERE actor_membership.user_id = p_actor_user_id
      AND actor_membership.company_id = p_company_id
      AND actor_membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Executor não possui administração ativa nesta empresa'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = p_target_user_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Usuário-alvo não pertence à empresa'
      USING ERRCODE = '23503';
  END IF;

  IF v_scope = 'global' THEN
    UPDATE public.application_sessions
    SET revoked_at = COALESCE(revoked_at, clock_timestamp()),
        revoked_by = COALESCE(revoked_by, p_actor_user_id),
        revocation_reason = COALESCE(revocation_reason, 'admin_logout_global')
    WHERE user_id = p_target_user_id AND revoked_at IS NULL;
    DELETE FROM public.user_access_context WHERE user_id = p_target_user_id;
  ELSIF v_scope = 'company' THEN
    UPDATE public.application_sessions
    SET revoked_at = COALESCE(revoked_at, clock_timestamp()),
        revoked_by = COALESCE(revoked_by, p_actor_user_id),
        revocation_reason = COALESCE(revocation_reason, 'admin_company_suspension')
    WHERE user_id = p_target_user_id
      AND company_id = p_company_id
      AND revoked_at IS NULL;
    DELETE FROM public.user_access_context context
    USING public.memberships membership
    WHERE context.membership_id = membership.id
      AND context.user_id = p_target_user_id
      AND membership.company_id = p_company_id;
  END IF;

  SELECT up.full_name, admin_role.name
  INTO v_actor_name, v_actor_role
  FROM public.user_profiles up
  JOIN public.memberships actor_membership
    ON actor_membership.user_id = up.id
   AND actor_membership.company_id = p_company_id
  JOIN public.membership_roles actor_membership_role
    ON actor_membership_role.membership_id = actor_membership.id
  JOIN public.roles admin_role
    ON admin_role.id = actor_membership_role.role_id
   AND lower(admin_role.name) IN ('admin', 'administrador', 'superadmin', 'super_admin')
  WHERE up.id = p_actor_user_id
  ORDER BY admin_role.id
  LIMIT 1;

  INSERT INTO public.audit_logs (
    company_id, cd_usuario, cd_usuario_nome, role_name,
    acao, tabela, registro_id, operacao, dados_novos, request_id
  ) VALUES (
    p_company_id, p_actor_user_id, v_actor_name, v_actor_role,
    upper(v_action), 'auth_admin', p_target_user_id::TEXT,
    'Operação administrativa de autenticação',
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'action', v_action,
      'session_scope', v_scope
    ),
    v_request_id
  );
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_user_access_active(UUID, UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_user_access_active(UUID, UUID, UUID, BOOLEAN)
  TO service_role;
REVOKE ALL ON FUNCTION public.admin_record_auth_operation(UUID, UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_auth_operation(UUID, UUID, UUID, TEXT, TEXT, TEXT)
  TO service_role;

-- O fluxo legado não identifica executor nem compensa o provedor de Auth.
REVOKE ALL ON FUNCTION public.set_user_access_active(UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.prepare_user_access_active(UUID, UUID, UUID, BOOLEAN) IS
  'Prepara transição administrativa bifásica com executor explícito, serialização por empresa e preservação de cobertura administrativa.';

COMMIT;

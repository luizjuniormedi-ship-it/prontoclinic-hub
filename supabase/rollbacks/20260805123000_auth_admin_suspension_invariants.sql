BEGIN;

DROP FUNCTION IF EXISTS public.admin_record_auth_operation(UUID, UUID, UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.prepare_user_access_active(UUID, UUID, UUID, BOOLEAN);

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

REVOKE ALL ON FUNCTION public.prepare_user_access_active(UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_user_access_active(UUID, UUID, BOOLEAN)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_user_access_active(UUID, UUID, BOOLEAN)
  TO service_role;

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260805123000';

COMMIT;

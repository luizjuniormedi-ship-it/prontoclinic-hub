-- Secure tenant-aware user profile administration.
-- Global role_permissions remain read-only until a tenant-scoped model is approved.

CREATE OR REPLACE FUNCTION public.update_user_profile_secure(
  p_target_user_id UUID,
  p_patch JSONB
)
RETURNS public.user_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.user_profiles;
  v_target public.user_profiles;
  v_result public.user_profiles;
  v_role public.roles;
  v_new_role_name TEXT;
  v_new_active BOOLEAN;
  v_admin_count INTEGER;
  v_primary_unit_id INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Alteracoes do perfil sao obrigatorias';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_object_keys(p_patch) AS key
     WHERE key NOT IN ('full_name', 'role_id', 'primary_unit_id', 'phone', 'cpf', 'lg_ativo')
  ) THEN
    RAISE EXCEPTION 'Campo de perfil nao editavel por este RPC';
  END IF;

  SELECT * INTO v_actor
    FROM public.user_profiles
   WHERE id = auth.uid()
     AND COALESCE(lg_ativo, TRUE) = TRUE
   LIMIT 1;

  IF NOT FOUND
     OR lower(COALESCE(v_actor.role_name, '')) NOT IN ('admin', 'administrador') THEN
    RAISE EXCEPTION 'Perfil sem permissao para administrar usuarios';
  END IF;

  SELECT * INTO v_target
    FROM public.user_profiles
   WHERE id = p_target_user_id
     AND company_id = v_actor.company_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario nao encontrado ou fora da empresa';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.company_id::text, 0));

  v_new_role_name := lower(COALESCE(v_target.role_name, ''));

  IF p_patch ? 'role_id' THEN
    IF p_patch->'role_id' = 'null'::jsonb THEN
      RAISE EXCEPTION 'Perfil de acesso e obrigatorio';
    END IF;

    SELECT * INTO v_role
      FROM public.roles
     WHERE id = (p_patch->>'role_id')::BIGINT
       AND lg_ativo = TRUE;

    IF NOT FOUND OR v_role.id > 2147483647 THEN
      RAISE EXCEPTION 'Perfil de acesso invalido';
    END IF;
    v_new_role_name := lower(v_role.name);
  END IF;

  v_new_active := CASE
    WHEN p_patch ? 'lg_ativo' THEN (p_patch->>'lg_ativo')::BOOLEAN
    ELSE COALESCE(v_target.lg_ativo, TRUE)
  END;

  IF lower(COALESCE(v_target.role_name, '')) IN ('admin', 'administrador')
     AND (v_new_role_name NOT IN ('admin', 'administrador') OR v_new_active IS FALSE) THEN
    SELECT count(*) INTO v_admin_count
      FROM public.user_profiles
     WHERE company_id = v_actor.company_id
       AND id <> v_target.id
       AND COALESCE(lg_ativo, TRUE) = TRUE
       AND lower(COALESCE(role_name, '')) IN ('admin', 'administrador');

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'Nao e permitido remover o ultimo administrador ativo';
    END IF;
  END IF;

  IF p_patch ? 'primary_unit_id' AND p_patch->'primary_unit_id' <> 'null'::jsonb THEN
    v_primary_unit_id := (p_patch->>'primary_unit_id')::INTEGER;
    IF NOT EXISTS (
      SELECT 1 FROM public.units
       WHERE id = v_primary_unit_id
         AND company_id = v_actor.company_id
    ) THEN
      RAISE EXCEPTION 'Unidade principal fora da empresa';
    END IF;
  ELSE
    v_primary_unit_id := v_target.primary_unit_id;
  END IF;

  UPDATE public.user_profiles
     SET full_name = CASE
           WHEN p_patch ? 'full_name' THEN NULLIF(trim(p_patch->>'full_name'), '')
           ELSE full_name
         END,
         role_id = CASE
           WHEN p_patch ? 'role_id' THEN v_role.id::INTEGER
           ELSE role_id
         END,
         role_name = CASE
           WHEN p_patch ? 'role_id' THEN v_new_role_name
           ELSE role_name
         END,
         primary_unit_id = CASE
           WHEN p_patch ? 'primary_unit_id' AND p_patch->'primary_unit_id' = 'null'::jsonb THEN NULL
           WHEN p_patch ? 'primary_unit_id' THEN v_primary_unit_id
           ELSE primary_unit_id
         END,
         phone = CASE
           WHEN p_patch ? 'phone' THEN NULLIF(trim(p_patch->>'phone'), '')
           ELSE phone
         END,
         cpf = CASE
           WHEN p_patch ? 'cpf' THEN NULLIF(trim(p_patch->>'cpf'), '')
           ELSE cpf
         END,
         lg_ativo = v_new_active,
         updated_at = NOW()
   WHERE id = v_target.id
   RETURNING * INTO v_result;

  IF v_result.full_name IS NULL THEN
    RAISE EXCEPTION 'Nome do usuario e obrigatorio';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.update_user_profile_secure(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_profile_secure(UUID, JSONB) TO authenticated;

GRANT SELECT ON public.user_profiles TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_profiles FROM anon, authenticated;

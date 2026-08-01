-- Validate the reception actor against the canonical application tenant.

CREATE OR REPLACE FUNCTION private.m11_assert_actor(
  p_company_id UUID,
  p_unit_id INTEGER,
  p_allowed_roles TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_claims JSONB := COALESCE(
    NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB,
    '{}'::JSONB
  );
  v_actor UUID := COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID,
    NULLIF(v_claims->>'sub', '')::UUID
  );
  v_active_company UUID := public.current_company_id();
  v_profile public.user_profiles;
  v_role TEXT;
BEGIN
  IF v_actor IS NULL
     OR v_active_company IS NULL
     OR v_active_company IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'Contexto autenticado de empresa invalido';
  END IF;

  SELECT * INTO v_profile
  FROM public.user_profiles profile
  WHERE (profile.id = v_actor OR profile.user_id = v_actor)
    AND profile.company_id = p_company_id
    AND profile.lg_ativo = TRUE
  ORDER BY (profile.id = v_actor) DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil operacional ativo nao encontrado';
  END IF;

  v_role := private.m11_normalize_role(v_profile.role_name);
  IF NOT (v_role = ANY(p_allowed_roles)) THEN
    RAISE EXCEPTION 'Perfil sem permissao para esta etapa';
  END IF;

  IF p_unit_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.units unit_record
      WHERE unit_record.id = p_unit_id
        AND unit_record.company_id = p_company_id
        AND unit_record.lg_ativo = TRUE
    ) THEN
      RAISE EXCEPTION 'Unidade fora da empresa autenticada';
    END IF;

    IF v_role NOT IN ('admin','gestor')
       AND v_profile.primary_unit_id IS DISTINCT FROM p_unit_id
       AND NOT EXISTS (
         SELECT 1 FROM public.unit_access access_record
         WHERE access_record.user_id = v_actor
           AND access_record.company_id = p_company_id
           AND access_record.unit_id = p_unit_id
           AND access_record.valid_from <= CURRENT_DATE
           AND (
             access_record.valid_until IS NULL
             OR access_record.valid_until >= CURRENT_DATE
           )
       ) THEN
      RAISE EXCEPTION 'Perfil sem acesso a unidade do workflow';
    END IF;
  END IF;

  RETURN v_actor;
END;
$function$;

ALTER FUNCTION private.m11_assert_actor(UUID, INTEGER, TEXT[])
  OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION private.m11_assert_actor(UUID, INTEGER, TEXT[])
  FROM PUBLIC, anon, authenticated, app_prontomedic, prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_assert_actor(UUID, INTEGER, TEXT[])
  TO prontomedic_reception_rpc_owner;

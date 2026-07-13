-- Harden the audit RPC contract. This migration is PostgreSQL-only and must
-- never be applied to DataSIGH.

DROP FUNCTION IF EXISTS public.log_data_access(TEXT, TEXT, TEXT, JSONB);

CREATE FUNCTION public.log_data_access(
  p_tabela TEXT,
  p_registro_id TEXT,
  p_acao TEXT,
  p_contexto JSONB DEFAULT '{}'::JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_log_id BIGINT;
  v_company_id UUID;
  v_user_id UUID := auth.uid();
  v_user_name TEXT;
  v_role TEXT;
  v_request_id TEXT;
  v_headers TEXT := current_setting('request.headers', TRUE);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user is required to log data access'
      USING ERRCODE = '28000';
  END IF;

  SELECT profile.company_id, profile.full_name, profile.role_name
    INTO v_company_id, v_user_name, v_role
    FROM public.user_profiles AS profile
    JOIN public.companies AS company ON company.id = profile.company_id
   WHERE profile.id = v_user_id
     AND profile.company_id IS NOT NULL
     AND profile.lg_ativo
     AND company.lg_ativo;

  IF NOT FOUND OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Active user profile and company are required to log data access'
      USING ERRCODE = '28000';
  END IF;

  IF p_tabela IS NULL
     OR p_tabela !~ '^[a-z][a-z0-9_]{0,49}$' THEN
    RAISE EXCEPTION 'Invalid audit table identifier'
      USING ERRCODE = '22023';
  END IF;
  IF p_acao IS NULL
     OR p_acao !~ '^[A-Z][A-Z0-9_]{0,49}$' THEN
    RAISE EXCEPTION 'Invalid audit action identifier'
      USING ERRCODE = '22023';
  END IF;
  IF p_registro_id IS NULL
     OR btrim(p_registro_id) = ''
     OR length(p_registro_id) > 256 THEN
    RAISE EXCEPTION 'Invalid audit record identifier'
      USING ERRCODE = '22023';
  END IF;

  -- Correlation metadata is retained, but caller-supplied context values are
  -- deliberately excluded because they may contain clinical information.
  IF NULLIF(v_headers, '') IS NOT NULL THEN
    BEGIN
      v_request_id := left(NULLIF(v_headers::JSONB ->> 'x-request-id', ''), 64);
    EXCEPTION WHEN invalid_text_representation THEN
      v_request_id := NULL;
    END;
  END IF;

  INSERT INTO public.audit_logs (
    company_id,
    cd_usuario,
    cd_usuario_nome,
    role_name,
    acao,
    tabela,
    registro_id,
    operacao,
    dados_novos,
    request_id
  ) VALUES (
    v_company_id,
    v_user_id,
    v_user_name,
    v_role,
    p_acao,
    p_tabela,
    p_registro_id,
    p_tabela || ' ' || p_acao || ' via API',
    jsonb_build_object(
      'context_supplied', COALESCE(p_contexto, '{}'::JSONB) <> '{}'::JSONB
    ),
    v_request_id
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$function$;

COMMENT ON FUNCTION public.log_data_access(TEXT, TEXT, TEXT, JSONB) IS
  'Writes tenant-bound API access metadata and returns the real audit_logs BIGINT id. Caller context values are not persisted.';

REVOKE ALL ON FUNCTION public.log_data_access(TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_data_access(TEXT, TEXT, TEXT, JSONB)
  TO authenticated;



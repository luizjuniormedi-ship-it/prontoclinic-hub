-- Corrige o contrato e a autenticidade da RPC de auditoria.
-- A migration anterior declarava UUID, apesar de audit_logs.id ser BIGINT,
-- e aceitava eventos arbitrarios enviados pelo cliente.

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
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_log_id BIGINT;
  v_company_id UUID;
  v_user_id UUID := auth.uid();
  v_user_name TEXT;
  v_role TEXT;
  v_tabela TEXT := lower(trim(p_tabela));
  v_acao TEXT := upper(trim(p_acao));
  v_exists BOOLEAN;
  v_request_id TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  IF v_tabela !~ '^[a-z_][a-z0-9_]*$'
     OR p_registro_id IS NULL
     OR length(trim(p_registro_id)) = 0 THEN
    RAISE EXCEPTION 'Tabela ou registro de auditoria inválido' USING ERRCODE = '22023';
  END IF;

  IF v_acao NOT IN ('VIEW_RECORD', 'PRINT', 'EXPORT', 'LOGIN', 'LOGOUT', 'ANONYMIZE') THEN
    RAISE EXCEPTION 'Ação de auditoria não permitida pela RPC: %', v_acao USING ERRCODE = '42501';
  END IF;

  SELECT company_id, full_name, role_name
    INTO v_company_id, v_user_name, v_role
    FROM public.user_profiles
   WHERE id = v_user_id
     AND lg_ativo = TRUE;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Perfil ativo sem empresa' USING ERRCODE = '42501';
  END IF;

  -- Login/logout representam o proprio usuario autenticado; nao aceitam
  -- identificadores arbitrarios nem uma identidade de outro tenant.
  IF v_tabela = 'auth' THEN
    IF v_acao NOT IN ('LOGIN', 'LOGOUT') OR p_registro_id <> v_user_id::TEXT THEN
      RAISE EXCEPTION 'Evento auth fora do escopo do usuario' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_acao IN ('LOGIN', 'LOGOUT') THEN
      RAISE EXCEPTION 'LOGIN/LOGOUT exigem tabela auth' USING ERRCODE = '22023';
    END IF;

    -- A tabela precisa ser publica e possuir o contrato id + company_id.
    IF NOT EXISTS (
      SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute aid ON aid.attrelid = c.oid AND aid.attname = 'id' AND NOT aid.attisdropped
        JOIN pg_attribute ac ON ac.attrelid = c.oid AND ac.attname = 'company_id' AND NOT ac.attisdropped
       WHERE n.nspname = 'public'
         AND c.relname = v_tabela
         AND c.relkind IN ('r', 'p', 'v')
    ) THEN
      RAISE EXCEPTION 'Tabela não auditável ou sem escopo de empresa: %', v_tabela USING ERRCODE = '42501';
    END IF;

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE id::text = $1 AND company_id = $2)',
      v_tabela
    ) INTO v_exists USING p_registro_id, v_company_id;

    IF NOT v_exists THEN
      RAISE EXCEPTION 'Registro de auditoria fora do escopo ou inexistente' USING ERRCODE = '42501';
    END IF;
  END IF;

  BEGIN
    v_request_id := NULLIF(current_setting('request.headers', true), '')::json->>'x-request-id';
  EXCEPTION WHEN OTHERS THEN
    v_request_id := NULL;
  END;

  INSERT INTO public.audit_logs (
    company_id, cd_usuario, cd_usuario_nome, role_name,
    acao, tabela, registro_id, operacao, dados_novos, request_id
  ) VALUES (
    v_company_id, v_user_id, v_user_name, v_role,
    v_acao, v_tabela, p_registro_id,
    v_tabela || ' ' || v_acao || ' via API', p_contexto, v_request_id
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

COMMENT ON FUNCTION public.log_data_access(TEXT, TEXT, TEXT, JSONB) IS
  'Registra acesso auditavel somente para o usuario autenticado, empresa e '
  'registro reais; retorna o BIGINT efetivamente inserido em audit_logs.';

REVOKE EXECUTE ON FUNCTION public.log_data_access(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_data_access(TEXT, TEXT, TEXT, JSONB) TO authenticated;

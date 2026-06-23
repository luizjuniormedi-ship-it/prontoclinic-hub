-- =============================================================================
-- Migration: 20260101000032_rpc_search_path_fix
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_pre_cadastro CASCADE;

-- Variáveis com prefixo 'r_' para evitar ambiguidade com colunas retornadas
-- (em PL/pgSQL, RETURN NEXT referencia nomes das colunas de saída)
CREATE OR REPLACE FUNCTION public.create_pre_cadastro(
  p_company_id UUID,
  p_full_name CHARACTER VARYING,
  p_email CHARACTER VARYING,
  p_phone CHARACTER VARYING,
  p_birth_date DATE,
  p_gender CHARACTER VARYING,
  p_cep CHARACTER VARYING,
  p_logradouro CHARACTER VARYING,
  p_numero CHARACTER VARYING,
  p_complemento CHARACTER VARYING,
  p_bairro CHARACTER VARYING,
  p_cidade CHARACTER VARYING,
  p_uf CHARACTER VARYING,
  p_versao_termo CHARACTER VARYING,
  p_texto_termo_hash CHARACTER,
  p_ip_origem INET,
  p_user_agent TEXT
)
RETURNS TABLE(r_id UUID, r_token CHARACTER VARYING, r_dt_exp TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_id           UUID;
  v_token        CHARACTER VARYING(64);
  v_dt_exp       TIMESTAMPTZ := NOW() + INTERVAL '72 hours';
  v_existing_id  UUID;
  v_email_hash   CHAR(64);
BEGIN
  IF p_email IS NULL OR LENGTH(TRIM(p_email)) = 0 THEN
    RAISE EXCEPTION 'E-mail obrigatorio';
  END IF;
  IF p_full_name IS NULL OR LENGTH(TRIM(p_full_name)) < 3 THEN
    RAISE EXCEPTION 'Nome completo invalido (minimo 3 caracteres)';
  END IF;

  v_email_hash := encode(extensions.digest(LOWER(TRIM(p_email)), 'sha256'), 'hex');

  SELECT id INTO v_existing_id
  FROM public.pre_cadastro
  WHERE company_id = p_company_id
    AND email      = LOWER(TRIM(p_email))
    AND status     = 'PENDENTE'
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.pre_cadastro
    SET token_confirmacao = encode(extensions.gen_random_bytes(32), 'hex'),
        dt_token_exp      = v_dt_exp,
        dt_ultimo_envio   = NOW(),
        tentativas_confirmacao = 0,
        full_name  = p_full_name,
        phone      = p_phone,
        birth_date = p_birth_date,
        gender     = p_gender,
        cep        = p_cep,
        logradouro = p_logradouro,
        numero     = p_numero,
        complemento = p_complemento,
        bairro     = p_bairro,
        cidade     = p_cidade,
        uf         = p_uf
    WHERE id = v_existing_id;
    -- Retorna o registro atualizado
    SELECT id, token_confirmacao, dt_token_exp
      INTO r_id, r_token, r_dt_exp
    FROM public.pre_cadastro
    WHERE id = v_existing_id;
    RETURN NEXT;
    RETURN;
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_id    := extensions.gen_random_uuid();

  INSERT INTO public.pre_cadastro (
    id, company_id,
    full_name, email, email_hash, phone, whatsapp,
    birth_date, gender,
    cep, logradouro, numero, complemento, bairro, cidade, uf,
    lg_aceite_termo, dt_aceite_termo, versao_termo, texto_termo_hash,
    ip_origem, user_agent,
    token_confirmacao, dt_token_exp, dt_ultimo_envio
  ) VALUES (
    v_id, p_company_id,
    p_full_name, LOWER(TRIM(p_email)), v_email_hash, p_phone, p_phone,
    p_birth_date, p_gender,
    p_cep, p_logradouro, p_numero, p_complemento, p_bairro, p_cidade, p_uf,
    TRUE, NOW(), p_versao_termo, p_texto_termo_hash,
    p_ip_origem, p_user_agent,
    v_token, v_dt_exp, NOW()
  );

  r_id    := v_id;
  r_token := v_token;
  r_dt_exp := v_dt_exp;
  RETURN NEXT;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.create_pre_cadastro(
  UUID, VARCHAR, VARCHAR, VARCHAR, DATE, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, CHARACTER, INET, TEXT
) TO anon, authenticated;
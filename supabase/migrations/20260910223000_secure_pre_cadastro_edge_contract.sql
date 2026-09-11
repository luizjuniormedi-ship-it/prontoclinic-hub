-- Expand phase for the Edge-mediated pre-registration contract.
-- Legacy RPC definitions and grants remain until the contract migration runs
-- after the Edge and frontend releases are active at the same commit.

ALTER TABLE public.pre_cadastro
  ADD COLUMN IF NOT EXISTS token_confirmacao_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS confirmation_request_key UUID;

UPDATE public.pre_cadastro
SET token_confirmacao_hash = encode(public.digest(token_confirmacao, 'sha256'), 'hex')
WHERE token_confirmacao IS NOT NULL
  AND token_confirmacao_hash IS NULL;

ALTER TABLE public.pre_cadastro ALTER COLUMN token_confirmacao DROP NOT NULL;

-- Transitional legacy contract: old clients still receive plaintext, while
-- every write also produces the hash consumed by the Edge contract.
CREATE OR REPLACE FUNCTION public.create_pre_cadastro(
  p_company_id UUID, p_full_name VARCHAR, p_email VARCHAR, p_phone VARCHAR,
  p_birth_date DATE, p_gender VARCHAR, p_cep VARCHAR, p_logradouro VARCHAR,
  p_numero VARCHAR, p_complemento VARCHAR, p_bairro VARCHAR, p_cidade VARCHAR,
  p_uf VARCHAR, p_versao_termo VARCHAR, p_texto_termo_hash CHAR,
  p_ip_origem INET, p_user_agent TEXT
)
RETURNS TABLE(r_id UUID, r_token VARCHAR, r_dt_exp TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_token VARCHAR(64) := encode(public.gen_random_bytes(32), 'hex');
  v_token_hash CHAR(64);
  v_dt_exp TIMESTAMPTZ := clock_timestamp() + interval '72 hours';
  v_existing_id UUID;
  v_email TEXT := lower(trim(p_email));
BEGIN
  -- Cleanup later takes the exclusive form of this lock after revoking grants.
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('prontomedic:pre-cadastro:legacy-drain', 0));
  IF v_email IS NULL OR v_email = '' OR length(trim(coalesce(p_full_name, ''))) < 3 THEN
    RAISE EXCEPTION 'Dados obrigatorios invalidos';
  END IF;
  v_token_hash := encode(public.digest(v_token, 'sha256'), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_company_id::text || ':' || v_email, 0));
  SELECT id INTO v_existing_id FROM public.pre_cadastro
  WHERE company_id = p_company_id AND lower(trim(email)) = v_email
    AND status = 'PENDENTE'
  FOR UPDATE;
  IF FOUND THEN
    UPDATE public.pre_cadastro
    SET token_confirmacao = v_token, token_confirmacao_hash = v_token_hash,
        confirmation_request_key = NULL, dt_token_exp = v_dt_exp,
        dt_ultimo_envio = clock_timestamp(), tentativas_confirmacao = 0,
        full_name = trim(p_full_name), phone = p_phone,
        birth_date = p_birth_date, gender = p_gender, cep = p_cep,
        logradouro = p_logradouro, numero = p_numero,
        complemento = p_complemento, bairro = p_bairro, cidade = p_cidade, uf = p_uf
    WHERE id = v_existing_id;
    r_id := v_existing_id; r_token := v_token; r_dt_exp := v_dt_exp;
    RETURN NEXT;
    RETURN;
  END IF;
  v_id := public.gen_random_uuid();
  INSERT INTO public.pre_cadastro (
    id, company_id, full_name, email, email_hash, phone, whatsapp,
    birth_date, gender, cep, logradouro, numero, complemento, bairro, cidade, uf,
    lg_aceite_termo, dt_aceite_termo, versao_termo, texto_termo_hash,
    ip_origem, user_agent, token_confirmacao, token_confirmacao_hash,
    dt_token_exp, dt_ultimo_envio
  ) VALUES (
    v_id, p_company_id, trim(p_full_name), v_email,
    encode(public.digest(v_email, 'sha256'), 'hex'), p_phone, p_phone,
    p_birth_date, p_gender, p_cep, p_logradouro, p_numero, p_complemento,
    p_bairro, p_cidade, p_uf, TRUE, clock_timestamp(), p_versao_termo,
    p_texto_termo_hash, p_ip_origem, left(p_user_agent, 500), v_token,
    v_token_hash, v_dt_exp, clock_timestamp()
  );
  r_id := v_id; r_token := v_token; r_dt_exp := v_dt_exp;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_pre_cadastro(p_token VARCHAR)
RETURNS TABLE(id UUID, full_name VARCHAR, email VARCHAR, status VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_record public.pre_cadastro%ROWTYPE;
  v_token_hash CHAR(64);
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('prontomedic:pre-cadastro:legacy-drain', 0));
  IF p_token IS NULL OR length(p_token) < 16 THEN RAISE EXCEPTION 'Token invalido'; END IF;
  v_token_hash := encode(public.digest(p_token, 'sha256'), 'hex');
  SELECT pc.* INTO v_record FROM public.pre_cadastro pc
  WHERE pc.token_confirmacao = p_token OR pc.token_confirmacao_hash = v_token_hash
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Token invalido'; END IF;
  IF v_record.status = 'EXPIRADO' THEN RAISE EXCEPTION 'Token expirado'; END IF;
  IF v_record.status IN ('CONFIRMADO', 'MIGRADO', 'CANCELADO') THEN
    RAISE EXCEPTION 'Pre-cadastro ja processado (status: %)', v_record.status;
  END IF;
  IF v_record.dt_token_exp < clock_timestamp() THEN
    UPDATE public.pre_cadastro SET status = 'EXPIRADO' WHERE pre_cadastro.id = v_record.id;
    RAISE EXCEPTION 'Token expirado';
  END IF;
  IF v_record.tentativas_confirmacao >= 5 THEN
    UPDATE public.pre_cadastro SET status = 'CANCELADO' WHERE pre_cadastro.id = v_record.id;
    RAISE EXCEPTION 'Muitas tentativas';
  END IF;
  UPDATE public.pre_cadastro
  SET lg_confirmado = TRUE, dt_confirmacao = clock_timestamp(),
      status = 'CONFIRMADO', tentativas_confirmacao = tentativas_confirmacao + 1,
      confirmation_request_key = NULL
  WHERE pre_cadastro.id = v_record.id;
  id := v_record.id; full_name := v_record.full_name;
  email := v_record.email; status := 'CONFIRMADO';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.create_pre_cadastro(
  UUID, VARCHAR, VARCHAR, VARCHAR, DATE, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, CHAR, INET, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_pre_cadastro(VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pre_cadastro(
  UUID, VARCHAR, VARCHAR, VARCHAR, DATE, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, CHAR, INET, TEXT
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_pre_cadastro(VARCHAR) TO anon, authenticated;

DROP INDEX IF EXISTS public.idx_pre_cadastro_token;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pre_cadastro_token_hash
  ON public.pre_cadastro(token_confirmacao_hash)
  WHERE token_confirmacao_hash IS NOT NULL;

-- Permissive policies compose with OR: replace the complete historical set.
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'pre_cadastro'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.pre_cadastro', p.policyname);
  END LOOP;
END $$;
ALTER TABLE public.pre_cadastro ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pre_cadastro_staff_select"
  ON public.pre_cadastro FOR SELECT TO authenticated
  USING (
    company_id = public.active_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.user_access_context ctx
      JOIN public.roles r ON r.id = ctx.role_id AND r.lg_ativo IS TRUE
      WHERE ctx.user_id = auth.uid()
        AND ctx.session_id = nullif(auth.jwt()->>'session_id', '')::UUID
        AND lower(r.name) IN ('admin', 'administrador', 'reception', 'recepcao', 'recepção')
    )
  );
DROP POLICY IF EXISTS "pre_cadastro_admin_delete" ON public.pre_cadastro;
CREATE POLICY "pre_cadastro_admin_delete"
  ON public.pre_cadastro FOR DELETE TO authenticated
  USING (
    company_id = public.active_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.user_access_context ctx
      JOIN public.roles r ON r.id = ctx.role_id AND r.lg_ativo IS TRUE
      WHERE ctx.user_id = auth.uid()
        AND ctx.session_id = nullif(auth.jwt()->>'session_id', '')::UUID
        AND lower(r.name) IN ('admin', 'administrador')
    )
  );

REVOKE SELECT, INSERT, UPDATE ON public.pre_cadastro FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, company_id, full_name, cpf, birth_date, gender, email, phone, whatsapp,
  cep, logradouro, numero, complemento, bairro, cidade, uf, ibge_cidade,
  lg_aceite_termo, dt_aceite_termo, versao_termo, dt_token_exp,
  lg_confirmado, dt_confirmacao, cd_paciente_final, dt_migracao, status,
  tentativas_confirmacao, dt_ultimo_envio, motivo_cancelamento, created_at, updated_at
) ON public.pre_cadastro TO authenticated;
-- Table-level REVOKE does not remove historical column-level privileges.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT attname FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.pre_cadastro'::regclass
      AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE INSERT (%I), UPDATE (%I) ON public.pre_cadastro FROM PUBLIC, anon, authenticated', c.attname, c.attname);
  END LOOP;
END $$;
ALTER VIEW public.pre_cadastros_pendentes SET (security_invoker = true);

-- Fail on legacy normalized collisions rather than silently selecting one row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pre_cadastro_company_email_normalized
  ON public.pre_cadastro(company_id, lower(trim(email)));

CREATE OR REPLACE FUNCTION public.cancel_pre_cadastro(p_id UUID, p_motivo TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor public.user_profiles%ROWTYPE;
  v_record public.pre_cadastro%ROWTYPE;
BEGIN
  IF p_id IS NULL OR nullif(trim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo do cancelamento e obrigatorio';
  END IF;
  SELECT up.* INTO v_actor FROM public.user_profiles up
  WHERE up.id = auth.uid() AND up.lg_ativo IS TRUE;
  IF NOT FOUND
    OR v_actor.company_id IS DISTINCT FROM public.active_company_id()
    OR NOT EXISTS (
      SELECT 1
      FROM public.user_access_context ctx
      JOIN public.roles r ON r.id = ctx.role_id AND r.lg_ativo IS TRUE
      WHERE ctx.user_id = auth.uid()
        AND ctx.session_id = nullif(auth.jwt()->>'session_id', '')::UUID
        AND lower(r.name) IN ('admin', 'administrador', 'reception', 'recepcao', 'recepção')
    ) THEN
    RAISE EXCEPTION 'Operador sem permissao para cancelar pre-cadastro';
  END IF;
  SELECT pc.* INTO v_record FROM public.pre_cadastro pc
  WHERE pc.id = p_id AND pc.company_id = v_actor.company_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pre-cadastro nao encontrado'; END IF;
  IF v_record.status = 'MIGRADO' THEN
    RAISE EXCEPTION 'Pre-cadastro ja migrado';
  END IF;
  UPDATE public.pre_cadastro
  SET status = 'CANCELADO', motivo_cancelamento = trim(p_motivo)
  WHERE id = v_record.id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_pre_cadastro(p_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor public.user_profiles%ROWTYPE;
  v_pre public.pre_cadastro%ROWTYPE;
  v_new_patient_id BIGINT;
  v_existing_patient BIGINT;
BEGIN
  SELECT up.* INTO v_actor FROM public.user_profiles up
  WHERE up.id = auth.uid() AND up.lg_ativo IS TRUE;
  IF NOT FOUND
    OR v_actor.company_id IS DISTINCT FROM public.active_company_id()
    OR NOT EXISTS (
      SELECT 1
      FROM public.user_access_context ctx
      JOIN public.roles r ON r.id = ctx.role_id AND r.lg_ativo IS TRUE
      WHERE ctx.user_id = auth.uid()
        AND ctx.session_id = nullif(auth.jwt()->>'session_id', '')::UUID
        AND lower(r.name) IN ('admin', 'administrador', 'reception', 'recepcao', 'recepção')
    ) THEN
    RAISE EXCEPTION 'Operador sem permissao para promover pre-cadastro';
  END IF;
  SELECT pc.* INTO v_pre FROM public.pre_cadastro pc
  WHERE pc.id = p_id AND pc.company_id = v_actor.company_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pre-cadastro nao encontrado'; END IF;
  IF v_pre.status = 'MIGRADO' AND v_pre.cd_paciente_final IS NOT NULL THEN
    RETURN v_pre.cd_paciente_final;
  END IF;
  IF v_pre.status <> 'CONFIRMADO' THEN
    RAISE EXCEPTION 'Pre-cadastro precisa estar CONFIRMADO';
  END IF;
  IF v_pre.cpf_hash IS NOT NULL THEN
    SELECT p.id INTO v_existing_patient FROM public.patients p
    WHERE p.company_id = v_pre.company_id AND p.cpf_hash = v_pre.cpf_hash
    LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'Paciente ja cadastrado'; END IF;
  END IF;
  INSERT INTO public.patients (
    company_id, full_name, cpf, cpf_hash, birth_date, gender,
    email, email_hash, phone, whatsapp, cep, logradouro, numero,
    complemento, bairro, cidade, uf, ibge_cidade, lg_aceite_termo, dt_aceite_termo
  ) VALUES (
    v_pre.company_id, v_pre.full_name, v_pre.cpf, v_pre.cpf_hash,
    v_pre.birth_date, v_pre.gender, v_pre.email, v_pre.email_hash,
    v_pre.phone, v_pre.whatsapp, v_pre.cep, v_pre.logradouro, v_pre.numero,
    v_pre.complemento, v_pre.bairro, v_pre.cidade, v_pre.uf, v_pre.ibge_cidade,
    TRUE, coalesce(v_pre.dt_aceite_termo, clock_timestamp())
  ) RETURNING id INTO v_new_patient_id;
  UPDATE public.pre_cadastro
  SET status = 'MIGRADO', cd_paciente_final = v_new_patient_id,
      dt_migracao = clock_timestamp()
  WHERE id = v_pre.id;
  RETURN v_new_patient_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_pre_cadastro(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.promote_pre_cadastro(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_pre_cadastro(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_pre_cadastro(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.pre_cadastro_edge_request(
  p_company_id UUID,
  p_request_key UUID,
  p_token_hash CHAR(64),
  p_full_name VARCHAR,
  p_email VARCHAR,
  p_phone VARCHAR,
  p_whatsapp VARCHAR,
  p_cpf VARCHAR,
  p_birth_date DATE,
  p_gender CHAR,
  p_cep VARCHAR,
  p_logradouro VARCHAR,
  p_numero VARCHAR,
  p_complemento VARCHAR,
  p_bairro VARCHAR,
  p_cidade VARCHAR,
  p_uf CHAR,
  p_ibge_cidade VARCHAR,
  p_versao_termo VARCHAR,
  p_texto_termo_hash CHAR,
  p_ip_origem INET,
  p_user_agent TEXT
)
RETURNS TABLE(r_should_send BOOLEAN, r_dt_exp TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_existing public.pre_cadastro%ROWTYPE;
  v_email TEXT := lower(trim(p_email));
  v_cpf TEXT := nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), '');
  v_now TIMESTAMPTZ := clock_timestamp();
  v_exp TIMESTAMPTZ := v_now + interval '72 hours';
BEGIN
  IF p_request_key IS NULL OR p_company_id IS NULL
    OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
    OR length(trim(coalesce(p_full_name, ''))) < 3
    OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    OR v_email IS NULL
    OR p_versao_termo IS NULL OR p_texto_termo_hash IS NULL
    OR p_texto_termo_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Solicitacao de pre-cadastro invalida';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id AND c.lg_ativo) THEN
    RAISE EXCEPTION 'Empresa de pre-cadastro indisponivel';
  END IF;

  -- Covers absent rows too; hash collisions only serialize unrelated requests.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_company_id::text || ':' || v_email, 0));
  v_now := clock_timestamp();
  v_exp := v_now + interval '72 hours';

  SELECT pc.* INTO v_existing
  FROM public.pre_cadastro pc
  WHERE pc.company_id = p_company_id AND lower(trim(pc.email)) = v_email
  FOR UPDATE;

  IF FOUND AND v_existing.status = 'PENDENTE' AND v_existing.dt_token_exp > v_now THEN
    IF v_existing.confirmation_request_key = p_request_key
      AND v_existing.token_confirmacao_hash = p_token_hash THEN
      r_should_send := TRUE;
      r_dt_exp := v_existing.dt_token_exp;
      RETURN NEXT;
      RETURN;
    END IF;
    IF v_existing.dt_ultimo_envio > v_now - interval '5 minutes' THEN
      r_should_send := FALSE;
      r_dt_exp := v_existing.dt_token_exp;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF FOUND AND v_existing.status IN ('CONFIRMADO', 'MIGRADO', 'CANCELADO') THEN
    r_should_send := FALSE;
    r_dt_exp := v_existing.dt_token_exp;
    RETURN NEXT;
    RETURN;
  END IF;

  IF FOUND THEN
    UPDATE public.pre_cadastro
    SET full_name = trim(p_full_name),
        cpf = v_cpf,
        cpf_hash = CASE WHEN v_cpf IS NULL THEN NULL ELSE encode(public.digest(v_cpf, 'sha256'), 'hex') END,
        birth_date = p_birth_date,
        gender = p_gender,
        email = v_email,
        email_hash = encode(public.digest(v_email, 'sha256'), 'hex'),
        phone = p_phone,
        whatsapp = coalesce(nullif(p_whatsapp, ''), p_phone),
        cep = p_cep, logradouro = p_logradouro, numero = p_numero,
        complemento = p_complemento, bairro = p_bairro, cidade = p_cidade,
        uf = p_uf, ibge_cidade = p_ibge_cidade,
        lg_aceite_termo = TRUE, dt_aceite_termo = v_now,
        versao_termo = p_versao_termo, texto_termo_hash = p_texto_termo_hash,
        ip_origem = p_ip_origem, user_agent = left(p_user_agent, 500),
        token_confirmacao = NULL, token_confirmacao_hash = p_token_hash,
        confirmation_request_key = p_request_key,
        dt_token_exp = v_exp, dt_ultimo_envio = v_now,
        lg_confirmado = FALSE, dt_confirmacao = NULL,
        status = 'PENDENTE', tentativas_confirmacao = 0,
        motivo_cancelamento = NULL
    WHERE id = v_existing.id;
  ELSE
    INSERT INTO public.pre_cadastro (
      company_id, full_name, cpf, cpf_hash, birth_date, gender,
      email, email_hash, phone, whatsapp,
      cep, logradouro, numero, complemento, bairro, cidade, uf, ibge_cidade,
      lg_aceite_termo, dt_aceite_termo, versao_termo, texto_termo_hash,
      ip_origem, user_agent, token_confirmacao, token_confirmacao_hash,
      confirmation_request_key, dt_token_exp, dt_ultimo_envio
    ) VALUES (
      p_company_id, trim(p_full_name), v_cpf,
      CASE WHEN v_cpf IS NULL THEN NULL ELSE encode(public.digest(v_cpf, 'sha256'), 'hex') END,
      p_birth_date, p_gender, v_email, encode(public.digest(v_email, 'sha256'), 'hex'),
      p_phone, coalesce(nullif(p_whatsapp, ''), p_phone),
      p_cep, p_logradouro, p_numero, p_complemento, p_bairro, p_cidade, p_uf, p_ibge_cidade,
      TRUE, v_now, p_versao_termo, p_texto_termo_hash,
      p_ip_origem, left(p_user_agent, 500), NULL, p_token_hash,
      p_request_key, v_exp, v_now
    );
  END IF;

  r_should_send := TRUE;
  r_dt_exp := v_exp;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.pre_cadastro_edge_status(p_token_hash CHAR(64))
RETURNS TABLE(r_status VARCHAR, r_dt_exp TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT CASE
      WHEN pc.status = 'PENDENTE' AND pc.dt_token_exp <= clock_timestamp() THEN 'EXPIRADO'::VARCHAR
      ELSE pc.status
    END,
    pc.dt_token_exp
  FROM public.pre_cadastro pc
  WHERE pc.token_confirmacao_hash = p_token_hash;
END;
$$;

CREATE OR REPLACE FUNCTION public.pre_cadastro_edge_confirm(p_token_hash CHAR(64))
RETURNS TABLE(r_status VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_record public.pre_cadastro%ROWTYPE;
BEGIN
  SELECT pc.* INTO v_record
  FROM public.pre_cadastro pc
  WHERE pc.token_confirmacao_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_record.status IN ('CONFIRMADO', 'MIGRADO') THEN
    r_status := v_record.status;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_record.status <> 'PENDENTE' THEN
    r_status := v_record.status;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_record.dt_token_exp <= clock_timestamp() THEN
    UPDATE public.pre_cadastro
    SET status = 'EXPIRADO', tentativas_confirmacao = tentativas_confirmacao + 1
    WHERE id = v_record.id;
    r_status := 'EXPIRADO';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.pre_cadastro
  SET lg_confirmado = TRUE,
      dt_confirmacao = clock_timestamp(),
      status = 'CONFIRMADO',
      tentativas_confirmacao = tentativas_confirmacao + 1,
      confirmation_request_key = NULL
  WHERE id = v_record.id;
  r_status := 'CONFIRMADO';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.pre_cadastro_edge_resend(
  p_actor_id UUID,
  p_session_id UUID,
  p_aal TEXT,
  p_id UUID,
  p_request_key UUID,
  p_token_hash CHAR(64)
)
RETURNS TABLE(
  r_should_send BOOLEAN,
  r_email VARCHAR,
  r_full_name VARCHAR,
  r_dt_exp TIMESTAMPTZ,
  r_retry_after_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor public.user_profiles%ROWTYPE;
  v_record public.pre_cadastro%ROWTYPE;
  v_now TIMESTAMPTZ;
BEGIN
  IF p_actor_id IS NULL OR p_session_id IS NULL OR p_aal IS DISTINCT FROM 'aal2'
    OR p_id IS NULL OR p_request_key IS NULL
    OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Solicitacao de reenvio invalida';
  END IF;

  SELECT up.* INTO v_actor
  FROM public.user_profiles up
  WHERE up.id = p_actor_id AND up.lg_ativo IS TRUE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.membership_roles mr ON mr.membership_id = m.id
    JOIN public.roles r ON r.id = mr.role_id AND r.lg_ativo IS TRUE
    JOIN public.companies c ON c.id = m.company_id AND c.lg_ativo IS TRUE
    JOIN public.user_access_context ctx
      ON ctx.user_id = m.user_id
     AND ctx.membership_id = m.id
     AND ctx.role_id = r.id
     AND ctx.session_id = p_session_id
    JOIN public.application_sessions app_session
      ON app_session.user_id = m.user_id
     AND app_session.company_id = m.company_id
     AND app_session.gotrue_session_id = p_session_id
     AND app_session.revoked_at IS NULL
     AND app_session.idle_expires_at > clock_timestamp()
     AND app_session.absolute_expires_at > clock_timestamp()
    JOIN public.application_devices device
      ON device.id = app_session.device_id
     AND device.user_id = m.user_id
     AND device.company_id = m.company_id
     AND device.revoked_at IS NULL
    LEFT JOIN public.membership_units membership_unit
      ON membership_unit.membership_id = m.id
     AND membership_unit.unit_id = ctx.unit_id
    LEFT JOIN public.units unit_record
      ON unit_record.id = app_session.unit_id
     AND unit_record.company_id = m.company_id
     AND unit_record.lg_ativo IS TRUE
    WHERE m.user_id = p_actor_id
      AND m.company_id = v_actor.company_id
      AND m.status = 'active'
      AND lower(r.name) IN ('admin', 'administrador', 'reception', 'recepcao', 'recepção')
      AND device.unit_id IS NOT DISTINCT FROM app_session.unit_id
      AND ctx.unit_id IS NOT DISTINCT FROM app_session.unit_id
      AND (
        (ctx.unit_id IS NULL AND lower(r.name) IN ('admin', 'administrador'))
        OR (ctx.unit_id IS NOT NULL AND membership_unit.unit_id IS NOT NULL AND unit_record.id IS NOT NULL)
      )
  ) THEN
    RAISE EXCEPTION 'Operador sem permissao para reenviar confirmacao';
  END IF;

  SELECT pc.* INTO v_record
  FROM public.pre_cadastro pc
  WHERE pc.id = p_id AND pc.company_id = v_actor.company_id
  FOR UPDATE;
  IF NOT FOUND OR v_record.status IN ('CONFIRMADO', 'MIGRADO', 'CANCELADO') THEN
    RAISE EXCEPTION 'Pre-cadastro indisponivel para reenvio';
  END IF;

  IF v_record.status = 'PENDENTE' AND v_record.dt_token_exp > clock_timestamp() THEN
    IF v_record.confirmation_request_key = p_request_key
      AND v_record.token_confirmacao_hash = p_token_hash THEN
      r_should_send := TRUE;
      r_email := v_record.email;
      r_full_name := v_record.full_name;
      r_dt_exp := v_record.dt_token_exp;
      r_retry_after_seconds := 0;
      RETURN NEXT;
      RETURN;
    END IF;
    IF v_record.dt_ultimo_envio > clock_timestamp() - interval '5 minutes' THEN
      r_should_send := FALSE;
      r_email := v_record.email;
      r_full_name := v_record.full_name;
      r_dt_exp := v_record.dt_token_exp;
      r_retry_after_seconds := GREATEST(
        1,
        ceil(extract(epoch FROM (v_record.dt_ultimo_envio + interval '5 minutes' - clock_timestamp())))::INTEGER
      );
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  v_now := clock_timestamp();
  UPDATE public.pre_cadastro
  SET token_confirmacao = NULL,
      token_confirmacao_hash = p_token_hash,
      confirmation_request_key = p_request_key,
      dt_token_exp = v_now + interval '72 hours',
      dt_ultimo_envio = v_now,
      tentativas_confirmacao = 0,
      status = 'PENDENTE',
      lg_confirmado = FALSE,
      dt_confirmacao = NULL
  WHERE id = v_record.id
  RETURNING email, full_name, dt_token_exp
    INTO r_email, r_full_name, r_dt_exp;
  r_should_send := TRUE;
  r_retry_after_seconds := 0;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.pre_cadastro_edge_request(
  UUID, UUID, CHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, DATE, CHAR,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, CHAR, VARCHAR,
  VARCHAR, CHAR, INET, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pre_cadastro_edge_status(CHAR) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pre_cadastro_edge_confirm(CHAR) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pre_cadastro_edge_resend(UUID, UUID, TEXT, UUID, UUID, CHAR)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pre_cadastro_edge_request(
  UUID, UUID, CHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, DATE, CHAR,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, CHAR, VARCHAR,
  VARCHAR, CHAR, INET, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.pre_cadastro_edge_status(CHAR) TO service_role;
GRANT EXECUTE ON FUNCTION public.pre_cadastro_edge_confirm(CHAR) TO service_role;
GRANT EXECUTE ON FUNCTION public.pre_cadastro_edge_resend(UUID, UUID, TEXT, UUID, UUID, CHAR) TO service_role;

COMMENT ON FUNCTION public.pre_cadastro_edge_request IS
  'Contrato exclusivo do Edge para pre-cadastro; recebe apenas hash do token e nunca o devolve ao navegador.';

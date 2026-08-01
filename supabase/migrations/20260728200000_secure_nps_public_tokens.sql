-- P0 NPS: replace predictable public identifiers and anonymous table writes
-- with opaque, expiring, single-use invitations handled atomically by RPC.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.nps_convites (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_pesquisa BIGINT NOT NULL REFERENCES public.nps_pesquisas(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  cd_appointment BIGINT REFERENCES public.appointments(id),
  token_hash BYTEA NOT NULL UNIQUE,
  ds_origem VARCHAR(20) CHECK (ds_origem IN ('EMAIL', 'WHATSAPP', 'SMS', 'PRESENCIAL')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT nps_convites_expiration_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_nps_convites_company_pesquisa
  ON public.nps_convites(company_id, cd_pesquisa, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nps_convites_active
  ON public.nps_convites(expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.nps_convites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nps_convites NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nps_convites FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON TABLE public.nps_respostas FROM anon;

DROP POLICY IF EXISTS "Anonymous can submit NPS" ON public.nps_respostas;
DROP POLICY IF EXISTS "Authenticated can submit NPS" ON public.nps_respostas;

-- Authenticated staff may still create a response only through the public
-- invitation contract. Direct table INSERT is intentionally unavailable.
REVOKE INSERT ON TABLE public.nps_respostas FROM authenticated;

CREATE OR REPLACE FUNCTION public.create_nps_invitation_secure(
  p_pesquisa_id BIGINT,
  p_paciente_id BIGINT,
  p_appointment_id BIGINT DEFAULT NULL,
  p_origem TEXT DEFAULT 'EMAIL',
  p_ttl INTERVAL DEFAULT INTERVAL '7 days'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_company UUID;
  v_token TEXT;
  v_token_hash BYTEA;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_ttl <= INTERVAL '0 seconds' OR p_ttl > INTERVAL '30 days' THEN
    RAISE EXCEPTION 'invalid invitation lifetime' USING ERRCODE = '22023';
  END IF;

  IF p_origem IS NULL OR p_origem NOT IN ('EMAIL', 'WHATSAPP', 'SMS', 'PRESENCIAL') THEN
    RAISE EXCEPTION 'invalid invitation origin' USING ERRCODE = '22023';
  END IF;

  SELECT up.company_id
    INTO v_company
    FROM public.user_profiles up
   WHERE up.id = v_actor
     AND up.role_name IN ('admin', 'gestor', 'administrador')
   LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'insufficient permission' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.nps_pesquisas p
     WHERE p.id = p_pesquisa_id
       AND p.company_id = v_company
       AND p.lg_ativo IS TRUE
       AND p.dt_inicio <= CURRENT_DATE
       AND (p.dt_fim IS NULL OR p.dt_fim >= CURRENT_DATE)
  ) THEN
    RAISE EXCEPTION 'survey unavailable' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.patients patient
     WHERE patient.id = p_paciente_id
       AND patient.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'patient unavailable' USING ERRCODE = 'P0002';
  END IF;

  IF p_appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.appointments appointment
     WHERE appointment.id = p_appointment_id
       AND appointment.patient_id = p_paciente_id
       AND appointment.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'appointment unavailable' USING ERRCODE = 'P0002';
  END IF;

  -- 256 bits of entropy. Only the SHA-256 digest is persisted.
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := extensions.digest(v_token, 'sha256');

  INSERT INTO public.nps_convites (
    company_id,
    cd_pesquisa,
    cd_paciente,
    cd_appointment,
    token_hash,
    ds_origem,
    expires_at,
    created_by
  )
  VALUES (
    v_company,
    p_pesquisa_id,
    p_paciente_id,
    p_appointment_id,
    v_token_hash,
    p_origem,
    clock_timestamp() + p_ttl,
    v_actor
  );

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_nps_survey_public(p_token TEXT)
RETURNS TABLE (
  ds_titulo VARCHAR(200),
  ds_descricao TEXT,
  cd_template_perguntas JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.ds_titulo, p.ds_descricao, p.cd_template_perguntas
    FROM public.nps_convites c
    JOIN public.nps_pesquisas p ON p.id = c.cd_pesquisa
   WHERE c.token_hash = extensions.digest(p_token, 'sha256')
     AND c.used_at IS NULL
     AND c.revoked_at IS NULL
     AND c.expires_at > clock_timestamp()
     AND p.lg_ativo IS TRUE
     AND p.dt_inicio <= CURRENT_DATE
     AND (p.dt_fim IS NULL OR p.dt_fim >= CURRENT_DATE)
   LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_nps_response_public(
  p_token TEXT,
  p_nota SMALLINT,
  p_comentario TEXT DEFAULT NULL,
  p_respostas JSONB DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_convite public.nps_convites%ROWTYPE;
  v_resposta_id BIGINT;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'survey link unavailable' USING ERRCODE = '22023';
  END IF;

  IF p_nota IS NULL OR p_nota < 0 OR p_nota > 10 THEN
    RAISE EXCEPTION 'invalid NPS score' USING ERRCODE = '22023';
  END IF;

  IF p_comentario IS NOT NULL AND length(p_comentario) > 2000 THEN
    RAISE EXCEPTION 'comment too long' USING ERRCODE = '22001';
  END IF;

  SELECT c.*
    INTO v_convite
    FROM public.nps_convites c
   WHERE c.token_hash = extensions.digest(p_token, 'sha256')
   FOR UPDATE;

  IF NOT FOUND
     OR v_convite.used_at IS NOT NULL
     OR v_convite.revoked_at IS NOT NULL
     OR v_convite.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'survey link unavailable' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.nps_pesquisas p
     WHERE p.id = v_convite.cd_pesquisa
       AND p.company_id = v_convite.company_id
       AND p.lg_ativo IS TRUE
       AND p.dt_inicio <= CURRENT_DATE
       AND (p.dt_fim IS NULL OR p.dt_fim >= CURRENT_DATE)
  ) THEN
    RAISE EXCEPTION 'survey link unavailable' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.nps_respostas (
    cd_pesquisa,
    cd_paciente,
    cd_appointment,
    nr_nota_nps,
    ds_comentario,
    ds_origem,
    ds_respostas
  )
  VALUES (
    v_convite.cd_pesquisa,
    v_convite.cd_paciente,
    v_convite.cd_appointment,
    p_nota,
    NULLIF(btrim(p_comentario), ''),
    v_convite.ds_origem,
    p_respostas
  )
  RETURNING id INTO v_resposta_id;

  UPDATE public.nps_convites
     SET used_at = clock_timestamp()
   WHERE id = v_convite.id
     AND used_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'survey link unavailable' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_resposta_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'survey link unavailable' USING ERRCODE = 'P0002';
END;
$$;

REVOKE ALL ON FUNCTION public.create_nps_invitation_secure(BIGINT, BIGINT, BIGINT, TEXT, INTERVAL) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_nps_survey_public(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_nps_response_public(TEXT, SMALLINT, TEXT, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_nps_invitation_secure(BIGINT, BIGINT, BIGINT, TEXT, INTERVAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_nps_survey_public(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_nps_response_public(TEXT, SMALLINT, TEXT, JSONB) TO anon, authenticated;

COMMENT ON TABLE public.nps_convites IS
  'Single-use NPS invitations. Stores only SHA-256 token digests; raw tokens are returned once.';
COMMENT ON FUNCTION public.submit_nps_response_public(TEXT, SMALLINT, TEXT, JSONB) IS
  'Atomically validates and consumes an opaque NPS invitation before recording the response.';

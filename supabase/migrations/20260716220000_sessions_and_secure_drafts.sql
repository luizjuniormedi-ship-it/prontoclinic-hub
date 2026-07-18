-- Migration: 20260716220000_sessions_and_secure_drafts
-- Fundação auditável de dispositivos/sessões da aplicação e rascunhos clínicos.
-- Não replica GoTrue e nunca persiste access/refresh tokens. O session_id do JWT,
-- quando presente, é apenas um vínculo auditável opaco com auth.sessions.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'supabase_vault') THEN
    CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
  END IF;
END;
$$;

-- Provisionamento operacional (uma vez, pelo SQL Editor/automação privilegiada):
-- SELECT vault.create_secret('<segredo forte>', 'secure_clinical_drafts_key');
-- O valor deliberadamente não faz parte da migration nem de qualquer bundle web.

-- ---------------------------------------------------------------------------
-- Dispositivos e sessões da camada de aplicação
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  client_device_id UUID NOT NULL,
  display_name TEXT,
  platform TEXT,
  user_agent TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revocation_reason TEXT,
  CONSTRAINT application_devices_user_company_client_key UNIQUE (user_id, company_id, client_device_id),
  CONSTRAINT application_devices_display_name_len CHECK (display_name IS NULL OR length(display_name) <= 200),
  CONSTRAINT application_devices_platform_len CHECK (platform IS NULL OR length(platform) <= 100),
  CONSTRAINT application_devices_user_agent_len CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  CONSTRAINT application_devices_revocation_consistent CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
    OR revoked_at IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.application_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  device_id UUID NOT NULL REFERENCES public.application_devices(id) ON DELETE CASCADE,
  gotrue_session_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idle_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  absolute_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '12 hours'),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revocation_reason TEXT,
  CONSTRAINT application_sessions_gotrue_device_key
    UNIQUE (user_id, gotrue_session_id, device_id),
  CONSTRAINT application_sessions_expiration_order CHECK (
    created_at <= idle_expires_at AND idle_expires_at <= absolute_expires_at
  ),
  CONSTRAINT application_sessions_revocation_consistent CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
    OR revoked_at IS NOT NULL
  )
);

-- Upgrades intermediários podem ter deixado a unidade obrigatória. Contextos
-- corporativos legitimamente não selecionam unidade.
ALTER TABLE public.application_devices ALTER COLUMN unit_id DROP NOT NULL;
ALTER TABLE public.application_sessions ALTER COLUMN unit_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS application_devices_user_active_idx
  ON public.application_devices(user_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS application_sessions_user_active_idx
  ON public.application_sessions(user_id, last_activity_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS application_sessions_device_idx ON public.application_sessions(device_id);

ALTER TABLE public.application_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS application_devices_select_own ON public.application_devices;
CREATE POLICY application_devices_select_own
ON public.application_devices FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  AND company_id = public.active_company_id()
  AND unit_id IS NOT DISTINCT FROM public.active_unit_id()
);

DROP POLICY IF EXISTS application_sessions_select_own ON public.application_sessions;
CREATE POLICY application_sessions_select_own
ON public.application_sessions FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  AND company_id = public.active_company_id()
  AND unit_id IS NOT DISTINCT FROM public.active_unit_id()
);

-- As tabelas são intencionalmente RPC-only. As policies permanecem como defesa em
-- profundidade caso um grant seja adicionado no futuro.
REVOKE ALL ON public.application_devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.application_sessions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_application_session_allowed(
  p_session_id UUID,
  p_client_device_id UUID,
  p_unit_id INTEGER DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.application_sessions s
    JOIN public.application_devices d ON d.id = s.device_id
    JOIN public.user_profiles up ON up.id = auth.uid()
    JOIN public.user_access_context ctx
      ON ctx.user_id = s.user_id
     AND ctx.session_id = s.gotrue_session_id
    JOIN public.memberships m
      ON m.id = ctx.membership_id
     AND m.user_id = ctx.user_id
     AND m.company_id = s.company_id
     AND m.status = 'active'
    JOIN public.membership_roles mr
      ON mr.membership_id = ctx.membership_id
     AND mr.role_id = ctx.role_id
    JOIN public.roles r ON r.id = ctx.role_id AND r.lg_ativo = TRUE
    LEFT JOIN public.membership_units mu
      ON mu.membership_id = ctx.membership_id
     AND mu.unit_id = ctx.unit_id
    LEFT JOIN public.units u
      ON u.id = s.unit_id
     AND u.company_id = s.company_id
     AND u.lg_ativo = TRUE
    WHERE s.id = p_session_id
      AND s.user_id = auth.uid()
      AND d.user_id = auth.uid()
      AND d.client_device_id = p_client_device_id
      AND s.gotrue_session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
      AND d.company_id = s.company_id
      AND d.unit_id IS NOT DISTINCT FROM s.unit_id
      AND ctx.unit_id IS NOT DISTINCT FROM s.unit_id
      AND public.request_aal() = 'aal2'
      AND (
        (ctx.unit_id IS NULL AND lower(r.name) IN (
          'admin', 'administrador', 'gestor', 'financeiro', 'auditor',
          'dpo', 'superadmin', 'super_admin'
        ))
        OR (ctx.unit_id IS NOT NULL AND mu.unit_id IS NOT NULL AND u.id IS NOT NULL)
      )
      AND up.lg_ativo = TRUE
      AND d.revoked_at IS NULL
      AND s.revoked_at IS NULL
      AND s.idle_expires_at > now()
      AND s.absolute_expires_at > now()
      AND (p_unit_id IS NULL OR s.unit_id = p_unit_id)
  ), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.register_application_session(
  p_client_device_id UUID,
  p_unit_id INTEGER,
  p_display_name TEXT,
  p_platform TEXT,
  p_user_agent TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_profile public.user_profiles%ROWTYPE;
  v_device public.application_devices%ROWTYPE;
  v_session public.application_sessions%ROWTYPE;
  v_gotrue_session_id UUID;
  v_company_id UUID;
  v_context_unit_id INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile
  FROM public.user_profiles
  WHERE id = auth.uid() AND lg_ativo = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil ativo é obrigatório' USING ERRCODE = '42501';
  END IF;

  IF public.request_aal() IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 é obrigatório para registrar sessão'
      USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_gotrue_session_id := NULLIF(auth.jwt()->>'session_id', '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'session_id inválido no JWT' USING ERRCODE = '22023';
  END;
  IF v_gotrue_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id é obrigatório no JWT' USING ERRCODE = '42501';
  END IF;

  SELECT m.company_id, ctx.unit_id
  INTO v_company_id, v_context_unit_id
  FROM public.user_access_context ctx
  JOIN public.memberships m
    ON m.id = ctx.membership_id
   AND m.user_id = ctx.user_id
   AND m.status = 'active'
  JOIN public.membership_roles mr
    ON mr.membership_id = ctx.membership_id
   AND mr.role_id = ctx.role_id
  JOIN public.roles r ON r.id = ctx.role_id AND r.lg_ativo = TRUE
  LEFT JOIN public.membership_units mu
    ON mu.membership_id = ctx.membership_id
   AND mu.unit_id = ctx.unit_id
  LEFT JOIN public.units u
    ON u.id = ctx.unit_id
   AND u.company_id = m.company_id
   AND u.lg_ativo = TRUE
  WHERE ctx.user_id = auth.uid()
    AND ctx.session_id = v_gotrue_session_id
    AND (
      (ctx.unit_id IS NULL AND lower(r.name) IN (
        'admin', 'administrador', 'gestor', 'financeiro', 'auditor',
        'dpo', 'superadmin', 'super_admin'
      ))
      OR (ctx.unit_id IS NOT NULL AND mu.unit_id IS NOT NULL AND u.id IS NOT NULL)
    );

  IF v_company_id IS NULL OR v_context_unit_id IS DISTINCT FROM p_unit_id THEN
    RAISE EXCEPTION 'Contexto AAL2 de empresa/unidade não selecionado ou divergente'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.application_devices (
    user_id, company_id, unit_id, client_device_id,
    display_name, platform, user_agent
  ) VALUES (
    auth.uid(), v_company_id, p_unit_id, p_client_device_id,
    NULLIF(trim(p_display_name), ''), NULLIF(trim(p_platform), ''),
    NULLIF(left(p_user_agent, 1000), '')
  )
  ON CONFLICT (user_id, company_id, client_device_id) DO UPDATE
  SET unit_id = EXCLUDED.unit_id,
      display_name = EXCLUDED.display_name,
      platform = EXCLUDED.platform,
      user_agent = EXCLUDED.user_agent,
      last_seen_at = now()
  WHERE application_devices.revoked_at IS NULL
  RETURNING * INTO v_device;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispositivo revogado ou fora do tenant' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.application_sessions (
    user_id, company_id, unit_id, device_id, gotrue_session_id
  ) VALUES (
    auth.uid(), v_company_id, p_unit_id, v_device.id, v_gotrue_session_id
  )
  ON CONFLICT (user_id, gotrue_session_id, device_id) DO UPDATE
  SET company_id = EXCLUDED.company_id,
      unit_id = EXCLUDED.unit_id,
      last_activity_at = now(),
      idle_expires_at = LEAST(now() + interval '30 minutes', application_sessions.absolute_expires_at)
  WHERE application_sessions.revoked_at IS NULL
    AND application_sessions.absolute_expires_at > now()
  RETURNING * INTO v_session;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão da aplicação expirada ou revogada' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'device_id', v_device.id,
    'idle_expires_at', v_session.idle_expires_at,
    'absolute_expires_at', v_session.absolute_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_application_context(
  p_membership_id UUID,
  p_role_id INTEGER,
  p_unit_id INTEGER,
  p_client_device_id UUID,
  p_display_name TEXT,
  p_platform TEXT,
  p_user_agent TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_context public.user_access_context%ROWTYPE;
  v_registration JSONB;
BEGIN
  -- As duas chamadas participam da mesma transação. Qualquer falha no registro
  -- da sessão desfaz também a seleção de contexto.
  SELECT * INTO v_context
  FROM public.set_access_context(p_membership_id, p_role_id, p_unit_id);

  v_registration := public.register_application_session(
    p_client_device_id, p_unit_id, p_display_name, p_platform, p_user_agent
  );

  RETURN v_registration || jsonb_build_object(
    'company_id', (SELECT company_id FROM public.memberships WHERE id = v_context.membership_id),
    'membership_id', v_context.membership_id,
    'role_id', v_context.role_id,
    'unit_id', v_context.unit_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_application_session(
  p_session_id UUID,
  p_client_device_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  UPDATE public.application_sessions s
  SET revoked_at = now(),
      revoked_by = auth.uid(),
      revocation_reason = CASE
        WHEN s.absolute_expires_at <= now() THEN 'absolute_timeout'
        ELSE 'idle_timeout'
      END
  FROM public.application_devices d
  WHERE s.id = p_session_id
    AND s.device_id = d.id
    AND s.user_id = auth.uid()
    AND s.gotrue_session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
    AND d.client_device_id = p_client_device_id
    AND s.revoked_at IS NULL
    AND (s.idle_expires_at <= now() OR s.absolute_expires_at <= now());

  DELETE FROM public.user_access_context ctx
  WHERE ctx.user_id = auth.uid()
    AND ctx.session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
    AND EXISTS (
      SELECT 1 FROM public.application_sessions s
      WHERE s.id = p_session_id
        AND s.user_id = ctx.user_id
        AND s.gotrue_session_id = ctx.session_id
        AND (s.revoked_at IS NOT NULL OR s.idle_expires_at <= now() OR s.absolute_expires_at <= now())
    );

  UPDATE public.application_sessions s
  SET last_activity_at = now(),
      idle_expires_at = LEAST(now() + interval '30 minutes', s.absolute_expires_at)
  FROM public.application_devices d
  WHERE s.id = p_session_id
    AND s.device_id = d.id
    AND s.user_id = auth.uid()
    AND s.gotrue_session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
    AND d.user_id = auth.uid()
    AND d.client_device_id = p_client_device_id
    AND d.revoked_at IS NULL
    AND s.revoked_at IS NULL
    AND s.idle_expires_at > now()
    AND s.absolute_expires_at > now();

  IF FOUND THEN
    UPDATE public.application_devices
    SET last_seen_at = now()
    WHERE id = (SELECT device_id FROM public.application_sessions WHERE id = p_session_id);
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_application_session(
  p_session_id UUID,
  p_reason TEXT DEFAULT 'user_revoked'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_revoked BOOLEAN;
BEGIN
  UPDATE public.application_sessions
  SET revoked_at = COALESCE(revoked_at, now()),
      revoked_by = COALESCE(revoked_by, auth.uid()),
      revocation_reason = COALESCE(revocation_reason, NULLIF(left(trim(p_reason), 500), ''))
  WHERE id = p_session_id AND user_id = auth.uid();
  v_revoked := FOUND;
  DELETE FROM public.user_access_context ctx
  USING public.application_sessions s
  WHERE s.id = p_session_id
    AND s.user_id = auth.uid()
    AND ctx.user_id = s.user_id
    AND ctx.session_id = s.gotrue_session_id;
  RETURN v_revoked;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_all_application_sessions(
  p_reason TEXT DEFAULT 'global_logout'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  UPDATE public.application_sessions
  SET revoked_at = COALESCE(revoked_at, now()),
      revoked_by = COALESCE(revoked_by, auth.uid()),
      revocation_reason = COALESCE(revocation_reason, NULLIF(left(trim(p_reason), 500), ''))
  WHERE user_id = auth.uid() AND revoked_at IS NULL;
  DELETE FROM public.user_access_context WHERE user_id = auth.uid();
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_application_device(
  p_device_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  UPDATE public.application_devices
  SET revoked_at = COALESCE(revoked_at, now()),
      revoked_by = COALESCE(revoked_by, auth.uid()),
      revocation_reason = COALESCE(revocation_reason, NULLIF(left(trim(p_reason), 500), ''), 'user_revoked')
  WHERE id = p_device_id AND user_id = auth.uid();
  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE public.application_sessions
  SET revoked_at = COALESCE(revoked_at, now()),
      revoked_by = COALESCE(revoked_by, auth.uid()),
      revocation_reason = COALESCE(revocation_reason, 'device_revoked')
  WHERE device_id = p_device_id AND user_id = auth.uid() AND revoked_at IS NULL;
  DELETE FROM public.user_access_context ctx
  USING public.application_sessions s
  WHERE s.device_id = p_device_id
    AND s.user_id = auth.uid()
    AND ctx.user_id = s.user_id
    AND ctx.session_id = s.gotrue_session_id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_application_devices()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'client_device_id', d.client_device_id,
    'unit_id', d.unit_id,
    'display_name', d.display_name,
    'platform', d.platform,
    'first_seen_at', d.first_seen_at,
    'last_seen_at', d.last_seen_at,
    'revoked_at', d.revoked_at,
    'revocation_reason', d.revocation_reason,
    'active_sessions', (
      SELECT count(*) FROM public.application_sessions s
      WHERE s.device_id = d.id AND s.revoked_at IS NULL
        AND s.idle_expires_at > now() AND s.absolute_expires_at > now()
    )
  ) ORDER BY d.last_seen_at DESC), '[]'::jsonb)
  FROM public.application_devices d
  WHERE d.user_id = auth.uid()
    AND d.company_id = public.active_company_id()
    AND d.unit_id IS NOT DISTINCT FROM public.active_unit_id();
$$;

CREATE OR REPLACE FUNCTION public.current_application_session_is_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.application_sessions s
    JOIN public.application_devices d ON d.id = s.device_id
    JOIN public.user_access_context ctx
      ON ctx.user_id = s.user_id
     AND ctx.session_id = s.gotrue_session_id
     AND ctx.unit_id IS NOT DISTINCT FROM s.unit_id
    JOIN public.memberships m
      ON m.id = ctx.membership_id
     AND m.user_id = ctx.user_id
     AND m.company_id = s.company_id
     AND m.status = 'active'
    JOIN public.membership_roles mr
      ON mr.membership_id = ctx.membership_id
     AND mr.role_id = ctx.role_id
    JOIN public.roles r ON r.id = ctx.role_id AND r.lg_ativo = TRUE
    LEFT JOIN public.membership_units mu
      ON mu.membership_id = ctx.membership_id AND mu.unit_id = ctx.unit_id
    LEFT JOIN public.units u
      ON u.id = ctx.unit_id AND u.company_id = m.company_id AND u.lg_ativo = TRUE
    WHERE s.user_id = auth.uid()
      AND s.gotrue_session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
      AND public.request_aal() = 'aal2'
      AND d.user_id = s.user_id
      AND d.company_id = s.company_id
      AND d.unit_id IS NOT DISTINCT FROM s.unit_id
      AND d.revoked_at IS NULL
      AND s.revoked_at IS NULL
      AND s.idle_expires_at > now()
      AND s.absolute_expires_at > now()
      AND (
        (ctx.unit_id IS NULL AND lower(r.name) IN (
          'admin', 'administrador', 'gestor', 'financeiro', 'auditor',
          'dpo', 'superadmin', 'super_admin'
        ))
        OR (ctx.unit_id IS NOT NULL AND mu.unit_id IS NOT NULL AND u.id IS NOT NULL)
      )
  ), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.active_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT m.company_id
  FROM public.user_access_context ctx
  JOIN public.memberships m
    ON m.id = ctx.membership_id
   AND m.user_id = ctx.user_id
   AND m.status = 'active'
  WHERE ctx.user_id = auth.uid()
    AND ctx.session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
    AND public.current_application_session_is_active();
$$;

CREATE OR REPLACE FUNCTION public.active_unit_id()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT ctx.unit_id
  FROM public.user_access_context ctx
  WHERE ctx.user_id = auth.uid()
    AND ctx.session_id = NULLIF(auth.jwt()->>'session_id', '')::UUID
    AND public.current_application_session_is_active();
$$;

-- A Admin API do GoTrue é obrigatória para encerrar uma sessão remota específica.
-- Esta migration revoga o contexto da aplicação imediatamente; uma Edge Function
-- deve complementar a revogação quando for necessário invalidar o refresh token.
COMMENT ON FUNCTION public.revoke_application_device(UUID, TEXT) IS
  'Revoga dispositivo e sessões no contexto da aplicação. Revogação individual do refresh token GoTrue requer Edge Function/Admin API.';

-- ---------------------------------------------------------------------------
-- Rascunhos clínicos cifrados no servidor
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.secure_clinical_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL,
  context_id TEXT NOT NULL,
  content_ciphertext BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT secure_drafts_context_type_chk CHECK (
    context_type IN ('patient', 'appointment', 'encounter', 'medical_record', 'clinical_note')
  ),
  CONSTRAINT secure_drafts_context_id_chk CHECK (length(trim(context_id)) BETWEEN 1 AND 200),
  CONSTRAINT secure_drafts_expiration_chk CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS secure_clinical_drafts_owner_context_idx
  ON public.secure_clinical_drafts(user_id, company_id, unit_id, context_type, context_id);
CREATE INDEX IF NOT EXISTS secure_clinical_drafts_expiry_idx ON public.secure_clinical_drafts(expires_at);

ALTER TABLE public.secure_clinical_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS secure_clinical_drafts_owner_scope ON public.secure_clinical_drafts;
CREATE POLICY secure_clinical_drafts_owner_scope
ON public.secure_clinical_drafts FOR ALL TO authenticated
USING (
  user_id = auth.uid()
  AND company_id = public.active_company_id()
  AND unit_id = public.active_unit_id()
  AND expires_at > now()
)
WITH CHECK (
  user_id = auth.uid()
  AND company_id = public.active_company_id()
  AND unit_id = public.active_unit_id()
);

REVOKE ALL ON public.secure_clinical_drafts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.secure_clinical_draft_key()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = vault, public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'secure_clinical_drafts_key'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_key IS NULL OR octet_length(v_key) < 32 THEN
    RAISE EXCEPTION 'Chave de rascunhos ausente ou inválida no Supabase Vault'
      USING ERRCODE = '55000';
  END IF;
  RETURN v_key;
END;
$$;
REVOKE ALL ON FUNCTION public.secure_clinical_draft_key() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_secure_clinical_draft(
  p_session_id UUID,
  p_client_device_id UUID,
  p_draft_id UUID,
  p_unit_id INTEGER,
  p_context_type TEXT,
  p_context_id TEXT,
  p_content JSONB,
  p_ttl_minutes INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
SET row_security = off
AS $$
DECLARE
  v_company_id UUID;
  v_id UUID;
  v_created_at TIMESTAMPTZ;
  v_updated_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_ciphertext BYTEA;
BEGIN
  IF NOT public.is_application_session_allowed(p_session_id, p_client_device_id, p_unit_id) THEN
    RAISE EXCEPTION 'Sessão da aplicação inválida, expirada ou revogada' USING ERRCODE = '42501';
  END IF;
  IF p_context_type NOT IN ('patient', 'appointment', 'encounter', 'medical_record', 'clinical_note')
     OR length(trim(COALESCE(p_context_id, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Contexto clínico inválido' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'object'
     OR octet_length(p_content::TEXT) > 1048576 THEN
    RAISE EXCEPTION 'Conteúdo deve ser objeto JSON de até 1 MiB' USING ERRCODE = '22023';
  END IF;
  IF p_ttl_minutes NOT BETWEEN 5 AND 120 THEN
    RAISE EXCEPTION 'TTL deve estar entre 5 e 120 minutos' USING ERRCODE = '22023';
  END IF;

  SELECT company_id INTO v_company_id
  FROM public.application_sessions
  WHERE id = p_session_id AND user_id = auth.uid() AND unit_id = p_unit_id;

  v_ciphertext := pgp_sym_encrypt(
    p_content::TEXT,
    public.secure_clinical_draft_key(),
    'cipher-algo=aes256, compress-algo=1'
  );

  IF p_draft_id IS NULL THEN
    INSERT INTO public.secure_clinical_drafts (
      user_id, company_id, unit_id, context_type, context_id,
      content_ciphertext, expires_at
    ) VALUES (
      auth.uid(), v_company_id, p_unit_id, p_context_type, trim(p_context_id),
      v_ciphertext, now() + make_interval(mins => p_ttl_minutes)
    )
    RETURNING id, created_at, updated_at, expires_at
      INTO v_id, v_created_at, v_updated_at, v_expires_at;
  ELSE
    UPDATE public.secure_clinical_drafts
    SET content_ciphertext = v_ciphertext,
        updated_at = now(),
        expires_at = now() + make_interval(mins => p_ttl_minutes)
    WHERE id = p_draft_id
      AND user_id = auth.uid()
      AND company_id = v_company_id
      AND unit_id = p_unit_id
      AND context_type = p_context_type
      AND context_id = trim(p_context_id)
      AND expires_at > now()
    RETURNING id, created_at, updated_at, expires_at
      INTO v_id, v_created_at, v_updated_at, v_expires_at;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Rascunho não encontrado no escopo informado' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'unit_id', p_unit_id,
    'context_type', p_context_type,
    'context_id', trim(p_context_id),
    'created_at', v_created_at,
    'updated_at', v_updated_at,
    'expires_at', v_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_secure_clinical_draft(
  p_session_id UUID,
  p_client_device_id UUID,
  p_draft_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
SET row_security = off
AS $$
DECLARE
  v_draft public.secure_clinical_drafts%ROWTYPE;
  v_content JSONB;
BEGIN
  IF NOT public.is_application_session_allowed(p_session_id, p_client_device_id) THEN
    RAISE EXCEPTION 'Sessão da aplicação inválida, expirada ou revogada' USING ERRCODE = '42501';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.secure_clinical_drafts d
  JOIN public.application_sessions s
    ON s.id = p_session_id AND s.unit_id = d.unit_id AND s.company_id = d.company_id
  WHERE d.id = p_draft_id
    AND d.user_id = auth.uid()
    AND s.user_id = auth.uid()
    AND d.expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rascunho não encontrado ou expirado' USING ERRCODE = 'P0002';
  END IF;

  v_content := pgp_sym_decrypt(
    v_draft.content_ciphertext,
    public.secure_clinical_draft_key()
  )::JSONB;

  RETURN jsonb_build_object(
    'id', v_draft.id,
    'unit_id', v_draft.unit_id,
    'context_type', v_draft.context_type,
    'context_id', v_draft.context_id,
    'content', v_content,
    'created_at', v_draft.created_at,
    'updated_at', v_draft.updated_at,
    'expires_at', v_draft.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_secure_clinical_drafts(
  p_session_id UUID,
  p_client_device_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_application_session_allowed(p_session_id, p_client_device_id) THEN
    RAISE EXCEPTION 'Sessão da aplicação inválida, expirada ou revogada' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'unit_id', d.unit_id,
    'context_type', d.context_type,
    'context_id', d.context_id,
    'created_at', d.created_at,
    'updated_at', d.updated_at,
    'expires_at', d.expires_at
  ) ORDER BY d.updated_at DESC), '[]'::jsonb)
  INTO v_result
  FROM public.secure_clinical_drafts d
  JOIN public.application_sessions s
    ON s.id = p_session_id AND s.unit_id = d.unit_id AND s.company_id = d.company_id
  WHERE d.user_id = auth.uid() AND d.expires_at > now();

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_secure_clinical_draft(
  p_session_id UUID,
  p_client_device_id UUID,
  p_draft_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF NOT public.is_application_session_allowed(p_session_id, p_client_device_id) THEN
    RAISE EXCEPTION 'Sessão da aplicação inválida, expirada ou revogada' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.secure_clinical_drafts d
  USING public.application_sessions s
  WHERE d.id = p_draft_id
    AND d.user_id = auth.uid()
    AND s.id = p_session_id
    AND s.user_id = auth.uid()
    AND s.company_id = d.company_id
    AND s.unit_id = d.unit_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_secure_clinical_drafts()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_deleted BIGINT;
BEGIN
  DELETE FROM public.secure_clinical_drafts WHERE expires_at <= now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Funções públicas são fechadas por padrão e liberadas apenas para os papéis
-- necessários. A função da chave e a limpeza jamais ficam disponíveis ao browser.
REVOKE ALL ON FUNCTION public.is_application_session_allowed(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_application_session(UUID, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_application_context(UUID, INTEGER, INTEGER, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_application_session_is_active() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_access_context(UUID, INTEGER, INTEGER) FROM authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_application_session(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_application_session(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_all_application_sessions(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_application_device(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_application_devices() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_secure_clinical_draft(UUID, UUID, UUID, INTEGER, TEXT, TEXT, JSONB, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_secure_clinical_draft(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_secure_clinical_drafts(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_secure_clinical_draft(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_secure_clinical_drafts() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_application_session_allowed(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_application_context(UUID, INTEGER, INTEGER, UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_application_session(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_application_session(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_all_application_sessions(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_application_device(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_application_devices() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_secure_clinical_draft(UUID, UUID, UUID, INTEGER, TEXT, TEXT, JSONB, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_secure_clinical_draft(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_secure_clinical_drafts(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_secure_clinical_draft(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_secure_clinical_drafts() TO service_role;

COMMENT ON TABLE public.secure_clinical_drafts IS
  'Rascunhos clínicos temporários; somente ciphertext pgcrypto. A chave reside no Supabase Vault.';
COMMENT ON FUNCTION public.secure_clinical_draft_key() IS
  'Leitor interno da chave no Vault; sem EXECUTE para anon/authenticated.';

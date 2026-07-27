BEGIN;

DO $$
BEGIN
  IF to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'Required schema private is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'app_prontomedic'
  ) THEN
    RAISE EXCEPTION 'Required backend role app_prontomedic is missing';
  END IF;
END;
$$;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE CREATE ON SCHEMA private FROM app_prontomedic;
GRANT USAGE ON SCHEMA private TO app_prontomedic;

CREATE OR REPLACE FUNCTION private.lookup_auth_user(p_identifier TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  encrypted_password TEXT,
  email_confirmed_at TIMESTAMPTZ,
  raw_app_meta_data JSONB,
  raw_user_meta_data JSONB,
  company_id UUID,
  lg_ativo BOOLEAN,
  must_change_password BOOLEAN,
  password_expires_at TIMESTAMPTZ,
  mfa_required BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, auth, public, private
AS $function$
  WITH normalized_identifier AS (
    SELECT
      lower(btrim(COALESCE(p_identifier, ''))) AS lookup_text,
      regexp_replace(COALESCE(p_identifier, ''), '\D', '', 'g') AS lookup_cpf
  ),
  candidates AS (
    SELECT
      users.id,
      users.email::TEXT,
      users.encrypted_password::TEXT,
      users.email_confirmed_at,
      users.raw_app_meta_data,
      users.raw_user_meta_data,
      profiles.company_id,
      profiles.lg_ativo,
      COALESCE(security.must_change_password, FALSE) AS must_change_password,
      security.password_expires_at,
      COALESCE(security.mfa_required, FALSE) AS mfa_required
    FROM auth.users AS users
    JOIN public.user_profiles AS profiles ON profiles.id = users.id
    LEFT JOIN public.auth_account_security AS security
      ON security.user_id = users.id
    CROSS JOIN normalized_identifier AS identifier
    WHERE identifier.lookup_text <> ''
      AND (
        lower(users.email) = identifier.lookup_text
        OR lower(COALESCE(users.raw_user_meta_data->>'username', '')) =
          identifier.lookup_text
        OR (
          length(identifier.lookup_cpf) = 11
          AND (
            regexp_replace(COALESCE(profiles.cpf, ''), '\D', '', 'g') =
              identifier.lookup_cpf
            OR regexp_replace(
              COALESCE(users.raw_user_meta_data->>'cpf', ''),
              '\D',
              '',
              'g'
            ) = identifier.lookup_cpf
          )
        )
      )
      AND profiles.lg_ativo IS TRUE
      AND profiles.blocked_at IS NULL
      AND (
        profiles.access_valid_until IS NULL
        OR profiles.access_valid_until > now()
      )
      AND (
        security.account_locked_until IS NULL
        OR security.account_locked_until <= now()
      )
  )
  SELECT candidates.*
  FROM candidates
  WHERE (SELECT count(*) FROM candidates) = 1;
$function$;

ALTER FUNCTION private.lookup_auth_user(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.lookup_auth_user(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.lookup_auth_user(TEXT) TO app_prontomedic;

COMMIT;

-- Harden the legacy first-access helper. It is an internal service operation,
-- never a browser-callable public API.
CREATE OR REPLACE FUNCTION public.create_password_reset(
  p_user_id UUID,
  p_ttl_hours INTEGER DEFAULT 72,
  p_ip INET DEFAULT NULL
)
RETURNS VARCHAR(64)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token VARCHAR(64);
BEGIN
  IF p_ttl_hours IS NULL OR p_ttl_hours < 1 OR p_ttl_hours > 168 THEN
    RAISE EXCEPTION 'invalid password reset TTL';
  END IF;
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.password_resets (user_id, token, dt_exp, ip_origem)
  VALUES (p_user_id, v_token, NOW() + (p_ttl_hours || ' hours')::INTERVAL, p_ip);
  RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_password_reset(UUID, INTEGER, INET) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_password_reset(UUID, INTEGER, INET) TO service_role;

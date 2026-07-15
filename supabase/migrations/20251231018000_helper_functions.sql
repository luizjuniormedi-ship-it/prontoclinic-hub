-- Helper functions used by RLS policies
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = p_user_id AND up.role_name IN ('admin', 'ADMIN', 'ADMINISTRADOR')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cid UUID;
BEGIN
  SELECT up.company_id INTO v_cid
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
  LIMIT 1;
  RETURN v_cid;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_staff(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = p_user_id AND up.role_name IN ('admin', 'médico', 'enfermeiro', 'recepcao', 'ADMIN', 'MEDICO', 'ENFERMEIRO', 'RECEPCAO')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.current_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;

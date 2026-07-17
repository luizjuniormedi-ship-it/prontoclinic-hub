-- Alinha os helpers legados ao mesmo identificador de identidade usado pelo
-- restante das policies: user_profiles.id = auth.uid().
-- Não usa user_profiles.user_id como fallback: misturar os dois identificadores
-- pode atribuir permissões de um usuário a outro perfil.

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.get_my_company_id();
$$;

CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = p_user_id
      AND upper(COALESCE(up.role_name, '')) IN ('ADMIN', 'ADMINISTRADOR')
      AND up.lg_ativo = TRUE
  ), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.is_staff(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = p_user_id
      AND upper(COALESCE(up.role_name, '')) IN (
        'ADMIN', 'ADMINISTRADOR', 'MEDICO', 'ENFERMEIRO', 'RECEPCAO'
      )
      AND up.lg_ativo = TRUE
  ), FALSE);
$$;

COMMENT ON FUNCTION public.current_company_id() IS
  'Compatibilidade legada: retorna o mesmo tenant de get_my_company_id().';
COMMENT ON FUNCTION public.is_admin(UUID) IS
  'Verifica admin pelo perfil cujo id corresponde a auth.uid().';
COMMENT ON FUNCTION public.is_staff(UUID) IS
  'Verifica equipe pelo perfil cujo id corresponde a auth.uid().';

REVOKE ALL ON FUNCTION public.current_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;
REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.is_staff(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff(UUID) TO authenticated;

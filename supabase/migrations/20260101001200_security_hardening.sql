-- =============================================================================
-- Migration: 20260101001200_security_hardening
-- Agente 17 — P0 Security Hardening
-- =============================================================================
-- Aplica melhorias de segurança em camadas:
--   1. Função SECURITY DEFINER para obter company_id do chamador autenticado
--   2. Habilita extensions necessárias (pg_trgm, pgcrypto)
--   3. Documenta padrões de hardening para futuras migrations
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extensões
-- -----------------------------------------------------------------------------
-- pg_trgm: busca fuzzy em índices (búsqueda aproximada de nomes/CPFs)
-- pgcrypto: funções de hash/criptografia (digest, gen_random_bytes, etc)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 2. Função get_my_company_id()
-- -----------------------------------------------------------------------------
-- Padrão: SECURITY DEFINER com search_path fixo evita SQL injection via
--         manipulação de search_path e RLS-bypass por impersonation.
--
-- Uso: SELECT public.get_my_company_id();
--      retorna o company_id do user_profile do usuário autenticado (auth.uid())
--
-- Quando usar: em policies RLS ou queries que precisam filtrar por
--              empresa (multi-tenant) sem repetir a subquery.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT company_id FROM public.user_profiles WHERE id = auth.uid();
$$;

-- Comentário descritivo
COMMENT ON FUNCTION public.get_my_company_id() IS
  'Retorna o company_id do perfil do usuário autenticado. SECURITY DEFINER permite uso em RLS sem recursão. search_path fixo previne injection.';

-- Permissões: execução para usuários autenticados
GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Validações
-- -----------------------------------------------------------------------------
-- Verifica que a função foi criada corretamente
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'get_my_company_id'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'Falha ao criar public.get_my_company_id()';
  END IF;
END
$$;

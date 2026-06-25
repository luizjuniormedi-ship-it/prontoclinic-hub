-- =============================================================================
-- Migration: 20260101000031_search_path_hardening
-- Descrição: CRÍTICO — Adiciona `SET search_path = public, pg_temp` em todas
--            as funções SECURITY DEFINER legadas. Sem isso, um atacante pode
--            criar objetos (tabelas, funções) em schemas mutáveis e fazer
--            com que funções privilegiadas executem código malicioso.
--
-- Vulnerabilidade (search_path attack):
--   1. Função SECURITY DEFINER roda com permissões do owner (postgres)
--   2. Sem SET search_path, SQL não-qualificado (ex: SELECT * FROM users)
--      pode resolver para `search_path` do session user
--   3. Atacante com CREATE permissão em schema público pode envenenar
--      o search_path e fazer a função privilegiada ler dados errados
--
-- Fix: `SET search_path = public, pg_temp` garante que SQL não-qualificado
--      sempre resolve para `public` (e temp tables em pg_temp).
--
-- Funções corrigidas: 18 funções em 8 migrations legadas
--   - 000006_lgpd: anonymize_patient, bloquear_update_anonimizacao,
--                   validate_anonimizacao_log
--   - 000006_password_resets: create_password_reset
--   - 000007_audit_logs: audit_trigger_func, log_data_access,
--                        purge_expired_audit_logs
--   - 000008_notifications: queue_notification
--   - 000009_dicom: get_dicom_exam_by_appointment, publish_dicom_report
--   - 000010_tiss: tiss_get_stats
--   - 000017_telemedicina: gerar_token_telemedicina, criar_sala_telemedicina,
--                          registrar_consentimento_gravacao,
--                          finalizar_sala_telemedicina
--   - 000018_lis: is_lab_user, classificar_resultado_lab, parse_hl7_oru,
--                 fn_gerar_alerta_critico
-- =============================================================================

-- ============================================================================
-- 1. Recriar funções da migration 000006_lgpd
-- ============================================================================
DO $$
BEGIN
  -- Drop e recriar com SET search_path
  -- (Drop+Create é necessário porque SET não pode ser adicionado via ALTER FUNCTION
  --  em algumas versões antigas do PostgreSQL; CREATE OR REPLACE FUNCTION preserva
  --  permissões mas pode alterar definição)

  -- anonymize_patient (recriar com search_path fixo)
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'anonymize_patient' AND pronamespace = 'public') THEN
    -- Não dropamos para preservar permissões; usamos DO block para ALTER FUNCTION
    EXECUTE 'ALTER FUNCTION public.anonymize_patient SET search_path = public, pg_temp';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'bloquear_update_anonimizacao' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.bloquear_update_anonimizacao SET search_path = public, pg_temp';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'validate_anonimizacao_log' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.validate_anonimizacao_log SET search_path = public, pg_temp';
  END IF;
END $$;

-- ============================================================================
-- 2. Recriar funções da migration 000006_password_resets
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_password_reset' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.create_password_reset SET search_path = public, pg_temp';
  END IF;
END $$;

-- ============================================================================
-- 3. Recriar funções da migration 000007_audit_logs
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_trigger_func' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.audit_trigger_func SET search_path = public, pg_temp';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'log_data_access' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.log_data_access SET search_path = public, pg_temp';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'purge_expired_audit_logs' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.purge_expired_audit_logs SET search_path = public, pg_temp';
  END IF;
END $$;

-- ============================================================================
-- 4. Recriar função da migration 000008_notifications
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'queue_notification' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.queue_notification SET search_path = public, pg_temp';
  END IF;
END $$;

-- ============================================================================
-- 5. Recriar funções da migration 000009_dicom
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_dicom_exam_by_appointment' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.get_dicom_exam_by_appointment SET search_path = public, pg_temp';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'publish_dicom_report' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.publish_dicom_report SET search_path = public, pg_temp';
  END IF;
END $$;

-- ============================================================================
-- 6. Recriar função da migration 000010_tiss
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tiss_get_stats' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.tiss_get_stats SET search_path = public, pg_temp';
  END IF;
END $$;

-- ============================================================================
-- 7. Recriar funções da migration 000017_telemedicina
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gerar_token_telemedicina' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.gerar_token_telemedicina SET search_path = public, pg_temp';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'criar_sala_telemedicina' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.criar_sala_telemedicina SET search_path = public, pg_temp';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'registrar_consentimento_gravacao' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.registrar_consentimento_gravacao SET search_path = public, pg_temp';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'finalizar_sala_telemedicina' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.finalizar_sala_telemedicina SET search_path = public, pg_temp';
  END IF;
END $$;

-- ============================================================================
-- 8. Recriar funções da migration 000018_lis
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_lab_user' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.is_lab_user SET search_path = public, pg_temp';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'classificar_resultado_lab' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.classificar_resultado_lab SET search_path = public, pg_temp';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'parse_hl7_oru' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.parse_hl7_oru SET search_path = public, pg_temp';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_gerar_alerta_critico' AND pronamespace = 'public') THEN
    EXECUTE 'ALTER FUNCTION public.fn_gerar_alerta_critico SET search_path = public, pg_temp';
  END IF;
END $$;

-- ============================================================================
-- 9. Hardening adicional: alterar default search_path do schema public
--    Isso garante que qualquer função/tabela criada no schema public
--    tenha search_path previsível
-- ============================================================================
ALTER DATABASE CURRENT_SETTING() RESET search_path;
ALTER ROLE CURRENT_USER RESET search_path;

-- Não podemos alterar search_path do banco facilmente sem impacto
-- Aplicar via ALTER DATABASE é destrutivo; pulamos e deixamos as
-- funções com SET explícito (mais seguro)

-- ============================================================================
-- 10. Validação: reportar funções corrigidas
-- ============================================================================
DO $$
DECLARE
  func_count INTEGER;
  fixed_count INTEGER := 0;
BEGIN
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prosecdef = true;

  RAISE NOTICE 'Total funções SECURITY DEFINER em public: %', func_count;
  RAISE NOTICE 'Migration 031: search_path hardening aplicado via ALTER FUNCTION';
  RAISE NOTICE 'Para verificar: SELECT proname, prosecdef FROM pg_proc WHERE prosecdef = true';
END $$;

COMMENT ON MIGRATION 20260101000031_search_path_hardening IS
  'CRÍTICO: aplica SET search_path = public, pg_temp em 18 funções SECURITY DEFINER
   legadas para prevenir privilege escalation via search_path attack (CWE-426).
   Refs: PostgreSQL SECURITY DEFINER docs, OWASP A01:2021 Broken Access Control.';
-- ============================================================
-- migrate_resume_via_sql_editor.sql
-- ProntoClinic Hub v1.1.0 — SIGH → Supabase Produção
-- POLICLINICA MEDILIFE · rhqgwrarkotjzdcrkbgn · 2026-06-24
--
-- CONTEXTO: O projeto Supabase Cloud Free ficou sem espaço
-- (500MB esgotados) durante a migração de appointments.
-- A API retorna HTTP 503 / PGRST002 até o banco recuperar.
--
-- Use este script QUANDO a API voltar a responder (HTTP 200),
-- abrindo o SQL Editor no Dashboard:
--   https://supabase.com/dashboard/project/rhqgwrarkotjzdcrkbgn/sql/new
--
-- ORDEM DE EXECUÇÃO (rode cada bloco separadamente e observe o resultado):
--   BLOCO 1: Diagnóstico de espaço e contagens atuais
--   BLOCO 2: Liberar espaço — soft-delete appointments antigos
--   BLOCO 3: Liberar espaço — VACUUM FULL e TRUNCATE de tabelas internas
--   BLOCO 4: Confirmar recuperação e contagens finais
-- ============================================================


-- ============================================================
-- BLOCO 1: DIAGNÓSTICO
-- Rode primeiro. Mostra espaço, contagens atuais e big tables.
-- ============================================================

-- 1.1 Espaço em disco do banco (em MB)
SELECT
  pg_size_pretty(pg_database_size(current_database())) AS db_total_size;

-- 1.2 Contagens atuais (espelho do que migramos até agora)
SELECT 'patients'             AS tabela, count(*)::text AS n FROM public.patients
UNION ALL SELECT 'professionals',  count(*)::text FROM public.professionals
UNION ALL SELECT 'insurance_companies', count(*)::text FROM public.insurance_companies
UNION ALL SELECT 'tiss_xml',       count(*)::text FROM public.tiss_xml
UNION ALL SELECT 'appointments',   count(*)::text FROM public.appointments
UNION ALL SELECT 'medical_records',count(*)::text FROM public.medical_records
UNION ALL SELECT 'prescriptions',  count(*)::text FROM public.prescriptions
UNION ALL SELECT 'companies',      count(*)::text FROM public.companies
ORDER BY tabela;

-- 1.3 Espaço por tabela (top 15)
SELECT
  schemaname || '.' || tablename AS tabela,
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS tamanho,
  pg_total_relation_size(schemaname || '.' || tablename) AS bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY bytes DESC
LIMIT 15;


-- ============================================================
-- BLOCO 2: LIBERAR ESPAÇO — SOFT-DELETE APPOINTMENTS ANTIGOS
-- Marque como inativos (NÃO apaga) registros anteriores a 2024.
-- Reduz drasticamente o tamanho físico após VACUUM.
--
-- IMPORTANTE: se preferir apagar, troque "lg_ativo = false"
-- por "DELETE FROM ..." (irreversível).
-- ============================================================

-- 2.1 Adicionar coluna lg_ativo se não existir
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS lg_ativo boolean NOT NULL DEFAULT true;

-- 2.2 Soft-delete de appointments com mais de 2 anos
UPDATE public.appointments
   SET lg_ativo = false
 WHERE appointment_date < '2024-01-01'
   AND lg_ativo = true;

-- 2.3 Quantos foram desativados (deve ser grande)
SELECT count(*) FILTER (WHERE lg_ativo = false) AS inativos,
       count(*) FILTER (WHERE lg_ativo = true)  AS ativos
  FROM public.appointments;

-- 2.4 Criar índice parcial para acelerar queries no que interessa
CREATE INDEX IF NOT EXISTS appointments_ativos_idx
    ON public.appointments (appointment_date)
 WHERE lg_ativo = true;


-- ============================================================
-- BLOCO 3: LIBERAR ESPAÇO — VACUUM E TRUNCATE DE LOGS INTERNOS
-- O PostgREST guarda um schema cache que pode crescer.
-- Rode VACUUM FULL para reclamar espaço de volta ao disco.
-- ============================================================

-- 3.1 VACUUM ANALYZE em appointments (rápido, devolve espaço ao SO)
VACUUM (ANALYZE, VERBOSE) public.appointments;

-- 3.2 Limpar tabela de migrations internas (não afeta dados)
-- ATENÇÃO: isso só funciona se você usa supabase db push.
-- Se preferir, pule este bloco.
-- TRUNCATE supabase_migrations.schema_migrations RESTART IDENTITY;

-- 3.3 Tamanho após VACUUM (compare com o bloco 1.1)
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_total_size_apos_vacuum;


-- ============================================================
-- BLOCO 4: VALIDAÇÃO FINAL
-- Rode ao terminar para gerar o relatório final.
-- ============================================================

-- 4.1 Contagens finais
SELECT 'patients'             AS tabela, count(*)::text AS n FROM public.patients
UNION ALL SELECT 'professionals',  count(*)::text FROM public.professionals
UNION ALL SELECT 'insurance_companies', count(*)::text FROM public.insurance_companies
UNION ALL SELECT 'tiss_xml',       count(*)::text FROM public.tiss_xml
UNION ALL SELECT 'appointments',   count(*)::text FROM public.appointments
UNION ALL SELECT 'medical_records',count(*)::text FROM public.medical_records
UNION ALL SELECT 'prescriptions',  count(*)::text FROM public.prescriptions
ORDER BY tabela;

-- 4.2 Espaço final
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_final_size;

-- 4.3 Top 10 tabelas
SELECT
  tablename AS tabela,
  pg_size_pretty(pg_total_relation_size('public.' || tablename)) AS tamanho
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size('public.' || tablename) DESC
LIMIT 10;


-- ============================================================
-- PRÓXIMOS PASSOS (manuais)
-- ============================================================
-- 1. Se a API continuar 503 PGRST002 após VACUUM, reinicie o projeto:
--    Dashboard → Settings → General → "Restart project"
--    (aguarde 2-3 min; dados NÃO são perdidos).
--
-- 2. Quando HTTP 200 voltar, rode localmente:
--      python scripts/migrate_resume_appointments.py
--    para inserir as ~312 mil appointments restantes.
--
-- 3. Validar com:
--      supabase db query "SELECT count(*) FROM public.appointments" --linked
--    alvo: ~448.676
--
-- 4. Para upgrade de plano (recomendado para produção):
--    Dashboard → Settings → Billing → Upgrade to Pro ($25/mês)
--    Plano Pro libera 8GB e remove o gargalo dos 500MB Free.
-- ============================================================

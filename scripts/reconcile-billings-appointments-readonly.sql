-- ProntoMedic: reconciliacao somente leitura de faturamentos/agendamentos.
-- Nao executar em modo de escrita. Nao contem UPDATE, INSERT, DELETE ou DDL.
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = public, pg_catalog;

-- Resumo geral do contrato observado.
SELECT 'summary' AS report,
       COUNT(*) AS billings_total,
       COUNT(*) FILTER (WHERE a.id IS NOT NULL) AS billings_mapped,
       COUNT(*) FILTER (WHERE a.id IS NULL) AS billings_unmapped,
       COUNT(*) FILTER (WHERE b.company_id IS NULL) AS billings_without_company
FROM public.billings b
LEFT JOIN public.appointments a ON a.billing_id = b.id;

-- Casos sem vinculo, agregados por empresa anonima, status e mes.
-- O hash evita exportar identificadores de empresa.
SELECT 'unmapped_by_bucket' AS report,
       md5(b.company_id::text) AS company_hash,
       b.status,
       date_trunc('month', b.created_at)::date AS created_month,
       COUNT(*) AS total
FROM public.billings b
LEFT JOIN public.appointments a ON a.billing_id = b.id
WHERE a.id IS NULL
GROUP BY b.company_id, b.status, date_trunc('month', b.created_at)
ORDER BY total DESC, company_hash, created_month;

-- Duplicidades de billing_id em appointments.
-- A lista serve para revisao controlada; nao escolher automaticamente um vencedor.
SELECT 'duplicate_billing_id' AS report,
       md5(a.company_id::text) AS company_hash,
       a.billing_id,
       COUNT(*) AS appointment_count,
       MIN(a.appointment_date)::date AS first_appointment_date,
       MAX(a.appointment_date)::date AS last_appointment_date
FROM public.appointments a
WHERE a.billing_id IS NOT NULL
GROUP BY a.company_id, a.billing_id
HAVING COUNT(*) > 1
ORDER BY appointment_count DESC, last_appointment_date DESC, a.billing_id;

-- Divergencia de tenant entre o faturamento e os agendamentos vinculados.
SELECT 'tenant_mismatch' AS report,
       COUNT(*) AS total
FROM public.appointments a
JOIN public.billings b ON b.id = a.billing_id
WHERE a.company_id IS DISTINCT FROM b.company_id;

ROLLBACK;

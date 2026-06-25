-- Drop problematic indexes that will be recreated by their respective migrations
DROP INDEX IF EXISTS public.idx_triagem_fila_senha_dia;
DROP INDEX IF EXISTS public.idx_lgpd_solic_venc;

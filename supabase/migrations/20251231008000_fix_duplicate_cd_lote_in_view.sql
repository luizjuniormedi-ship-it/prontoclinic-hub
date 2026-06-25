-- Drop view with duplicate cd_lote column so migration can recreate cleanly
DROP VIEW IF EXISTS public.v_estoque_atual CASCADE;

ALTER TABLE public.exames_lab_pedido ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE public.exames_lab_pedido_itens ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE public.exames_lab_resultado ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE public.exames_lab_alerta_critico ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE public.exames_lab_catalogo ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE public.exames_lab_valor_referencia ADD COLUMN IF NOT EXISTS company_id UUID;

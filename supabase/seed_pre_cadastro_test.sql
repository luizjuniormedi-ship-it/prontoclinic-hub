-- =============================================================================
-- seed_pre_cadastro_test.sql
--
-- Insere um pre-cadastro de teste (Joao da Silva) na primeira empresa ativa.
-- Util para validar manualmente o fluxo de confirmacao.
--
-- Como usar:
--   psql $DATABASE_URL -f supabase/seed_pre_cadastro_test.sql
--   ou via Supabase SQL Editor
--
-- Token de teste: 'token-teste-12345' (apenas para dev — em prod, sempre
-- gerar via RPC create_pre_cadastro)
-- =============================================================================

-- Extensao necessaria para digest() / gen_random_bytes()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Insere o pre-cadastro de teste (idempotente — usa ON CONFLICT)
INSERT INTO public.pre_cadastro (
  company_id,
  full_name,
  email,
  phone,
  whatsapp,
  birth_date,
  gender,
  cep,
  logradouro,
  numero,
  complemento,
  bairro,
  cidade,
  uf,
  lg_aceite_termo,
  dt_aceite_termo,
  versao_termo,
  texto_termo_hash,
  ip_origem,
  user_agent,
  token_confirmacao,
  dt_token_exp,
  dt_ultimo_envio,
  status
) VALUES (
  (SELECT id FROM public.companies WHERE status = 'active' ORDER BY created_at ASC LIMIT 1),
  'Joao da Silva Teste',
  'joao.teste@example.com',
  '11999998888',
  '11999998888',
  '1990-01-15',
  'M',
  '01310-100',
  'Avenida Paulista',
  '1000',
  'Apto 101',
  'Bela Vista',
  'Sao Paulo',
  'SP',
  TRUE,
  NOW(),
  'v1.0-2026-06-22',
  encode(digest('Termo de Uso v1.0-2026-06-22 — texto canonico do termo de pre-cadastro', 'sha256'), 'hex'),
  '127.0.0.1'::INET,
  'Mozilla/5.0 (Test/1.0) ProntoClinic-Hub-Seed',
  'token-teste-12345-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  NOW() + INTERVAL '72 hours',
  NOW(),
  'PENDENTE'
)
ON CONFLICT (company_id, email) DO UPDATE
SET
  token_confirmacao = EXCLUDED.token_confirmacao,
  dt_token_exp = EXCLUDED.dt_token_exp,
  dt_ultimo_envio = EXCLUDED.dt_ultimo_envio,
  status = 'PENDENTE',
  updated_at = NOW();

-- Verifica insercao
SELECT
  id,
  full_name,
  email,
  status,
  dt_token_exp,
  token_confirmacao
FROM public.pre_cadastro
WHERE email = 'joao.teste@example.com';

-- Link de teste (para abrir no navegador e confirmar manualmente)
SELECT
  'http://localhost:5173/pre-cadastro/confirmar?token=' || token_confirmacao AS link_teste
FROM public.pre_cadastro
WHERE email = 'joao.teste@example.com';

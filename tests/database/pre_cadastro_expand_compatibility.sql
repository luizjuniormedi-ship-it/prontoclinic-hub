\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.companies (id, name, lg_ativo)
VALUES ('41000000-0000-4000-8000-000000000001', 'Empresa QA Compatibilidade', TRUE)
ON CONFLICT (id) DO UPDATE SET lg_ativo = TRUE;

SET LOCAL ROLE anon;
SELECT r_id AS legacy_id, r_token AS legacy_token
FROM public.create_pre_cadastro(
  '41000000-0000-4000-8000-000000000001', 'Paciente Legado QA',
  'legado.qa@example.test', '(11) 99999-9999', DATE '1990-01-01', 'F',
  '01310100', 'Avenida Paulista', '1000', NULL, 'Bela Vista',
  'Sao Paulo', 'SP', 'v1.0-qa', repeat('a', 64)::CHAR(64),
  '127.0.0.1', 'expand-contract-test'
)
\gset
RESET ROLE;

SELECT EXISTS (
  SELECT 1 FROM public.pre_cadastro
  WHERE id = :'legacy_id'::UUID
    AND token_confirmacao = :'legacy_token'
    AND token_confirmacao_hash =
      encode(public.digest(:'legacy_token', 'sha256'), 'hex')
) AS dual_write_ok
\gset
\if :dual_write_ok
\else
  \echo 'RPC legado nao gravou plaintext e hash correspondentes'
  \quit 1
\endif

SET LOCAL ROLE anon;
SELECT id AS confirmed_id
FROM public.confirm_pre_cadastro(:'legacy_token')
\gset
RESET ROLE;

SELECT (
  :'confirmed_id'::UUID = :'legacy_id'::UUID
  AND EXISTS (
    SELECT 1 FROM public.pre_cadastro
    WHERE id = :'legacy_id'::UUID AND status = 'CONFIRMADO'
  )
) AS dual_read_ok
\gset
\if :dual_read_ok
\else
  \echo 'RPC legado nao confirmou registro dual-write'
  \quit 1
\endif

SET LOCAL ROLE anon;
SELECT r_id AS edge_legacy_id, r_token AS edge_legacy_token
FROM public.create_pre_cadastro(
  '41000000-0000-4000-8000-000000000001', 'Paciente Legado para Edge',
  'legado.edge.qa@example.test', '(11) 98888-8888', DATE '1991-02-02', 'F',
  '01310100', 'Avenida Paulista', '1001', NULL, 'Bela Vista',
  'Sao Paulo', 'SP', 'v1.0-qa', repeat('b', 64)::CHAR(64),
  '127.0.0.1', 'expand-contract-edge-test'
)
\gset
RESET ROLE;
SELECT encode(public.digest(:'edge_legacy_token', 'sha256'), 'hex') AS edge_legacy_hash
\gset
SET LOCAL ROLE service_role;
SELECT r_status AS edge_confirm_status
FROM public.pre_cadastro_edge_confirm(:'edge_legacy_hash'::CHAR(64))
\gset
RESET ROLE;
SELECT (
  :'edge_confirm_status' = 'CONFIRMADO'
  AND EXISTS (
    SELECT 1 FROM public.pre_cadastro
    WHERE id = :'edge_legacy_id'::UUID AND status = 'CONFIRMADO'
  )
) AS legacy_to_edge_ok
\gset
\if :legacy_to_edge_ok
\else
  \echo 'Edge nao confirmou registro criado pelo contrato legado'
  \quit 1
\endif

ROLLBACK;

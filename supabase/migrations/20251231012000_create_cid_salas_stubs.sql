-- Stubs for tables referenced by cirurgia and others
CREATE TABLE IF NOT EXISTS public.cid (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_codigo VARCHAR(10) NOT NULL,
  ds_descricao VARCHAR(500) NOT NULL,
  categoria VARCHAR(50),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cid_codigo ON public.cid(cd_codigo);

CREATE TABLE IF NOT EXISTS public.salas_cirurgicas (
  id SERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_codigo VARCHAR(20) NOT NULL,
  ds_nome VARCHAR(100) NOT NULL,
  tp_sala VARCHAR(30),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.procedimentos_sus (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_codigo VARCHAR(20) NOT NULL,
  ds_nome VARCHAR(300) NOT NULL,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

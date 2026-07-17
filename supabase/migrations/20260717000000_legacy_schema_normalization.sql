-- Normaliza, de forma aditiva, schemas criados por versões legadas mal datadas.
-- Não remove tabelas, colunas ou dados e não usa DROP ... CASCADE.

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS ds_razao_social VARCHAR(200),
  ADD COLUMN IF NOT EXISTS ds_endereco VARCHAR(200),
  ADD COLUMN IF NOT EXISTS nr_endereco VARCHAR(20),
  ADD COLUMN IF NOT EXISTS ds_complemento VARCHAR(100),
  ADD COLUMN IF NOT EXISTS ds_bairro VARCHAR(100),
  ADD COLUMN IF NOT EXISTS ds_cidade VARCHAR(100),
  ADD COLUMN IF NOT EXISTS ds_uf VARCHAR(2),
  ADD COLUMN IF NOT EXISTS nr_cep VARCHAR(8),
  ADD COLUMN IF NOT EXISTS nr_telefone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS ds_email VARCHAR(200),
  ADD COLUMN IF NOT EXISTS cd_ibge_municipio VARCHAR(7),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.salas_cirurgicas
  ADD COLUMN IF NOT EXISTS ds_localizacao VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cd_origem_sigh INTEGER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.units WHERE company_id IS NULL) THEN
    RAISE EXCEPTION 'legacy normalization aborted: units.company_id contains NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.salas_cirurgicas WHERE company_id IS NULL) THEN
    RAISE EXCEPTION 'legacy normalization aborted: salas_cirurgicas.company_id contains NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.salas_cirurgicas
    GROUP BY company_id, ds_nome HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'legacy normalization aborted: duplicate salas_cirurgicas(company_id, ds_nome)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.salas_cirurgicas
    WHERE tp_sala IS NOT NULL AND tp_sala NOT IN (
      'CIRURGIA_GERAL', 'OBSTETRICIA', 'ORTOPEDIA', 'CARDIACA',
      'NEUROCIRURGIA', 'AMBULATORIAL'
    )
  ) THEN
    RAISE EXCEPTION 'legacy normalization aborted: unsupported salas_cirurgicas.tp_sala';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.units
    WHERE tp_unidade IS NOT NULL AND tp_unidade NOT IN (
      'HOSPITAL', 'CLINICA', 'UPA', 'UBS', 'LABORATORIO',
      'CONSULTORIO', 'MATRIZ', 'FILIAL'
    )
  ) THEN
    RAISE EXCEPTION 'legacy normalization aborted: unsupported units.tp_unidade';
  END IF;
END;
$$;

ALTER TABLE public.units ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.salas_cirurgicas ALTER COLUMN company_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.units'::regclass
      AND conname = 'units_tp_unidade_check'
  ) THEN
    ALTER TABLE public.units ADD CONSTRAINT units_tp_unidade_check CHECK (
      tp_unidade IN (
        'HOSPITAL', 'CLINICA', 'UPA', 'UBS', 'LABORATORIO',
        'CONSULTORIO', 'MATRIZ', 'FILIAL'
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.salas_cirurgicas'::regclass
      AND conname = 'salas_cirurgicas_tp_sala_check'
  ) THEN
    ALTER TABLE public.salas_cirurgicas ADD CONSTRAINT salas_cirurgicas_tp_sala_check CHECK (
      tp_sala IN (
        'CIRURGIA_GERAL', 'OBSTETRICIA', 'ORTOPEDIA', 'CARDIACA',
        'NEUROCIRURGIA', 'AMBULATORIAL'
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.salas_cirurgicas'::regclass
      AND conname = 'uniq_sala_nome_company'
  ) THEN
    ALTER TABLE public.salas_cirurgicas
      ADD CONSTRAINT uniq_sala_nome_company UNIQUE (company_id, ds_nome);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_units_company_codigo_unique
  ON public.units(company_id, cd_codigo);
CREATE INDEX IF NOT EXISTS idx_units_principal
  ON public.units(company_id, lg_principal) WHERE lg_principal = TRUE;
CREATE INDEX IF NOT EXISTS idx_units_ativo
  ON public.units(company_id, lg_ativo);
CREATE INDEX IF NOT EXISTS idx_units_cnpj
  ON public.units(nr_cnpj) WHERE nr_cnpj IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_salas_company
  ON public.salas_cirurgicas(company_id);
CREATE INDEX IF NOT EXISTS idx_salas_tipo
  ON public.salas_cirurgicas(company_id, tp_sala);
CREATE INDEX IF NOT EXISTS idx_salas_ativas
  ON public.salas_cirurgicas(company_id) WHERE lg_ativa = TRUE;

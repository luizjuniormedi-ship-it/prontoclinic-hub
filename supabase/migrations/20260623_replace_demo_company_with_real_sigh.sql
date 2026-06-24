-- Migration: Substituir empresa DEMO pela empresa REAL do SIGH
-- Empresa real descoberta em SIGH:
--   POLICLINICA MEDILIFE DIAGNOSTICOS LTDA
--   CNPJ: 42533813000197 (matriz, do config.DS_CNPJ)
--   Endereço: Rua Doutor Alfredo Backer, Alcantara - São Gonçalo/RJ
--   CEP: 24710-392
--   CNES: 3041379 (SUS)
--
-- Esta migration é IDEMPOTENTE — pode ser rodada várias vezes sem efeito colateral.
-- Estratégia: cria empresa real se não existir; reponta todas as FKs; dropa empresa demo.

BEGIN;

-- ============================================================================
-- 1) Inserir empresa REAL se ainda não existir
-- ============================================================================
DO $$
DECLARE
  v_demo_id   CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  v_real_cnpj CONSTANT text := '42533813000197';
  v_existing_id uuid;
  v_updated    int;
  rec          record;
BEGIN
  -- Procura empresa real existente
  SELECT id INTO v_existing_id
  FROM public.companies
  WHERE cnpj = v_real_cnpj
  LIMIT 1;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.companies (
      name, cnpj, lg_ativo, phone, email
    ) VALUES (
      'POLICLINICA MEDILIFE DIAGNOSTICOS LTDA',
      v_real_cnpj,
      true,
      NULL,
      NULL
    )
    RETURNING id INTO v_existing_id;

    RAISE NOTICE 'Empresa REAL inserida: id=% cnpj=%', v_existing_id, v_real_cnpj;
  ELSE
    RAISE NOTICE 'Empresa REAL já existia: id=% cnpj=%', v_existing_id, v_real_cnpj;
  END IF;

  -- Garante que a empresa real está ativa
  UPDATE public.companies
     SET name     = 'POLICLINICA MEDILIFE DIAGNOSTICOS LTDA',
         lg_ativo = true
   WHERE id = v_existing_id;

  -- ============================================================================
  -- 2) Repontar todas as FKs da empresa demo para a empresa real
  -- ============================================================================
  FOR rec IN
    SELECT c.conrelid::regclass::text AS tbl
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = ANY(c.conkey)
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.companies'::regclass
       AND a.attname = 'company_id'
     GROUP BY c.conrelid
  LOOP
    EXECUTE format(
      'UPDATE %I SET company_id = %L WHERE company_id = %L',
      rec.tbl, v_existing_id, v_demo_id
    );
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE 'Tabela %: % registros repontados', rec.tbl, v_updated;
  END LOOP;

  -- ============================================================================
  -- 3) Dropar empresa DEMO se existir
  -- ============================================================================
  DELETE FROM public.companies
   WHERE id = v_demo_id
     AND id <> v_existing_id;
END $$;

COMMIT;

-- ============================================================================
-- Verificação
-- ============================================================================
-- SELECT id, name, cnpj, lg_ativo FROM public.companies;

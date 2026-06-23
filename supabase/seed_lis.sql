-- =============================================================================
-- Seed: LIS — Catálogo de exames laboratoriais
-- Migration: 20260101000018_lis
-- =============================================================================

DO $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE NOTICE 'Nenhuma company encontrada — pulando seed_lis';
    RETURN;
  END IF;

  INSERT INTO public.exames_lab_catalogo
    (company_id, ds_exame, ds_sigla, cd_tuss, cd_loinc, ds_categoria, ds_material, nr_prazo_dias, vl_particular, vl_convenio)
  VALUES
    -- Hematologia
    (v_company_id, 'Hemograma completo',     'HC',    '40304310', '58410-2',  'HEMATOLOGIA', 'SANGUE', 1, 25.00, 18.00),
    (v_company_id, 'Hematócrito',            'Ht',    '40304320', '4544-3',   'HEMATOLOGIA', 'SANGUE', 1,  8.00,  6.00),
    (v_company_id, 'Hemoglobina',            'Hb',    '40304330', '718-7',    'HEMATOLOGIA', 'SANGUE', 1,  8.00,  6.00),
    (v_company_id, 'Leucograma',             'LEU',   '40304340', '6690-2',   'HEMATOLOGIA', 'SANGUE', 1, 15.00, 12.00),
    (v_company_id, 'Plaquetas',              'PLT',   '40304350', '777-3',    'HEMATOLOGIA', 'SANGUE', 1, 10.00,  8.00),
    (v_company_id, 'VHS',                    'VHS',   '40304360', '30341-2',  'HEMATOLOGIA', 'SANGUE', 1, 10.00,  8.00),
    (v_company_id, 'Reticulócitos',          'RT',    '40304370', '17849-1',  'HEMATOLOGIA', 'SANGUE', 1, 12.00,  9.00),
    -- Bioquímica
    (v_company_id, 'Glicemia jejum',         'GLI',   '40302030', '2345-7',   'BIOQUIMICA',  'SANGUE', 1, 12.00,  9.00),
    (v_company_id, 'Hemoglobina glicada',    'HbA1c', '40302060', '4548-4',   'BIOQUIMICA',  'SANGUE', 1, 45.00, 35.00),
    (v_company_id, 'Colesterol total',       'COL',   '40302100', '2093-3',   'BIOQUIMICA',  'SANGUE', 1, 15.00, 12.00),
    (v_company_id, 'HDL',                    'HDL',   '40302110', '2085-9',   'BIOQUIMICA',  'SANGUE', 1, 18.00, 14.00),
    (v_company_id, 'LDL',                    'LDL',   '40302120', '13457-7',  'BIOQUIMICA',  'SANGUE', 1, 18.00, 14.00),
    (v_company_id, 'Triglicerídeos',         'TG',    '40302130', '2571-8',   'BIOQUIMICA',  'SANGUE', 1, 18.00, 14.00),
    (v_company_id, 'Ureia',                  'UR',    '40302300', '3094-0',   'BIOQUIMICA',  'SANGUE', 1, 10.00,  8.00),
    (v_company_id, 'Creatinina',             'CR',    '40302310', '2160-0',   'BIOQUIMICA',  'SANGUE', 1, 10.00,  8.00),
    (v_company_id, 'TGO/AST',                'TGO',   '40302400', '1920-8',   'BIOQUIMICA',  'SANGUE', 1, 12.00,  9.00),
    (v_company_id, 'TGP/ALT',                'TGP',   '40302410', '1742-6',   'BIOQUIMICA',  'SANGUE', 1, 12.00,  9.00),
    (v_company_id, 'Ácido úrico',            'AU',    '40302420', '3084-1',   'BIOQUIMICA',  'SANGUE', 1, 12.00,  9.00),
    -- Urina
    (v_company_id, 'EAS (Urina tipo I)',     'EAS',   '40302500', '5802-4',   'URINALISE',   'URINA',  1, 15.00, 12.00),
    (v_company_id, 'Urocultura',             'URO',   '40302510', '630-4',    'URINALISE',   'URINA',  3, 30.00, 24.00),
    -- Coagulação
    (v_company_id, 'TAP',                    'TAP',   '40303010', '3184-9',   'COAGULACAO',  'SANGUE', 1, 18.00, 14.00),
    (v_company_id, 'TTPa',                   'TTPa',  '40303020', '3173-2',   'COAGULACAO',  'SANGUE', 1, 35.00, 28.00),
    (v_company_id, 'INR',                    'INR',   '40303030', '34714-6',  'COAGULACAO',  'SANGUE', 1, 18.00, 14.00),
    -- Imunologia
    (v_company_id, 'TSH',                    'TSH',   '40316010', '3016-3',   'IMUNOLOGIA',  'SANGUE', 2, 25.00, 20.00),
    (v_company_id, 'T4 livre',               'T4L',   '40316020', '3026-2',   'IMUNOLOGIA',  'SANGUE', 2, 30.00, 24.00),
    (v_company_id, 'Anti-HBs',               'HBs',   '40318020', '5193-8',   'IMUNOLOGIA',  'SANGUE', 2, 35.00, 28.00),
    -- Sorologias
    (v_company_id, 'HIV (anti-HIV)',         'HIV',   '40314010', '5221-7',   'SOROLOGIA',   'SANGUE', 2, 50.00, 40.00),
    (v_company_id, 'HBsAg',                  'HBsAg', '40314020', '5196-1',   'SOROLOGIA',   'SANGUE', 2, 35.00, 28.00),
    (v_company_id, 'Anti-HCV',               'HCV',   '40314030', '16128-1',  'SOROLOGIA',   'SANGUE', 2, 60.00, 48.00),
    (v_company_id, 'VDRL',                   'VDRL',  '40314050', '5292-8',   'SOROLOGIA',   'SANGUE', 1, 20.00, 16.00),
    -- Cultura
    (v_company_id, 'Hemocultura',            'HEMO',  '40312010', '600-7',    'CULTURA',     'SANGUE', 5, 80.00, 64.00),
    (v_company_id, 'Coprocultura',           'COPRO', '40312020', '635-3',    'CULTURA',     'FEZES',  5, 60.00, 48.00)
  ON CONFLICT (company_id, ds_sigla) DO NOTHING;

  -- Hemograma (HC) — referência por sexo
  INSERT INTO public.exames_lab_valor_referencia
    (cd_exame, ds_parametro, vl_minimo, vl_maximo, ds_unidade, cd_sexo, nr_idade_min, nr_idade_max)
  SELECT c.id, p.ds_parametro, p.vl_minimo, p.vl_maximo, p.ds_unidade, p.cd_sexo, p.nr_idade_min, p.nr_idade_max
  FROM public.exames_lab_catalogo c
  CROSS JOIN (VALUES
    ('Hemácias',     4.5, 5.5, 'milhões/mm³', 'M', 18, 99),
    ('Hemácias',     3.9, 4.8, 'milhões/mm³', 'F', 18, 99),
    ('Hemoglobina', 13.0, 17.5, 'g/dL',         'M', 18, 99),
    ('Hemoglobina', 12.0, 15.5, 'g/dL',         'F', 18, 99),
    ('Hematócrito', 40.0, 54.0, '%',            'M', 18, 99),
    ('Hematócrito', 36.0, 48.0, '%',            'F', 18, 99),
    ('Leucócitos', 4500.0, 11000.0, '/mm³',     'A',  0, 99),
    ('Plaquetas', 150000.0, 400000.0, '/mm³',   'A',  0, 99)
  ) AS p(ds_parametro, vl_minimo, vl_maximo, ds_unidade, cd_sexo, nr_idade_min, nr_idade_max)
  WHERE c.company_id = v_company_id AND c.ds_sigla = 'HC'
  ON CONFLICT DO NOTHING;

  -- Glicemia
  INSERT INTO public.exames_lab_valor_referencia
    (cd_exame, ds_parametro, vl_minimo, vl_maximo, ds_unidade, cd_sexo, nr_idade_min, nr_idade_max)
  SELECT c.id, 'Glicose', 70, 99, 'mg/dL', 'A', 0, 99
  FROM public.exames_lab_catalogo c
  WHERE c.company_id = v_company_id AND c.ds_sigla = 'GLI'
  ON CONFLICT DO NOTHING;

  -- Colesterol total
  INSERT INTO public.exames_lab_valor_referencia
    (cd_exame, ds_parametro, vl_minimo, vl_maximo, ds_unidade, cd_sexo, nr_idade_min, nr_idade_max)
  SELECT c.id, 'Colesterol Total', 0, 200, 'mg/dL', 'A', 0, 99
  FROM public.exames_lab_catalogo c
  WHERE c.company_id = v_company_id AND c.ds_sigla = 'COL'
  ON CONFLICT DO NOTHING;

  -- TSH
  INSERT INTO public.exames_lab_valor_referencia
    (cd_exame, ds_parametro, vl_minimo, vl_maximo, ds_unidade, cd_sexo, nr_idade_min, nr_idade_max)
  SELECT c.id, 'TSH', 0.4, 4.0, 'mUI/L', 'A', 0, 99
  FROM public.exames_lab_catalogo c
  WHERE c.company_id = v_company_id AND c.ds_sigla = 'TSH'
  ON CONFLICT DO NOTHING;

  -- Creatinina
  INSERT INTO public.exames_lab_valor_referencia
    (cd_exame, ds_parametro, vl_minimo, vl_maximo, ds_unidade, cd_sexo, nr_idade_min, nr_idade_max)
  SELECT c.id, 'Creatinina', 0.7, 1.3, 'mg/dL', 'M', 18, 99
  FROM public.exames_lab_catalogo c
  WHERE c.company_id = v_company_id AND c.ds_sigla = 'CR'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.exames_lab_valor_referencia
    (cd_exame, ds_parametro, vl_minimo, vl_maximo, ds_unidade, cd_sexo, nr_idade_min, nr_idade_max)
  SELECT c.id, 'Creatinina', 0.6, 1.1, 'mg/dL', 'F', 18, 99
  FROM public.exames_lab_catalogo c
  WHERE c.company_id = v_company_id AND c.ds_sigla = 'CR'
  ON CONFLICT DO NOTHING;
END $$;

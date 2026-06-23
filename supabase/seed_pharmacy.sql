-- =============================================================================
-- Seed: seed_pharmacy.sql
-- Descrição: 50 medicamentos Rename/CMED + 20 materiais hospitalares
--            + 3 almoxarifados + ~100 lotes de exemplo.
--
--            IDs cd_origem_sigh mapeiam para SIGH.medicamento (1-50)
--            e SIGH.material (1-20) para rastreabilidade da migração.
--
-- Modo de uso:
--   psql -h localhost -U postgres -d prontoclinic -f supabase/seed_pharmacy.sql
-- =============================================================================

DO $$
DECLARE
  v_company_id UUID;
  v_almox_ids  INTEGER[] := ARRAY[]::INTEGER[];
  v_med_ids    BIGINT[]  := ARRAY[]::BIGINT[];
  v_mat_ids    BIGINT[]  := ARRAY[]::BIGINT[];
  v_med_id     BIGINT;
  v_mat_id     BIGINT;
  v_alm_id     INTEGER;
  i            INTEGER;
  v_validade   DATE;
  v_qt         INTEGER;
  v_almox      INTEGER;
  v_lote_seq   INTEGER := 0;
BEGIN
  -- 1. Selecionar empresa ativa
  SELECT id INTO v_company_id FROM public.companies WHERE status = 'active' LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa. Rode seed_categories.sql antes.';
  END IF;

  -- 2. 3 Almoxarifados
  INSERT INTO public.almoxarifados (company_id, ds_nome, ds_localizacao, lg_principal)
  VALUES (v_company_id, 'Farmácia Central', 'Térreo - Bloco A', TRUE)
  RETURNING id INTO v_alm_id;
  v_almox_ids := array_append(v_almox_ids, v_alm_id);

  INSERT INTO public.almoxarifados (company_id, ds_nome, ds_localizacao, lg_principal)
  VALUES (v_company_id, 'Farmácia Pronto-Socorro', '1º andar - Emergência', FALSE)
  RETURNING id INTO v_alm_id;
  v_almox_ids := array_append(v_almox_ids, v_alm_id);

  INSERT INTO public.almoxarifados (company_id, ds_nome, ds_localizacao, lg_principal)
  VALUES (v_company_id, 'Almoxarifado Geral', 'Subsolo', FALSE)
  RETURNING id INTO v_alm_id;
  v_almox_ids := array_append(v_almox_ids, v_alm_id);

  RAISE NOTICE 'Almoxarifados criados: %', v_almox_ids;

  -- 3. 50 Medicamentos
  INSERT INTO public.medicamentos (company_id, cd_principio_ativo, cd_nome_comercial, ds_concentracao, ds_forma_farmaceutica, cd_anvisa, tp_receita, cd_classe_terapeutica, vl_unitario, lg_generico, lg_controlado, cd_origem_sigh) VALUES
    -- Analgésicos / Antipiréticos (1-5)
    (v_company_id, 'Dipirona', 'Novalgina', '500mg', 'COMPRIMIDO', '103920001', 'BRANCA', 'ANALGESICO', 0.45, FALSE, FALSE, 1),
    (v_company_id, 'Paracetamol', 'Tylenol', '500mg', 'COMPRIMIDO', '103920045', 'BRANCA', 'ANALGESICO', 0.32, FALSE, FALSE, 2),
    (v_company_id, 'Paracetamol', NULL, '200mg/mL', 'GOTAS', '103920046', 'BRANCA', 'ANALGESICO', 5.80, TRUE, FALSE, 3),
    (v_company_id, 'Dipirona', NULL, '500mg/mL', 'INJETAVEL', '103920002', 'BRANCA', 'ANALGESICO', 2.20, FALSE, FALSE, 4),
    (v_company_id, 'Ácido Acetilsalicílico', 'AAS', '100mg', 'COMPRIMIDO', '103920012', 'BRANCA', 'ANALGESICO', 0.18, FALSE, FALSE, 5),
    -- Anti-inflamatórios (6-9)
    (v_company_id, 'Ibuprofeno', 'Advil', '400mg', 'COMPRIMIDO', '103920067', 'BRANCA', 'ANTI_INFLAMATORIO', 0.85, FALSE, FALSE, 6),
    (v_company_id, 'Diclofenaco', 'Voltaren', '50mg', 'COMPRIMIDO', '103920078', 'BRANCA', 'ANTI_INFLAMATORIO', 0.92, FALSE, FALSE, 7),
    (v_company_id, 'Nimesulida', 'Nisulid', '100mg', 'COMPRIMIDO', '103920089', 'BRANCA', 'ANTI_INFLAMATORIO', 1.10, FALSE, FALSE, 8),
    (v_company_id, 'Cetoprofeno', 'Profenid', '100mg', 'INJETAVEL', '103920101', 'BRANCA', 'ANTI_INFLAMATORIO', 8.50, FALSE, FALSE, 9),
    -- Antibióticos (10-16)
    (v_company_id, 'Amoxicilina', 'Amoxil', '500mg', 'CAPSULA', '103920078', 'BRANCA', 'ANTIBIOTICO', 1.20, FALSE, FALSE, 10),
    (v_company_id, 'Amoxicilina', NULL, '250mg/5mL', 'SUSPENSAO', '103920079', 'BRANCA', 'ANTIBIOTICO', 14.50, TRUE, FALSE, 11),
    (v_company_id, 'Azitromicina', 'Zitromax', '500mg', 'COMPRIMIDO', '103920102', 'BRANCA', 'ANTIBIOTICO', 3.50, FALSE, FALSE, 12),
    (v_company_id, 'Ciprofloxacino', 'Cipro', '500mg', 'COMPRIMIDO', '103920115', 'BRANCA', 'ANTIBIOTICO', 1.85, FALSE, FALSE, 13),
    (v_company_id, 'Cefalexina', 'Keflex', '500mg', 'CAPSULA', '103920128', 'BRANCA', 'ANTIBIOTICO', 1.65, FALSE, FALSE, 14),
    (v_company_id, 'Sulfametoxazol + Trimetoprima', 'Bactrim', '400mg+80mg', 'COMPRIMIDO', '103920141', 'BRANCA', 'ANTIBIOTICO', 0.95, FALSE, FALSE, 15),
    (v_company_id, 'Ceftriaxona', 'Rocefin', '1g', 'INJETAVEL', '103920154', 'BRANCA', 'ANTIBIOTICO', 22.00, FALSE, FALSE, 16),
    -- Anti-hipertensivos (17-21)
    (v_company_id, 'Losartana', 'Cozaar', '50mg', 'COMPRIMIDO', '103920156', 'BRANCA', 'ANTI_HIPERTENSIVO', 0.65, TRUE, FALSE, 17),
    (v_company_id, 'Enalapril', 'Renitec', '10mg', 'COMPRIMIDO', '103920167', 'BRANCA', 'ANTI_HIPERTENSIVO', 0.42, TRUE, FALSE, 18),
    (v_company_id, 'Captopril', 'Capoten', '25mg', 'COMPRIMIDO', '103920178', 'BRANCA', 'ANTI_HIPERTENSIVO', 0.30, FALSE, FALSE, 19),
    (v_company_id, 'Hidroclorotiazida', NULL, '25mg', 'COMPRIMIDO', '103920189', 'BRANCA', 'ANTI_HIPERTENSIVO', 0.28, TRUE, FALSE, 20),
    (v_company_id, 'Amlodipina', 'Norvasc', '5mg', 'COMPRIMIDO', '103920201', 'BRANCA', 'ANTI_HIPERTENSIVO', 0.78, TRUE, FALSE, 21),
    -- Antidiabéticos (22-24)
    (v_company_id, 'Metformina', 'Glifage', '850mg', 'COMPRIMIDO', '103920212', 'BRANCA', 'ANTIDIABETICO', 0.45, TRUE, FALSE, 22),
    (v_company_id, 'Glibenclamida', 'Daonil', '5mg', 'COMPRIMIDO', '103920223', 'BRANCA', 'ANTIDIABETICO', 0.32, FALSE, FALSE, 23),
    (v_company_id, 'Insulina NPH', 'Novolin N', '100UI/mL', 'INJETAVEL', '103920234', 'BRANCA', 'ANTIDIABETICO', 38.00, FALSE, FALSE, 24),
    -- Anticoagulantes (25-26)
    (v_company_id, 'Warfarina', 'Marevan', '5mg', 'COMPRIMIDO', '103920245', 'BRANCA', 'ANTICOAGULANTE', 0.55, FALSE, FALSE, 25),
    (v_company_id, 'AAS', NULL, '100mg', 'COMPRIMIDO', '103920256', 'BRANCA', 'ANTICOAGULANTE', 0.20, TRUE, FALSE, 26),
    -- Cardiovasculares (27-29)
    (v_company_id, 'Propranolol', 'Inderal', '40mg', 'COMPRIMIDO', '103920267', 'BRANCA', 'CARDIOVASCULAR', 0.40, FALSE, FALSE, 27),
    (v_company_id, 'Atenolol', 'Atenol', '50mg', 'COMPRIMIDO', '103920278', 'BRANCA', 'CARDIOVASCULAR', 0.35, TRUE, FALSE, 28),
    (v_company_id, 'Sinvastatina', 'Zocor', '20mg', 'COMPRIMIDO', '103920289', 'BRANCA', 'CARDIOVASCULAR', 0.65, TRUE, FALSE, 29),
    -- Gastrointestinais (30-33)
    (v_company_id, 'Omeprazol', 'Losec', '20mg', 'CAPSULA', '103920301', 'BRANCA', 'GASTROINTESTINAL', 0.42, TRUE, FALSE, 30),
    (v_company_id, 'Ranitidina', 'Antak', '150mg', 'COMPRIMIDO', '103920312', 'BRANCA', 'GASTROINTESTINAL', 0.55, FALSE, FALSE, 31),
    (v_company_id, 'Domperidona', 'Motilium', '10mg', 'COMPRIMIDO', '103920323', 'BRANCA', 'GASTROINTESTINAL', 0.85, FALSE, FALSE, 32),
    (v_company_id, 'Loperamida', 'Imosec', '2mg', 'COMPRIMIDO', '103920334', 'BRANCA', 'GASTROINTESTINAL', 0.45, FALSE, FALSE, 33),
    -- Respiratórios (34-36)
    (v_company_id, 'Salbutamol', 'Aerolin', '100mcg', 'INALATORIO', '103920345', 'BRANCA', 'RESPIRATORIO', 18.00, FALSE, FALSE, 34),
    (v_company_id, 'Budesonida', 'Pulmicort', '200mcg', 'INALATORIO', '103920356', 'BRANCA', 'RESPIRATORIO', 35.00, FALSE, FALSE, 35),
    (v_company_id, 'Loratadina', 'Claritin', '10mg', 'COMPRIMIDO', '103920367', 'BRANCA', 'RESPIRATORIO', 0.78, FALSE, FALSE, 36),
    -- Vitaminas / Suplementos (37-40)
    (v_company_id, 'Ácido Fólico', NULL, '5mg', 'COMPRIMIDO', '103920378', 'BRANCA', 'VITAMINA', 0.20, TRUE, FALSE, 37),
    (v_company_id, 'Sulfato Ferroso', NULL, '40mg', 'COMPRIMIDO', '103920389', 'BRANCA', 'VITAMINA', 0.25, FALSE, FALSE, 38),
    (v_company_id, 'Vitamina D3', 'Addera D3', '1000UI', 'CAPSULA', '103920401', 'BRANCA', 'VITAMINA', 1.20, FALSE, FALSE, 39),
    (v_company_id, 'Vitamina C', 'Cewin', '500mg', 'COMPRIMIDO', '103920412', 'BRANCA', 'VITAMINA', 0.55, FALSE, FALSE, 40),
    -- Dermatológicos (41-42)
    (v_company_id, 'Hidrocortisona', NULL, '10mg/g', 'CREME', '103920423', 'BRANCA', 'DERMATOLOGICO', 12.00, FALSE, FALSE, 41),
    (v_company_id, 'Cetoconazol', 'Nizoral', '20mg/g', 'CREME', '103920434', 'BRANCA', 'DERMATOLOGICO', 14.50, FALSE, FALSE, 42),
    -- Psicotrópicos / Controlados (43-47)
    (v_company_id, 'Clonazepam', 'Rivotril', '2mg', 'COMPRIMIDO', '103920189', 'AZUL', 'ANSIOLITICO', 1.80, FALSE, TRUE, 43),
    (v_company_id, 'Alprazolam', 'Frontal', '1mg', 'COMPRIMIDO', '103920201', 'AZUL', 'ANSIOLITICO', 2.10, FALSE, TRUE, 44),
    (v_company_id, 'Sertralina', 'Zoloft', '50mg', 'COMPRIMIDO', '103920445', 'BRANCA', 'ANTIDEPRESSIVO', 2.50, TRUE, FALSE, 45),
    (v_company_id, 'Fluoxetina', 'Prozac', '20mg', 'CAPSULA', '103920456', 'BRANCA', 'ANTIDEPRESSIVO', 1.20, TRUE, FALSE, 46),
    (v_company_id, 'Morfina', 'Dimorf', '10mg', 'COMPRIMIDO', '103920201', 'VERMELHA', 'ANALGESICO_OPIOIDE', 5.40, FALSE, TRUE, 47),
    -- Antimicrobianos Portaria 344 (48-50)
    (v_company_id, 'Codeína', 'Tylex', '30mg', 'COMPRIMIDO', '103920467', 'AMARELA', 'ANALGESICO_OPIOIDE', 3.20, FALSE, TRUE, 48),
    (v_company_id, 'Tramadol', 'Tramal', '50mg', 'CAPSULA', '103920478', 'AMARELA', 'ANALGESICO_OPIOIDE', 2.80, FALSE, TRUE, 49),
    (v_company_id, 'Rivotril', NULL, '2.5mg/mL', 'GOTAS', '103920190', 'AZUL', 'ANSIOLITICO', 8.50, FALSE, TRUE, 50)
  ON CONFLICT DO NOTHING;

  -- Coleta IDs dos medicamentos (pelos cd_origem_sigh)
  FOR i IN 1..50 LOOP
    SELECT id INTO v_med_id FROM public.medicamentos
    WHERE company_id = v_company_id AND cd_origem_sigh = i
    ORDER BY id LIMIT 1;
    IF v_med_id IS NOT NULL THEN
      v_med_ids := array_append(v_med_ids, v_med_id);
    END IF;
  END LOOP;

  RAISE NOTICE 'Medicamentos cadastrados: %', array_length(v_med_ids, 1);

  -- 4. 20 Materiais hospitalares
  INSERT INTO public.materiais (company_id, ds_nome, cd_codigo_interno, cd_ean, ds_categoria, ds_unidade, vl_custo_medio, vl_venda, ponto_reposicao, cd_origem_sigh) VALUES
    (v_company_id, 'Seringa descartável 5mL', 'SR-DESC-5', '7898123456701', 'DESCARTAVEL', 'UN', 0.35, 0.80, 500, 1),
    (v_company_id, 'Seringa descartável 10mL', 'SR-DESC-10', '7898123456718', 'DESCARTAVEL', 'UN', 0.55, 1.20, 300, 2),
    (v_company_id, 'Seringa descartável 20mL', 'SR-DESC-20', '7898123456725', 'DESCARTAVEL', 'UN', 0.95, 1.80, 200, 3),
    (v_company_id, 'Agulha descartável 25x7', 'AG-DESC-25-7', '7898123456732', 'DESCARTAVEL', 'UN', 0.15, 0.40, 1000, 4),
    (v_company_id, 'Agulha descartável 30x7', 'AG-DESC-30-7', '7898123456749', 'DESCARTAVEL', 'UN', 0.15, 0.40, 1000, 5),
    (v_company_id, 'Luva nitrílica M', 'LU-NIT-M', '7898123456756', 'EPI', 'UN', 0.45, 1.20, 2000, 6),
    (v_company_id, 'Luva nitrílica G', 'LU-NIT-G', '7898123456763', 'EPI', 'UN', 0.45, 1.20, 1500, 7),
    (v_company_id, 'Luva látex M', 'LU-LTX-M', '7898123456770', 'EPI', 'UN', 0.30, 0.90, 1500, 8),
    (v_company_id, 'Máscara cirúrgica descartável', 'MS-CIR', '7898123456787', 'EPI', 'UN', 0.25, 0.70, 3000, 9),
    (v_company_id, 'Gaze estéril 7,5x7,5cm', 'GZ-EST-7', '7898123456794', 'DESCARTAVEL', 'UN', 0.40, 1.00, 1000, 10),
    (v_company_id, 'Atadura de crepe 10cm', 'AT-CRP-10', '7898123456800', 'DESCARTAVEL', 'UN', 1.20, 3.00, 400, 11),
    (v_company_id, 'Esparadrapo 5cm x 4,5m', 'ESP-5', '7898123456817', 'DESCARTAVEL', 'UN', 4.50, 9.00, 200, 12),
    (v_company_id, 'Micropore 5cm x 10m', 'MIC-5', '7898123456824', 'DESCARTAVEL', 'UN', 5.80, 12.00, 200, 13),
    (v_company_id, 'Álcool 70% 1L', 'AL-70-1L', '7898123456831', 'ESCRITORIO', 'UN', 8.50, 18.00, 100, 14),
    (v_company_id, 'PVPI tópico 1L', 'PVPI-1L', '7898123456848', 'DESCARTAVEL', 'UN', 22.00, 45.00, 60, 15),
    (v_company_id, 'Soro fisiológico 0,9% 500mL', 'SF-500', '7898123456855', 'DESCARTAVEL', 'UN', 4.20, 9.50, 800, 16),
    (v_company_id, 'Ringer Lactato 500mL', 'RL-500', '7898123456862', 'DESCARTAVEL', 'UN', 5.80, 12.00, 400, 17),
    (v_company_id, 'Equipo macrogotas', 'EQ-MAC', '7898123456879', 'DESCARTAVEL', 'UN', 2.20, 5.00, 600, 18),
    (v_company_id, 'Tubo endotraqueal 7,5', 'TET-7-5', '7898123456886', 'INSTRUMENTAL', 'UN', 18.00, 38.00, 50, 19),
    (v_company_id, 'Cateter venoso periférico 20G', 'CT-20G', '7898123456893', 'DESCARTAVEL', 'UN', 3.50, 8.00, 300, 20)
  ON CONFLICT DO NOTHING;

  -- Coleta IDs dos materiais
  FOR i IN 1..20 LOOP
    SELECT id INTO v_mat_id FROM public.materiais
    WHERE company_id = v_company_id AND cd_origem_sigh = i
    ORDER BY id LIMIT 1;
    IF v_mat_id IS NOT NULL THEN
      v_mat_ids := array_append(v_mat_ids, v_mat_id);
    END IF;
  END LOOP;

  RAISE NOTICE 'Materiais cadastrados: %', array_length(v_mat_ids, 1);

  -- 5. 100 lotes de exemplo (50 medicamentos + 50 materiais)
  --    Distribui entre 3 almoxarifados, com validades variadas para testar FEFO.
  FOR i IN 1..50 LOOP
    IF v_med_ids[i] IS NULL THEN CONTINUE; END IF;

    -- 1 lote por medicamento, validade entre 60 e 720 dias
    v_validade := CURRENT_DATE + ((60 + (i * 13) % 660))::INTEGER * INTERVAL '1 day';
    v_qt := 100 + (i * 7) % 400;
    v_almox := v_almox_ids[((i - 1) % 3) + 1];
    v_lote_seq := v_lote_seq + 1;

    INSERT INTO public.lotes (
      company_id, cd_produto_tipo, cd_medicamento_id, cd_lote, dt_validade,
      qt_inicial, qt_atual, vl_custo_unitario, cd_almoxarifado, nr_lote_fabricante
    ) VALUES (
      v_company_id, 'MEDICAMENTO', v_med_ids[i],
      'L' || LPAD(v_lote_seq::TEXT, 6, '0'),
      v_validade, v_qt, v_qt,
      (i * 0.25)::DECIMAL(10,2), v_almox,
      'FAB-' || LPAD(i::TEXT, 4, '0')
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Materiais: 2-3 lotes por material (total ~50 lotes)
  FOR i IN 1..20 LOOP
    IF v_mat_ids[i] IS NULL THEN CONTINUE; END IF;

    FOR j IN 1..(2 + (i % 2)) LOOP
      -- Validades variadas: -10, 20, 60, 200, 500 dias
      v_validade := CURRENT_DATE + ((-10 + (i + j * 17) % 510))::INTEGER * INTERVAL '1 day';
      v_qt := 200 + (i * 11 + j * 31) % 800;
      v_almox := v_almox_ids[((i + j) % 3) + 1];
      v_lote_seq := v_lote_seq + 1;

      INSERT INTO public.lotes (
        company_id, cd_produto_tipo, cd_material_id, cd_lote, dt_validade,
        qt_inicial, qt_atual, vl_custo_unitario, cd_almoxarifado, nr_lote_fabricante
      ) VALUES (
        v_company_id, 'MATERIAL', v_mat_ids[i],
        'L' || LPAD(v_lote_seq::TEXT, 6, '0'),
        v_validade, v_qt, v_qt,
        ((i + j) * 0.5)::DECIMAL(10,2), v_almox,
        'FAB-M' || LPAD((i * 10 + j)::TEXT, 5, '0')
      ) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Total de lotes criados: %', v_lote_seq;
  RAISE NOTICE 'Seed de farmácia concluído com sucesso!';
END $$;

-- =============================================================================
-- Seed: insurance_companies + insurance_plans (SIGH: 30 + 28)
-- =============================================================================

DO $$
DECLARE
  v_company_id UUID;
  v_payment_source_id INTEGER;
  v_insurance_id INTEGER;
BEGIN
  SELECT id INTO v_company_id FROM public.companies WHERE status = 'active' LIMIT 1;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Nenhuma empresa ativa encontrada.'; END IF;

  -- Convenio 1: PARTICULAR NITEROI
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 25 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'PARTICULAR NITEROI', NULL, 1)
  RETURNING id INTO v_insurance_id;

  -- Convenio 2: ASSIM NITEROI (AMBULATORIAL)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = NULL AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (AMBULATORIAL)', '309222', 2)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 350);

  -- Convenio 4: ASSIM NITEROI (ASSIM MAX QC )
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (ASSIM MAX QC )', '309222', 4)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 131);

  -- Convenio 5: CABERJ (SG)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 67 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'CABERJ (SG)', '324361', 5)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '42533813000197', 360);

  -- Convenio 6: ASSIM NITEROI (COMPLETO)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (COMPLETO)', '309222', 6)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 351);

  -- Convenio 7: ASSIM NITEROI (ESSENCIAL NITEROI)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (ESSENCIAL NITEROI)', '309222', 7)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 205);

  -- Convenio 8: ASSIM NITEROI (DIRECTO)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (DIRECTO)', '309222', 8)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 138);

  -- Convenio 9: NAO USAR
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'NAO USAR', '309222', 9)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRÃO', '46930', 4);

  -- Convenio 10: ASSIM NITEROI (ABSOLUTO CORP)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (ABSOLUTO CORP)', '309222', 10)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 128);

  -- Convenio 11: ASSIM NITEROI (ABSOLUTO)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (ABSOLUTO)', '309222', 11)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 129);

  -- Convenio 12: ASSIM NITEROI (BASICO)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (BASICO)', '309222', 12)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 134);

  -- Convenio 13: ASSIM POLICLINICA ( SG )
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM POLICLINICA ( SG )', NULL, 13)
  RETURNING id INTO v_insurance_id;

  -- Convenio 14: ASSIM NITEROI (CLASSICO ADESAO)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (CLASSICO ADESAO)', '309222', 14)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 135);

  -- Convenio 16: PETROBRAS (NITEROI)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 15 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'PETROBRAS (NITEROI)', '422631', 16)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '31828999000195', 28);

  -- Convenio 17: AMIL NITEROI (BASICO )
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'AMIL NITEROI (BASICO )', '326305', 17)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRÃO', '10430237', 118);

  -- Convenio 18: ASSIM NITEROI (AMBULATORIAL ASSIM)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (AMBULATORIAL ASSIM)', '309222', 18)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 130);

  -- Convenio 19: ASSIM NITEROI (AZUL-SDT)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (AZUL-SDT)', '309222', 19)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 133);

  -- Convenio 20: ASSIM NITEROI (ESSENCIAL CONCEPT)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (ESSENCIAL CONCEPT)', '309222', 20)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 207);

  -- Convenio 21: SULAMERICA NITEROI 
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 18 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'SULAMERICA NITEROI ', '006246', 21)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '318289990001', 32);

  -- Convenio 22: ASSIM NITEROI (CLASSICO Z)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (CLASSICO Z)', '309222', 22)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 136);

  -- Convenio 23: ASSIM NITEROI (CLASSICO)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (CLASSICO)', '309222', 23)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 137);

  -- Convenio 24: ASSIM NITEROI (ESSENCIAL)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (ESSENCIAL)', '309222', 24)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 203);

  -- Convenio 25: ASSIM NITEROI (AZUL)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (AZUL)', '309222', 25)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 132);

  -- Convenio 31: ASSIM NITEROI ( COMPLETO PLUS)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI ( COMPLETO PLUS)', '309222', 31)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 6);

  -- Convenio 33: ASSIM NITEROI (EXCLUSIVO)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (EXCLUSIVO)', '309222', 33)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 198);

  -- Convenio 34: ASSIM NITEROI (EXCLUSIVO II )
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (EXCLUSIVO II )', '309222', 34)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 352);

  -- Convenio 35: ASSIM NITEROI (EXCLUSIVO III) 
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (EXCLUSIVO III) ', '309222', 35)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 201);

  -- Convenio 36: ASSIM NITEROI(EXPRESS)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI(EXPRESS)', '309222', 36)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 139);

  -- Convenio 37: ASSIM NITEROI (EXPRESS NITEROI)
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (EXPRESS NITEROI)', '309222', 37)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 196);

  -- Convenio 38: ASSIM NITEROI (FIK )
  SELECT id INTO v_payment_source_id FROM public.payment_sources WHERE cd_origem_sigh = 48 AND company_id = v_company_id LIMIT 1;
  INSERT INTO public.insurance_companies (company_id, payment_source_id, name, registro_ans, cd_origem_sigh)
  VALUES (v_company_id, v_payment_source_id, 'ASSIM NITEROI (FIK )', '309222', 38)
  RETURNING id INTO v_insurance_id;
  INSERT INTO public.insurance_plans (company_id, insurance_company_id, name, codigo, cd_origem_sigh) VALUES (v_company_id, v_insurance_id, 'PADRAO', '46930', 194);

  RAISE NOTICE 'Seed concluido';
END $$;

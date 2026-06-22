-- =============================================================================
-- Seed: payment_sources (SIGH.fonte_pagadora - 53 registros)
-- Fonte: 6083041e1bde.sn.mynetname.net:47777 / DataSIGH
-- Data extracao: 2026-06-22
-- =============================================================================

DO $$
DECLARE v_company_id UUID;
BEGIN
  SELECT id INTO v_company_id FROM public.companies WHERE status = 'active' LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa encontrada.';
  END IF;

  INSERT INTO public.payment_sources (company_id, name, type, cnpj, lg_ativo, cd_origem_sigh) VALUES
    (v_company_id, 'UNIMED', 'CONVENIO', '27578434000120', TRUE, 1),
    (v_company_id, 'ASSEFAZ', 'CONVENIO', '00628107002203', TRUE, 2),
    (v_company_id, 'BANESCAIXA', 'CONVENIO', '28502128000172', TRUE, 3),
    (v_company_id, 'ABBERTTA SAÚDE (BELGO MINEIRA)', 'CONVENIO', '17505793000101', TRUE, 4),
    (v_company_id, 'CAPE SAUDE', 'CONVENIO', '30036685000197', TRUE, 5),
    (v_company_id, 'CODESA', 'CONVENIO', '2731653800066', TRUE, 6),
    (v_company_id, 'CORREIOS', 'CONVENIO', '18275071000162', TRUE, 7),
    (v_company_id, 'ARCELOR MITTAL', 'CONVENIO', '17469701010482', TRUE, 8),
    (v_company_id, 'VALE', 'CONVENIO', '33592510001711', TRUE, 9),
    (v_company_id, 'PASA', 'CONVENIO', '33592510001711', TRUE, 10),
    (v_company_id, 'EMBRATEL', 'CONVENIO', '40432544078170', TRUE, 11),
    (v_company_id, 'SAUDE CAIXA', 'CONVENIO', '00360305016884', TRUE, 12),
    (v_company_id, 'LIFE EMPRESARIAL', 'CONVENIO', NULL, TRUE, 13),
    (v_company_id, 'MEDSERVICE', 'CONVENIO', '57746455000178', TRUE, 14),
    (v_company_id, 'PETROBRAS BR', 'CONVENIO', '33000167000101', TRUE, 15),
    (v_company_id, 'PETROBRAS DISTRIB', 'CONVENIO', '34274233004000', TRUE, 16),
    (v_company_id, 'SAMP', 'CONVENIO', '02403281000159', TRUE, 17),
    (v_company_id, 'SULAMÉRICA', 'CONVENIO', '33041062001334', TRUE, 18),
    (v_company_id, 'SUS', 'SUS', '27080630500019', TRUE, 19),
    (v_company_id, 'USIMINAS', 'CONVENIO', '19878404000100', TRUE, 20),
    (v_company_id, 'CORTESIA', 'CORTESIA', NULL, TRUE, 21),
    (v_company_id, 'SANTA CASA SAUDE', 'CONVENIO', '28141190000267', TRUE, 24),
    (v_company_id, 'PARTICULAR', 'PARTICULAR', NULL, TRUE, 25),
    (v_company_id, 'CAIXA ECONOMICA FEDERAL', 'CONVENIO', NULL, TRUE, 41),
    (v_company_id, 'BANESTES', 'CONVENIO', NULL, TRUE, 43),
    (v_company_id, 'CESAN', 'CONVENIO', '28151363000147', TRUE, 45),
    (v_company_id, 'ASSIM POLICLINICA ( SG )', 'CONVENIO', NULL, TRUE, 48),
    (v_company_id, 'ALLIANZ', 'CONVENIO', NULL, TRUE, 49),
    (v_company_id, 'MEMORIAL SAUDE - SG', 'CONVENIO', NULL, TRUE, 50),
    (v_company_id, 'MEMORIAL- SG', 'CONVENIO', NULL, TRUE, 51),
    (v_company_id, 'CAREPLUS', 'CONVENIO', NULL, TRUE, 52),
    (v_company_id, 'GAMA', 'CONVENIO', NULL, TRUE, 53),
    (v_company_id, 'GEAP', 'CONVENIO', '03658432000182', TRUE, 54),
    (v_company_id, 'MEDSENIOR', 'CONVENIO', NULL, TRUE, 55),
    (v_company_id, 'MEMORIAL', 'CONVENIO', NULL, TRUE, 56),
    (v_company_id, 'PORTO SEGURO', 'CONVENIO', NULL, TRUE, 57),
    (v_company_id, 'REAL GRANDEZA', 'CONVENIO', NULL, TRUE, 58),
    (v_company_id, 'SAUDE ITAU', 'CONVENIO', NULL, TRUE, 59),
    (v_company_id, 'ASSIM', 'CONVENIO', NULL, TRUE, 60),
    (v_company_id, 'MAPFRE', 'CONVENIO', NULL, TRUE, 61),
    (v_company_id, 'APPAI', 'CONVENIO', NULL, TRUE, 62),
    (v_company_id, 'CAMARJ', 'CONVENIO', NULL, TRUE, 63),
    (v_company_id, 'EVERCROSS', 'CONVENIO', NULL, TRUE, 64),
    (v_company_id, 'IPALERJ', 'CONVENIO', NULL, TRUE, 65),
    (v_company_id, 'HEALTHMED', 'CONVENIO', NULL, TRUE, 66),
    (v_company_id, 'CABERJ - SG', 'CONVENIO', NULL, TRUE, 67),
    (v_company_id, 'BRADESCO - SG - 101503', 'CONVENIO', NULL, TRUE, 68),
    (v_company_id, 'BRADESCO - SG', 'CONVENIO', NULL, TRUE, 69),
    (v_company_id, 'PARCERIA AMOR SAUDE', 'CONVENIO', NULL, TRUE, 70),
    (v_company_id, 'AMIL SAUDE', 'CONVENIO', NULL, TRUE, 71),
    (v_company_id, 'NOTREDAME', 'CONVENIO', NULL, TRUE, 72),
    (v_company_id, 'INTERMÉDICA', 'CONVENIO', NULL, TRUE, 73),
    (v_company_id, 'KLINI', 'CONVENIO', NULL, TRUE, 74)
  ON CONFLICT DO NOTHING;
  RAISE NOTICE 'Seed payment_sources: 53 registros';
END $$;

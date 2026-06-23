-- =============================================================================
-- Seed: Compras + Transporte + NPS
-- Descrição: Dados iniciais sintéticos para o módulo Compras, Transporte e NPS.
--
-- IMPORTANTE: este seed é idempotente. Usa ON CONFLICT para não duplicar
-- registros em re-runs. company_id é fixado para o tenant de demo.
-- =============================================================================

-- ID de empresa demo (mesmo usado em outros seeds do projeto)
DO $$
DECLARE
  v_company_id UUID := '00000000-0000-0000-0000-000000000001';
  v_fornecedor_medicamentos_id BIGINT;
  v_fornecedor_materiais_id BIGINT;
  v_fornecedor_equipamentos_id BIGINT;
  v_fornecedor_servicos_id BIGINT;
  v_fornecedor_outros_id BIGINT;
  v_pesquisa_nps_id BIGINT;
BEGIN
  -- ==========================================================================
  -- 1. Fornecedores
  -- ==========================================================================

  INSERT INTO public.fornecedores
    (company_id, nm_razao_social, nm_fantasia, cd_cnpj, cd_inscricao_estadual, ds_endereco, cd_cep, ds_cidade, ds_uf, nr_telefone, ds_email, ds_contato, tp_fornecedor, vl_prazo_pagto_dias)
  VALUES
    (v_company_id, 'MEDBRAS Distribuidora de Medicamentos Ltda', 'MEDBRAS', '11222333000144', '123456789', 'Av. Brasil 1000', '01310100', 'São Paulo', 'SP', '1133334444', 'contato@medbras.com.br', 'Carlos Mendes', 'MEDICAMENTOS', 30),
    (v_company_id, 'Hospitalar Suprimentos Médicos S.A.', 'HOSPITALAR', '22333444000155', '987654321', 'Rua das Industrias 500', '04567890', 'São Paulo', 'SP', '1155556666', 'vendas@hosp.com.br', 'Patrícia Souza', 'MATERIAIS', 45),
    (v_company_id, 'GE Healthcare do Brasil', 'GE Healthcare', '33444555000166', '456789123', 'Av. Paulista 2000', '01310000', 'São Paulo', 'SP', '1177778888', 'saude@ge.com', 'Roberto Lima', 'EQUIPAMENTOS', 60),
    (v_company_id, 'LimpClin Serviços de Limpeza Hospitalar', 'LimpClin', '44555666000177', '321654987', 'Rua dos Serviços 100', '02345000', 'São Paulo', 'SP', '1199990000', 'comercial@limpclin.com.br', 'Maria Silva', 'SERVICOS', 15),
    (v_company_id, 'Papelaria e Escritório Central', 'Papelaria Central', '55666777000188', '789456123', 'Rua do Comércio 50', '03010000', 'São Paulo', 'SP', '1122223333', 'vendas@papelariacentral.com.br', 'João Santos', 'OUTROS', 7)
  ON CONFLICT (cd_cnpj) DO NOTHING;

  SELECT id INTO v_fornecedor_medicamentos_id FROM public.fornecedores WHERE cd_cnpj = '11222333000144' AND company_id = v_company_id;
  SELECT id INTO v_fornecedor_materiais_id    FROM public.fornecedores WHERE cd_cnpj = '22333444000155' AND company_id = v_company_id;
  SELECT id INTO v_fornecedor_equipamentos_id FROM public.fornecedores WHERE cd_cnpj = '33444555000166' AND company_id = v_company_id;
  SELECT id INTO v_fornecedor_servicos_id     FROM public.fornecedores WHERE cd_cnpj = '44555666000177' AND company_id = v_company_id;
  SELECT id INTO v_fornecedor_outros_id       FROM public.fornecedores WHERE cd_cnpj = '55666777000188' AND company_id = v_company_id;

  -- ==========================================================================
  -- 2. Veículos
  -- ==========================================================================

  INSERT INTO public.veiculos (company_id, nr_placa, ds_modelo, nr_ano, ds_tipo, cd_renavam, nr_capacidade, lg_ativo)
  VALUES
    (v_company_id, 'ABC1D23', 'Mercedes Sprinter 2020', 2020, 'AMBULANCIA_SIMPLES', '1234567890', 4, TRUE),
    (v_company_id, 'XYZ4E56', 'Renault Master 2022', 2022, 'AMBULANCIA_UTI', '9876543210', 2, TRUE)
  ON CONFLICT (company_id, nr_placa) DO NOTHING;

  -- ==========================================================================
  -- 3. Equipe de Transporte
  -- ==========================================================================

  INSERT INTO public.equipe_transporte (company_id, nm_nome, cd_cpf, tp_funcao, nr_cnh, cd_categoria_cnh, dt_validade_cnh, lg_ativo)
  VALUES
    (v_company_id, 'José da Silva Motorista', '11122233344', 'MOTORISTA', '12345678901', 'D', '2027-12-31', TRUE),
    (v_company_id, 'Carlos Souza Motorista', '22233344455', 'MOTORISTA', '23456789012', 'D', '2026-08-15', TRUE),
    (v_company_id, 'Ana Paula Técnica', '33344455566', 'TECNICO_ENFERMAGEM', NULL, NULL, NULL, TRUE),
    (v_company_id, 'Dr. Pedro Mendes', '44455566677', 'MEDICO', NULL, NULL, NULL, TRUE)
  ON CONFLICT DO NOTHING;

  -- ==========================================================================
  -- 4. Pesquisa NPS modelo
  -- ==========================================================================

  INSERT INTO public.nps_pesquisas
    (company_id, ds_titulo, ds_descricao, dt_inicio, dt_fim, tp_publico, cd_template_perguntas, lg_ativo)
  VALUES
    (v_company_id,
     'Pesquisa de Satisfação 2026',
     'Avalie sua experiência com nossa clínica. Sua opinião é fundamental para melhorarmos continuamente.',
     '2026-01-01',
     '2026-12-31',
     'TODOS_PACIENTES',
     '[
       {"id": "q1", "texto": "De 0 a 10, o quanto você recomendaria nossa clínica a um amigo ou familiar?", "tipo": "NPS", "obrigatoria": true},
       {"id": "q2", "texto": "Como você avalia o atendimento da recepção?", "tipo": "ESCALA_5", "obrigatoria": true},
       {"id": "q3", "texto": "Como você avalia o tempo de espera?", "tipo": "ESCALA_5", "obrigatoria": true},
       {"id": "q4", "texto": "Deixe seu comentário (opcional)", "tipo": "TEXTO", "obrigatoria": false}
     ]'::jsonb,
     TRUE)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_pesquisa_nps_id
    FROM public.nps_pesquisas
    WHERE ds_titulo = 'Pesquisa de Satisfação 2026' AND company_id = v_company_id
    LIMIT 1;

  RAISE NOTICE 'Seed Compras+Transporte+NPS concluído. Pesquisa NPS id=%', v_pesquisa_nps_id;
END $$;

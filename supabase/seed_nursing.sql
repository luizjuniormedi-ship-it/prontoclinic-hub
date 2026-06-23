-- =============================================================================
-- Seed: Classificações de risco (Manchester) + Fluxograma principal
-- Aplicar após a migration 20260101000016_enfermagem.
-- Idempotente: usa ON CONFLICT para não duplicar dados em re-execuções.
-- =============================================================================

-- Classificações Manchester (5 cores padronizadas)
INSERT INTO public.mnct_classificacao_risco
  (ds_classificacao, cd_cor_hex, nr_tempo_max_atendimento_min, ds_descricao)
VALUES
  ('VERMELHO', '#DC2626', 0,   'Emergência — atendimento imediato'),
  ('LARANJA',  '#EA580C', 10,  'Muito urgente — até 10 minutos'),
  ('AMARELO',  '#CA8A04', 60,  'Urgente — até 60 minutos'),
  ('VERDE',    '#16A34A', 120, 'Pouco urgente — até 120 minutos'),
  ('AZUL',     '#2563EB', 240, 'Não urgente — até 240 minutos')
ON CONFLICT (ds_classificacao) DO UPDATE SET
  cd_cor_hex                   = EXCLUDED.cd_cor_hex,
  nr_tempo_max_atendimento_min = EXCLUDED.nr_tempo_max_atendimento_min,
  ds_descricao                 = EXCLUDED.ds_descricao,
  lg_ativo                     = TRUE;

-- Fluxograma Manchester — perguntas principais (10 discriminadores mais comuns)
INSERT INTO public.mnct_fluxograma
  (ds_discriminador, ds_pergunta, cd_classificacao_se_sim, cd_ordem, ds_categoria)
VALUES
  -- Respiratório
  ('Dispneia grave',         'Há sinais de dificuldade respiratória grave?',                  'VERMELHO', 1,  'RESPIRATORIO'),
  ('Saturação O2 baixa',     'SpO2 < 90% em ar ambiente?',                                     'LARANJA',  2,  'RESPIRATORIO'),
  -- Cardiovascular
  ('Choque',                 'Há sinais de choque circulatório (palidez, sudorese fria)?',     'VERMELHO', 3,  'CARDIOVASCULAR'),
  ('Dor torácica',           'Há dor torácica sugestiva de síndrome coronariana aguda?',       'LARANJA',  4,  'CARDIOVASCULAR'),
  ('Bradicardia/Taquicardia','FC < 50 bpm ou > 120 bpm com sintomas?',                        'AMARELO',  5,  'CARDIOVASCULAR'),
  -- Neurológico
  ('Alteração consciência',  'Há alteração aguda do nível de consciência (Glasgow < 13)?',      'VERMELHO', 6,  'NEUROLOGICO'),
  ('Convulsão',              'Há convulsão ativa ou pós-ictal (até 30 min)?',                  'VERMELHO', 7,  'NEUROLOGICO'),
  -- Dor
  ('Dor severa',             'Há dor severa (≥ 7/10 na EVA)?',                                 'LARANJA',  8,  'DOR'),
  -- Febre/Infecção
  ('Febre alta',             'Temperatura axilar ≥ 39°C em adulto?',                            'AMARELO',  9,  'INFECCAO'),
  -- Sangramento / Trauma
  ('Sangramento ativo',      'Há sangramento ativo não controlado?',                            'LARANJA',  10, 'CIRURGICO'),
  -- Gastrointestinal
  ('Vômito persistente',    'Há vômito persistente ou hematêmese?',                            'AMARELO',  11, 'GASTROINTESTINAL'),
  -- Psiquiátrico
  ('Risco suicida',          'Há ideação suicida ou agitação psicomotora grave?',               'VERMELHO', 12, 'PSIQUIATRICO')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Fim do seed nursing
-- =============================================================================

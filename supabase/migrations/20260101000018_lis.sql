-- =============================================================================
-- Migration: 20260101000018_lis
-- Descrição: Módulo LIS (Laboratory Information System)
--            Interfaceamento HL7 v2.5, catálogo de exames, pedidos, resultados
--            e alertas de valores críticos.
--
-- Compatibilidade: HL7 v2.5 ANSI (Health Level Seven International).
--                  ORU^R01 (Observational Result Unsolicited).
-- =============================================================================

-- 1.1. Catálogo de exames laboratoriais
CREATE TABLE IF NOT EXISTS public.exames_lab_catalogo (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ds_exame VARCHAR(200) NOT NULL,                  -- 'Hemograma completo'
  ds_sigla VARCHAR(20) NOT NULL,                   -- 'HC', 'Glicemia'
  cd_tuss VARCHAR(20),                             -- código TUSS
  cd_loinc VARCHAR(20),                            -- Logical Observation Identifiers
  ds_categoria VARCHAR(50),                        -- 'HEMATOLOGIA', 'BIOQUIMICA', 'URINALISE'
  ds_metodo VARCHAR(100),                          -- método de análise
  ds_material VARCHAR(50),                         -- 'SANGUE', 'URINA', 'FEZES'
  nr_prazo_dias SMALLINT DEFAULT 3,                -- prazo de entrega
  vl_particular DECIMAL(10,2),
  vl_convenio DECIMAL(10,2),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_exame_lab_sigla UNIQUE (company_id, ds_sigla)
);

CREATE INDEX IF NOT EXISTS idx_exames_lab_catalogo_company ON public.exames_lab_catalogo(company_id);
CREATE INDEX IF NOT EXISTS idx_exames_lab_catalogo_categoria ON public.exames_lab_catalogo(ds_categoria);
CREATE INDEX IF NOT EXISTS idx_exames_lab_catalogo_ativo ON public.exames_lab_catalogo(company_id, lg_ativo) WHERE lg_ativo = TRUE;

DROP TRIGGER IF EXISTS trg_exames_lab_catalogo_updated_at ON public.exames_lab_catalogo;
CREATE TRIGGER trg_exames_lab_catalogo_updated_at
  BEFORE UPDATE ON public.exames_lab_catalogo
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.exames_lab_catalogo IS 'Catálogo de exames laboratoriais (sigla + TUSS + LOINC)';

-- 1.2. Valores de referência (por faixa etária e sexo)
CREATE TABLE IF NOT EXISTS public.exames_lab_valor_referencia (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_exame BIGINT NOT NULL REFERENCES public.exames_lab_catalogo(id) ON DELETE CASCADE,
  ds_parametro VARCHAR(100) NOT NULL,              -- 'Hemácias', 'Leucócitos'
  vl_minimo DECIMAL(15,6),
  vl_maximo DECIMAL(15,6),
  ds_unidade VARCHAR(20),                          -- 'milhões/mm³', 'g/dL'
  cd_sexo CHAR(1) CHECK (cd_sexo IN ('M', 'F', 'A')),  -- A = ambos
  nr_idade_min SMALLINT DEFAULT 0,
  nr_idade_max SMALLINT DEFAULT 120,
  lg_ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_valor_ref_exame ON public.exames_lab_valor_referencia(cd_exame);
CREATE INDEX IF NOT EXISTS idx_valor_ref_param ON public.exames_lab_valor_referencia(cd_exame, ds_parametro);

-- 1.3. Pedidos de exame
CREATE TABLE IF NOT EXISTS public.exames_lab_pedido (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_exame BIGINT REFERENCES public.exames_lab_catalogo(id),
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  cd_medico BIGINT NOT NULL REFERENCES public.professionals(id),
  cd_appointment BIGINT REFERENCES public.appointments(id),
  dt_pedido TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cd_tipo_atendimento VARCHAR(20) DEFAULT 'AMBULATORIAL' CHECK (cd_tipo_atendimento IN ('AMBULATORIAL', 'INTERNACAO', 'URGENCIA', 'DOMICILIAR')),
  tp_prioridade VARCHAR(20) DEFAULT 'ROTINA' CHECK (tp_prioridade IN ('ROTINA', 'URGENTE', 'EMERGENCIA')),
  ds_hipotese_diagnostica TEXT,
  ds_observacoes TEXT,
  tp_status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE' CHECK (tp_status IN ('PENDENTE', 'COLETADO', 'EM_ANALISE', 'LIBERADO', 'ENTREGUE', 'CANCELADO')),
  dt_coleta TIMESTAMPTZ,
  dt_liberacao TIMESTAMPTZ,
  cd_lab_externo VARCHAR(100),                     -- nome do lab que processou
  nr_protocolo_lab VARCHAR(50),                    -- protocolo do lab externo
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exames_lab_pedido_company ON public.exames_lab_pedido(company_id, dt_pedido DESC);
CREATE INDEX IF NOT EXISTS idx_exames_lab_pedido_paciente ON public.exames_lab_pedido(cd_paciente, dt_pedido DESC);
CREATE INDEX IF NOT EXISTS idx_exames_lab_pedido_medico ON public.exames_lab_pedido(cd_medico, dt_pedido DESC);
CREATE INDEX IF NOT EXISTS idx_exames_lab_pedido_status ON public.exames_lab_pedido(company_id, tp_status) WHERE tp_status IN ('PENDENTE', 'COLETADO', 'EM_ANALISE');

COMMENT ON TABLE public.exames_lab_pedido IS 'Pedidos de exame (header) com workflow de status';

-- 1.4. Itens do pedido (1 pedido = N exames)
CREATE TABLE IF NOT EXISTS public.exames_lab_pedido_itens (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_pedido BIGINT NOT NULL REFERENCES public.exames_lab_pedido(id) ON DELETE CASCADE,
  cd_exame BIGINT NOT NULL REFERENCES public.exames_lab_catalogo(id),
  tp_status VARCHAR(20) DEFAULT 'PENDENTE' CHECK (tp_status IN ('PENDENTE', 'COLETADO', 'EM_ANALISE', 'LIBERADO', 'CANCELADO')),
  dt_coleta TIMESTAMPTZ,
  dt_liberacao TIMESTAMPTZ,
  ds_amostra_id VARCHAR(50),                       -- código da amostra no lab
  ds_observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido ON public.exames_lab_pedido_itens(cd_pedido);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_exame ON public.exames_lab_pedido_itens(cd_exame);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_status ON public.exames_lab_pedido_itens(cd_pedido, tp_status);

-- 1.5. Resultados de exames
CREATE TABLE IF NOT EXISTS public.exames_lab_resultado (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_pedido BIGINT REFERENCES public.exames_lab_pedido(id),
  cd_exame BIGINT REFERENCES public.exames_lab_catalogo(id),
  cd_item_pedido BIGINT NOT NULL REFERENCES public.exames_lab_pedido_itens(id) ON DELETE CASCADE,
  cd_valor_referencia BIGINT REFERENCES public.exames_lab_valor_referencia(id),
  ds_parametro VARCHAR(100) NOT NULL,
  vl_resultado DECIMAL(15,6),
  vl_resultado_texto VARCHAR(200),                 -- para resultados não numéricos
  ds_unidade VARCHAR(20),
  vl_minimo_referencia DECIMAL(15,6),
  vl_maximo_referencia DECIMAL(15,6),
  tp_resultado VARCHAR(20) CHECK (tp_resultado IN ('NORMAL', 'BAIXO', 'ALTO', 'CRITICO_BAIXO', 'CRITICO_ALTO', 'INCONCLUSIVO')),
  dt_resultado TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cd_equipamento VARCHAR(50),                      -- ID do analisador
  cd_lote_reagente VARCHAR(50),
  cd_usuario_laboratorio UUID,
  ds_observacao TEXT,
  -- HL7 v2.5 raw
  ds_hl7_message TEXT,                             -- mensagem ORU original
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resultado_item ON public.exames_lab_resultado(cd_item_pedido);
CREATE INDEX IF NOT EXISTS idx_resultado_tipo ON public.exames_lab_resultado(tp_resultado) WHERE tp_resultado IN ('CRITICO_BAIXO', 'CRITICO_ALTO');
CREATE INDEX IF NOT EXISTS idx_resultado_data ON public.exames_lab_resultado(dt_resultado DESC);
CREATE INDEX IF NOT EXISTS idx_resultado_param ON public.exames_lab_resultado(ds_parametro);

-- 1.6. Valores críticos (alertas)
CREATE TABLE IF NOT EXISTS public.exames_lab_alerta_critico (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_resultado BIGINT NOT NULL REFERENCES public.exames_lab_resultado(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL,
  cd_medico BIGINT NOT NULL,
  dt_alerta TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tp_alerta VARCHAR(20) CHECK (tp_alerta IN ('CRITICO_BAIXO', 'CRITICO_ALTO')),
  ds_parametro VARCHAR(100),
  vl_resultado DECIMAL(15,6),
  vl_referencia VARCHAR(50),
  lg_comunicado BOOLEAN DEFAULT FALSE,             -- foi comunicado ao médico?
  dt_comunicacao TIMESTAMPTZ,
  cd_usuario_comunicou UUID,
  ds_forma_comunicacao VARCHAR(50),                -- 'TELEFONE', 'SMS', 'PRESENCIAL'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerta_paciente ON public.exames_lab_alerta_critico(cd_paciente, dt_alerta DESC);
CREATE INDEX IF NOT EXISTS idx_alerta_pendente ON public.exames_lab_alerta_critico(lg_comunicado, dt_alerta) WHERE lg_comunicado = FALSE;
CREATE INDEX IF NOT EXISTS idx_alerta_resultado ON public.exames_lab_alerta_critico(cd_resultado);

-- 1.7. RLS
ALTER TABLE public.exames_lab_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_valor_referencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_resultado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_alerta_critico ENABLE ROW LEVEL SECURITY;

-- Helper para checar permissão de laboratório
CREATE OR REPLACE FUNCTION public.is_lab_user(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = uid AND role_name IN ('admin', 'laboratório', 'medico')
  );
$$;

-- Policies
DROP POLICY IF EXISTS "Authenticated can read lab catalog" ON public.exames_lab_catalogo;
CREATE POLICY "Authenticated can read lab catalog" ON public.exames_lab_catalogo
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Lab can manage exam catalog" ON public.exames_lab_catalogo;
CREATE POLICY "Lab can manage exam catalog" ON public.exames_lab_catalogo
  FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND public.is_lab_user(auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated can read lab ref values" ON public.exames_lab_valor_referencia;
CREATE POLICY "Authenticated can read lab ref values" ON public.exames_lab_valor_referencia
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Lab can manage ref values" ON public.exames_lab_valor_referencia;
CREATE POLICY "Lab can manage ref values" ON public.exames_lab_valor_referencia
  FOR ALL TO authenticated
  USING (public.is_lab_user(auth.uid()))
  WITH CHECK (public.is_lab_user(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can read lab orders" ON public.exames_lab_pedido;
CREATE POLICY "Authenticated can read lab orders" ON public.exames_lab_pedido
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Lab can manage lab orders" ON public.exames_lab_pedido;
CREATE POLICY "Lab can manage lab orders" ON public.exames_lab_pedido
  FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND public.is_lab_user(auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated can read lab order items" ON public.exames_lab_pedido_itens;
CREATE POLICY "Authenticated can read lab order items" ON public.exames_lab_pedido_itens
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Lab can manage lab order items" ON public.exames_lab_pedido_itens;
CREATE POLICY "Lab can manage lab order items" ON public.exames_lab_pedido_itens
  FOR ALL TO authenticated
  USING (public.is_lab_user(auth.uid()))
  WITH CHECK (public.is_lab_user(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can read lab results" ON public.exames_lab_resultado;
CREATE POLICY "Authenticated can read lab results" ON public.exames_lab_resultado
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Lab can manage lab results" ON public.exames_lab_resultado;
CREATE POLICY "Lab can manage lab results" ON public.exames_lab_resultado
  FOR ALL TO authenticated
  USING (public.is_lab_user(auth.uid()))
  WITH CHECK (public.is_lab_user(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can read lab alerts" ON public.exames_lab_alerta_critico;
CREATE POLICY "Authenticated can read lab alerts" ON public.exames_lab_alerta_critico
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Lab can manage lab alerts" ON public.exames_lab_alerta_critico;
CREATE POLICY "Lab can manage lab alerts" ON public.exames_lab_alerta_critico
  FOR ALL TO authenticated
  USING (public.is_lab_user(auth.uid()))
  WITH CHECK (public.is_lab_user(auth.uid()));

-- 1.8. Função: classificar resultado
CREATE OR REPLACE FUNCTION public.classificar_resultado_lab(
  p_valor NUMERIC,
  p_minimo NUMERIC,
  p_maximo NUMERIC
)
RETURNS VARCHAR(20)
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF p_valor IS NULL OR (p_minimo IS NULL AND p_maximo IS NULL) THEN
    RETURN 'INCONCLUSIVO';
  END IF;

  IF p_minimo IS NOT NULL AND p_valor < p_minimo * 0.5 THEN
    RETURN 'CRITICO_BAIXO';
  END IF;

  IF p_maximo IS NOT NULL AND p_valor > p_maximo * 1.5 THEN
    RETURN 'CRITICO_ALTO';
  END IF;

  IF p_minimo IS NOT NULL AND p_valor < p_minimo THEN
    RETURN 'BAIXO';
  END IF;

  IF p_maximo IS NOT NULL AND p_valor > p_maximo THEN
    RETURN 'ALTO';
  END IF;

  RETURN 'NORMAL';
END;
$$;

-- 1.9. Função: parser HL7 v2.5 (ORU message)
-- HL7 v2.5 encoding: segmentos terminados em \r, campos separados por |, componentes por ^, repetições por ~
CREATE OR REPLACE FUNCTION public.parse_hl7_oru(p_message TEXT)
RETURNS TABLE(field_name TEXT, field_value TEXT)
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_segment TEXT;
  v_segtype TEXT;
  v_lines TEXT[];
BEGIN
  IF p_message IS NULL OR length(p_message) = 0 THEN
    RETURN;
  END IF;

  v_lines := string_to_array(p_message, E'\r');

  FOREACH v_segment IN ARRAY v_lines
  LOOP
    v_segtype := split_part(v_segment, '|', 1);

    IF v_segtype = 'OBX' THEN
      -- OBX|1|NM|GLUCOSE^Glicose^L|||70-99|mg/dL|||F
      field_name := 'OBX_VALUE';     field_value := split_part(v_segment, '|', 5);  RETURN NEXT;
      field_name := 'OBX_UNITS';     field_value := split_part(v_segment, '|', 6);  RETURN NEXT;
      field_name := 'OBX_REFERENCE'; field_value := split_part(v_segment, '|', 7);  RETURN NEXT;
      field_name := 'OBX_ABNORMAL';  field_value := split_part(v_segment, '|', 8);  RETURN NEXT;
    END IF;

    IF v_segtype = 'PID' THEN
      -- PID|1||MRN12345^^^MR||Doe^John||19800101|M
      field_name := 'PID_NAME'; field_value := split_part(v_segment, '|', 5); RETURN NEXT;
      field_name := 'PID_DOB';  field_value := split_part(v_segment, '|', 7); RETURN NEXT;
      field_name := 'PID_SEX';  field_value := split_part(v_segment, '|', 8); RETURN NEXT;
    END IF;

    IF v_segtype = 'OBR' THEN
      -- OBR|1||LAB123|CBC^Hemograma^L|||20250101
      field_name := 'OBR_ID';        field_value := split_part(v_segment, '|', 3); RETURN NEXT;
      field_name := 'OBR_EXAME';     field_value := split_part(v_segment, '|', 4); RETURN NEXT;
      field_name := 'OBR_DATETIME';  field_value := split_part(v_segment, '|', 7); RETURN NEXT;
    END IF;

    IF v_segtype = 'MSH' THEN
      -- MSH|^~\&|LAB|HOSP|...|20250101120000
      field_name := 'MSH_DATETIME'; field_value := split_part(v_segment, '|', 7); RETURN NEXT;
      field_name := 'MSH_MSG_TYPE'; field_value := split_part(v_segment, '|', 9); RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- 1.10. Trigger: gerar alerta crítico automaticamente
CREATE OR REPLACE FUNCTION public.fn_gerar_alerta_critico()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cd_paciente BIGINT;
  v_cd_medico BIGINT;
BEGIN
  IF NEW.tp_resultado NOT IN ('CRITICO_BAIXO', 'CRITICO_ALTO') THEN
    RETURN NEW;
  END IF;

  -- Buscar paciente e médico via pedido
  SELECT pl.cd_paciente, pl.cd_medico
    INTO v_cd_paciente, v_cd_medico
    FROM public.exames_lab_pedido_itens pi
    JOIN public.exames_lab_pedido pl ON pl.id = pi.cd_pedido
    WHERE pi.id = NEW.cd_item_pedido
    LIMIT 1;

  IF v_cd_paciente IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.exames_lab_alerta_critico (
    cd_resultado, cd_paciente, cd_medico, tp_alerta,
    ds_parametro, vl_resultado, vl_referencia
  ) VALUES (
    NEW.id, v_cd_paciente, v_cd_medico, NEW.tp_resultado,
    NEW.ds_parametro, NEW.vl_resultado,
    CONCAT_WS('-',
      COALESCE(NEW.vl_minimo_referencia::TEXT, ''),
      COALESCE(NEW.vl_maximo_referencia::TEXT, '')
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gerar_alerta_critico ON public.exames_lab_resultado;
CREATE TRIGGER trg_gerar_alerta_critico
  AFTER INSERT ON public.exames_lab_resultado
  FOR EACH ROW
  WHEN (NEW.tp_resultado IN ('CRITICO_BAIXO', 'CRITICO_ALTO'))
  EXECUTE FUNCTION public.fn_gerar_alerta_critico();

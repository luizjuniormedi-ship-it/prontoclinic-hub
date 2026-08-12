-- Farmácia: fechamento transacional, idempotente e tenant-safe.

BEGIN;

CREATE OR REPLACE FUNCTION public.m18_unit_accessible(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $fn$
  SELECT private.m18_unit_accessible_runtime(p_company_id, p_unit_id)
$fn$;

ALTER FUNCTION public.m18_unit_accessible(UUID, INTEGER)
  OWNER TO prontomedic_rpc_owner;
REVOKE ALL ON FUNCTION public.m18_unit_accessible(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m18_unit_accessible(UUID, INTEGER)
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;

ALTER TABLE public.dispensacoes
  ADD COLUMN IF NOT EXISTS operation_id UUID,
  ADD COLUMN IF NOT EXISTS request_hash TEXT,
  ADD COLUMN IF NOT EXISTS electronic_prescription_id UUID
    REFERENCES public.electronic_prescriptions(id) ON DELETE RESTRICT;

ALTER TABLE public.electronic_prescription_items
  ADD COLUMN IF NOT EXISTS dispensable_quantity INTEGER
    CHECK (dispensable_quantity IS NULL OR dispensable_quantity > 0);

ALTER TABLE public.dispensacao_itens
  ADD COLUMN IF NOT EXISTS electronic_prescription_item_id UUID
    REFERENCES public.electronic_prescription_items(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS dispensacao_itens_prescription_item_idx
  ON public.dispensacao_itens(electronic_prescription_item_id)
  WHERE electronic_prescription_item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.m20_upsert_prescription_item_secure(
  p_prescription_id UUID,
  p_item JSONB,
  p_item_id UUID DEFAULT NULL
)
RETURNS public.electronic_prescription_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $fn$
DECLARE
  v_row public.electronic_prescription_items;
  v_quantity INTEGER;
BEGIN
  IF lower(COALESCE(NULLIF(BTRIM(p_item->>'item_type'), ''), 'medication')) = 'medication' THEN
    IF COALESCE(p_item->>'medication_id', '') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Medicamento do catálogo é obrigatório'
        USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_item->>'dispensable_quantity', '') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Quantidade dispensável deve ser um inteiro positivo'
        USING ERRCODE = '22023';
    END IF;
    v_quantity := (p_item->>'dispensable_quantity')::INTEGER;
  END IF;

  v_row := private.m20_upsert_item_impl(p_prescription_id, p_item, p_item_id);
  PERFORM set_config('m20.internal_write', 'on', TRUE);
  UPDATE public.electronic_prescription_items
     SET dispensable_quantity = v_quantity,
         updated_at = NOW(),
         updated_by = auth.uid()
   WHERE id = v_row.id
     AND prescription_id = p_prescription_id
  RETURNING * INTO v_row;
  PERFORM private.m20_append_version(p_prescription_id, 'dispensable_quantity_saved', NULL);
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.m20_transition_prescription_secure(
  p_prescription_id UUID,
  p_target_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.electronic_prescriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $fn$
BEGIN
  IF lower(BTRIM(COALESCE(p_target_status, ''))) = 'signed'
     AND EXISTS (
       SELECT 1
       FROM public.electronic_prescription_items i
       WHERE i.prescription_id = p_prescription_id
         AND i.company_id = public.get_my_company_id()
         AND i.item_type = 'medication'
         AND (i.medication_id IS NULL OR i.dispensable_quantity IS NULL)
     ) THEN
    RAISE EXCEPTION 'Medicamentos exigem catálogo e quantidade dispensável antes da assinatura'
      USING ERRCODE = '23514';
  END IF;
  RETURN private.m20_transition_prescription_impl(
    p_prescription_id, p_target_status, p_reason
  );
END;
$fn$;

ALTER TABLE public.movimentacoes_estoque
  ADD COLUMN IF NOT EXISTS electronic_prescription_id UUID
    REFERENCES public.electronic_prescriptions(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS dispensacoes_company_operation_uq
  ON public.dispensacoes(company_id, operation_id)
  WHERE operation_id IS NOT NULL;

ALTER TABLE public.medicamentos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.materiais FORCE ROW LEVEL SECURITY;
ALTER TABLE public.almoxarifados FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lotes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.movimentacoes_estoque FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dispensacoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dispensacao_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.receitas_controladas FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.registrar_movimentacao_estoque(
  p_lote_id        BIGINT,
  p_tipo           VARCHAR,
  p_quantidade     INTEGER,
  p_motivo         TEXT,
  p_paciente_id    BIGINT DEFAULT NULL,
  p_appointment_id BIGINT DEFAULT NULL,
  p_prescricao_id  BIGINT DEFAULT NULL,
  p_observacao     TEXT DEFAULT NULL
)
RETURNS TABLE(id BIGINT, qt_anterior INTEGER, qt_posterior INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
SET row_security = off
AS $fn$
DECLARE
  v_lote public.lotes;
  v_company_id UUID := public.get_my_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_qt_posterior INTEGER;
  v_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR v_company_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Contexto autenticado de empresa e unidade obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF NOT private.prontomedic_module_action_allowed(
    'revisao_farmaceutica', 'create', v_unit_id, FALSE
  ) THEN
    RAISE EXCEPTION 'Usuário sem permissão para movimentar estoque'
      USING ERRCODE = '42501';
  END IF;
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser positiva'
      USING ERRCODE = '22023';
  END IF;
  IF p_prescricao_id IS NOT NULL THEN
    RAISE EXCEPTION 'Prescrição legada sem contrato de empresa; use a dispensação eletrônica'
      USING ERRCODE = '22023';
  END IF;
  IF p_paciente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.id = p_paciente_id
      AND p.company_id = v_company_id
      AND COALESCE(p.lg_ativo, TRUE)
  ) THEN
    RAISE EXCEPTION 'Paciente não pertence à empresa ativa'
      USING ERRCODE = '42501';
  END IF;
  IF p_appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments appointment
    WHERE appointment.id = p_appointment_id
      AND appointment.company_id = v_company_id
      AND appointment.unit_id = v_unit_id
      AND (p_paciente_id IS NULL OR appointment.patient_id = p_paciente_id)
  ) THEN
    RAISE EXCEPTION 'Agendamento incompatível com paciente, empresa ou unidade'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.* INTO v_lote
  FROM public.lotes l
  LEFT JOIN public.almoxarifados warehouse ON warehouse.id = l.cd_almoxarifado
  WHERE l.id = p_lote_id
    AND l.company_id = v_company_id
    AND l.lg_ativo = TRUE
    AND (warehouse.cd_unidade IS NULL OR warehouse.cd_unidade = v_unit_id)
  FOR UPDATE OF l;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_tipo IN ('ENTRADA', 'AJUSTE') THEN
    v_qt_posterior := v_lote.qt_atual + p_quantidade;
  ELSIF p_tipo IN ('SAIDA', 'TRANSFERENCIA', 'PERDA', 'VENCIMENTO') THEN
    IF v_lote.qt_atual < p_quantidade THEN
      RAISE EXCEPTION 'Estoque insuficiente. Disponível: %, solicitado: %',
        v_lote.qt_atual, p_quantidade
        USING ERRCODE = '23514';
    END IF;
    v_qt_posterior := v_lote.qt_atual - p_quantidade;
  ELSE
    RAISE EXCEPTION 'Tipo de movimentação inválido: %', p_tipo
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.lotes l
  SET qt_atual = v_qt_posterior
  WHERE l.id = v_lote.id
    AND l.company_id = v_company_id;

  INSERT INTO public.movimentacoes_estoque (
    company_id, cd_lote, tp_movimentacao, qt_movimentada,
    qt_anterior, qt_posterior, cd_paciente, cd_appointment,
    cd_prescricao_id, cd_usuario, ds_motivo, ds_observacao
  ) VALUES (
    v_company_id, v_lote.id, p_tipo, p_quantidade,
    v_lote.qt_atual, v_qt_posterior, p_paciente_id, p_appointment_id,
    p_prescricao_id, auth.uid(), NULLIF(BTRIM(p_motivo), ''),
    NULLIF(BTRIM(p_observacao), '')
  )
  RETURNING movimentacoes_estoque.id INTO v_id;

  RETURN QUERY SELECT v_id, v_lote.qt_atual, v_qt_posterior;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.calcular_valor_estoque(
  p_company_id UUID DEFAULT NULL
)
RETURNS DECIMAL(12,2)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
SET row_security = off
AS $fn$
DECLARE
  v_company_id UUID := public.get_my_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_total DECIMAL(12,2);
BEGIN
  IF auth.uid() IS NULL OR v_company_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Contexto autenticado de empresa e unidade obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NOT NULL AND p_company_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'Empresa solicitada fora do contexto ativo'
      USING ERRCODE = '42501';
  END IF;
  IF NOT private.prontomedic_module_action_allowed(
    'revisao_farmaceutica', 'view', v_unit_id, FALSE
  ) THEN
    RAISE EXCEPTION 'Usuário sem permissão para consultar estoque'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(l.qt_atual * COALESCE(l.vl_custo_unitario, 0)), 0)
  INTO v_total
  FROM public.lotes l
  LEFT JOIN public.almoxarifados warehouse ON warehouse.id = l.cd_almoxarifado
  WHERE l.company_id = v_company_id
    AND l.lg_ativo = TRUE
    AND l.qt_atual > 0
    AND (warehouse.cd_unidade IS NULL OR warehouse.cd_unidade = v_unit_id);

  RETURN v_total;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.dispensar_estoque_atomic(
  p_operation_id UUID,
  p_patient_id BIGINT,
  p_appointment_id BIGINT DEFAULT NULL,
  p_legacy_prescription_id BIGINT DEFAULT NULL,
  p_electronic_prescription_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB
)
RETURNS public.dispensacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
SET row_security = off
AS $fn$
DECLARE
  v_company_id UUID := public.get_my_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_request JSONB;
  v_items JSONB;
  v_request_hash TEXT;
  v_existing public.dispensacoes;
  v_dispensing public.dispensacoes;
  v_item JSONB;
  v_lot public.lotes;
  v_lot_id BIGINT;
  v_quantity INTEGER;
  v_prescription_item_id UUID;
  v_prescription_item public.electronic_prescription_items;
  v_already_dispensed BIGINT;
  v_unit_value NUMERIC(10,2);
  v_previous INTEGER;
  v_after INTEGER;
BEGIN
  IF auth.uid() IS NULL OR v_company_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Contexto autenticado de empresa e unidade obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF NOT private.prontomedic_module_action_allowed(
    'revisao_farmaceutica', 'create', v_unit_id, FALSE
  ) THEN
    RAISE EXCEPTION 'Usuário sem permissão para dispensar'
      USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL OR p_patient_id IS NULL THEN
    RAISE EXCEPTION 'Operação e paciente são obrigatórios'
      USING ERRCODE = '22023';
  END IF;
  IF p_legacy_prescription_id IS NOT NULL THEN
    RAISE EXCEPTION 'Prescrição legada ambígua; informe electronic_prescription_id'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_items, 'null'::JSONB)) <> 'array'
     OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'A dispensação deve conter entre 1 e 50 itens'
      USING ERRCODE = '22023';
  END IF;
  IF (
    SELECT COUNT(*) <> COUNT(DISTINCT (item->>'cd_lote'))
    FROM jsonb_array_elements(p_items) item
  ) THEN
    RAISE EXCEPTION 'O mesmo lote não pode aparecer mais de uma vez'
      USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_agg(item ORDER BY (item->>'cd_lote')::BIGINT)
  INTO v_items
  FROM jsonb_array_elements(p_items) item;
  IF NOT EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.id = p_patient_id
      AND p.company_id = v_company_id
      AND COALESCE(p.lg_ativo, TRUE)
  ) THEN
    RAISE EXCEPTION 'Paciente não pertence à empresa ativa'
      USING ERRCODE = '42501';
  END IF;
  IF p_appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = p_appointment_id
      AND a.company_id = v_company_id
      AND a.patient_id = p_patient_id
      AND a.unit_id = v_unit_id
  ) THEN
    RAISE EXCEPTION 'Agendamento incompatível com paciente ou empresa'
      USING ERRCODE = '42501';
  END IF;
  IF p_electronic_prescription_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.electronic_prescriptions ep
    WHERE ep.id = p_electronic_prescription_id
      AND ep.company_id = v_company_id
      AND ep.patient_id = p_patient_id
      AND ep.status IN ('signed', 'active')
  ) THEN
    RAISE EXCEPTION 'Prescrição eletrônica inválida para dispensação'
      USING ERRCODE = '42501';
  END IF;

  v_request := jsonb_build_object(
    'patient_id', p_patient_id,
    'appointment_id', p_appointment_id,
    'electronic_prescription_id', p_electronic_prescription_id,
    'notes', NULLIF(BTRIM(p_notes), ''),
    'items', v_items
  );
  v_request_hash := encode(digest(convert_to(v_request::TEXT, 'UTF8'), 'sha256'), 'hex');

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_company_id::TEXT || ':' || p_operation_id::TEXT, 0)
  );

  SELECT d.* INTO v_existing
  FROM public.dispensacoes d
  WHERE d.company_id = v_company_id
    AND d.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'operation_id já utilizado com outro conteúdo'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing;
  END IF;

  PERFORM 1
  FROM public.lotes l
  WHERE l.id IN (
    SELECT (item->>'cd_lote')::BIGINT
    FROM jsonb_array_elements(v_items) item
  )
  ORDER BY l.id
  FOR UPDATE;

  INSERT INTO public.dispensacoes (
    company_id, cd_paciente, cd_appointment, cd_prescricao_id,
    electronic_prescription_id, operation_id, request_hash,
    cd_usuario, ds_observacao
  ) VALUES (
    v_company_id, p_patient_id, p_appointment_id, NULL,
    p_electronic_prescription_id, p_operation_id, v_request_hash,
    auth.uid(), NULLIF(BTRIM(p_notes), '')
  )
  RETURNING * INTO v_dispensing;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    BEGIN
      v_lot_id := (v_item->>'cd_lote')::BIGINT;
      v_quantity := (v_item->>'qt_dispensada')::INTEGER;
      v_prescription_item_id := NULLIF(v_item->>'electronic_prescription_item_id', '')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Item de dispensação inválido'
        USING ERRCODE = '22023';
    END;
    IF v_lot_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Lote e quantidade positiva são obrigatórios'
        USING ERRCODE = '22023';
    END IF;
    IF p_electronic_prescription_id IS NOT NULL AND v_prescription_item_id IS NULL THEN
      RAISE EXCEPTION 'Item da prescrição eletrônica é obrigatório'
        USING ERRCODE = '22023';
    END IF;

    SELECT l.* INTO v_lot
    FROM public.lotes l
    LEFT JOIN public.almoxarifados warehouse ON warehouse.id = l.cd_almoxarifado
    WHERE l.id = v_lot_id
      AND l.company_id = v_company_id
      AND l.lg_ativo = TRUE
      AND (warehouse.cd_unidade IS NULL OR warehouse.cd_unidade = v_unit_id)
    FOR UPDATE OF l;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lote % não encontrado na empresa ativa', v_lot_id
        USING ERRCODE = 'P0002';
    END IF;
    IF v_lot.dt_validade < CURRENT_DATE THEN
      RAISE EXCEPTION 'Lote % está vencido', v_lot_id
        USING ERRCODE = '23514';
    END IF;
    IF v_lot.qt_atual < v_quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente no lote %. Disponível: %, solicitado: %',
        v_lot_id, v_lot.qt_atual, v_quantity
        USING ERRCODE = '23514';
    END IF;
    IF p_electronic_prescription_id IS NOT NULL THEN
      SELECT epi.* INTO v_prescription_item
      FROM public.electronic_prescription_items epi
      WHERE epi.id = v_prescription_item_id
        AND epi.prescription_id = p_electronic_prescription_id
        AND epi.company_id = v_company_id
        AND epi.item_type = 'medication'
      FOR UPDATE;
      IF NOT FOUND
         OR v_prescription_item.medication_id IS DISTINCT FROM v_lot.cd_medicamento_id
         OR v_lot.cd_produto_tipo <> 'MEDICAMENTO' THEN
        RAISE EXCEPTION 'Lote % não corresponde ao item prescrito', v_lot_id
          USING ERRCODE = '23514';
      END IF;
      SELECT COALESCE(SUM(di.qt_dispensada), 0)
        INTO v_already_dispensed
      FROM public.dispensacao_itens di
      WHERE di.electronic_prescription_item_id = v_prescription_item_id;
      IF v_already_dispensed + v_quantity > v_prescription_item.dispensable_quantity THEN
        RAISE EXCEPTION 'Quantidade excede o saldo prescrito. Saldo: %, solicitado: %',
          v_prescription_item.dispensable_quantity - v_already_dispensed, v_quantity
          USING ERRCODE = '23514';
      END IF;
    END IF;

    v_previous := v_lot.qt_atual;
    v_after := v_previous - v_quantity;
    v_unit_value := v_lot.vl_custo_unitario;

    UPDATE public.lotes l
    SET qt_atual = v_after
    WHERE l.id = v_lot.id
      AND l.company_id = v_company_id;

    INSERT INTO public.movimentacoes_estoque (
      company_id, cd_lote, tp_movimentacao, qt_movimentada,
      qt_anterior, qt_posterior, cd_paciente, cd_appointment,
      cd_prescricao_id, electronic_prescription_id, cd_usuario, ds_motivo
    ) VALUES (
      v_company_id, v_lot.id, 'SAIDA', v_quantity,
      v_previous, v_after, p_patient_id, p_appointment_id,
      NULL, p_electronic_prescription_id, auth.uid(), 'Dispensação de receita'
    );

    INSERT INTO public.dispensacao_itens (
      cd_dispensacao, cd_lote, qt_dispensada, vl_unitario,
      electronic_prescription_item_id
    ) VALUES (
      v_dispensing.id, v_lot.id, v_quantity, v_unit_value,
      v_prescription_item_id
    );
  END LOOP;

  RETURN v_dispensing;
END;
$fn$;

REVOKE ALL ON FUNCTION public.registrar_movimentacao_estoque(
  BIGINT, VARCHAR, INTEGER, TEXT, BIGINT, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calcular_valor_estoque(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dispensar_estoque_atomic(
  UUID, BIGINT, BIGINT, BIGINT, UUID, TEXT, JSONB
) FROM PUBLIC, anon;

ALTER FUNCTION public.registrar_movimentacao_estoque(
  BIGINT, VARCHAR, INTEGER, TEXT, BIGINT, BIGINT, BIGINT, TEXT
) OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION public.calcular_valor_estoque(UUID)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION public.dispensar_estoque_atomic(
  UUID, BIGINT, BIGINT, BIGINT, UUID, TEXT, JSONB
) OWNER TO prontomedic_rpc_owner;

GRANT USAGE ON SCHEMA public, private, auth TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.get_my_company_id(), public.active_unit_id(),
  public.m18_unit_accessible(UUID, INTEGER),
  private.prontomedic_module_action_allowed(TEXT, TEXT, INTEGER, BOOLEAN),
  auth.uid()
  TO prontomedic_rpc_owner;
GRANT SELECT ON public.patients, public.appointments,
  public.electronic_prescriptions, public.electronic_prescription_items,
  public.almoxarifados
  TO prontomedic_rpc_owner;
GRANT SELECT, UPDATE ON public.lotes TO prontomedic_rpc_owner;
GRANT SELECT, INSERT ON public.dispensacoes TO prontomedic_rpc_owner;
GRANT SELECT, INSERT ON public.dispensacao_itens TO prontomedic_rpc_owner;
GRANT INSERT ON public.movimentacoes_estoque TO prontomedic_rpc_owner;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prontomedic_rpc_owner;

GRANT EXECUTE ON FUNCTION public.registrar_movimentacao_estoque(
  BIGINT, VARCHAR, INTEGER, TEXT, BIGINT, BIGINT, BIGINT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.calcular_valor_estoque(UUID)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.dispensar_estoque_atomic(
  UUID, BIGINT, BIGINT, BIGINT, UUID, TEXT, JSONB
) TO authenticated, app_prontomedic;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.dispensacoes, public.dispensacao_itens, public.movimentacoes_estoque
  FROM authenticated;
GRANT SELECT
  ON public.dispensacoes, public.dispensacao_itens, public.movimentacoes_estoque
  TO authenticated;

COMMIT;

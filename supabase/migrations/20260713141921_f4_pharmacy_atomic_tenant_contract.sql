-- F4 P0 pharmacy contract: tenant-safe inventory and atomic dispensing.
-- No external/SIGH data is read or changed by this migration.

DO $preflight$
BEGIN
  IF to_regclass('public.medicamentos') IS NULL
     OR to_regclass('public.materiais') IS NULL
     OR to_regclass('public.almoxarifados') IS NULL
     OR to_regclass('public.lotes') IS NULL
     OR to_regclass('public.movimentacoes_estoque') IS NULL
     OR to_regclass('public.dispensacoes') IS NULL
     OR to_regclass('public.dispensacao_itens') IS NULL
     OR to_regclass('public.receitas_controladas') IS NULL
     OR to_regclass('public.patients') IS NULL
     OR to_regclass('public.appointments') IS NULL
     OR to_regclass('public.user_profiles') IS NULL
     OR to_regclass('public.roles') IS NULL THEN
    RAISE EXCEPTION 'F4 pharmacy preflight: canonical relations are missing';
  END IF;

  IF EXISTS (SELECT 1 FROM public.lotes WHERE qt_atual < 0) THEN
    RAISE EXCEPTION 'F4 pharmacy preflight: existing negative inventory must be reconciled explicitly';
  END IF;
END
$preflight$;

ALTER TABLE public.dispensacoes
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS idempotency_hash TEXT;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.lotes'::REGCLASS
       AND conname = 'lotes_qt_atual_nonnegative_check'
  ) THEN
    ALTER TABLE public.lotes
      ADD CONSTRAINT lotes_qt_atual_nonnegative_check
      CHECK (qt_atual >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.movimentacoes_estoque'::REGCLASS
       AND conname = 'movimentacoes_estoque_positive_quantity_check'
  ) THEN
    ALTER TABLE public.movimentacoes_estoque
      ADD CONSTRAINT movimentacoes_estoque_positive_quantity_check
      CHECK (qt_movimentada > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.dispensacao_itens'::REGCLASS
       AND conname = 'dispensacao_itens_positive_quantity_check'
  ) THEN
    ALTER TABLE public.dispensacao_itens
      ADD CONSTRAINT dispensacao_itens_positive_quantity_check
      CHECK (qt_dispensada > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.dispensacoes'::REGCLASS
       AND conname = 'dispensacoes_idempotency_pair_check'
  ) THEN
    ALTER TABLE public.dispensacoes
      ADD CONSTRAINT dispensacoes_idempotency_pair_check
      CHECK (
        (idempotency_key IS NULL AND idempotency_hash IS NULL)
        OR
        (idempotency_key IS NOT NULL AND idempotency_hash IS NOT NULL AND length(idempotency_hash) = 32)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.dispensacoes'::REGCLASS
       AND conname = 'dispensacoes_company_idempotency_uq'
  ) THEN
    ALTER TABLE public.dispensacoes
      ADD CONSTRAINT dispensacoes_company_idempotency_uq
      UNIQUE (company_id, idempotency_key);
  END IF;
END
$constraints$;

ALTER TABLE public.lotes
  VALIDATE CONSTRAINT lotes_qt_atual_nonnegative_check;
ALTER TABLE public.dispensacoes
  VALIDATE CONSTRAINT dispensacoes_idempotency_pair_check;

CREATE INDEX IF NOT EXISTS movimentacoes_estoque_company_lote_data_idx
  ON public.movimentacoes_estoque(company_id, cd_lote, dt_movimentacao DESC);
CREATE INDEX IF NOT EXISTS dispensacoes_company_patient_data_idx
  ON public.dispensacoes(company_id, cd_paciente, dt_dispensacao DESC);

CREATE OR REPLACE VIEW public.v_estoque_atual
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  l.id AS cd_lote,
  l.company_id,
  l.cd_produto_tipo,
  COALESCE(m.cd_principio_ativo, mat.ds_nome) AS ds_produto,
  m.cd_nome_comercial,
  m.ds_concentracao,
  l.dt_validade,
  l.qt_atual,
  l.vl_custo_unitario,
  l.cd_almoxarifado,
  a.ds_nome AS ds_almoxarifado,
  CASE
    WHEN l.dt_validade < CURRENT_DATE THEN 'VENCIDO'
    WHEN l.dt_validade < CURRENT_DATE + INTERVAL '30 days' THEN 'VENCE_30_DIAS'
    WHEN l.dt_validade < CURRENT_DATE + INTERVAL '90 days' THEN 'VENCE_90_DIAS'
    ELSE 'OK'
  END AS status_validade,
  l.cd_medicamento_id,
  l.cd_material_id,
  l.cd_lote AS nr_lote
FROM public.lotes AS l
LEFT JOIN public.medicamentos AS m
  ON m.id = l.cd_medicamento_id
 AND m.company_id = l.company_id
LEFT JOIN public.materiais AS mat
  ON mat.id = l.cd_material_id
 AND mat.company_id = l.company_id
LEFT JOIN public.almoxarifados AS a
  ON a.id = l.cd_almoxarifado
 AND a.company_id = l.company_id
WHERE l.lg_ativo = TRUE
  AND l.qt_atual > 0;

COMMENT ON VIEW public.v_estoque_atual IS
  'Tenant-invoker FEFO inventory. Includes product ids and physical lot number consumed by pharmacyService.';

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharmacy_rpc_owner') THEN
    CREATE ROLE pharmacy_rpc_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE pharmacy_rpc_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$role$;

ALTER TABLE public.lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lotes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.movimentacoes_estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimentacoes_estoque FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dispensacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispensacoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dispensacao_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispensacao_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.receitas_controladas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receitas_controladas FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lotes_all ON public.lotes;
DROP POLICY IF EXISTS movimentacoes_insert ON public.movimentacoes_estoque;
DROP POLICY IF EXISTS dispensacoes_all ON public.dispensacoes;
DROP POLICY IF EXISTS dispensacao_itens_all ON public.dispensacao_itens;
DROP POLICY IF EXISTS receitas_controladas_all ON public.receitas_controladas;

DROP POLICY IF EXISTS pharmacy_rpc_actor_lookup ON public.user_profiles;
CREATE POLICY pharmacy_rpc_actor_lookup
  ON public.user_profiles FOR SELECT TO pharmacy_rpc_owner
  USING (id = (SELECT auth.uid()) AND lg_ativo = TRUE);

DROP POLICY IF EXISTS pharmacy_rpc_role_lookup ON public.roles;
CREATE POLICY pharmacy_rpc_role_lookup
  ON public.roles FOR SELECT TO pharmacy_rpc_owner
  USING (lg_ativo = TRUE);

DROP POLICY IF EXISTS pharmacy_rpc_patient_lookup ON public.patients;
CREATE POLICY pharmacy_rpc_patient_lookup
  ON public.patients FOR SELECT TO pharmacy_rpc_owner
  USING (
    company_id = (
      SELECT profile.company_id
        FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS pharmacy_rpc_appointment_lookup ON public.appointments;
CREATE POLICY pharmacy_rpc_appointment_lookup
  ON public.appointments FOR SELECT TO pharmacy_rpc_owner
  USING (
    company_id = (
      SELECT profile.company_id
        FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS pharmacy_rpc_medicamento_lookup ON public.medicamentos;
CREATE POLICY pharmacy_rpc_medicamento_lookup
  ON public.medicamentos FOR SELECT TO pharmacy_rpc_owner
  USING (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS pharmacy_rpc_material_lookup ON public.materiais;
CREATE POLICY pharmacy_rpc_material_lookup
  ON public.materiais FOR SELECT TO pharmacy_rpc_owner
  USING (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS pharmacy_rpc_warehouse_lookup ON public.almoxarifados;
CREATE POLICY pharmacy_rpc_warehouse_lookup
  ON public.almoxarifados FOR SELECT TO pharmacy_rpc_owner
  USING (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS pharmacy_rpc_lote_select ON public.lotes;
CREATE POLICY pharmacy_rpc_lote_select
  ON public.lotes FOR SELECT TO pharmacy_rpc_owner
  USING (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS pharmacy_rpc_lote_update ON public.lotes;
CREATE POLICY pharmacy_rpc_lote_update
  ON public.lotes FOR UPDATE TO pharmacy_rpc_owner
  USING (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  )
  WITH CHECK (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
    AND qt_atual >= 0
  );

DROP POLICY IF EXISTS pharmacy_rpc_movement_insert ON public.movimentacoes_estoque;
CREATE POLICY pharmacy_rpc_movement_insert
  ON public.movimentacoes_estoque FOR INSERT TO pharmacy_rpc_owner
  WITH CHECK (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
    AND cd_usuario = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS pharmacy_rpc_dispensation_select ON public.dispensacoes;
CREATE POLICY pharmacy_rpc_dispensation_select
  ON public.dispensacoes FOR SELECT TO pharmacy_rpc_owner
  USING (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS pharmacy_rpc_dispensation_insert ON public.dispensacoes;
CREATE POLICY pharmacy_rpc_dispensation_insert
  ON public.dispensacoes FOR INSERT TO pharmacy_rpc_owner
  WITH CHECK (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
    AND cd_usuario = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS pharmacy_rpc_item_insert ON public.dispensacao_itens;
CREATE POLICY pharmacy_rpc_item_insert
  ON public.dispensacao_itens FOR INSERT TO pharmacy_rpc_owner
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.dispensacoes AS disp
       WHERE disp.id = cd_dispensacao
         AND disp.company_id = (
           SELECT profile.company_id FROM public.user_profiles AS profile
            WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
         )
         AND disp.cd_usuario = (SELECT auth.uid())
    )
  );

GRANT USAGE ON SCHEMA public TO pharmacy_rpc_owner;
GRANT USAGE ON SCHEMA auth TO pharmacy_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO pharmacy_rpc_owner;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT SELECT ON public.user_profiles, public.roles, public.patients, public.appointments,
  public.medicamentos, public.materiais, public.almoxarifados TO pharmacy_rpc_owner;
GRANT SELECT, UPDATE ON public.lotes TO pharmacy_rpc_owner;
GRANT SELECT, INSERT ON public.movimentacoes_estoque, public.dispensacoes,
  public.dispensacao_itens TO pharmacy_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.movimentacoes_estoque_id_seq,
  public.dispensacoes_id_seq, public.dispensacao_itens_id_seq TO pharmacy_rpc_owner;

CREATE OR REPLACE FUNCTION public.registrar_movimentacao_estoque(
  p_lote_id BIGINT,
  p_tipo VARCHAR,
  p_quantidade INTEGER,
  p_motivo TEXT,
  p_paciente_id BIGINT DEFAULT NULL,
  p_appointment_id BIGINT DEFAULT NULL,
  p_prescricao_id BIGINT DEFAULT NULL,
  p_observacao TEXT DEFAULT NULL
)
RETURNS TABLE(id BIGINT, qt_anterior INTEGER, qt_posterior INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_lote public.lotes%ROWTYPE;
  v_after INTEGER;
  v_id BIGINT;
BEGIN
  SELECT profile.id, profile.company_id, canonical_role.name AS role_name
    INTO v_actor
    FROM public.user_profiles AS profile
    JOIN public.roles AS canonical_role
      ON canonical_role.id = profile.role_id
     AND canonical_role.lg_ativo = TRUE
   WHERE profile.id = auth.uid() AND profile.lg_ativo = TRUE;

  IF v_actor.id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Ator autenticado sem perfil ativo e empresa';
  END IF;
  IF COALESCE(v_actor.role_name, '') NOT IN ('admin', 'farmacia') THEN
    RAISE EXCEPTION 'Perfil sem permissao para movimentar estoque';
  END IF;
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser positiva';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN
     ('ENTRADA', 'SAIDA', 'AJUSTE', 'TRANSFERENCIA', 'PERDA', 'VENCIMENTO') THEN
    RAISE EXCEPTION 'Tipo de movimentacao invalido';
  END IF;
  IF NULLIF(trim(COALESCE(p_motivo, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo e obrigatorio';
  END IF;
  IF p_prescricao_id IS NOT NULL THEN
    RAISE EXCEPTION 'Vinculo de prescricao sem relacao canonica nao e aceito';
  END IF;

  SELECT lote.* INTO v_lote
    FROM public.lotes AS lote
   WHERE lote.id = p_lote_id
     AND lote.company_id = v_actor.company_id
     AND lote.lg_ativo = TRUE
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote inexistente, inativo ou fora do tenant';
  END IF;

  IF NOT (
    (v_lote.cd_produto_tipo = 'MEDICAMENTO'
      AND v_lote.cd_medicamento_id IS NOT NULL
      AND v_lote.cd_material_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.medicamentos AS med
         WHERE med.id = v_lote.cd_medicamento_id
           AND med.company_id = v_actor.company_id AND med.lg_ativo = TRUE
      ))
    OR
    (v_lote.cd_produto_tipo = 'MATERIAL'
      AND v_lote.cd_material_id IS NOT NULL
      AND v_lote.cd_medicamento_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.materiais AS mat
         WHERE mat.id = v_lote.cd_material_id
           AND mat.company_id = v_actor.company_id AND mat.lg_ativo = TRUE
      ))
  ) THEN
    RAISE EXCEPTION 'Lote possui vinculo de produto invalido ou cross-tenant';
  END IF;
  IF v_lote.cd_almoxarifado IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.almoxarifados AS warehouse
     WHERE warehouse.id = v_lote.cd_almoxarifado
       AND warehouse.company_id = v_actor.company_id
       AND warehouse.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Lote possui vinculo de almoxarifado invalido ou cross-tenant';
  END IF;
  IF p_paciente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.patients AS patient
     WHERE patient.id = p_paciente_id
       AND patient.company_id = v_actor.company_id
       AND patient.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Paciente inexistente, inativo ou fora do tenant';
  END IF;
  IF p_appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments AS appointment
     WHERE appointment.id = p_appointment_id
       AND appointment.company_id = v_actor.company_id
       AND (p_paciente_id IS NULL OR appointment.patient_id = p_paciente_id)
  ) THEN
    RAISE EXCEPTION 'Atendimento inexistente, fora do tenant ou de outro paciente';
  END IF;
  IF p_tipo IN ('SAIDA', 'TRANSFERENCIA') AND v_lote.dt_validade < CURRENT_DATE THEN
    RAISE EXCEPTION 'Lote vencido nao pode gerar saida ou transferencia';
  END IF;

  IF p_tipo IN ('ENTRADA', 'AJUSTE') THEN
    v_after := v_lote.qt_atual + p_quantidade;
  ELSE
    v_after := v_lote.qt_atual - p_quantidade;
  END IF;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente';
  END IF;

  UPDATE public.lotes AS lote
     SET qt_atual = v_after
   WHERE lote.id = v_lote.id;

  INSERT INTO public.movimentacoes_estoque (
    company_id, cd_lote, tp_movimentacao, qt_movimentada,
    qt_anterior, qt_posterior, cd_paciente, cd_appointment,
    cd_prescricao_id, cd_usuario, ds_motivo, ds_observacao
  ) VALUES (
    v_actor.company_id, v_lote.id, p_tipo, p_quantidade,
    v_lote.qt_atual, v_after, p_paciente_id, p_appointment_id,
    NULL, v_actor.id, trim(p_motivo), p_observacao
  ) RETURNING movimentacoes_estoque.id INTO v_id;

  id := v_id;
  qt_anterior := v_lote.qt_atual;
  qt_posterior := v_after;
  RETURN NEXT;
END
$function$;

CREATE OR REPLACE FUNCTION public.calcular_valor_estoque(p_company_id UUID DEFAULT NULL)
RETURNS DECIMAL(12,2)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company_id UUID;
  v_total DECIMAL(12,2);
BEGIN
  SELECT profile.company_id INTO v_company_id
    FROM public.user_profiles AS profile
   WHERE profile.id = auth.uid() AND profile.lg_ativo = TRUE;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Ator autenticado sem perfil ativo e empresa';
  END IF;
  IF p_company_id IS NOT NULL AND p_company_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'Empresa solicitada fora do tenant do ator';
  END IF;

  SELECT COALESCE(SUM(lote.qt_atual * COALESCE(lote.vl_custo_unitario, 0)), 0)::DECIMAL(12,2)
    INTO v_total
    FROM public.lotes AS lote
   WHERE lote.company_id = v_company_id
     AND lote.lg_ativo = TRUE
     AND lote.qt_atual > 0;
  RETURN v_total;
END
$function$;

CREATE OR REPLACE FUNCTION public.dispensar_estoque(
  p_idempotency_key UUID,
  p_paciente_id BIGINT,
  p_itens JSONB,
  p_appointment_id BIGINT DEFAULT NULL,
  p_prescricao_id BIGINT DEFAULT NULL,
  p_observacao TEXT DEFAULT NULL
)
RETURNS TABLE(
  id BIGINT,
  company_id UUID,
  cd_paciente BIGINT,
  dt_dispensacao TIMESTAMPTZ,
  cd_usuario UUID,
  idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_normalized_items JSONB;
  v_request_hash TEXT;
  v_disp public.dispensacoes%ROWTYPE;
  v_is_new BOOLEAN := FALSE;
BEGIN
  SELECT profile.id, profile.company_id, canonical_role.name AS role_name
    INTO v_actor
    FROM public.user_profiles AS profile
    JOIN public.roles AS canonical_role
      ON canonical_role.id = profile.role_id
     AND canonical_role.lg_ativo = TRUE
   WHERE profile.id = auth.uid() AND profile.lg_ativo = TRUE;

  IF v_actor.id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Ator autenticado sem perfil ativo e empresa';
  END IF;
  IF COALESCE(v_actor.role_name, '') NOT IN ('admin', 'farmacia') THEN
    RAISE EXCEPTION 'Perfil sem permissao para dispensar estoque';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Chave de idempotencia e obrigatoria';
  END IF;
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Dispensacao exige ao menos um item';
  END IF;
  IF p_prescricao_id IS NOT NULL THEN
    RAISE EXCEPTION 'Vinculo de prescricao sem relacao canonica nao e aceito';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.patients AS patient
     WHERE patient.id = p_paciente_id
       AND patient.company_id = v_actor.company_id
       AND patient.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Paciente inexistente, inativo ou fora do tenant';
  END IF;
  IF p_appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments AS appointment
     WHERE appointment.id = p_appointment_id
       AND appointment.company_id = v_actor.company_id
       AND appointment.patient_id = p_paciente_id
  ) THEN
    RAISE EXCEPTION 'Atendimento inexistente, fora do tenant ou de outro paciente';
  END IF;

  BEGIN
    SELECT jsonb_agg(
             jsonb_build_object(
               'cd_lote', item.cd_lote,
               'qt_dispensada', item.qt_dispensada
             ) ORDER BY item.cd_lote
           )
      INTO v_normalized_items
      FROM jsonb_to_recordset(p_itens)
        AS item(cd_lote BIGINT, qt_dispensada INTEGER);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Item de dispensacao possui lote ou quantidade invalida';
  END;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_normalized_items)
      AS item(cd_lote BIGINT, qt_dispensada INTEGER)
     WHERE item.cd_lote IS NULL OR item.qt_dispensada IS NULL OR item.qt_dispensada <= 0
  ) THEN
    RAISE EXCEPTION 'Itens exigem lote e quantidade positiva';
  END IF;
  IF (
    SELECT count(*) FROM jsonb_to_recordset(v_normalized_items)
      AS item(cd_lote BIGINT, qt_dispensada INTEGER)
  ) IS DISTINCT FROM (
    SELECT count(DISTINCT item.cd_lote) FROM jsonb_to_recordset(v_normalized_items)
      AS item(cd_lote BIGINT, qt_dispensada INTEGER)
  ) THEN
    RAISE EXCEPTION 'Cada lote deve aparecer uma unica vez na dispensacao';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'patient_id', p_paciente_id,
    'appointment_id', p_appointment_id,
    'prescription_id', p_prescricao_id,
    'observation', p_observacao,
    'items', v_normalized_items
  )::TEXT);

  INSERT INTO public.dispensacoes (
    company_id, cd_paciente, cd_appointment, cd_prescricao_id,
    cd_usuario, ds_observacao, idempotency_key, idempotency_hash
  ) VALUES (
    v_actor.company_id, p_paciente_id, p_appointment_id, NULL,
    v_actor.id, p_observacao, p_idempotency_key, v_request_hash
  )
  ON CONFLICT ON CONSTRAINT dispensacoes_company_idempotency_uq DO NOTHING
  RETURNING dispensacoes.* INTO v_disp;

  IF FOUND THEN
    v_is_new := TRUE;
  ELSE
    SELECT disp.* INTO v_disp
      FROM public.dispensacoes AS disp
     WHERE disp.company_id = v_actor.company_id
       AND disp.idempotency_key = p_idempotency_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Falha ao resolver chave de idempotencia';
    END IF;
    IF v_disp.idempotency_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'Chave de idempotencia reutilizada com payload diferente';
    END IF;
  END IF;

  IF v_is_new THEN
    PERFORM lote.id
      FROM public.lotes AS lote
      JOIN jsonb_to_recordset(v_normalized_items)
        AS item(cd_lote BIGINT, qt_dispensada INTEGER)
        ON item.cd_lote = lote.id
     WHERE lote.company_id = v_actor.company_id
       AND lote.lg_ativo = TRUE
     ORDER BY lote.id
     FOR UPDATE OF lote;

    IF (
      SELECT count(*)
        FROM public.lotes AS lote
        JOIN jsonb_to_recordset(v_normalized_items)
          AS item(cd_lote BIGINT, qt_dispensada INTEGER)
          ON item.cd_lote = lote.id
       WHERE lote.company_id = v_actor.company_id AND lote.lg_ativo = TRUE
    ) IS DISTINCT FROM jsonb_array_length(v_normalized_items) THEN
      RAISE EXCEPTION 'Lote inexistente, inativo ou fora do tenant';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.lotes AS lote
        JOIN jsonb_to_recordset(v_normalized_items)
          AS item(cd_lote BIGINT, qt_dispensada INTEGER)
          ON item.cd_lote = lote.id
        LEFT JOIN public.medicamentos AS med
          ON med.id = lote.cd_medicamento_id AND med.company_id = lote.company_id AND med.lg_ativo = TRUE
        LEFT JOIN public.materiais AS mat
          ON mat.id = lote.cd_material_id AND mat.company_id = lote.company_id AND mat.lg_ativo = TRUE
        LEFT JOIN public.almoxarifados AS warehouse
          ON warehouse.id = lote.cd_almoxarifado AND warehouse.company_id = lote.company_id AND warehouse.lg_ativo = TRUE
       WHERE lote.company_id = v_actor.company_id
         AND (
           (lote.cd_produto_tipo = 'MEDICAMENTO'
             AND (lote.cd_medicamento_id IS NULL OR lote.cd_material_id IS NOT NULL OR med.id IS NULL))
           OR
           (lote.cd_produto_tipo = 'MATERIAL'
             AND (lote.cd_material_id IS NULL OR lote.cd_medicamento_id IS NOT NULL OR mat.id IS NULL))
           OR
           (lote.cd_almoxarifado IS NOT NULL AND warehouse.id IS NULL)
         )
    ) THEN
      RAISE EXCEPTION 'Lote possui vinculo de produto ou almoxarifado invalido/cross-tenant';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public.lotes AS lote
        JOIN jsonb_to_recordset(v_normalized_items)
          AS item(cd_lote BIGINT, qt_dispensada INTEGER)
          ON item.cd_lote = lote.id
       WHERE lote.company_id = v_actor.company_id
         AND lote.dt_validade < CURRENT_DATE
    ) THEN
      RAISE EXCEPTION 'Dispensacao de lote vencido e proibida';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public.lotes AS lote
        JOIN jsonb_to_recordset(v_normalized_items)
          AS item(cd_lote BIGINT, qt_dispensada INTEGER)
          ON item.cd_lote = lote.id
       WHERE lote.company_id = v_actor.company_id
         AND lote.qt_atual < item.qt_dispensada
    ) THEN
      RAISE EXCEPTION 'Estoque insuficiente para dispensacao';
    END IF;

    INSERT INTO public.dispensacao_itens (
      cd_dispensacao, cd_lote, qt_dispensada, vl_unitario
    )
    SELECT v_disp.id, lote.id, item.qt_dispensada, lote.vl_custo_unitario
      FROM public.lotes AS lote
      JOIN jsonb_to_recordset(v_normalized_items)
        AS item(cd_lote BIGINT, qt_dispensada INTEGER)
        ON item.cd_lote = lote.id
     WHERE lote.company_id = v_actor.company_id
     ORDER BY lote.id;

    INSERT INTO public.movimentacoes_estoque (
      company_id, cd_lote, tp_movimentacao, qt_movimentada,
      qt_anterior, qt_posterior, cd_paciente, cd_appointment,
      cd_prescricao_id, cd_usuario, ds_motivo, ds_observacao
    )
    SELECT v_actor.company_id, lote.id, 'SAIDA', item.qt_dispensada,
           lote.qt_atual, lote.qt_atual - item.qt_dispensada,
           p_paciente_id, p_appointment_id, NULL, v_actor.id,
           'Dispensacao de receita', p_observacao
      FROM public.lotes AS lote
      JOIN jsonb_to_recordset(v_normalized_items)
        AS item(cd_lote BIGINT, qt_dispensada INTEGER)
        ON item.cd_lote = lote.id
     WHERE lote.company_id = v_actor.company_id
     ORDER BY lote.id;

    UPDATE public.lotes AS lote
       SET qt_atual = lote.qt_atual - item.qt_dispensada
      FROM jsonb_to_recordset(v_normalized_items)
        AS item(cd_lote BIGINT, qt_dispensada INTEGER)
     WHERE lote.id = item.cd_lote
       AND lote.company_id = v_actor.company_id;
  END IF;

  RETURN QUERY
  SELECT v_disp.id, v_disp.company_id, v_disp.cd_paciente,
         v_disp.dt_dispensacao, v_disp.cd_usuario, NOT v_is_new;
END
$function$;

ALTER FUNCTION public.registrar_movimentacao_estoque(
  BIGINT, VARCHAR, INTEGER, TEXT, BIGINT, BIGINT, BIGINT, TEXT
) OWNER TO pharmacy_rpc_owner;
ALTER FUNCTION public.calcular_valor_estoque(UUID)
  OWNER TO pharmacy_rpc_owner;
ALTER FUNCTION public.dispensar_estoque(UUID, BIGINT, JSONB, BIGINT, BIGINT, TEXT)
  OWNER TO pharmacy_rpc_owner;

REVOKE ALL ON FUNCTION public.registrar_movimentacao_estoque(
  BIGINT, VARCHAR, INTEGER, TEXT, BIGINT, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calcular_valor_estoque(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dispensar_estoque(UUID, BIGINT, JSONB, BIGINT, BIGINT, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.registrar_movimentacao_estoque(
  BIGINT, VARCHAR, INTEGER, TEXT, BIGINT, BIGINT, BIGINT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calcular_valor_estoque(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dispensar_estoque(UUID, BIGINT, JSONB, BIGINT, BIGINT, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_movimentacao_estoque(
  BIGINT, VARCHAR, INTEGER, TEXT, BIGINT, BIGINT, BIGINT, TEXT
) TO service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.lotes,
  public.movimentacoes_estoque, public.dispensacoes, public.dispensacao_itens,
  public.receitas_controladas
  FROM PUBLIC, anon, authenticated;
REVOKE USAGE, UPDATE ON SEQUENCE public.lotes_id_seq,
  public.movimentacoes_estoque_id_seq, public.dispensacoes_id_seq,
  public.dispensacao_itens_id_seq, public.receitas_controladas_id_seq
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.lotes,
  public.movimentacoes_estoque, public.dispensacoes, public.dispensacao_itens,
  public.receitas_controladas TO service_role;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.lotes_id_seq,
  public.movimentacoes_estoque_id_seq, public.dispensacoes_id_seq,
  public.dispensacao_itens_id_seq, public.receitas_controladas_id_seq
  TO service_role;

GRANT SELECT ON public.medicamentos, public.materiais, public.almoxarifados,
  public.lotes, public.movimentacoes_estoque, public.dispensacoes,
  public.dispensacao_itens, public.receitas_controladas,
  public.v_estoque_atual TO authenticated;

COMMENT ON FUNCTION public.registrar_movimentacao_estoque(
  BIGINT, VARCHAR, INTEGER, TEXT, BIGINT, BIGINT, BIGINT, TEXT
) IS 'Tenant-bound stock movement. Derives actor/company from auth.uid(), validates links and locks the lot. Rejects cd_prescricao_id until a canonical prescription relation exists.';
COMMENT ON FUNCTION public.calcular_valor_estoque(UUID) IS
  'Tenant-safe inventory valuation under a no-login, non-bypass RLS owner.';
COMMENT ON FUNCTION public.dispensar_estoque(UUID, BIGINT, JSONB, BIGINT, BIGINT, TEXT) IS
  'Atomic idempotent dispensing. Locks lots in deterministic order and writes header, items, movements and balances together. Rejects cd_prescricao_id until a canonical prescription relation exists.';


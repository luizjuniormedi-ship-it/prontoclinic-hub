BEGIN;

CREATE OR REPLACE FUNCTION m23_private.upsert_reference_range(
  p_reference_id BIGINT, p_exam_id BIGINT, p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, m23_private
AS $fn$
DECLARE
  v_company UUID := private.current_company_id();
  v_id BIGINT;
  v_sex TEXT := upper(coalesce(NULLIF(p_payload->>'sex', ''), 'A'));
  v_minimum_age SMALLINT := coalesce((p_payload->>'minimumAge')::SMALLINT, 0);
  v_maximum_age SMALLINT := coalesce((p_payload->>'maximumAge')::SMALLINT, 120);
  v_minimum NUMERIC := NULLIF(p_payload->>'minimumValue', '')::NUMERIC;
  v_maximum NUMERIC := NULLIF(p_payload->>'maximumValue', '')::NUMERIC;
BEGIN
  IF v_company IS NULL OR NOT m23_private.can('edit', NULL, FALSE) THEN
    RAISE EXCEPTION 'M23 reference range access denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.exames_lab_catalogo
    WHERE id = p_exam_id AND company_id = v_company
  ) THEN
    RAISE EXCEPTION 'Laboratory exam is outside current company';
  END IF;
  IF NULLIF(BTRIM(p_payload->>'parameter'), '') IS NULL THEN
    RAISE EXCEPTION 'Reference parameter is required';
  END IF;
  IF v_sex NOT IN ('M', 'F', 'A') THEN
    RAISE EXCEPTION 'Invalid reference sex';
  END IF;
  IF v_minimum_age < 0 OR v_maximum_age < v_minimum_age OR v_maximum_age > 150 THEN
    RAISE EXCEPTION 'Invalid reference age range';
  END IF;
  IF v_minimum IS NULL AND v_maximum IS NULL THEN
    RAISE EXCEPTION 'At least one reference limit is required';
  END IF;
  IF v_minimum IS NOT NULL AND v_maximum IS NOT NULL AND v_minimum > v_maximum THEN
    RAISE EXCEPTION 'Reference minimum cannot exceed maximum';
  END IF;

  IF p_reference_id IS NULL THEN
    INSERT INTO public.exames_lab_valor_referencia (
      cd_exame, ds_parametro, vl_minimo, vl_maximo, ds_unidade,
      cd_sexo, nr_idade_min, nr_idade_max, lg_ativo
    ) VALUES (
      p_exam_id, BTRIM(p_payload->>'parameter'), v_minimum, v_maximum,
      NULLIF(BTRIM(p_payload->>'unit'), ''), v_sex, v_minimum_age,
      v_maximum_age, coalesce((p_payload->>'active')::BOOLEAN, TRUE)
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.exames_lab_valor_referencia r
    SET cd_exame = p_exam_id,
        ds_parametro = BTRIM(p_payload->>'parameter'),
        vl_minimo = v_minimum,
        vl_maximo = v_maximum,
        ds_unidade = NULLIF(BTRIM(p_payload->>'unit'), ''),
        cd_sexo = v_sex,
        nr_idade_min = v_minimum_age,
        nr_idade_max = v_maximum_age,
        lg_ativo = coalesce((p_payload->>'active')::BOOLEAN, r.lg_ativo)
    FROM public.exames_lab_catalogo c
    WHERE r.id = p_reference_id
      AND r.cd_exame = c.id
      AND c.company_id = v_company
    RETURNING r.id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Reference range not found in current company';
    END IF;
  END IF;
  RETURN jsonb_build_object('reference_id', v_id, 'exam_id', p_exam_id);
END
$fn$;

ALTER FUNCTION m23_private.upsert_reference_range(BIGINT, BIGINT, JSONB)
  OWNER TO prontomedic_rpc_owner;
ALTER TABLE public.exames_lab_pedido_itens ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.exames_lab_resultado ALTER COLUMN company_id DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.m23_acknowledge_critical_alert_secure(
  p_alert_id BIGINT,
  p_communication_method TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, m23_private
AS $fn$
  SELECT m23_private.acknowledge_critical_alert(
    p_alert_id, p_communication_method, p_note
  )
$fn$;

ALTER FUNCTION public.m23_acknowledge_critical_alert_secure(BIGINT, TEXT, TEXT)
  OWNER TO prontomedic_rpc_owner;
REVOKE ALL ON FUNCTION public.m23_acknowledge_critical_alert_secure(BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, prontomedic_lis_rpc_owner;
GRANT EXECUTE ON FUNCTION public.m23_acknowledge_critical_alert_secure(BIGINT, TEXT, TEXT)
  TO app_prontomedic;
REVOKE EXECUTE ON FUNCTION m23_private.acknowledge_critical_alert(BIGINT, TEXT, TEXT)
  FROM prontomedic_lis_rpc_owner;
REVOKE USAGE ON SCHEMA m23_private FROM prontomedic_lis_rpc_owner;

COMMIT;

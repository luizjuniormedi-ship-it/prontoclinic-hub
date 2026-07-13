-- Canonical LIS P0 contract: atomically save or release laboratory results.
-- Tenant and actor are always derived from auth.uid(); direct mutations are closed.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lis_rpc_owner') THEN
    CREATE ROLE lis_rpc_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE lis_rpc_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$role$;

ALTER TABLE public.exames_lab_pedido_itens
  ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE public.exames_lab_resultado
  ADD COLUMN IF NOT EXISTS company_id UUID,
  ADD COLUMN IF NOT EXISTS lg_liberado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dt_liberacao TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cd_usuario_liberacao UUID;
ALTER TABLE public.exames_lab_alerta_critico
  ADD COLUMN IF NOT EXISTS company_id UUID;

UPDATE public.exames_lab_pedido_itens AS item
   SET company_id = pedido.company_id
  FROM public.exames_lab_pedido AS pedido
 WHERE pedido.id = item.cd_pedido
   AND item.company_id IS NULL;

UPDATE public.exames_lab_resultado AS resultado
   SET company_id = item.company_id,
       lg_liberado = (item.tp_status = 'LIBERADO'),
       dt_liberacao = CASE
         WHEN item.tp_status = 'LIBERADO'
           THEN COALESCE(resultado.dt_liberacao, item.dt_liberacao, resultado.dt_resultado)
         ELSE resultado.dt_liberacao
       END,
       cd_usuario_liberacao = CASE
         WHEN item.tp_status = 'LIBERADO'
           THEN COALESCE(resultado.cd_usuario_liberacao, resultado.cd_usuario_laboratorio)
         ELSE resultado.cd_usuario_liberacao
       END
  FROM public.exames_lab_pedido_itens AS item
 WHERE item.id = resultado.cd_item_pedido
   AND (resultado.company_id IS NULL OR item.tp_status = 'LIBERADO');

UPDATE public.exames_lab_alerta_critico AS alerta
   SET company_id = resultado.company_id
  FROM public.exames_lab_resultado AS resultado
 WHERE resultado.id = alerta.cd_resultado
   AND alerta.company_id IS NULL;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_pedido_itens AS item
      LEFT JOIN public.exames_lab_pedido AS pedido ON pedido.id = item.cd_pedido
     WHERE pedido.id IS NULL
        OR item.company_id IS NULL
        OR item.company_id IS DISTINCT FROM pedido.company_id
  ) THEN
    RAISE EXCEPTION 'LIS P0 preflight: item sem pedido/tenant canonico';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_resultado AS resultado
      LEFT JOIN public.exames_lab_pedido_itens AS item ON item.id = resultado.cd_item_pedido
     WHERE item.id IS NULL
        OR resultado.company_id IS NULL
        OR resultado.company_id IS DISTINCT FROM item.company_id
  ) THEN
    RAISE EXCEPTION 'LIS P0 preflight: resultado sem item/tenant canonico';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_alerta_critico AS alerta
      LEFT JOIN public.exames_lab_resultado AS resultado ON resultado.id = alerta.cd_resultado
     WHERE resultado.id IS NULL
        OR alerta.company_id IS NULL
        OR alerta.company_id IS DISTINCT FROM resultado.company_id
  ) THEN
    RAISE EXCEPTION 'LIS P0 preflight: alerta sem resultado/tenant canonico';
  END IF;
END
$preflight$;

ALTER TABLE public.exames_lab_pedido_itens
  ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.exames_lab_resultado
  ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.exames_lab_alerta_critico
  ALTER COLUMN company_id SET NOT NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exames_lab_pedido_itens_company_fkey') THEN
    ALTER TABLE public.exames_lab_pedido_itens
      ADD CONSTRAINT exames_lab_pedido_itens_company_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exames_lab_resultado_company_fkey') THEN
    ALTER TABLE public.exames_lab_resultado
      ADD CONSTRAINT exames_lab_resultado_company_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exames_lab_alerta_critico_company_fkey') THEN
    ALTER TABLE public.exames_lab_alerta_critico
      ADD CONSTRAINT exames_lab_alerta_critico_company_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exames_lab_resultado_release_consistency_check') THEN
    ALTER TABLE public.exames_lab_resultado
      ADD CONSTRAINT exames_lab_resultado_release_consistency_check
      CHECK (
        (lg_liberado AND dt_liberacao IS NOT NULL AND cd_usuario_liberacao IS NOT NULL)
        OR
        (NOT lg_liberado AND dt_liberacao IS NULL AND cd_usuario_liberacao IS NULL)
      ) NOT VALID;
  END IF;
END
$constraints$;

ALTER TABLE public.exames_lab_pedido_itens VALIDATE CONSTRAINT exames_lab_pedido_itens_company_fkey;
ALTER TABLE public.exames_lab_resultado VALIDATE CONSTRAINT exames_lab_resultado_company_fkey;
ALTER TABLE public.exames_lab_alerta_critico VALIDATE CONSTRAINT exames_lab_alerta_critico_company_fkey;
ALTER TABLE public.exames_lab_resultado VALIDATE CONSTRAINT exames_lab_resultado_release_consistency_check;

CREATE UNIQUE INDEX IF NOT EXISTS exames_lab_pedido_itens_company_id_uq
  ON public.exames_lab_pedido_itens(company_id, id);
CREATE INDEX IF NOT EXISTS exames_lab_resultado_company_item_idx
  ON public.exames_lab_resultado(company_id, cd_item_pedido);
CREATE INDEX IF NOT EXISTS exames_lab_alerta_company_pending_idx
  ON public.exames_lab_alerta_critico(company_id, lg_comunicado, dt_alerta)
  WHERE lg_comunicado = FALSE;

CREATE TABLE IF NOT EXISTS public.lis_result_mutations (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id),
  item_id BIGINT NOT NULL,
  actor_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  expected_status TEXT NOT NULL,
  release_requested BOOLEAN NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lis_result_mutations_company_item_fkey
    FOREIGN KEY (company_id, item_id)
    REFERENCES public.exames_lab_pedido_itens(company_id, id),
  CONSTRAINT lis_result_mutations_company_idempotency_uq
    UNIQUE (company_id, idempotency_key)
);

ALTER TABLE public.exames_lab_pedido ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_resultado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_resultado FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_alerta_critico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_alerta_critico FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lis_result_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lis_result_mutations FORCE ROW LEVEL SECURITY;

INSERT INTO public.roles (name, description)
VALUES ('laboratorio', 'Equipe de laboratorio')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions
  (role_id, module, can_view, can_create, can_edit, can_delete, can_export)
SELECT role.id, 'laboratorio', TRUE, TRUE,
       role.name IN ('admin', 'laboratorio'), FALSE, FALSE
  FROM public.roles AS role
 WHERE role.name IN ('admin', 'gestor', 'laboratorio')
ON CONFLICT (role_id, module) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can read lab orders" ON public.exames_lab_pedido;
DROP POLICY IF EXISTS "Lab can manage lab orders" ON public.exames_lab_pedido;
DROP POLICY IF EXISTS "Authenticated can read lab order items" ON public.exames_lab_pedido_itens;
DROP POLICY IF EXISTS "Lab can manage lab order items" ON public.exames_lab_pedido_itens;
DROP POLICY IF EXISTS "Authenticated can read lab results" ON public.exames_lab_resultado;
DROP POLICY IF EXISTS "Lab can manage lab results" ON public.exames_lab_resultado;
DROP POLICY IF EXISTS "Authenticated can read lab alerts" ON public.exames_lab_alerta_critico;
DROP POLICY IF EXISTS "Lab can manage lab alerts" ON public.exames_lab_alerta_critico;

DROP POLICY IF EXISTS lis_orders_tenant_select ON public.exames_lab_pedido;
CREATE POLICY lis_orders_tenant_select
  ON public.exames_lab_pedido FOR SELECT TO authenticated
  USING (
    company_id = (
      SELECT profile.company_id
        FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS lis_order_items_tenant_select ON public.exames_lab_pedido_itens;
CREATE POLICY lis_order_items_tenant_select
  ON public.exames_lab_pedido_itens FOR SELECT TO authenticated
  USING (
    company_id = (
      SELECT profile.company_id
        FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS lis_results_tenant_select ON public.exames_lab_resultado;
CREATE POLICY lis_results_tenant_select
  ON public.exames_lab_resultado FOR SELECT TO authenticated
  USING (
    company_id = (
      SELECT profile.company_id
        FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS lis_alerts_tenant_select ON public.exames_lab_alerta_critico;
CREATE POLICY lis_alerts_tenant_select
  ON public.exames_lab_alerta_critico FOR SELECT TO authenticated
  USING (
    company_id = (
      SELECT profile.company_id
        FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS lis_rpc_actor_lookup ON public.user_profiles;
CREATE POLICY lis_rpc_actor_lookup
  ON public.user_profiles FOR SELECT TO lis_rpc_owner
  USING (id = (SELECT auth.uid()) AND lg_ativo = TRUE);

DROP POLICY IF EXISTS lis_rpc_roles_lookup ON public.roles;
CREATE POLICY lis_rpc_roles_lookup
  ON public.roles FOR SELECT TO lis_rpc_owner
  USING (lg_ativo = TRUE);

DROP POLICY IF EXISTS lis_rpc_permissions_lookup ON public.role_permissions;
CREATE POLICY lis_rpc_permissions_lookup
  ON public.role_permissions FOR SELECT TO lis_rpc_owner
  USING (module = 'laboratorio');

DROP POLICY IF EXISTS lis_rpc_orders_internal ON public.exames_lab_pedido;
CREATE POLICY lis_rpc_orders_internal
  ON public.exames_lab_pedido FOR ALL TO lis_rpc_owner
  USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS lis_rpc_items_internal ON public.exames_lab_pedido_itens;
CREATE POLICY lis_rpc_items_internal
  ON public.exames_lab_pedido_itens FOR ALL TO lis_rpc_owner
  USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS lis_rpc_results_internal ON public.exames_lab_resultado;
CREATE POLICY lis_rpc_results_internal
  ON public.exames_lab_resultado FOR ALL TO lis_rpc_owner
  USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS lis_rpc_alerts_internal ON public.exames_lab_alerta_critico;
CREATE POLICY lis_rpc_alerts_internal
  ON public.exames_lab_alerta_critico FOR ALL TO lis_rpc_owner
  USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS lis_rpc_mutations_internal ON public.lis_result_mutations;
CREATE POLICY lis_rpc_mutations_internal
  ON public.lis_result_mutations FOR ALL TO lis_rpc_owner
  USING (TRUE) WITH CHECK (TRUE);

CREATE OR REPLACE FUNCTION public.validate_lis_result_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.exames_lab_pedido_itens AS item
      JOIN public.exames_lab_pedido AS pedido
        ON pedido.id = item.cd_pedido
       AND pedido.company_id = item.company_id
     WHERE item.id = NEW.cd_item_pedido
       AND item.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Resultado LIS possui item ou tenant incoerente';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.validate_lis_alert_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.exames_lab_resultado AS resultado
      JOIN public.exames_lab_pedido_itens AS item ON item.id = resultado.cd_item_pedido
      JOIN public.exames_lab_pedido AS pedido ON pedido.id = item.cd_pedido
     WHERE resultado.id = NEW.cd_resultado
       AND resultado.company_id = NEW.company_id
       AND item.company_id = NEW.company_id
       AND pedido.company_id = NEW.company_id
       AND pedido.cd_paciente = NEW.cd_paciente
       AND pedido.cd_medico = NEW.cd_medico
  ) THEN
    RAISE EXCEPTION 'Alerta LIS possui resultado, paciente, medico ou tenant incoerente';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.protect_released_lis_result()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.lg_liberado
     OR EXISTS (
       SELECT 1 FROM public.exames_lab_pedido_itens AS item
        WHERE item.id = OLD.cd_item_pedido AND item.tp_status = 'LIBERADO'
     ) THEN
    RAISE EXCEPTION 'Resultado laboratorial liberado e imutavel';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_gerar_alerta_critico ON public.exames_lab_resultado;
DROP TRIGGER IF EXISTS trg_validate_lis_result_tenant ON public.exames_lab_resultado;
CREATE TRIGGER trg_validate_lis_result_tenant
  BEFORE INSERT OR UPDATE OF company_id, cd_item_pedido
  ON public.exames_lab_resultado
  FOR EACH ROW EXECUTE FUNCTION public.validate_lis_result_tenant();
DROP TRIGGER IF EXISTS trg_protect_released_lis_result ON public.exames_lab_resultado;
CREATE TRIGGER trg_protect_released_lis_result
  BEFORE UPDATE OR DELETE ON public.exames_lab_resultado
  FOR EACH ROW EXECUTE FUNCTION public.protect_released_lis_result();
DROP TRIGGER IF EXISTS trg_validate_lis_alert_tenant ON public.exames_lab_alerta_critico;
CREATE TRIGGER trg_validate_lis_alert_tenant
  BEFORE INSERT OR UPDATE OF company_id, cd_resultado, cd_paciente, cd_medico
  ON public.exames_lab_alerta_critico
  FOR EACH ROW EXECUTE FUNCTION public.validate_lis_alert_tenant();

CREATE OR REPLACE FUNCTION public.save_or_release_lab_result_secure(
  p_item_id BIGINT,
  p_expected_status TEXT,
  p_idempotency_key UUID,
  p_results JSONB,
  p_release BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor_id UUID := auth.uid();
  v_company_id UUID;
  v_item public.exames_lab_pedido_itens;
  v_order public.exames_lab_pedido;
  v_existing public.lis_result_mutations;
  v_entry JSONB;
  v_result_id BIGINT;
  v_result_ids BIGINT[] := ARRAY[]::BIGINT[];
  v_parameter TEXT;
  v_text_value TEXT;
  v_unit TEXT;
  v_observation TEXT;
  v_numeric NUMERIC;
  v_minimum NUMERIC;
  v_maximum NUMERIC;
  v_result_type TEXT;
  v_release_at TIMESTAMPTZ;
  v_order_status TEXT;
  v_request_hash TEXT;
  v_response JSONB;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria para resultado laboratorial';
  END IF;
  IF p_item_id IS NULL OR p_idempotency_key IS NULL OR NULLIF(trim(COALESCE(p_expected_status, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Item, status esperado e chave idempotente sao obrigatorios';
  END IF;
  IF p_results IS NULL OR jsonb_typeof(p_results) <> 'array' OR jsonb_array_length(p_results) = 0 THEN
    RAISE EXCEPTION 'Resultados devem ser um array JSON nao vazio';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_results) AS entry(value)
     GROUP BY lower(trim(entry.value->>'ds_parametro'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Payload contem parametro laboratorial duplicado';
  END IF;

  SELECT profile.company_id
    INTO v_company_id
    FROM public.user_profiles AS profile
    JOIN public.roles AS role
      ON role.lg_ativo = TRUE
     AND (
       role.id = profile.role_id
       OR (
         profile.role_id IS NULL
         AND role.name = CASE lower(COALESCE(profile.role_name, ''))
           WHEN 'administrador' THEN 'admin'
           WHEN 'laboratório' THEN 'laboratorio'
           ELSE lower(COALESCE(profile.role_name, ''))
         END
       )
     )
    JOIN public.role_permissions AS permission
      ON permission.role_id = role.id
     AND permission.module = 'laboratorio'
     AND permission.can_edit = TRUE
   WHERE profile.id = v_actor_id
     AND profile.lg_ativo = TRUE
     AND profile.company_id IS NOT NULL
   LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Perfil sem permissao laboratorio.can_edit ou tenant ativo';
  END IF;

  v_request_hash := encode(digest(jsonb_build_object(
    'item_id', p_item_id,
    'expected_status', p_expected_status,
    'release', COALESCE(p_release, FALSE),
    'results', p_results
  )::TEXT, 'sha256'), 'hex');

  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::TEXT || ':' || p_idempotency_key::TEXT, 0));

  SELECT * INTO v_existing
    FROM public.lis_result_mutations
   WHERE company_id = v_company_id
     AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.item_id IS DISTINCT FROM p_item_id
       OR v_existing.expected_status IS DISTINCT FROM p_expected_status
       OR v_existing.release_requested IS DISTINCT FROM COALESCE(p_release, FALSE)
       OR v_existing.request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'Chave idempotente LIS reutilizada com payload diferente';
    END IF;
    RETURN v_existing.response;
  END IF;

  SELECT pedido.*
    INTO v_order
    FROM public.exames_lab_pedido AS pedido
    JOIN public.exames_lab_pedido_itens AS item
      ON item.cd_pedido = pedido.id
     AND item.company_id = pedido.company_id
   WHERE item.id = p_item_id
     AND pedido.company_id = v_company_id
   FOR UPDATE OF pedido;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item laboratorial inexistente ou fora do tenant do ator';
  END IF;

  SELECT item.*
    INTO v_item
    FROM public.exames_lab_pedido_itens AS item
   WHERE item.id = p_item_id
     AND item.company_id = v_company_id
     AND item.cd_pedido = v_order.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item laboratorial inconsistente com o pedido';
  END IF;
  IF v_item.tp_status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'Status esperado divergente: esperado %, atual %', p_expected_status, v_item.tp_status;
  END IF;
  IF v_order.tp_status IS NULL OR v_order.tp_status IN ('CANCELADO', 'LIBERADO', 'ENTREGUE') THEN
    RAISE EXCEPTION 'Pedido laboratorial em transicao invalida: %', v_order.tp_status;
  END IF;
  IF p_release AND v_item.tp_status IS DISTINCT FROM 'EM_ANALISE' THEN
    RAISE EXCEPTION 'Liberacao exige item EM_ANALISE';
  END IF;
  IF NOT p_release AND v_item.tp_status NOT IN ('COLETADO', 'EM_ANALISE') THEN
    RAISE EXCEPTION 'Salvamento exige item COLETADO ou EM_ANALISE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.exames_lab_resultado
     WHERE company_id = v_company_id
       AND cd_item_pedido = p_item_id
       AND lg_liberado = TRUE
  ) THEN
    RAISE EXCEPTION 'Resultado laboratorial liberado e imutavel';
  END IF;

  DELETE FROM public.exames_lab_resultado
   WHERE company_id = v_company_id AND cd_item_pedido = p_item_id;

  v_release_at := CASE WHEN p_release THEN clock_timestamp() ELSE NULL END;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_results)
  LOOP
    IF jsonb_typeof(v_entry) <> 'object' THEN
      RAISE EXCEPTION 'Cada resultado deve ser um objeto JSON';
    END IF;
    v_parameter := NULLIF(trim(v_entry->>'ds_parametro'), '');
    v_text_value := NULLIF(trim(v_entry->>'vl_resultado_texto'), '');
    v_unit := NULLIF(trim(v_entry->>'ds_unidade'), '');
    v_observation := NULLIF(trim(v_entry->>'ds_observacao'), '');
    v_numeric := CASE WHEN v_entry ? 'vl_resultado' AND v_entry->>'vl_resultado' <> ''
                      THEN (v_entry->>'vl_resultado')::NUMERIC ELSE NULL END;
    v_minimum := CASE WHEN v_entry ? 'vl_minimo_referencia' AND v_entry->>'vl_minimo_referencia' <> ''
                      THEN (v_entry->>'vl_minimo_referencia')::NUMERIC ELSE NULL END;
    v_maximum := CASE WHEN v_entry ? 'vl_maximo_referencia' AND v_entry->>'vl_maximo_referencia' <> ''
                      THEN (v_entry->>'vl_maximo_referencia')::NUMERIC ELSE NULL END;
    IF v_parameter IS NULL OR (v_numeric IS NULL AND v_text_value IS NULL) THEN
      RAISE EXCEPTION 'Parametro e valor numerico ou textual sao obrigatorios';
    END IF;
    v_result_type := COALESCE(
      NULLIF(upper(trim(v_entry->>'tp_resultado')), ''),
      public.classificar_resultado_lab(v_numeric, v_minimum, v_maximum)
    );
    IF v_result_type NOT IN ('NORMAL', 'BAIXO', 'ALTO', 'CRITICO_BAIXO', 'CRITICO_ALTO', 'INCONCLUSIVO') THEN
      RAISE EXCEPTION 'Classificacao de resultado invalida: %', v_result_type;
    END IF;

    INSERT INTO public.exames_lab_resultado (
      company_id, cd_item_pedido, ds_parametro, vl_resultado,
      vl_resultado_texto, ds_unidade, vl_minimo_referencia,
      vl_maximo_referencia, tp_resultado, dt_resultado,
      cd_usuario_laboratorio, ds_observacao,
      lg_liberado, dt_liberacao, cd_usuario_liberacao
    ) VALUES (
      v_company_id, p_item_id, v_parameter, v_numeric,
      v_text_value, v_unit, v_minimum, v_maximum, v_result_type,
      clock_timestamp(), v_actor_id, v_observation,
      COALESCE(p_release, FALSE), v_release_at,
      CASE WHEN p_release THEN v_actor_id ELSE NULL END
    ) RETURNING id INTO v_result_id;
    v_result_ids := array_append(v_result_ids, v_result_id);

    IF p_release AND v_result_type IN ('CRITICO_BAIXO', 'CRITICO_ALTO') THEN
      INSERT INTO public.exames_lab_alerta_critico (
        company_id, cd_resultado, cd_paciente, cd_medico, tp_alerta,
        ds_parametro, vl_resultado, vl_referencia
      ) VALUES (
        v_company_id, v_result_id, v_order.cd_paciente, v_order.cd_medico,
        v_result_type, v_parameter, v_numeric,
        concat_ws('-', COALESCE(v_minimum::TEXT, ''), COALESCE(v_maximum::TEXT, ''))
      );
    END IF;
  END LOOP;

  UPDATE public.exames_lab_pedido_itens
     SET tp_status = CASE WHEN p_release THEN 'LIBERADO' ELSE 'EM_ANALISE' END,
         dt_liberacao = v_release_at
   WHERE id = v_item.id AND company_id = v_company_id;

  IF p_release AND NOT EXISTS (
    SELECT 1
      FROM public.exames_lab_pedido_itens AS sibling
     WHERE sibling.cd_pedido = v_order.id
       AND sibling.company_id = v_company_id
       AND sibling.tp_status NOT IN ('LIBERADO', 'CANCELADO')
  ) THEN
    v_order_status := 'LIBERADO';
  ELSE
    v_order_status := 'EM_ANALISE';
  END IF;

  UPDATE public.exames_lab_pedido
     SET tp_status = v_order_status,
         dt_liberacao = CASE WHEN v_order_status = 'LIBERADO' THEN v_release_at ELSE NULL END
   WHERE id = v_order.id AND company_id = v_company_id;

  v_response := jsonb_build_object(
    'company_id', v_company_id,
    'actor_id', v_actor_id,
    'item_id', v_item.id,
    'order_id', v_order.id,
    'item_status', CASE WHEN p_release THEN 'LIBERADO' ELSE 'EM_ANALISE' END,
    'order_status', v_order_status,
    'released', COALESCE(p_release, FALSE),
    'released_at', v_release_at,
    'result_ids', to_jsonb(v_result_ids)
  );

  INSERT INTO public.lis_result_mutations (
    company_id, item_id, actor_id, idempotency_key, expected_status,
    release_requested, request_hash, response
  ) VALUES (
    v_company_id, p_item_id, v_actor_id, p_idempotency_key, p_expected_status,
    COALESCE(p_release, FALSE), v_request_hash, v_response
  );
  RETURN v_response;
END
$function$;

GRANT USAGE, CREATE ON SCHEMA public TO lis_rpc_owner;
GRANT USAGE ON SCHEMA auth TO lis_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO lis_rpc_owner;
GRANT SELECT ON TABLE public.user_profiles, public.roles, public.role_permissions TO lis_rpc_owner;
GRANT SELECT, UPDATE ON TABLE public.exames_lab_pedido, public.exames_lab_pedido_itens TO lis_rpc_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.exames_lab_resultado TO lis_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON TABLE public.exames_lab_alerta_critico TO lis_rpc_owner;
GRANT SELECT, INSERT ON TABLE public.lis_result_mutations TO lis_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.exames_lab_resultado_id_seq,
  public.exames_lab_alerta_critico_id_seq, public.lis_result_mutations_id_seq TO lis_rpc_owner;

ALTER FUNCTION public.save_or_release_lab_result_secure(BIGINT, TEXT, UUID, JSONB, BOOLEAN)
  OWNER TO lis_rpc_owner;
REVOKE CREATE ON SCHEMA public FROM lis_rpc_owner;

REVOKE ALL ON FUNCTION public.save_or_release_lab_result_secure(BIGINT, TEXT, UUID, JSONB, BOOLEAN)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_or_release_lab_result_secure(BIGINT, TEXT, UUID, JSONB, BOOLEAN)
  TO authenticated;

REVOKE ALL ON FUNCTION public.validate_lis_result_tenant() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_lis_alert_tenant() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_released_lis_result() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gerar_alerta_critico() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_lab_user(UUID) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.exames_lab_pedido, public.exames_lab_pedido_itens,
  public.exames_lab_resultado, public.exames_lab_alerta_critico
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.exames_lab_pedido, public.exames_lab_pedido_itens,
  public.exames_lab_resultado, public.exames_lab_alerta_critico
  TO authenticated;
REVOKE ALL ON TABLE public.lis_result_mutations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.exames_lab_resultado_id_seq,
  public.exames_lab_alerta_critico_id_seq, public.lis_result_mutations_id_seq
  FROM PUBLIC, anon, authenticated, service_role;


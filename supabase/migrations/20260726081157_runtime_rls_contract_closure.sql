BEGIN;

-- The BI views are SECURITY INVOKER. Their base tables therefore need explicit
-- grants protected by policies tied to the active application context.
ALTER TABLE public.payment_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_sources FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read payment_sources from their company" ON public.payment_sources;
DROP POLICY IF EXISTS "Admins can manage payment_sources in their company" ON public.payment_sources;
DROP POLICY IF EXISTS payment_sources_context_select ON public.payment_sources;
DROP POLICY IF EXISTS payment_sources_context_insert ON public.payment_sources;
DROP POLICY IF EXISTS payment_sources_context_update ON public.payment_sources;
DROP POLICY IF EXISTS payment_sources_context_delete ON public.payment_sources;

CREATE POLICY payment_sources_context_select
ON public.payment_sources
FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id()
  AND (
    public.can_access('recepcao', 'view')
    OR public.can_access('faturamento', 'view')
    OR public.can_access('financeiro', 'view')
    OR public.can_access('bi', 'view')
  )
);

CREATE POLICY payment_sources_context_insert
ON public.payment_sources
FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.active_company_id()
  AND (
    public.can_access('faturamento', 'create')
    OR public.can_access('financeiro', 'create')
  )
);

CREATE POLICY payment_sources_context_update
ON public.payment_sources
FOR UPDATE TO authenticated
USING (
  company_id = public.active_company_id()
  AND (
    public.can_access('faturamento', 'edit')
    OR public.can_access('financeiro', 'edit')
  )
)
WITH CHECK (
  company_id = public.active_company_id()
  AND (
    public.can_access('faturamento', 'edit')
    OR public.can_access('financeiro', 'edit')
  )
);

CREATE POLICY payment_sources_context_delete
ON public.payment_sources
FOR DELETE TO authenticated
USING (
  company_id = public.active_company_id()
  AND (
    public.can_access('faturamento', 'delete')
    OR public.can_access('financeiro', 'delete')
  )
);

REVOKE ALL ON public.payment_sources FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_sources TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.payment_sources_id_seq TO authenticated;

ALTER TABLE public.billings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billings_context_select ON public.billings;
CREATE POLICY billings_context_select
ON public.billings
FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id()
  AND (
    public.can_access('recepcao', 'view')
    OR public.can_access('faturamento', 'view')
    OR public.can_access('financeiro', 'view')
    OR public.can_access('bi', 'view')
  )
  AND (
    public.active_unit_id() IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.appointments appointment
      WHERE appointment.id = billings.appointment_id
        AND appointment.company_id = billings.company_id
        AND appointment.unit_id = public.active_unit_id()
    )
  )
);

REVOKE ALL ON public.billings FROM PUBLIC, anon;
GRANT SELECT ON public.billings TO authenticated;

-- The laboratory RPCs are SECURITY INVOKER and need the same tenant-scoped
-- base-table contract. Replace legacy USING(true)/role-name policies.
ALTER TABLE public.exames_lab_pedido ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_alerta_critico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_alerta_critico FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read lab orders" ON public.exames_lab_pedido;
DROP POLICY IF EXISTS "Lab can manage lab orders" ON public.exames_lab_pedido;
DROP POLICY IF EXISTS lab_orders_context_select ON public.exames_lab_pedido;
DROP POLICY IF EXISTS lab_orders_context_insert ON public.exames_lab_pedido;
DROP POLICY IF EXISTS lab_orders_context_update ON public.exames_lab_pedido;
DROP POLICY IF EXISTS lab_orders_context_delete ON public.exames_lab_pedido;

CREATE POLICY lab_orders_context_select
ON public.exames_lab_pedido
FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'view')
  AND (
    public.active_unit_id() IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.patients patient
      WHERE patient.id = exames_lab_pedido.cd_paciente
        AND patient.company_id = exames_lab_pedido.company_id
        AND patient.unit_id = public.active_unit_id()
    )
  )
);

CREATE POLICY lab_orders_context_insert
ON public.exames_lab_pedido
FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'create')
  AND EXISTS (
    SELECT 1
    FROM public.patients patient
    WHERE patient.id = exames_lab_pedido.cd_paciente
      AND patient.company_id = exames_lab_pedido.company_id
      AND (
        public.active_unit_id() IS NULL
        OR patient.unit_id = public.active_unit_id()
      )
  )
);

CREATE POLICY lab_orders_context_update
ON public.exames_lab_pedido
FOR UPDATE TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'edit')
  AND EXISTS (
    SELECT 1
    FROM public.patients patient
    WHERE patient.id = exames_lab_pedido.cd_paciente
      AND patient.company_id = exames_lab_pedido.company_id
      AND (
        public.active_unit_id() IS NULL
        OR patient.unit_id = public.active_unit_id()
      )
  )
)
WITH CHECK (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'edit')
  AND EXISTS (
    SELECT 1
    FROM public.patients patient
    WHERE patient.id = exames_lab_pedido.cd_paciente
      AND patient.company_id = exames_lab_pedido.company_id
      AND (
        public.active_unit_id() IS NULL
        OR patient.unit_id = public.active_unit_id()
      )
  )
);

CREATE POLICY lab_orders_context_delete
ON public.exames_lab_pedido
FOR DELETE TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'delete')
  AND EXISTS (
    SELECT 1
    FROM public.patients patient
    WHERE patient.id = exames_lab_pedido.cd_paciente
      AND patient.company_id = exames_lab_pedido.company_id
      AND (
        public.active_unit_id() IS NULL
        OR patient.unit_id = public.active_unit_id()
      )
  )
);

DROP POLICY IF EXISTS "Authenticated can read lab order items" ON public.exames_lab_pedido_itens;
DROP POLICY IF EXISTS "Lab can manage lab order items" ON public.exames_lab_pedido_itens;
DROP POLICY IF EXISTS lab_order_items_context_select ON public.exames_lab_pedido_itens;
DROP POLICY IF EXISTS lab_order_items_context_insert ON public.exames_lab_pedido_itens;
DROP POLICY IF EXISTS lab_order_items_context_update ON public.exames_lab_pedido_itens;
DROP POLICY IF EXISTS lab_order_items_context_delete ON public.exames_lab_pedido_itens;

CREATE POLICY lab_order_items_context_select
ON public.exames_lab_pedido_itens
FOR SELECT TO authenticated
USING (
  public.can_access('laboratorio', 'view')
  AND EXISTS (
    SELECT 1
    FROM public.exames_lab_pedido pedido
    JOIN public.patients patient
      ON patient.id = pedido.cd_paciente
     AND patient.company_id = pedido.company_id
    WHERE pedido.id = exames_lab_pedido_itens.cd_pedido
      AND pedido.company_id = public.active_company_id()
      AND (
        exames_lab_pedido_itens.company_id IS NULL
        OR exames_lab_pedido_itens.company_id = pedido.company_id
      )
      AND (
        public.active_unit_id() IS NULL
        OR patient.unit_id = public.active_unit_id()
      )
  )
);

CREATE POLICY lab_order_items_context_insert
ON public.exames_lab_pedido_itens
FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'create')
  AND EXISTS (
    SELECT 1
    FROM public.exames_lab_pedido pedido
    WHERE pedido.id = exames_lab_pedido_itens.cd_pedido
      AND pedido.company_id = exames_lab_pedido_itens.company_id
  )
);

CREATE POLICY lab_order_items_context_update
ON public.exames_lab_pedido_itens
FOR UPDATE TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'edit')
  AND EXISTS (
    SELECT 1
    FROM public.exames_lab_pedido pedido
    JOIN public.patients patient
      ON patient.id = pedido.cd_paciente
     AND patient.company_id = pedido.company_id
    WHERE pedido.id = exames_lab_pedido_itens.cd_pedido
      AND pedido.company_id = exames_lab_pedido_itens.company_id
      AND (
        public.active_unit_id() IS NULL
        OR patient.unit_id = public.active_unit_id()
      )
  )
)
WITH CHECK (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'edit')
  AND EXISTS (
    SELECT 1
    FROM public.exames_lab_pedido pedido
    JOIN public.patients patient
      ON patient.id = pedido.cd_paciente
     AND patient.company_id = pedido.company_id
    WHERE pedido.id = exames_lab_pedido_itens.cd_pedido
      AND pedido.company_id = exames_lab_pedido_itens.company_id
      AND (
        public.active_unit_id() IS NULL
        OR patient.unit_id = public.active_unit_id()
      )
  )
);

CREATE POLICY lab_order_items_context_delete
ON public.exames_lab_pedido_itens
FOR DELETE TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'delete')
  AND EXISTS (
    SELECT 1
    FROM public.exames_lab_pedido pedido
    JOIN public.patients patient
      ON patient.id = pedido.cd_paciente
     AND patient.company_id = pedido.company_id
    WHERE pedido.id = exames_lab_pedido_itens.cd_pedido
      AND pedido.company_id = exames_lab_pedido_itens.company_id
      AND (
        public.active_unit_id() IS NULL
        OR patient.unit_id = public.active_unit_id()
      )
  )
);

DROP POLICY IF EXISTS "Authenticated can read lab alerts" ON public.exames_lab_alerta_critico;
DROP POLICY IF EXISTS "Lab can manage lab alerts" ON public.exames_lab_alerta_critico;
DROP POLICY IF EXISTS lab_alerts_context_select ON public.exames_lab_alerta_critico;
DROP POLICY IF EXISTS lab_alerts_context_insert ON public.exames_lab_alerta_critico;
DROP POLICY IF EXISTS lab_alerts_context_update ON public.exames_lab_alerta_critico;
DROP POLICY IF EXISTS lab_alerts_context_delete ON public.exames_lab_alerta_critico;

CREATE POLICY lab_alerts_context_select
ON public.exames_lab_alerta_critico
FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'view')
  AND (
    public.active_unit_id() IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.patients patient
      WHERE patient.id = exames_lab_alerta_critico.cd_paciente
        AND patient.company_id = exames_lab_alerta_critico.company_id
        AND patient.unit_id = public.active_unit_id()
    )
  )
);

CREATE POLICY lab_alerts_context_insert
ON public.exames_lab_alerta_critico
FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'create')
);

CREATE POLICY lab_alerts_context_update
ON public.exames_lab_alerta_critico
FOR UPDATE TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'edit')
  AND (
    public.active_unit_id() IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.patients patient
      WHERE patient.id = exames_lab_alerta_critico.cd_paciente
        AND patient.company_id = exames_lab_alerta_critico.company_id
        AND patient.unit_id = public.active_unit_id()
    )
  )
)
WITH CHECK (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'edit')
  AND (
    public.active_unit_id() IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.patients patient
      WHERE patient.id = exames_lab_alerta_critico.cd_paciente
        AND patient.company_id = exames_lab_alerta_critico.company_id
        AND patient.unit_id = public.active_unit_id()
    )
  )
);

CREATE POLICY lab_alerts_context_delete
ON public.exames_lab_alerta_critico
FOR DELETE TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.can_access('laboratorio', 'delete')
  AND (
    public.active_unit_id() IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.patients patient
      WHERE patient.id = exames_lab_alerta_critico.cd_paciente
        AND patient.company_id = exames_lab_alerta_critico.company_id
        AND patient.unit_id = public.active_unit_id()
    )
  )
);

REVOKE ALL ON public.exames_lab_pedido FROM PUBLIC, anon;
REVOKE ALL ON public.exames_lab_pedido_itens FROM PUBLIC, anon;
REVOKE ALL ON public.exames_lab_alerta_critico FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.exames_lab_pedido,
     public.exames_lab_pedido_itens,
     public.exames_lab_alerta_critico
  TO authenticated;
GRANT USAGE, SELECT
  ON SEQUENCE public.exames_lab_pedido_id_seq,
              public.exames_lab_pedido_itens_id_seq,
              public.exames_lab_alerta_critico_id_seq
  TO authenticated;

-- Preserve automatic critical-alert creation after FORCE RLS by propagating
-- the tenant from the originating order instead of creating a NULL tenant row.
CREATE OR REPLACE FUNCTION public.fn_gerar_alerta_critico()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id UUID;
  v_cd_paciente BIGINT;
  v_cd_medico BIGINT;
BEGIN
  IF NEW.tp_resultado NOT IN ('CRITICO_BAIXO', 'CRITICO_ALTO') THEN
    RETURN NEW;
  END IF;

  SELECT pedido.company_id, pedido.cd_paciente, pedido.cd_medico
    INTO v_company_id, v_cd_paciente, v_cd_medico
  FROM public.exames_lab_pedido_itens item
  JOIN public.exames_lab_pedido pedido ON pedido.id = item.cd_pedido
  WHERE item.id = NEW.cd_item_pedido
    AND pedido.company_id = public.active_company_id()
  LIMIT 1;

  IF v_company_id IS NULL OR v_cd_paciente IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.exames_lab_alerta_critico (
    company_id, cd_resultado, cd_paciente, cd_medico, tp_alerta,
    ds_parametro, vl_resultado, vl_referencia
  ) VALUES (
    v_company_id, NEW.id, v_cd_paciente, v_cd_medico, NEW.tp_resultado,
    NEW.ds_parametro, NEW.vl_resultado,
    CONCAT_WS(
      '-',
      COALESCE(NEW.vl_minimo_referencia::TEXT, ''),
      COALESCE(NEW.vl_maximo_referencia::TEXT, '')
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_gerar_alerta_critico() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_gerar_alerta_critico() TO authenticated;

COMMIT;

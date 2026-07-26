BEGIN;

-- BI views must preserve the active tenant and execute with caller privileges.
CREATE OR REPLACE VIEW public.v_ocupacao_profissional
WITH (security_invoker = true) AS
SELECT
  p.id AS cd_profissional,
  p.full_name AS nm_profissional,
  p.specialty AS ds_especialidade,
  COUNT(a.id) AS nr_agendamentos_total,
  COUNT(a.id) FILTER (WHERE a.status IN ('confirmed', 'waiting', 'in_progress', 'completed')) AS nr_confirmados,
  COUNT(a.id) FILTER (WHERE a.status = 'completed') AS nr_atendidos,
  COUNT(a.id) FILTER (WHERE a.status = 'no_show') AS nr_faltaram,
  ROUND(
    100.0 * COUNT(a.id) FILTER (WHERE a.status = 'completed') / NULLIF(COUNT(a.id), 0),
    2
  ) AS nr_taxa_atendimento,
  p.company_id
FROM public.professionals p
LEFT JOIN public.appointments a
  ON a.professional_id = p.id
 AND a.company_id = p.company_id
 AND a.appointment_date >= CURRENT_DATE - INTERVAL '30 days'
WHERE p.lg_ativo = TRUE
  AND p.company_id = public.active_company_id()
GROUP BY p.company_id, p.id, p.full_name, p.specialty;

CREATE OR REPLACE VIEW public.v_faturamento_convenio
WITH (security_invoker = true) AS
SELECT
  ic.id AS cd_convenio,
  ic.name AS nm_convenio,
  ps.name AS nm_fonte_pagadora,
  COUNT(DISTINCT a.id) AS nr_atendimentos,
  COALESCE(SUM(b.amount), 0) AS vl_faturado,
  COALESCE(SUM(b.paid_amount), 0) AS vl_recebido,
  COALESCE(SUM(b.amount - b.paid_amount), 0) AS vl_a_receber,
  ic.company_id
FROM public.insurance_companies ic
LEFT JOIN public.payment_sources ps
  ON ps.id = ic.payment_source_id
 AND ps.company_id = ic.company_id
LEFT JOIN public.appointments a
  ON a.insurance_company_id = ic.id
 AND a.company_id = ic.company_id
 AND a.appointment_date >= CURRENT_DATE - INTERVAL '90 days'
LEFT JOIN public.billings b
  ON b.appointment_id = a.id
 AND b.company_id = ic.company_id
WHERE ic.lg_ativo = TRUE
  AND ic.company_id = public.active_company_id()
GROUP BY ic.company_id, ic.id, ic.name, ps.name;

GRANT SELECT ON public.v_ocupacao_profissional, public.v_faturamento_convenio TO authenticated;

-- DICOM equipment was RLS-enabled but not exposed to the authenticated runtime role.
ALTER TABLE public.dicom_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dicom_equipment FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read dicom_equipment from their company" ON public.dicom_equipment;
DROP POLICY IF EXISTS "Admins and radiology can manage dicom_equipment" ON public.dicom_equipment;
DROP POLICY IF EXISTS dicom_equipment_tenant_select ON public.dicom_equipment;
DROP POLICY IF EXISTS dicom_equipment_tenant_insert ON public.dicom_equipment;
DROP POLICY IF EXISTS dicom_equipment_tenant_update ON public.dicom_equipment;
DROP POLICY IF EXISTS dicom_equipment_tenant_delete ON public.dicom_equipment;

CREATE POLICY dicom_equipment_tenant_select
ON public.dicom_equipment
FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.can_access('dicom', 'view')
);

CREATE POLICY dicom_equipment_tenant_insert
ON public.dicom_equipment
FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.active_company_id()
  AND public.can_access('dicom', 'create')
);

CREATE POLICY dicom_equipment_tenant_update
ON public.dicom_equipment
FOR UPDATE TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.can_access('dicom', 'edit')
)
WITH CHECK (
  company_id = public.active_company_id()
  AND public.can_access('dicom', 'edit')
);

CREATE POLICY dicom_equipment_tenant_delete
ON public.dicom_equipment
FOR DELETE TO authenticated
USING (
  company_id = public.active_company_id()
  AND public.can_access('dicom', 'delete')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dicom_equipment TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.dicom_equipment_id_seq TO authenticated;

-- The local gateway intentionally supports only simple REST selects. These
-- invoker RPCs expose the minimum laboratory projection with tenant checks.
CREATE OR REPLACE FUNCTION public.get_lab_order_summaries(
  p_company_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_result JSONB;
BEGIN
  IF v_company_id IS NULL
     OR NOT public.can_access('laboratorio', 'view') THEN
    RAISE EXCEPTION 'Contexto de laboratorio invalido ou sem permissao'
      USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NOT NULL AND p_company_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'Empresa solicitada nao pertence ao contexto ativo'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_payload ORDER BY sort_date DESC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      p.dt_pedido AS sort_date,
      to_jsonb(p)
        || jsonb_build_object(
          'paciente_nome', pac.full_name,
          'medico_nome', med.full_name,
          'itens_count', (
            SELECT COUNT(*)
            FROM public.exames_lab_pedido_itens item
            WHERE item.cd_pedido = p.id
              AND item.company_id = v_company_id
          )
        ) AS row_payload
    FROM public.exames_lab_pedido p
    LEFT JOIN public.patients pac
      ON pac.id = p.cd_paciente
     AND pac.company_id = p.company_id
    LEFT JOIN public.professionals med
      ON med.id = p.cd_medico
     AND med.company_id = p.company_id
    WHERE p.company_id = v_company_id
  ) scoped_orders;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lab_critical_alerts(
  p_company_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_result JSONB;
BEGIN
  IF v_company_id IS NULL
     OR NOT public.can_access('laboratorio', 'view') THEN
    RAISE EXCEPTION 'Contexto de laboratorio invalido ou sem permissao'
      USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NOT NULL AND p_company_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'Empresa solicitada nao pertence ao contexto ativo'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_payload ORDER BY sort_date DESC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      a.dt_alerta AS sort_date,
      to_jsonb(a)
        || jsonb_build_object(
          'paciente_nome', pac.full_name,
          'medico_nome', med.full_name
        ) AS row_payload
    FROM public.exames_lab_alerta_critico a
    LEFT JOIN public.patients pac
      ON pac.id = a.cd_paciente
     AND pac.company_id = a.company_id
    LEFT JOIN public.professionals med
      ON med.id = a.cd_medico
     AND med.company_id = a.company_id
    WHERE a.company_id = v_company_id
      AND a.lg_comunicado = FALSE
  ) scoped_alerts;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_lab_order_summaries(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_lab_critical_alerts(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lab_order_summaries(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lab_critical_alerts(UUID) TO authenticated;

COMMIT;

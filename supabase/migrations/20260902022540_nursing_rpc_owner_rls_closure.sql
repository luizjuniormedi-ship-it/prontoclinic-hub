BEGIN;

DO $owner$
DECLARE
  v_executor_is_superuser BOOLEAN;
BEGIN
  SELECT rolsuper INTO v_executor_is_superuser
    FROM pg_roles WHERE rolname = CURRENT_USER;

  IF to_regrole('prontomedic_nursing_rpc_owner') IS NULL THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION 'Nursing RPC owner creation requires superuser';
    END IF;
    EXECUTE 'CREATE ROLE prontomedic_nursing_rpc_owner NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'prontomedic_nursing_rpc_owner'
       AND (rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication)
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION 'Nursing RPC owner hardening requires superuser';
    END IF;
    EXECUTE 'ALTER ROLE prontomedic_nursing_rpc_owner NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  END IF;
END
$owner$;

GRANT USAGE ON SCHEMA public, auth TO prontomedic_nursing_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO prontomedic_nursing_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_company_id() TO prontomedic_nursing_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_unit_id() TO prontomedic_nursing_rpc_owner;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT) TO prontomedic_nursing_rpc_owner;
GRANT SELECT ON public.professionals TO prontomedic_nursing_rpc_owner;
GRANT SELECT, UPDATE ON public.nursing_medication_administrations
  TO prontomedic_nursing_rpc_owner;

DROP POLICY IF EXISTS nursing_rpc_owner_select
  ON public.nursing_medication_administrations;
CREATE POLICY nursing_rpc_owner_select
  ON public.nursing_medication_administrations
  FOR SELECT TO prontomedic_nursing_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.can_access('prontuario', 'edit')
  );

DROP POLICY IF EXISTS nursing_rpc_owner_update
  ON public.nursing_medication_administrations;
CREATE POLICY nursing_rpc_owner_update
  ON public.nursing_medication_administrations
  FOR UPDATE TO prontomedic_nursing_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.can_access('prontuario', 'edit')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.can_access('prontuario', 'edit')
  );

ALTER FUNCTION public.nursing_administer_medication_secure(BIGINT, BIGINT)
  OWNER TO prontomedic_nursing_rpc_owner;
ALTER FUNCTION public.nursing_refuse_medication_secure(BIGINT, TEXT)
  OWNER TO prontomedic_nursing_rpc_owner;

CREATE OR REPLACE FUNCTION public.check_prescription_safety(
  p_patient_id BIGINT,
  p_medication TEXT
)
RETURNS TABLE(alert_type TEXT, severity TEXT, descricao TEXT)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_medication TEXT := LOWER(BTRIM(COALESCE(p_medication, '')));
BEGIN
  IF v_company IS NULL OR v_medication = '' THEN
    RAISE EXCEPTION 'Contexto ativo e medicamento sao obrigatorios'
      USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_access('prontuario', 'view') THEN
    RAISE EXCEPTION 'Permissao clinica para consultar seguranca da prescricao e obrigatoria'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.patients AS patient
     WHERE patient.id = p_patient_id
       AND patient.company_id = v_company
       AND patient.lg_ativo
  ) THEN
    RAISE EXCEPTION 'Paciente nao encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT 'alergia'::TEXT,
         CASE allergy.severity
           WHEN 'HIGH' THEN 'grave'
           WHEN 'MODERATE' THEN 'moderada'
           ELSE 'informativa'
         END::TEXT,
         ('Alergia registrada: ' || allergy.allergen ||
           COALESCE(' - reacao: ' || NULLIF(allergy.reaction, ''), ''))::TEXT
    FROM public.patient_allergies AS allergy
   WHERE allergy.company_id = v_company
     AND allergy.patient_id = p_patient_id
     AND allergy.status = 'ACTIVE'
     AND LOWER(BTRIM(allergy.allergen)) = v_medication;

  RETURN QUERY
  SELECT 'duplicidade'::TEXT,
         'moderada'::TEXT,
         ('Medicamento ja prescrito: ' || item.medication_name)::TEXT
    FROM public.electronic_prescriptions AS prescription
    JOIN public.electronic_prescription_items AS item
      ON item.prescription_id = prescription.id
     AND item.company_id = v_company
   WHERE prescription.company_id = v_company
     AND prescription.patient_id = p_patient_id
     AND prescription.status IN ('signed', 'active')
     AND item.item_type = 'medication'
     AND LOWER(BTRIM(COALESCE(NULLIF(item.active_ingredient, ''), item.medication_name))) = v_medication;
END
$function$;

REVOKE ALL ON FUNCTION public.check_prescription_safety(BIGINT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_prescription_safety(BIGINT, TEXT)
  TO authenticated, app_prontomedic;

COMMIT;

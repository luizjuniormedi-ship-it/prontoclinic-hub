-- RPC seguro para validar regras de Convenios sem aceitar company_id arbitrario.
-- A funcao legada permanece interna; o cliente usa apenas este wrapper.

CREATE OR REPLACE FUNCTION public.validate_insurance_operation_secure(
  p_company_id UUID,
  p_operation TEXT,
  p_insurance_company_id INTEGER,
  p_insurance_plan_id INTEGER DEFAULT NULL,
  p_service_id BIGINT DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL,
  p_professional_id BIGINT DEFAULT NULL,
  p_patient_id BIGINT DEFAULT NULL,
  p_appointment_id BIGINT DEFAULT NULL,
  p_reference_date DATE DEFAULT CURRENT_DATE,
  p_create_snapshot BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_company_id IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION 'tenant invalido para validacao de convenio'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.validate_insurance_operation(
    p_company_id,
    p_operation,
    p_insurance_company_id,
    p_insurance_plan_id,
    p_service_id,
    p_unit_id,
    p_professional_id,
    p_patient_id,
    p_appointment_id,
    p_reference_date,
    p_create_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_insurance_operation_secure(
  UUID, TEXT, INTEGER, INTEGER, BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, DATE, BOOLEAN
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_insurance_operation_secure(
  UUID, TEXT, INTEGER, INTEGER, BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, DATE, BOOLEAN
) TO authenticated;

COMMENT ON FUNCTION public.validate_insurance_operation_secure(
  UUID, TEXT, INTEGER, INTEGER, BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, DATE, BOOLEAN
) IS 'Valida regras de Convenios somente para o tenant da identidade autenticada.';

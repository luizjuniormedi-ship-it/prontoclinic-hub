-- Expose Convênios only through the authenticated tenant boundary.
-- The legacy function remains an internal implementation detail.

REVOKE ALL ON FUNCTION public.validate_insurance_operation(
  UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,BIGINT,BIGINT,DATE,BOOLEAN
) FROM PUBLIC;

DO $f1$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.validate_insurance_operation(
      UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,BIGINT,BIGINT,DATE,BOOLEAN
    ) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.validate_insurance_operation(
      UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,BIGINT,BIGINT,DATE,BOOLEAN
    ) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    REVOKE ALL ON FUNCTION public.validate_insurance_operation(
      UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,BIGINT,BIGINT,DATE,BOOLEAN
    ) FROM app_prontomedic;
  END IF;
END
$f1$;

CREATE OR REPLACE FUNCTION public.validate_insurance_operation_secure(
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
AS $f1$
DECLARE
  v_company_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'usuario nao autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT up.company_id INTO STRICT v_company_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.lg_ativo = TRUE;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'usuario sem empresa associada' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.lg_ativo = TRUE
      AND upper(trim(coalesce(up.role_name, ''))) IN (
        'ADMIN', 'ADMINISTRADOR', 'RECEPTION', 'RECEPCAO',
        'FINANCIAL', 'FATURAMENTO', 'MEDICO', 'ENFERMEIRO',
        'DOCTOR', 'NURSING', 'BILLING'
      )
  ) THEN
    RAISE EXCEPTION 'papel sem permissao para validar convenio' USING ERRCODE = '42501';
  END IF;

  RETURN public.validate_insurance_operation(
    v_company_id,
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
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'usuario sem empresa associada' USING ERRCODE = '42501';
  WHEN TOO_MANY_ROWS THEN
    RAISE EXCEPTION 'identidade do usuario ambigua' USING ERRCODE = '42501';
END
$f1$;

REVOKE ALL ON FUNCTION public.validate_insurance_operation_secure(
  TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,BIGINT,BIGINT,DATE,BOOLEAN
) FROM PUBLIC;

DO $f1$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.validate_insurance_operation_secure(
      TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,BIGINT,BIGINT,DATE,BOOLEAN
    ) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.validate_insurance_operation_secure(
      TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,BIGINT,BIGINT,DATE,BOOLEAN
    ) TO authenticated;
  END IF;
END
$f1$;

REVOKE ALL ON FUNCTION public.get_my_company_id() FROM PUBLIC;

DO $f1$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.get_my_company_id() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated;
  END IF;
END
$f1$;

COMMENT ON FUNCTION public.validate_insurance_operation_secure(
  TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,BIGINT,BIGINT,DATE,BOOLEAN
) IS 'Valida Convênios usando exclusivamente auth.uid() -> user_profiles.company_id; nunca aceita company_id do cliente.';


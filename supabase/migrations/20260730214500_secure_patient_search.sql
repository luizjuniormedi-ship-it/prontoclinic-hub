-- Patient search is a hot path for Agenda, Reception and Call Center. Running
-- the four-field search directly through the patients RLS policy evaluates
-- authorization helpers once per row. This function preserves the same access
-- contract while evaluating it once, then lets PostgreSQL use the trigram
-- indexes created by 20260730203000.
CREATE OR REPLACE FUNCTION public.search_patients_secure(
  p_query TEXT,
  p_limit INTEGER DEFAULT 50
)
RETURNS SETOF public.patients
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_text TEXT := regexp_replace(btrim(COALESCE(p_query, '')), '[%,()]', ' ', 'g');
  v_digits TEXT := regexp_replace(COALESCE(p_query, ''), '[^0-9]', '', 'g');
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.current_application_session_is_active()
     OR v_company_id IS NULL
     OR v_unit_id IS NULL
     OR NOT public.org_can_access_unit(v_company_id, v_unit_id)
     OR NOT (
       public.can_access('patients', 'view')
       OR public.can_access('pacientes', 'view')
     )
  THEN
    RAISE EXCEPTION 'PATIENT_SEARCH_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  IF v_text = '' AND v_digits = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT patient.*
  FROM public.patients AS patient
  WHERE patient.company_id = v_company_id
    AND (
      patient.full_name ILIKE '%' || v_text || '%'
      OR patient.cpf ILIKE '%' || COALESCE(NULLIF(v_digits, ''), v_text) || '%'
      OR patient.phone ILIKE '%' || COALESCE(NULLIF(v_digits, ''), v_text) || '%'
      OR patient.email ILIKE '%' || v_text || '%'
    )
  ORDER BY patient.full_name ASC
  LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_patients_secure(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_patients_secure(TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_patients_secure(TEXT, INTEGER) TO authenticated;


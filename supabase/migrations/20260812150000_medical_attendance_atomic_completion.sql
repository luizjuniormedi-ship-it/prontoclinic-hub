BEGIN;

CREATE OR REPLACE FUNCTION public.m18_complete_attendance_secure(
  p_encounter_id UUID,
  p_payload JSONB,
  p_disposition TEXT DEFAULT 'FINALIZED'
)
RETURNS public.encounters
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.encounters;
BEGIN
  v_row := public.m18_save_attendance_secure(p_encounter_id, p_payload);
  RETURN public.m18_finalize_attendance_secure(p_encounter_id, p_disposition);
END;
$$;

REVOKE ALL ON FUNCTION public.m18_complete_attendance_secure(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m18_complete_attendance_secure(UUID, JSONB, TEXT) TO authenticated, app_prontomedic;

COMMIT;

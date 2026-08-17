BEGIN;

CREATE OR REPLACE FUNCTION public.m22_unit_access(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, private
AS $fn$
  SELECT private.exam_unit_access_runtime(p_company_id, p_unit_id)
$fn$;

ALTER FUNCTION public.m22_unit_access(UUID, INTEGER)
  OWNER TO app_prontomedic;
REVOKE ALL ON FUNCTION public.m22_unit_access(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m22_unit_access(UUID, INTEGER)
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;

COMMIT;

BEGIN;

DO $prerequisites$
BEGIN
  IF to_regprocedure('private.exam_unit_access_runtime(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'M22 unit access runtime is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_rpc_owner'
  ) THEN
    RAISE EXCEPTION 'M22 RPC owner is missing';
  END IF;
END
$prerequisites$;

CREATE OR REPLACE FUNCTION public.m22_unit_access(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $fn$
  SELECT private.exam_unit_access_runtime(p_company_id, p_unit_id)
$fn$;

ALTER FUNCTION public.m22_unit_access(UUID, INTEGER)
  OWNER TO prontomedic_rpc_owner;
REVOKE ALL ON FUNCTION public.m22_unit_access(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m22_unit_access(UUID, INTEGER)
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;

COMMIT;

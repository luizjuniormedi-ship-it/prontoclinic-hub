BEGIN;

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS units_select ON public.units;
CREATE POLICY units_select
ON public.units
FOR SELECT
TO authenticated
USING (company_id = private.current_company_id());

GRANT SELECT ON TABLE public.units TO authenticated;

COMMIT;

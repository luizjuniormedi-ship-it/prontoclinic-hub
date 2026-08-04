BEGIN;

DROP FUNCTION IF EXISTS public.update_active_company_admin(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.upsert_active_company_unit_admin(INTEGER, TEXT, TEXT, TEXT, TEXT, BOOLEAN);

ALTER TABLE public.companies NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.units NO FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS units_admin ON public.units;
DROP POLICY IF EXISTS units_insert ON public.units;
DROP POLICY IF EXISTS units_update ON public.units;
DROP POLICY IF EXISTS units_delete ON public.units;

CREATE POLICY units_admin
ON public.units
FOR ALL
TO authenticated
USING (
  company_id = public.get_my_company_id()
  AND EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = auth.uid() AND role_name IN ('admin')
  )
)
WITH CHECK (company_id = public.get_my_company_id());

REVOKE INSERT, UPDATE, DELETE ON public.companies FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.units FROM authenticated;
GRANT SELECT ON public.units TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.units_id_seq TO authenticated;

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260804033225';

COMMIT;

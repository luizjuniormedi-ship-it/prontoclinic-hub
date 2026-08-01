-- Reception and billing call find_price as the authenticated runtime role.
-- Keep the function invoker-based so price_tables RLS remains authoritative.
REVOKE ALL ON public.price_tables FROM anon;
GRANT SELECT ON public.price_tables TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    EXECUTE 'REVOKE ALL ON public.price_tables FROM app_prontomedic';
    EXECUTE 'GRANT SELECT ON public.price_tables TO app_prontomedic';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.price_tables', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated runtime cannot read public.price_tables';
  END IF;

  IF has_table_privilege('anon', 'public.price_tables', 'SELECT') THEN
    RAISE EXCEPTION 'anonymous runtime must not read public.price_tables';
  END IF;
END
$$;

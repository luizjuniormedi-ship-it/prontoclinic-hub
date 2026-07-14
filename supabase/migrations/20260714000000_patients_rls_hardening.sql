-- Protecao tenant para dados sensiveis de pacientes.
-- Nao altera o DataSIGH; aplica-se somente ao PostgreSQL do ProntoMedic.

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.patients TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'patients'
      AND policyname = 'patients_tenant_select'
  ) THEN
    CREATE POLICY patients_tenant_select
      ON public.patients
      FOR SELECT TO authenticated
      USING (company_id = public.get_my_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'patients'
      AND policyname = 'patients_tenant_insert'
  ) THEN
    CREATE POLICY patients_tenant_insert
      ON public.patients
      FOR INSERT TO authenticated
      WITH CHECK (company_id = public.get_my_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'patients'
      AND policyname = 'patients_tenant_update'
  ) THEN
    CREATE POLICY patients_tenant_update
      ON public.patients
      FOR UPDATE TO authenticated
      USING (company_id = public.get_my_company_id())
      WITH CHECK (company_id = public.get_my_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'patients'
      AND policyname = 'patients_tenant_delete'
  ) THEN
    CREATE POLICY patients_tenant_delete
      ON public.patients
      FOR DELETE TO authenticated
      USING (company_id = public.get_my_company_id());
  END IF;
END
$$;

COMMENT ON TABLE public.patients IS
  'Dados de pacientes isolados por company_id com RLS forcado.';

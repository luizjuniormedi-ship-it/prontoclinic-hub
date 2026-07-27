-- Módulo 3: unidades, setores e recursos organizacionais.
-- Esta migration é local nesta rodada: não foi aplicada em Supabase/VPS.
-- DataSIGH não participa desta estrutura.

BEGIN;

CREATE TABLE IF NOT EXISTS public.unit_access (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unit_access_dates_valid CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT unit_access_unique_user_unit UNIQUE (user_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_unit_access_company_unit
  ON public.unit_access(company_id, unit_id, user_id);

CREATE TABLE IF NOT EXISTS public.sectors (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(150) NOT NULL,
  sector_type VARCHAR(30) NOT NULL DEFAULT 'operational'
    CHECK (sector_type IN ('administrative', 'clinical', 'diagnostic', 'operational', 'support')),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sectors_company_unit_code_unique UNIQUE (company_id, unit_id, code)
);

CREATE INDEX IF NOT EXISTS idx_sectors_company_unit_active
  ON public.sectors(company_id, unit_id, lg_ativo);

CREATE TABLE IF NOT EXISTS public.organizational_resources (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  sector_id BIGINT REFERENCES public.sectors(id) ON DELETE SET NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(150) NOT NULL,
  resource_type VARCHAR(30) NOT NULL
    CHECK (resource_type IN ('room', 'office', 'bed', 'equipment', 'inventory_location', 'cost_center')),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'maintenance')),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organizational_resources_company_unit_code_unique UNIQUE (company_id, unit_id, code)
);

CREATE INDEX IF NOT EXISTS idx_org_resources_scope
  ON public.organizational_resources(company_id, unit_id, resource_type, status);

CREATE TABLE IF NOT EXISTS public.unit_schedules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  sector_id BIGINT REFERENCES public.sectors(id) ON DELETE CASCADE,
  resource_id BIGINT REFERENCES public.organizational_resources(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unit_schedules_time_valid CHECK (end_time > start_time),
  CONSTRAINT unit_schedules_dates_valid CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT unit_schedules_target_valid CHECK (sector_id IS NOT NULL OR resource_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_unit_schedules_scope
  ON public.unit_schedules(company_id, unit_id, day_of_week, start_time);

CREATE TABLE IF NOT EXISTS public.unit_services (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  service_id BIGINT NOT NULL REFERENCES public.services_catalog(id) ON DELETE RESTRICT,
  duration_minutes SMALLINT NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 1 AND 1440),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  available_from DATE,
  available_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unit_services_dates_valid CHECK (available_until IS NULL OR available_from IS NULL OR available_until >= available_from),
  CONSTRAINT unit_services_unique UNIQUE (company_id, unit_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_unit_services_scope
  ON public.unit_services(company_id, unit_id, lg_ativo);

CREATE OR REPLACE FUNCTION public.org_is_manager()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE (up.id = auth.uid() OR up.user_id = auth.uid())
      AND lower(coalesce(up.role_name, '')) IN (
        'admin', 'administrador', 'gestor', 'gerente', 'administrativo'
      )
  )
$$;

REVOKE ALL ON FUNCTION public.org_is_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_is_manager() TO authenticated;

CREATE OR REPLACE FUNCTION public.org_can_access_unit(p_company_id UUID, p_unit_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT p_company_id = public.get_my_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.units u
      WHERE u.id = p_unit_id
        AND u.company_id = p_company_id
        AND u.lg_ativo = TRUE
        AND (
          public.org_is_manager()
          OR EXISTS (
            SELECT 1
            FROM public.user_profiles up
            WHERE (up.id = auth.uid() OR up.user_id = auth.uid())
              AND up.company_id = p_company_id
              AND up.primary_unit_id = p_unit_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.unit_access ua
            WHERE ua.user_id = auth.uid()
              AND ua.company_id = p_company_id
              AND ua.unit_id = p_unit_id
              AND ua.valid_from <= CURRENT_DATE
              AND (ua.valid_until IS NULL OR ua.valid_until >= CURRENT_DATE)
          )
        )
    )
$$;

REVOKE ALL ON FUNCTION public.org_can_access_unit(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_can_access_unit(UUID, INTEGER) TO authenticated;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['unit_access', 'sectors', 'organizational_resources', 'unit_schedules', 'unit_services'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_manage', t);
  END LOOP;
  EXECUTE 'DROP POLICY IF EXISTS module_unit_access_access ON public.unit_access';
  EXECUTE 'DROP POLICY IF EXISTS module_unit_access_admin ON public.unit_access';
END $$;

CREATE POLICY unit_access_read ON public.unit_access
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND (user_id = auth.uid() OR public.org_is_manager()));
CREATE POLICY unit_access_manage ON public.unit_access
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND public.org_is_manager())
  WITH CHECK (company_id = public.get_my_company_id() AND public.org_is_manager());

CREATE POLICY sectors_read ON public.sectors
  FOR SELECT TO authenticated
  USING (public.org_can_access_unit(company_id, unit_id));
CREATE POLICY sectors_manage ON public.sectors
  FOR ALL TO authenticated
  USING (public.org_is_manager() AND public.org_can_access_unit(company_id, unit_id))
  WITH CHECK (public.org_is_manager() AND public.org_can_access_unit(company_id, unit_id));

CREATE POLICY organizational_resources_read ON public.organizational_resources
  FOR SELECT TO authenticated
  USING (public.org_can_access_unit(company_id, unit_id));
CREATE POLICY organizational_resources_manage ON public.organizational_resources
  FOR ALL TO authenticated
  USING (public.org_is_manager() AND public.org_can_access_unit(company_id, unit_id))
  WITH CHECK (public.org_is_manager() AND public.org_can_access_unit(company_id, unit_id));

CREATE POLICY unit_schedules_read ON public.unit_schedules
  FOR SELECT TO authenticated
  USING (public.org_can_access_unit(company_id, unit_id));
CREATE POLICY unit_schedules_manage ON public.unit_schedules
  FOR ALL TO authenticated
  USING (public.org_is_manager() AND public.org_can_access_unit(company_id, unit_id))
  WITH CHECK (public.org_is_manager() AND public.org_can_access_unit(company_id, unit_id));

CREATE POLICY unit_services_read ON public.unit_services
  FOR SELECT TO authenticated
  USING (public.org_can_access_unit(company_id, unit_id));
CREATE POLICY unit_services_manage ON public.unit_services
  FOR ALL TO authenticated
  USING (public.org_is_manager() AND public.org_can_access_unit(company_id, unit_id))
  WITH CHECK (public.org_is_manager() AND public.org_can_access_unit(company_id, unit_id));

GRANT SELECT ON public.unit_access, public.sectors, public.organizational_resources, public.unit_schedules, public.unit_services TO authenticated;
GRANT SELECT ON public.user_profiles, public.units TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.unit_access, public.sectors, public.organizational_resources, public.unit_schedules, public.unit_services TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.unit_access_id_seq, public.sectors_id_seq, public.organizational_resources_id_seq, public.unit_schedules_id_seq, public.unit_services_id_seq TO authenticated;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['unit_access', 'sectors', 'organizational_resources', 'unit_schedules', 'unit_services'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func()', t, t);
  END LOOP;
END $$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sectors', 'organizational_resources', 'unit_schedules', 'unit_services'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
  END LOOP;
END $$;

COMMENT ON TABLE public.sectors IS 'Setores operacionais vinculados a uma unidade e empresa.';
COMMENT ON TABLE public.organizational_resources IS 'Salas, consultórios, leitos, equipamentos, estoque e centros de custo.';
COMMENT ON TABLE public.unit_schedules IS 'Horários operacionais de setores e recursos por unidade.';
COMMENT ON TABLE public.unit_services IS 'Serviços do catálogo habilitados por unidade.';

COMMIT;

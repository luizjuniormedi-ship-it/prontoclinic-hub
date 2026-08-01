-- Empresas provisionadas depois do baseline precisam receber a mesma matriz
-- administrativa das empresas existentes. Sem isso, o perfil admin autentica,
-- mas o RLS nega os módulos operacionais.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.seed_admin_permissions_for_company(
  p_company_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
SET row_security = off
AS $function$
BEGIN
  INSERT INTO public.role_permissions (
    company_id,
    role_id,
    module,
    can_view,
    can_create,
    can_edit,
    can_delete,
    can_export
  )
  SELECT
    p_company_id,
    role_record.id,
    module_record.module,
    TRUE,
    TRUE,
    TRUE,
    TRUE,
    TRUE
  FROM public.roles AS role_record
  CROSS JOIN (
    SELECT DISTINCT lower(trim(existing_permission.module)) AS module
    FROM public.role_permissions AS existing_permission
    WHERE NULLIF(trim(existing_permission.module), '') IS NOT NULL
    UNION
    SELECT module
    FROM (
      VALUES
        ('dashboard'), ('patients'), ('pacientes'), ('professionals'),
        ('schedule'), ('agenda'), ('callcenter'), ('reception'), ('recepcao'),
        ('records'), ('attendance'), ('encounters'), ('nursing'),
        ('billing'), ('faturamento'), ('financial'), ('dicom'),
        ('insurance_companies'), ('insurance_plans'), ('audit'), ('admin')
    ) AS canonical_module(module)
  ) AS module_record
  WHERE role_record.lg_ativo IS TRUE
    AND lower(role_record.name) IN ('admin', 'administrador')
    AND EXISTS (
      SELECT 1
      FROM public.companies AS company_record
      WHERE company_record.id = p_company_id
        AND company_record.lg_ativo IS TRUE
    )
  ON CONFLICT (company_id, role_id, module) DO UPDATE
  SET can_view = TRUE,
      can_create = TRUE,
      can_edit = TRUE,
      can_delete = TRUE,
      can_export = TRUE,
      updated_at = NOW();
END
$function$;

REVOKE ALL ON FUNCTION
  private.seed_admin_permissions_for_company(UUID)
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.seed_admin_permissions_after_company_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
SET row_security = off
AS $function$
BEGIN
  IF NEW.lg_ativo IS TRUE THEN
    PERFORM private.seed_admin_permissions_for_company(NEW.id);
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION
  private.seed_admin_permissions_after_company_change()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS companies_seed_admin_permissions
  ON public.companies;
CREATE TRIGGER companies_seed_admin_permissions
AFTER INSERT OR UPDATE OF lg_ativo
ON public.companies
FOR EACH ROW
WHEN (NEW.lg_ativo IS TRUE)
EXECUTE FUNCTION private.seed_admin_permissions_after_company_change();

DO $seed_existing_companies$
DECLARE
  company_record RECORD;
BEGIN
  FOR company_record IN
    SELECT id
    FROM public.companies
    WHERE lg_ativo IS TRUE
  LOOP
    PERFORM private.seed_admin_permissions_for_company(company_record.id);
  END LOOP;
END
$seed_existing_companies$;

DO $permission_contract$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.companies AS company_record
    CROSS JOIN public.roles AS role_record
    CROSS JOIN (
      VALUES
        ('dashboard'), ('patients'), ('professionals'), ('agenda'),
        ('recepcao'), ('nursing')
    ) AS expected(module)
    LEFT JOIN public.role_permissions AS role_permission
      ON role_permission.company_id = company_record.id
     AND role_permission.role_id = role_record.id
     AND role_permission.module = expected.module
    WHERE company_record.lg_ativo IS TRUE
      AND role_record.lg_ativo IS TRUE
      AND lower(role_record.name) IN ('admin', 'administrador')
      AND (
        role_permission.id IS NULL
        OR role_permission.can_view IS DISTINCT FROM TRUE
      )
  ) THEN
    RAISE EXCEPTION
      'Matriz administrativa incompleta para empresa ativa';
  END IF;
END
$permission_contract$;

DO $ledger$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
      SELECT
        '20260731042000_admin_permission_parity_for_active_companies.sql',
        NOW()
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.prontomedic_deployment_migrations
        WHERE filename =
          '20260731042000_admin_permission_parity_for_active_companies.sql'
      )
    $sql$;
  END IF;
END
$ledger$;

COMMIT;

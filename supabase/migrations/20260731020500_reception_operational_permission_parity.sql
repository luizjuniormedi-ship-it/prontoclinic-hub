-- Garante que empresas criadas depois do baseline recebam a matriz operacional
-- completa da Recepcao. Os aliases existem porque a UI e o gateway/RLS usam
-- nomes diferentes para os mesmos dominios.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.seed_reception_operational_permissions_for_company(
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
    permission.module,
    permission.can_view,
    permission.can_create,
    permission.can_edit,
    FALSE,
    FALSE
  FROM (
    VALUES
      ('recepcao', 'dashboard', TRUE, FALSE, FALSE),
      ('recepcao', 'patients', TRUE, TRUE, TRUE),
      ('recepcao', 'pacientes', TRUE, TRUE, TRUE),
      ('recepcao', 'schedule', TRUE, TRUE, FALSE),
      ('recepcao', 'agenda', TRUE, TRUE, FALSE),
      ('recepcao', 'reception', TRUE, TRUE, TRUE),
      ('recepcao', 'recepcao', TRUE, TRUE, TRUE),
      ('recepcao', 'callcenter', TRUE, FALSE, FALSE),

      ('supervisor_recepcao', 'dashboard', TRUE, FALSE, FALSE),
      ('supervisor_recepcao', 'patients', TRUE, TRUE, TRUE),
      ('supervisor_recepcao', 'pacientes', TRUE, TRUE, TRUE),
      ('supervisor_recepcao', 'schedule', TRUE, TRUE, TRUE),
      ('supervisor_recepcao', 'agenda', TRUE, TRUE, TRUE),
      ('supervisor_recepcao', 'reception', TRUE, TRUE, TRUE),
      ('supervisor_recepcao', 'recepcao', TRUE, TRUE, TRUE),
      ('supervisor_recepcao', 'callcenter', TRUE, TRUE, TRUE),

      ('callcenter', 'dashboard', TRUE, FALSE, FALSE),
      ('callcenter', 'patients', TRUE, TRUE, TRUE),
      ('callcenter', 'pacientes', TRUE, TRUE, TRUE),
      ('callcenter', 'schedule', TRUE, TRUE, TRUE),
      ('callcenter', 'agenda', TRUE, TRUE, TRUE),
      ('callcenter', 'reception', TRUE, FALSE, FALSE),
      ('callcenter', 'recepcao', TRUE, FALSE, FALSE),
      ('callcenter', 'callcenter', TRUE, TRUE, TRUE)
  ) AS permission(role_name, module, can_view, can_create, can_edit)
  JOIN public.roles AS role_record
    ON role_record.name = permission.role_name
   AND role_record.lg_ativo IS TRUE
  WHERE EXISTS (
    SELECT 1
    FROM public.companies AS company_record
    WHERE company_record.id = p_company_id
      AND company_record.lg_ativo IS TRUE
  )
  ON CONFLICT (company_id, role_id, module) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete,
      can_export = EXCLUDED.can_export,
      updated_at = NOW();
END
$function$;

REVOKE ALL ON FUNCTION
  private.seed_reception_operational_permissions_for_company(UUID)
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.seed_reception_operational_permissions_after_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
SET row_security = off
AS $trigger$
BEGIN
  PERFORM private.seed_reception_operational_permissions_for_company(NEW.id);
  RETURN NEW;
END
$trigger$;

REVOKE ALL ON FUNCTION
  private.seed_reception_operational_permissions_after_company()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_seed_reception_operational_permissions
  ON public.companies;
CREATE TRIGGER trg_seed_reception_operational_permissions
AFTER INSERT OR UPDATE OF lg_ativo ON public.companies
FOR EACH ROW
WHEN (NEW.lg_ativo IS TRUE)
EXECUTE FUNCTION private.seed_reception_operational_permissions_after_company();

DO $seed_existing_companies$
DECLARE
  company_record RECORD;
BEGIN
  FOR company_record IN
    SELECT id
    FROM public.companies
    WHERE lg_ativo IS TRUE
  LOOP
    PERFORM private.seed_reception_operational_permissions_for_company(
      company_record.id
    );
  END LOOP;
END
$seed_existing_companies$;

DO $permission_contract$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.companies AS company_record
    CROSS JOIN (
      VALUES
        ('recepcao', 'patients', TRUE, TRUE, TRUE),
        ('recepcao', 'pacientes', TRUE, TRUE, TRUE),
        ('recepcao', 'agenda', TRUE, TRUE, FALSE),
        ('recepcao', 'recepcao', TRUE, TRUE, TRUE),
        ('supervisor_recepcao', 'agenda', TRUE, TRUE, TRUE),
        ('supervisor_recepcao', 'recepcao', TRUE, TRUE, TRUE),
        ('callcenter', 'agenda', TRUE, TRUE, TRUE),
        ('callcenter', 'callcenter', TRUE, TRUE, TRUE)
    ) AS expected(role_name, module, can_view, can_create, can_edit)
    JOIN public.roles AS role_record
      ON role_record.name = expected.role_name
     AND role_record.lg_ativo IS TRUE
    LEFT JOIN public.role_permissions AS role_permission
      ON role_permission.company_id = company_record.id
     AND role_permission.role_id = role_record.id
     AND role_permission.module = expected.module
    WHERE company_record.lg_ativo IS TRUE
      AND (
        role_permission.id IS NULL
        OR role_permission.can_view IS DISTINCT FROM expected.can_view
        OR role_permission.can_create IS DISTINCT FROM expected.can_create
        OR role_permission.can_edit IS DISTINCT FROM expected.can_edit
        OR role_permission.can_delete IS DISTINCT FROM FALSE
        OR role_permission.can_export IS DISTINCT FROM FALSE
      )
  ) THEN
    RAISE EXCEPTION
      'Paridade operacional de permissoes da Recepcao nao foi estabelecida';
  END IF;
END
$permission_contract$;

DO $ledger$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.prontomedic_deployment_migrations
       WHERE filename =
         '20260731020500_reception_operational_permission_parity.sql'
     ) THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES (
      '20260731020500_reception_operational_permission_parity.sql',
      NOW()
    );
  END IF;
END
$ledger$;

COMMIT;

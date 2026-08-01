-- Alinha o nome operacional `agenda`, usado por can_access/RLS, com a matriz
-- de permissao da Recepcao. A linha `schedule` continua existindo para a UI.
BEGIN;

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
  company_record.id,
  role_record.id,
  'agenda',
  TRUE,
  TRUE,
  role_record.name IN ('supervisor_recepcao', 'callcenter'),
  FALSE,
  FALSE
FROM public.companies AS company_record
CROSS JOIN public.roles AS role_record
WHERE company_record.lg_ativo IS TRUE
  AND role_record.lg_ativo IS TRUE
  AND role_record.name IN (
    'recepcao',
    'supervisor_recepcao',
    'callcenter'
  )
ON CONFLICT (company_id, role_id, module) DO UPDATE
SET can_view = EXCLUDED.can_view,
    can_create = EXCLUDED.can_create,
    can_edit = EXCLUDED.can_edit,
    can_delete = EXCLUDED.can_delete,
    can_export = EXCLUDED.can_export,
    updated_at = NOW();

DO $permission_contract$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.companies AS company_record
    CROSS JOIN public.roles AS role_record
    LEFT JOIN public.role_permissions AS role_permission
      ON role_permission.company_id = company_record.id
     AND role_permission.role_id = role_record.id
     AND role_permission.module = 'agenda'
    WHERE company_record.lg_ativo IS TRUE
      AND role_record.lg_ativo IS TRUE
      AND role_record.name IN (
        'recepcao',
        'supervisor_recepcao',
        'callcenter'
      )
      AND (
        role_permission.id IS NULL
        OR role_permission.can_view IS DISTINCT FROM TRUE
        OR role_permission.can_create IS DISTINCT FROM TRUE
        OR role_permission.can_delete IS DISTINCT FROM FALSE
      )
  ) THEN
    RAISE EXCEPTION
      'Paridade de permissao agenda/Recepcao nao foi estabelecida';
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
         '20260731020000_reception_agenda_permission_parity.sql'
     ) THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES (
      '20260731020000_reception_agenda_permission_parity.sql',
      NOW()
    );
  END IF;
END
$ledger$;

COMMIT;

-- Modulo 11: paridade aditiva das permissoes canonicas da Recepcao.
-- Permissoes sao materializadas por empresa no modelo canonico role_permissions.
BEGIN;

INSERT INTO public.roles(name, description, lg_ativo)
VALUES
  ('recepcao', 'Operacao de recepcao', TRUE),
  ('supervisor_recepcao', 'Supervisao de recepcao', TRUE)
ON CONFLICT (name) DO UPDATE
SET lg_ativo = TRUE,
    updated_at = NOW();

INSERT INTO public.role_permissions (
  company_id,
  role_id,
  module,
  can_view,
  can_create,
  can_edit,
  can_delete
)
SELECT
  company_record.id,
  r.id,
  'recepcao',
  TRUE,
  TRUE,
  TRUE,
  FALSE
FROM public.roles AS r
CROSS JOIN public.companies AS company_record
WHERE r.name IN ('recepcao', 'supervisor_recepcao')
  AND r.lg_ativo IS TRUE
  AND company_record.lg_ativo IS TRUE
ON CONFLICT (company_id, role_id, module) DO UPDATE
SET can_view = EXCLUDED.can_view,
    can_create = EXCLUDED.can_create,
    can_edit = EXCLUDED.can_edit,
    can_delete = EXCLUDED.can_delete,
    updated_at = NOW();

DO $permission_contract$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.roles AS r
    CROSS JOIN public.companies AS company_record
    LEFT JOIN public.role_permissions AS rp
      ON rp.role_id = r.id
     AND rp.company_id = company_record.id
     AND rp.module = 'recepcao'
    WHERE r.name IN ('recepcao', 'supervisor_recepcao')
      AND r.lg_ativo IS TRUE
      AND company_record.lg_ativo IS TRUE
      AND (
        rp.id IS NULL
        OR rp.can_view IS DISTINCT FROM TRUE
        OR rp.can_create IS DISTINCT FROM TRUE
        OR rp.can_edit IS DISTINCT FROM TRUE
        OR rp.can_delete IS DISTINCT FROM FALSE
      )
  ) THEN
    RAISE EXCEPTION
      'Paridade de permissoes da Recepcao nao foi estabelecida';
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
         '20260726120000_module11_reception_permission_parity.sql'
     ) THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES (
      '20260726120000_module11_reception_permission_parity.sql',
      NOW()
    );
  END IF;
END
$ledger$;

COMMIT;

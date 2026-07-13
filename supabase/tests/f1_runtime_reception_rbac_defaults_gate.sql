-- F1 reception RBAC defaults gate.
-- Ephemeral PostgreSQL only. Never run against DataSIGH or production.

BEGIN;

DO $gate$
DECLARE
  v_reception_role_id bigint;
BEGIN
  SELECT id
    INTO v_reception_role_id
    FROM public.roles
   WHERE name = 'recepcao'
     AND lg_ativo = TRUE;

  IF v_reception_role_id IS NULL THEN
    RAISE EXCEPTION 'F1 reception RBAC active role is missing';
  END IF;

  IF (
    SELECT count(*)
      FROM public.role_permissions
     WHERE role_id = v_reception_role_id
       AND module IN ('pacientes', 'agenda', 'recepcao')
       AND can_view = TRUE
       AND can_create = FALSE
       AND can_edit = FALSE
       AND can_delete = FALSE
       AND can_export = FALSE
  ) <> 3 THEN
    RAISE EXCEPTION 'F1 reception RBAC read-only operational defaults are incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.role_permissions
     WHERE role_id = v_reception_role_id
       AND module IN ('financeiro', 'faturamento', 'admin')
  ) THEN
    RAISE EXCEPTION 'F1 reception RBAC received financial or admin defaults';
  END IF;
END
$gate$;

-- Simulate a tenant customization before replaying the bootstrap migration.
UPDATE public.role_permissions
   SET can_view = FALSE,
       can_edit = TRUE,
       updated_at = TIMESTAMPTZ '2026-07-13 00:00:00+00'
 WHERE role_id = (SELECT id FROM public.roles WHERE name = 'recepcao')
   AND module = 'agenda';

\ir ../migrations/20260712234000_reception_rbac_read_defaults.sql
\ir ../migrations/20260712234000_reception_rbac_read_defaults.sql

DO $gate$
DECLARE
  v_reception_role_id bigint;
  v_agenda public.role_permissions;
BEGIN
  SELECT id INTO STRICT v_reception_role_id
    FROM public.roles
   WHERE name = 'recepcao';

  SELECT * INTO STRICT v_agenda
    FROM public.role_permissions
   WHERE role_id = v_reception_role_id
     AND module = 'agenda';

  IF v_agenda.can_view <> FALSE
     OR v_agenda.can_edit <> TRUE
     OR v_agenda.updated_at <> TIMESTAMPTZ '2026-07-13 00:00:00+00' THEN
    RAISE EXCEPTION 'F1 reception RBAC bootstrap overwrote an existing customization: %', row_to_json(v_agenda);
  END IF;

  IF (
    SELECT count(*)
      FROM public.role_permissions
     WHERE role_id = v_reception_role_id
       AND module IN ('pacientes', 'agenda', 'recepcao')
  ) <> 3 THEN
    RAISE EXCEPTION 'F1 reception RBAC bootstrap is not idempotent';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.role_permissions
     WHERE role_id = v_reception_role_id
       AND module IN ('financeiro', 'faturamento', 'admin')
  ) THEN
    RAISE EXCEPTION 'F1 reception RBAC replay introduced financial or admin access';
  END IF;
END
$gate$;

ROLLBACK;

SELECT 'F1_RUNTIME_RECEPTION_RBAC_DEFAULTS=PASS' AS result;


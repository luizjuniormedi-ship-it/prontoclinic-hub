-- Farmacia: restaura leitura autenticada dos catalogos protegidos por FORCE RLS.
-- Additive only. DataSIGH is intentionally not referenced.
BEGIN;

CREATE TABLE IF NOT EXISTS private.pharmacy_catalog_acl_rollback_state (
  table_name TEXT PRIMARY KEY,
  public_select_direct BOOLEAN NOT NULL,
  authenticated_select_direct BOOLEAN NOT NULL,
  anon_select_direct BOOLEAN NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

REVOKE ALL ON private.pharmacy_catalog_acl_rollback_state
  FROM PUBLIC, anon, authenticated, app_prontomedic;

DO $snapshot$
DECLARE
  v_table TEXT;
  v_relation REGCLASS;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.pharmacy_catalog_acl_rollback_state) THEN
    FOREACH v_table IN ARRAY ARRAY[
      'medicamentos', 'materiais', 'almoxarifados', 'lotes',
      'receitas_controladas'
    ]
    LOOP
      v_relation := format('public.%I', v_table)::REGCLASS;

      INSERT INTO private.pharmacy_catalog_acl_rollback_state (
        table_name, public_select_direct, authenticated_select_direct,
        anon_select_direct
      )
      SELECT
        v_table,
        EXISTS (
          SELECT 1
          FROM pg_class c
          CROSS JOIN LATERAL aclexplode(c.relacl) acl
          WHERE c.oid = v_relation
            AND acl.grantee = 0
            AND acl.privilege_type = 'SELECT'
        ),
        EXISTS (
          SELECT 1
          FROM pg_class c
          CROSS JOIN LATERAL aclexplode(c.relacl) acl
          JOIN pg_roles role_grantee ON role_grantee.oid = acl.grantee
          WHERE c.oid = v_relation
            AND role_grantee.rolname = 'authenticated'
            AND acl.privilege_type = 'SELECT'
        ),
        EXISTS (
          SELECT 1
          FROM pg_class c
          CROSS JOIN LATERAL aclexplode(c.relacl) acl
          JOIN pg_roles role_grantee ON role_grantee.oid = acl.grantee
          WHERE c.oid = v_relation
            AND role_grantee.rolname = 'anon'
            AND acl.privilege_type = 'SELECT'
        );
    END LOOP;
  END IF;
END
$snapshot$;

DO $snapshot_integrity$
BEGIN
  IF (
    SELECT COUNT(*) <> 5
      OR BOOL_OR(table_name NOT IN (
        'medicamentos', 'materiais', 'almoxarifados', 'lotes',
        'receitas_controladas'
      ))
    FROM private.pharmacy_catalog_acl_rollback_state
  ) THEN
    RAISE EXCEPTION 'Pharmacy catalog ACL rollback snapshot is incomplete';
  END IF;
END
$snapshot_integrity$;

GRANT SELECT
  ON public.medicamentos, public.materiais, public.almoxarifados,
     public.lotes, public.receitas_controladas
  TO authenticated;

REVOKE SELECT
  ON public.medicamentos, public.materiais, public.almoxarifados,
     public.lotes, public.receitas_controladas
  FROM PUBLIC, anon;

COMMIT;

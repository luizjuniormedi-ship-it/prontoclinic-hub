-- Restores direct SELECT grants captured before the pharmacy ACL migration.
BEGIN;

DO $restore$
DECLARE
  v_state RECORD;
BEGIN
  IF to_regclass('private.pharmacy_catalog_acl_rollback_state') IS NULL THEN
    RAISE EXCEPTION 'Pharmacy catalog ACL rollback snapshot is missing';
  END IF;

  IF (SELECT COUNT(*) FROM private.pharmacy_catalog_acl_rollback_state) <> 5 THEN
    RAISE EXCEPTION 'Pharmacy catalog ACL rollback snapshot is incomplete';
  END IF;

  FOR v_state IN
    SELECT table_name, public_select_direct, authenticated_select_direct,
           anon_select_direct
    FROM private.pharmacy_catalog_acl_rollback_state
    ORDER BY table_name
  LOOP
    EXECUTE format(
      'REVOKE SELECT ON TABLE public.%I FROM PUBLIC, authenticated, anon',
      v_state.table_name
    );

    IF v_state.public_select_direct THEN
      EXECUTE format(
        'GRANT SELECT ON TABLE public.%I TO PUBLIC',
        v_state.table_name
      );
    END IF;

    IF v_state.authenticated_select_direct THEN
      EXECUTE format(
        'GRANT SELECT ON TABLE public.%I TO authenticated',
        v_state.table_name
      );
    END IF;

    IF v_state.anon_select_direct THEN
      EXECUTE format(
        'GRANT SELECT ON TABLE public.%I TO anon',
        v_state.table_name
      );
    END IF;
  END LOOP;
END
$restore$;

DROP TABLE private.pharmacy_catalog_acl_rollback_state;

COMMIT;

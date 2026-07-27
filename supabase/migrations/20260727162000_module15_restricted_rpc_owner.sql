-- Close the Module 15 authorization mutators under a dedicated restricted
-- owner. The role is shared with reception workflows and cannot log in or
-- bypass FORCE RLS.

BEGIN;

DO $requirements$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'prontomedic_reception_rpc_owner'
      AND NOT rolcanlogin
      AND NOT rolinherit
      AND NOT rolbypassrls
      AND NOT rolsuper
  ) THEN
    RAISE EXCEPTION
      'Module 15 requires the hardened reception RPC owner';
  END IF;
END
$requirements$;

GRANT SELECT, INSERT, UPDATE
  ON public.insurance_authorizations
  TO prontomedic_reception_rpc_owner;
GRANT SELECT, INSERT
  ON public.insurance_authorization_attachments
  TO prontomedic_reception_rpc_owner;
GRANT SELECT
  ON public.appointments, public.patients, public.professionals
  TO prontomedic_reception_rpc_owner;

GRANT EXECUTE ON FUNCTION public.m15_can_operate_authorizations()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.get_scheduling_actor()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_company_id()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_unit_id()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT)
  TO prontomedic_reception_rpc_owner;

DROP POLICY IF EXISTS m15_authorizations_reception_owner_select
  ON public.insurance_authorizations;
CREATE POLICY m15_authorizations_reception_owner_select
  ON public.insurance_authorizations
  FOR SELECT
  TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.m15_can_operate_authorizations()
    AND (
      public.can_access('recepcao', 'view')
      OR public.can_access('faturamento', 'view')
      OR public.can_access('agenda', 'view')
    )
  );

DROP POLICY IF EXISTS m15_authorizations_reception_owner_insert
  ON public.insurance_authorizations;
CREATE POLICY m15_authorizations_reception_owner_insert
  ON public.insurance_authorizations
  FOR INSERT
  TO prontomedic_reception_rpc_owner
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.m15_can_operate_authorizations()
    AND (
      public.can_access('recepcao', 'create')
      OR public.can_access('faturamento', 'create')
      OR public.can_access('agenda', 'create')
    )
  );

DROP POLICY IF EXISTS m15_authorizations_reception_owner_update
  ON public.insurance_authorizations;
CREATE POLICY m15_authorizations_reception_owner_update
  ON public.insurance_authorizations
  FOR UPDATE
  TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.m15_can_operate_authorizations()
    AND (
      public.can_access('recepcao', 'edit')
      OR public.can_access('faturamento', 'edit')
    )
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.m15_can_operate_authorizations()
    AND (
      public.can_access('recepcao', 'edit')
      OR public.can_access('faturamento', 'edit')
    )
  );

DROP POLICY IF EXISTS m15_authorization_attachments_reception_owner_select
  ON public.insurance_authorization_attachments;
CREATE POLICY m15_authorization_attachments_reception_owner_select
  ON public.insurance_authorization_attachments
  FOR SELECT
  TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.insurance_authorizations AS authorization_record
      WHERE authorization_record.id = authorization_id
        AND authorization_record.company_id =
          insurance_authorization_attachments.company_id
        AND authorization_record.unit_id = public.active_unit_id()
    )
    AND public.m15_can_operate_authorizations()
    AND (
      public.can_access('recepcao', 'view')
      OR public.can_access('faturamento', 'view')
      OR public.can_access('agenda', 'view')
    )
  );

DROP POLICY IF EXISTS m15_authorization_attachments_reception_owner_insert
  ON public.insurance_authorization_attachments;
CREATE POLICY m15_authorization_attachments_reception_owner_insert
  ON public.insurance_authorization_attachments
  FOR INSERT
  TO prontomedic_reception_rpc_owner
  WITH CHECK (
    company_id = public.active_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.insurance_authorizations AS authorization_record
      WHERE authorization_record.id = authorization_id
        AND authorization_record.company_id =
          insurance_authorization_attachments.company_id
        AND authorization_record.unit_id = public.active_unit_id()
    )
    AND public.m15_can_operate_authorizations()
    AND (
      public.can_access('recepcao', 'edit')
      OR public.can_access('faturamento', 'edit')
    )
  );

ALTER FUNCTION public.create_insurance_authorization_secure(
  BIGINT, BIGINT, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT,
  BIGINT, TEXT, TEXT, INTEGER, DATE, DATE
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.transition_insurance_authorization_secure(
  UUID, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, INTEGER, TEXT
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.create_insurance_authorization_followup_secure(
  UUID, TEXT, TEXT, DATE, DATE, INTEGER
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.add_insurance_authorization_attachment_secure(
  UUID, TEXT, TEXT, TEXT, BIGINT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.consume_insurance_authorization(UUID, INTEGER)
  OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.create_insurance_authorization_secure(
  BIGINT, BIGINT, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT,
  BIGINT, TEXT, TEXT, INTEGER, DATE, DATE
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.transition_insurance_authorization_secure(
  UUID, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.create_insurance_authorization_followup_secure(
  UUID, TEXT, TEXT, DATE, DATE, INTEGER
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.add_insurance_authorization_attachment_secure(
  UUID, TEXT, TEXT, TEXT, BIGINT, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.consume_insurance_authorization(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT EXECUTE ON FUNCTION public.create_insurance_authorization_secure(
  BIGINT, BIGINT, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT,
  BIGINT, TEXT, TEXT, INTEGER, DATE, DATE
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.transition_insurance_authorization_secure(
  UUID, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, INTEGER, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.create_insurance_authorization_followup_secure(
  UUID, TEXT, TEXT, DATE, DATE, INTEGER
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.add_insurance_authorization_attachment_secure(
  UUID, TEXT, TEXT, TEXT, BIGINT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.consume_insurance_authorization(UUID, INTEGER)
  TO authenticated, app_prontomedic;

COMMIT;

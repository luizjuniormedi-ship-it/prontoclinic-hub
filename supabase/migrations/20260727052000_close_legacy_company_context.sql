BEGIN;

DO $requirements$
BEGIN
  IF to_regprocedure('public.active_company_id()') IS NULL
     OR to_regprocedure('public.current_application_session_is_active()') IS NULL THEN
    RAISE EXCEPTION
      'Legacy company context closure requires the application session foundation';
  END IF;
END;
$requirements$;

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT CASE
    WHEN public.current_application_session_is_active()
      THEN public.active_company_id()
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.current_company_id() IS
  'Returns the company from the active application session; fails closed for missing, expired, revoked or ambiguous contexts.';

CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT COALESCE(
    p_user_id = auth.uid()
    AND public.current_application_session_is_active()
    AND public.current_context_is_company_admin(public.active_company_id()),
    FALSE
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_staff(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT COALESCE(
    p_user_id = auth.uid()
    AND public.current_application_session_is_active()
    AND public.active_company_id() IS NOT NULL,
    FALSE
  );
$function$;

COMMENT ON FUNCTION public.is_admin(UUID) IS
  'Validates the administrative role selected in the active AAL2 application context.';
COMMENT ON FUNCTION public.is_staff(UUID) IS
  'Validates identity and an active application context before granting staff compatibility.';

-- The local gateway executes client queries with SET LOCAL ROLE authenticated.
-- NOINHERIT keeps the application connection privileged only after that
-- explicit role switch.
GRANT authenticated TO app_prontomedic;

-- Retire the unused request.jwt.claim.company_id GUC as a tenant authority.
-- The signed session id and persisted access context are the single source of
-- truth for both direct backend policies and authenticated RPCs.
CREATE OR REPLACE FUNCTION public.request_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT public.current_company_id();
$function$;

ALTER FUNCTION public.request_company_id() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.current_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO authenticated, app_prontomedic, prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.is_staff(UUID)
  TO authenticated, app_prontomedic;

REVOKE ALL ON FUNCTION public.request_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_company_id()
  TO authenticated,
     app_prontomedic,
     prontomedic_lis_rpc_owner,
     prontomedic_tiss_rpc_owner;

-- Legacy scheduling RPCs consume this tuple. Resolve it from the selected AAL2
-- access context instead of the single-company compatibility profile.
CREATE OR REPLACE FUNCTION public.get_scheduling_actor()
RETURNS TABLE(user_id UUID, company_id UUID, role_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = off
AS $function$
  SELECT
    access_context.user_id,
    membership.company_id,
    lower(role_record.name)
  FROM public.user_access_context AS access_context
  JOIN public.memberships AS membership
    ON membership.id = access_context.membership_id
   AND membership.user_id = access_context.user_id
   AND membership.status = 'active'
  JOIN public.membership_roles AS membership_role
    ON membership_role.membership_id = access_context.membership_id
   AND membership_role.role_id = access_context.role_id
  JOIN public.roles AS role_record
    ON role_record.id = access_context.role_id
   AND role_record.lg_ativo = TRUE
  WHERE access_context.user_id = auth.uid()
    AND access_context.session_id =
      NULLIF(auth.jwt()->>'session_id', '')::UUID
    AND public.current_application_session_is_active()
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_scheduling_actor()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_scheduling_actor()
  TO authenticated, app_prontomedic, prontomedic_reception_rpc_owner;

-- Policies installed for the direct backend role call these helpers. Keep the
-- grants explicit because earlier closures revoke PUBLIC and portal access.
GRANT EXECUTE ON FUNCTION public.active_company_id()
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.active_unit_id()
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT)
  TO app_prontomedic;

DO $runtime_policy_acl$
BEGIN
  IF NOT EXISTS (
       SELECT 1
         FROM pg_auth_members membership
         JOIN pg_roles granted_role
           ON granted_role.oid = membership.roleid
         JOIN pg_roles member_role
           ON member_role.oid = membership.member
        WHERE granted_role.rolname = 'authenticated'
          AND member_role.rolname = 'app_prontomedic'
     )
     OR NOT has_function_privilege(
       'app_prontomedic',
       'public.active_company_id()',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'app_prontomedic',
       'public.active_unit_id()',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'app_prontomedic',
       'public.can_access(text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'app_prontomedic',
       'public.request_company_id()',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.request_company_id()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'Direct backend role membership or policy helper ACL is incomplete';
  END IF;
END
$runtime_policy_acl$;

DO $organization_runtime_requirements$
BEGIN
  IF to_regprocedure(
       'private.org_can_access_unit_runtime(uuid,integer)'
     ) IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_roles
       WHERE rolname = 'prontomedic_rpc_owner'
     ) THEN
    RAISE EXCEPTION
      'Organization runtime owner or unit access implementation is missing';
  END IF;
END
$organization_runtime_requirements$;

CREATE OR REPLACE FUNCTION public.org_can_access_unit(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
  SELECT private.org_can_access_unit_runtime(p_company_id, p_unit_id);
$function$;

ALTER FUNCTION public.org_can_access_unit(UUID, INTEGER)
  OWNER TO prontomedic_rpc_owner;
REVOKE ALL ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  TO authenticated, app_prontomedic, prontomedic_reception_rpc_owner;

-- The insurance scope trigger must not require direct SELECT on units from the
-- authenticated role. Route unit validation through the restricted
-- organizational wrapper while retaining invoker rights for permission checks.
CREATE OR REPLACE FUNCTION public.enforce_insurance_record_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_action TEXT := CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'edit' END;
BEGIN
  IF NEW.company_id IS NULL OR NEW.unit_id IS NULL THEN
    RAISE EXCEPTION
      'Empresa e unidade do registro de convenio sao invalidas ou inacessiveis'
      USING ERRCODE = '23514';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT public.org_can_access_unit(NEW.company_id, NEW.unit_id) THEN
      RAISE EXCEPTION
        'Empresa e unidade do registro de convenio sao invalidas ou inacessiveis'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.units AS unit_record
    WHERE unit_record.id = NEW.unit_id
      AND unit_record.company_id = NEW.company_id
      AND unit_record.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION
      'Empresa e unidade do registro de convenio sao invalidas ou inacessiveis'
      USING ERRCODE = '23514';
  END IF;

  IF auth.uid() IS NOT NULL AND (
    NEW.company_id IS DISTINCT FROM public.active_company_id()
    OR NEW.unit_id IS DISTINCT FROM public.active_unit_id()
    OR NOT (
      public.can_access('recepcao', v_action)
      OR public.can_access('faturamento', v_action)
      OR (TG_OP = 'INSERT' AND public.can_access('agenda', 'create'))
    )
  ) THEN
    RAISE EXCEPTION
      'Registro de convenio fora do contexto ativo ou sem permissao'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_insurance_record_scope()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_insurance_record_scope()
  TO authenticated, app_prontomedic;

-- Attachment writes are exposed only through the secure Module 15 RPC. The
-- trigger validates the parent authorization against the persisted active
-- context without nesting the organizational SECURITY DEFINER wrapper.
CREATE OR REPLACE FUNCTION public.insurance_attachment_scope_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
BEGIN
  IF v_company_id IS NULL
     OR v_unit_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.insurance_authorizations AS authorization_record
       WHERE authorization_record.id = NEW.authorization_id
         AND authorization_record.company_id = v_company_id
         AND authorization_record.unit_id = v_unit_id
     ) THEN
    RAISE EXCEPTION
      'Authorization attachment is outside the active tenant/unit'
      USING ERRCODE = '42501';
  END IF;

  NEW.company_id := v_company_id;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.insurance_attachment_scope_guard()
  FROM PUBLIC, anon, authenticated, app_prontomedic;

COMMIT;

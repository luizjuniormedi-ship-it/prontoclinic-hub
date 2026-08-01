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
  TO app_prontomedic, prontomedic_rpc_owner, prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_unit_id()
  TO app_prontomedic, prontomedic_rpc_owner, prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT)
  TO app_prontomedic, prontomedic_reception_rpc_owner;

-- Existing databases already carry the Module 15 RPC, so repeat the final
-- definition here to make authorization denials machine-readable without
-- depending on a historical migration being replayed.
CREATE OR REPLACE FUNCTION public.transition_insurance_authorization_secure(
  p_authorization_id UUID,
  p_status TEXT,
  p_protocol_number TEXT DEFAULT NULL,
  p_authorization_number TEXT DEFAULT NULL,
  p_password_number TEXT DEFAULT NULL,
  p_valid_until DATE DEFAULT NULL,
  p_quantity_authorized INTEGER DEFAULT NULL,
  p_quantity_used INTEGER DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.insurance_authorizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor RECORD;
  v_old public.insurance_authorizations;
  v_row public.insurance_authorizations;
  v_authorized INTEGER;
  v_used INTEGER;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL
     OR v_actor.company_id IS NULL
     OR NOT public.m15_can_operate_authorizations() THEN
    RAISE EXCEPTION 'Usuario sem permissao para atualizar autorizacao'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old
  FROM public.insurance_authorizations
  WHERE id = p_authorization_id
    AND company_id = v_actor.company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Autorizacao nao encontrada no tenant atual';
  END IF;
  IF p_status NOT IN (
    'pendente',
    'solicitada',
    'em_analise',
    'autorizada',
    'parcialmente_autorizada',
    'negada',
    'vencida',
    'cancelada',
    'reenviada',
    'liberada_excecao',
    'nao_necessaria'
  ) THEN
    RAISE EXCEPTION 'Status de autorizacao invalido';
  END IF;

  v_authorized := COALESCE(
    p_quantity_authorized,
    v_old.quantity_authorized
  );
  IF p_status = 'autorizada' THEN
    v_authorized := COALESCE(
      p_quantity_authorized,
      v_old.quantity_requested
    );
  END IF;
  v_used := COALESCE(p_quantity_used, v_old.quantity_used);

  IF v_authorized < 0 OR v_authorized > v_old.quantity_requested THEN
    RAISE EXCEPTION 'Quantidade autorizada invalida';
  END IF;
  IF v_used < 0 OR v_used > v_authorized THEN
    RAISE EXCEPTION 'Quantidade utilizada invalida';
  END IF;
  IF p_status IN (
    'autorizada',
    'parcialmente_autorizada',
    'liberada_excecao'
  ) AND NULLIF(
    trim(COALESCE(p_authorization_number, v_old.authorization_number, '')),
    ''
  ) IS NULL THEN
    RAISE EXCEPTION 'Numero da autorizacao e obrigatorio';
  END IF;
  IF p_status = 'negada'
     AND NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo da negativa e obrigatorio';
  END IF;

  UPDATE public.insurance_authorizations
  SET status = p_status,
      protocol_number = COALESCE(
        NULLIF(trim(p_protocol_number), ''),
        protocol_number
      ),
      authorization_number = COALESCE(
        NULLIF(trim(p_authorization_number), ''),
        authorization_number
      ),
      password_number = COALESCE(
        NULLIF(trim(p_password_number), ''),
        password_number
      ),
      valid_until = COALESCE(p_valid_until, valid_until),
      quantity_authorized = v_authorized,
      quantity_used = v_used,
      authorized_at = CASE
        WHEN p_status IN (
          'autorizada',
          'parcialmente_autorizada',
          'liberada_excecao'
        ) THEN COALESCE(authorized_at, NOW())
        ELSE authorized_at
      END,
      denied_at = CASE
        WHEN p_status = 'negada' THEN NOW()
        ELSE denied_at
      END,
      denial_reason = CASE
        WHEN p_status = 'negada' THEN NULLIF(trim(p_reason), '')
        ELSE denial_reason
      END,
      notes = concat_ws(E'\n', notes, NULLIF(trim(p_reason), '')),
      updated_by = v_actor.user_id,
      updated_at = NOW()
  WHERE id = p_authorization_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

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

-- The legacy runtime helper trusted request.jwt.claim.company_id, a mutable GUC
-- retired above. Resolve the tenant from the persisted AAL2 context and the
-- actor from the signed JWT while preserving the established unit rules.
CREATE OR REPLACE FUNCTION private.org_can_access_unit_runtime(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
  SELECT p_company_id = public.active_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.units AS unit_record
      WHERE unit_record.id = p_unit_id
        AND unit_record.company_id = p_company_id
        AND unit_record.lg_ativo = TRUE
        AND (
          p_unit_id = public.active_unit_id()
          OR EXISTS (
            SELECT 1
            FROM public.user_profiles AS profile
            WHERE (
              profile.id = auth.uid()
              OR profile.user_id = auth.uid()
            )
              AND profile.company_id = p_company_id
              AND profile.lg_ativo = TRUE
              AND (
                profile.primary_unit_id = p_unit_id
                OR lower(COALESCE(profile.role_name, '')) IN (
                  'admin',
                  'administrador',
                  'gestor',
                  'gerente',
                  'administrativo'
                )
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.unit_access AS unit_access_record
            WHERE unit_access_record.user_id = auth.uid()
              AND unit_access_record.company_id = p_company_id
              AND unit_access_record.unit_id = p_unit_id
              AND unit_access_record.valid_from <= CURRENT_DATE
              AND (
                unit_access_record.valid_until IS NULL
                OR unit_access_record.valid_until >= CURRENT_DATE
              )
          )
        )
    );
$function$;

ALTER FUNCTION private.org_can_access_unit_runtime(UUID, INTEGER)
  OWNER TO prontomedic_rpc_owner;
REVOKE ALL ON FUNCTION private.org_can_access_unit_runtime(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.org_can_access_unit_runtime(UUID, INTEGER)
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;

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

-- Eligibility writers run as a restricted NOLOGIN/NOBYPASSRLS owner. Since
-- the table uses FORCE RLS, that owner needs explicit policies for the secure
-- RPC to lock and update only the row selected by the persisted tenant/unit
-- context. Authenticated callers do not inherit these policies.
DROP POLICY IF EXISTS insurance_eligibility_reception_owner_select
  ON public.insurance_eligibility_checks;
CREATE POLICY insurance_eligibility_reception_owner_select
  ON public.insurance_eligibility_checks
  FOR SELECT
  TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.m14_can_operate_eligibility(unit_id)
  );

DROP POLICY IF EXISTS insurance_eligibility_reception_owner_update
  ON public.insurance_eligibility_checks;
CREATE POLICY insurance_eligibility_reception_owner_update
  ON public.insurance_eligibility_checks
  FOR UPDATE
  TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.m14_can_operate_eligibility(unit_id)
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.m14_can_operate_eligibility(unit_id)
  );

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

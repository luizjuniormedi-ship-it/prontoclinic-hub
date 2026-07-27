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

-- With FORCE RLS, an out-of-unit authorization is intentionally invisible to
-- the restricted owner. Return a stable authorization error instead of a
-- generic PL/pgSQL exception, without disclosing whether the identifier exists.
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
    RAISE EXCEPTION 'Autorizacao indisponivel no contexto atual'
      USING ERRCODE = '42501';
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

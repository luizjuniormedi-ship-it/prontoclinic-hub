-- Module 11: close reception workflow, tenant isolation and exception governance.
-- Additive hardening only. DataSIGH is not involved.

BEGIN;

DO $prerequisites$
BEGIN
  IF to_regclass('public.appointments') IS NULL
     OR to_regclass('public.reception_checkins') IS NULL
     OR to_regclass('public.reception_queue_tickets') IS NULL
     OR to_regclass('public.reception_admin_history') IS NULL
     OR to_regclass('public.reception_checkin_workflows') IS NULL
     OR to_regclass('public.reception_payments') IS NULL
     OR to_regclass('public.reception_term_acceptances') IS NULL
     OR to_regclass('public.reception_document_pickups') IS NULL THEN
    RAISE EXCEPTION 'Module 11 reception foundation is missing';
  END IF;
  IF to_regprocedure('public.get_scheduling_actor()') IS NULL
     OR to_regprocedure('public.assert_scheduling_permission()') IS NULL
     OR to_regprocedure('public.get_reception_checkin_readiness(bigint)') IS NULL
     OR to_regprocedure('public.get_reception_precheckin_context(bigint)') IS NULL
     OR to_regprocedure('public.update_appointment_status_secure(bigint,text,text)') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL
     OR to_regprocedure('public.org_can_access_unit(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'Module 11 reception function dependencies are missing';
  END IF;
END
$prerequisites$;

DO $owner$
DECLARE
  v_executor_is_superuser BOOLEAN;
BEGIN
  SELECT rolsuper
    INTO v_executor_is_superuser
    FROM pg_roles
   WHERE rolname = CURRENT_USER;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'prontomedic_reception_rpc_owner'
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION
        'Module 11 requires a superuser to create prontomedic_reception_rpc_owner';
    END IF;
    EXECUTE
      'CREATE ROLE prontomedic_reception_rpc_owner NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  ELSIF EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = 'prontomedic_reception_rpc_owner'
       AND (
         rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper
         OR rolcreatedb OR rolcreaterole OR rolreplication
       )
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION
        'Module 11 cannot harden prontomedic_reception_rpc_owner without a superuser';
    END IF;
    EXECUTE
      'ALTER ROLE prontomedic_reception_rpc_owner NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  END IF;
END
$owner$;

CREATE OR REPLACE FUNCTION public.assert_scheduling_permission()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor RECORD;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional';
  END IF;
  IF COALESCE(v_actor.role_name, '') NOT IN (
    'admin',
    'administrador',
    'recepcao',
    'recepção',
    'reception',
    'supervisor_recepcao',
    'gestor',
    'medico',
    'médico'
  ) THEN
    RAISE EXCEPTION 'Usuario sem permissao para operar agenda';
  END IF;
END;
$function$;

ALTER TABLE public.reception_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_checkins FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reception_admin_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_admin_history FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reception_queue_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_queue_tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reception_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reception_term_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_term_acceptances FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reception_document_pickups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_document_pickups FORCE ROW LEVEL SECURITY;

ALTER TABLE public.reception_queue_tickets
  ADD COLUMN IF NOT EXISTS issued_unit_id INTEGER
  REFERENCES public.units(id) ON DELETE RESTRICT;

UPDATE public.reception_queue_tickets
   SET issued_unit_id = unit_id
 WHERE issued_unit_id IS NULL;

COMMENT ON COLUMN public.reception_queue_tickets.issued_unit_id IS
  'Immutable issuance scope. Transfers change unit_id but preserve ticket numbering.';

ALTER TABLE public.reception_queue_tickets
  DROP CONSTRAINT IF EXISTS reception_queue_tickets_ticket_date_prefix_number_key;
DROP INDEX IF EXISTS public.reception_queue_tickets_scope_number_uq;
CREATE UNIQUE INDEX reception_queue_tickets_scope_number_uq
  ON public.reception_queue_tickets(
    company_id,
    COALESCE(issued_unit_id, -1),
    ticket_date,
    prefix,
    number
  );

CREATE OR REPLACE FUNCTION private.reception_actor_can_access_unit(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
  WITH actor AS (
    SELECT COALESCE(
      NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID,
      auth.uid()
    ) AS user_id
  )
  SELECT p_unit_id IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM public.units unit_record
        CROSS JOIN actor
       WHERE unit_record.id = p_unit_id
         AND unit_record.company_id = p_company_id
         AND unit_record.lg_ativo = TRUE
         AND EXISTS (
           SELECT 1
             FROM public.user_profiles profile
            WHERE (
              profile.id = actor.user_id
              OR profile.user_id = actor.user_id
            )
              AND profile.company_id = p_company_id
              AND profile.lg_ativo = TRUE
              AND (
                lower(COALESCE(profile.role_name, '')) IN (
                  'admin',
                  'administrador',
                  'gestor',
                  'gerente'
                )
                OR profile.primary_unit_id = p_unit_id
                OR EXISTS (
                  SELECT 1
                    FROM public.unit_access access_record
                   WHERE access_record.user_id = actor.user_id
                     AND access_record.company_id = p_company_id
                     AND access_record.unit_id = p_unit_id
                     AND access_record.valid_from <= NOW()
                     AND (
                       access_record.valid_until IS NULL
                       OR access_record.valid_until > NOW()
                     )
                )
              )
         )
    )
$function$;

REVOKE ALL ON FUNCTION private.reception_actor_can_access_unit(
  UUID, INTEGER
) FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.reception_actor_can_access_unit(
  UUID, INTEGER
) TO prontomedic_reception_rpc_owner;

CREATE OR REPLACE FUNCTION private.reception_can_checkin(
  p_user_id UUID,
  p_company_id UUID,
  p_unit_id INTEGER,
  p_role_name TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN lower(trim(COALESCE(p_role_name, ''))) IN (
      'admin',
      'administrador',
      'gestor',
      'gerente',
      'recepcao',
      'recepção',
      'reception',
      'supervisor_recepcao'
    ) THEN TRUE
    ELSE EXISTS (
      SELECT 1
        FROM public.memberships membership
        JOIN public.membership_roles membership_role
          ON membership_role.membership_id = membership.id
        JOIN public.roles role_record
          ON role_record.id = membership_role.role_id
         AND role_record.lg_ativo IS TRUE
        JOIN public.role_permissions role_permission
          ON role_permission.role_id = role_record.id
         AND role_permission.company_id = membership.company_id
       WHERE membership.user_id = p_user_id
         AND membership.company_id = p_company_id
         AND membership.status = 'active'
         AND lower(role_record.name) = lower(trim(COALESCE(p_role_name, '')))
         AND lower(role_permission.module) IN ('reception', 'recepcao')
         AND (
           role_permission.can_create IS TRUE
           OR role_permission.can_edit IS TRUE
         )
    )
  END
$function$;

REVOKE ALL ON FUNCTION private.reception_can_checkin(
  UUID, UUID, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.reception_can_checkin(
  UUID, UUID, INTEGER, TEXT
) TO prontomedic_reception_rpc_owner;

CREATE OR REPLACE FUNCTION private.reception_can_release_exception(
  p_user_id UUID,
  p_company_id UUID,
  p_unit_id INTEGER,
  p_role_name TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships membership
    JOIN public.membership_roles membership_role
      ON membership_role.membership_id = membership.id
    JOIN public.roles role_record
      ON role_record.id = membership_role.role_id
     AND role_record.lg_ativo IS TRUE
    WHERE membership.user_id = p_user_id
      AND membership.company_id = p_company_id
      AND membership.status = 'active'
      AND lower(role_record.name) IN (
        'admin',
        'administrador',
        'gestor',
        'gerente',
        'supervisor_recepcao'
      )
      AND CASE lower(trim(COALESCE(p_role_name, '')))
        WHEN 'administrador' THEN 'admin'
        WHEN 'admin_master' THEN 'admin'
        WHEN 'master' THEN 'admin'
        ELSE lower(trim(COALESCE(p_role_name, '')))
      END = CASE lower(role_record.name)
        WHEN 'administrador' THEN 'admin'
        ELSE lower(role_record.name)
      END
      AND (
        lower(role_record.name) IN (
          'admin',
          'administrador',
          'gestor',
          'gerente'
        )
        OR EXISTS (
          SELECT 1
          FROM public.membership_units membership_unit
          WHERE membership_unit.membership_id = membership.id
            AND membership_unit.unit_id = p_unit_id
        )
      )
  )
$function$;

REVOKE ALL ON FUNCTION private.reception_can_release_exception(
  UUID, UUID, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.reception_can_release_exception(
  UUID, UUID, INTEGER, TEXT
) TO prontomedic_reception_rpc_owner;

CREATE OR REPLACE FUNCTION private.m11_normalize_role(p_role TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT CASE lower(trim(COALESCE(p_role, '')))
    WHEN 'administrador' THEN 'admin'
    WHEN 'admin_master' THEN 'admin'
    WHEN 'master' THEN 'admin'
    WHEN 'gerente' THEN 'gestor'
    WHEN 'recepção' THEN 'recepcao'
    WHEN 'reception' THEN 'recepcao'
    WHEN 'supervisor_recepcao' THEN 'recepcao'
    WHEN 'billing' THEN 'faturista'
    WHEN 'financial' THEN 'financeiro'
    ELSE lower(trim(COALESCE(p_role, '')))
  END
$function$;

CREATE OR REPLACE FUNCTION public.advance_reception_checkin_workflow_secure(
  p_workflow_id UUID,
  p_expected_version INTEGER,
  p_next_step TEXT,
  p_status TEXT DEFAULT 'in_progress',
  p_billing_account_id UUID DEFAULT NULL,
  p_tiss_guide_id UUID DEFAULT NULL,
  p_financial_transaction_id BIGINT DEFAULT NULL,
  p_checkin_id BIGINT DEFAULT NULL,
  p_result_payload JSONB DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS public.reception_checkin_workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_actor RECORD;
  v_workflow public.reception_checkin_workflows;
  v_readiness JSONB;
  v_precheck JSONB;
  v_ready BOOLEAN;
  v_exception_reason TEXT;
  v_result_payload JSONB := COALESCE(p_result_payload, '{}'::JSONB);
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional';
  END IF;

  SELECT * INTO v_workflow
    FROM public.reception_checkin_workflows workflow
   WHERE workflow.id = p_workflow_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow de check-in nao encontrado ou fora do escopo';
  END IF;
  IF v_workflow.company_id <> v_actor.company_id
     OR NOT private.reception_actor_can_access_unit(
       v_workflow.company_id,
       v_workflow.unit_id
     ) THEN
    RAISE EXCEPTION 'Workflow de check-in fora do escopo do usuario';
  END IF;

  IF v_workflow.current_step = 'precheck'
     AND p_next_step = 'billing'
     AND p_status = 'in_progress' THEN
    v_readiness := public.get_reception_checkin_readiness(
      v_workflow.appointment_id
    );
    v_precheck := public.get_reception_precheckin_context(
      v_workflow.appointment_id
    );
    v_ready := COALESCE((v_readiness->>'ready')::BOOLEAN, FALSE)
      AND COALESCE((v_precheck->>'ready')::BOOLEAN, FALSE);

    IF NOT v_ready THEN
      v_exception_reason := NULLIF(
        trim(COALESCE(v_workflow.request_payload->>'exception_reason', '')),
        ''
      );
      IF NOT private.reception_can_release_exception(
        v_actor.user_id,
        v_actor.company_id,
        v_workflow.unit_id,
        v_actor.role_name
      ) THEN
        RAISE EXCEPTION 'Usuario sem permissao reception.release_exception';
      END IF;
      IF v_exception_reason IS NULL OR length(v_exception_reason) < 20 THEN
        RAISE EXCEPTION
          'Justificativa da excecao deve ter pelo menos 20 caracteres';
      END IF;
    END IF;

    v_result_payload := v_result_payload || jsonb_build_object(
      'precheck_ready',
      v_ready,
      'exception_authorized',
      NOT v_ready
    );
  END IF;

  SELECT advanced.*
    INTO v_workflow
    FROM private.m11_advance_workflow(
      p_workflow_id,
      p_expected_version,
      p_next_step,
      p_status,
      p_billing_account_id,
      p_tiss_guide_id,
      p_financial_transaction_id,
      p_checkin_id,
      v_result_payload,
      p_error_code,
      p_error_message
    ) AS advanced;

  RETURN v_workflow;
END;
$function$;

ALTER FUNCTION public.advance_reception_checkin_workflow_secure(
  UUID, INTEGER, TEXT, TEXT, UUID, UUID, BIGINT, BIGINT, JSONB, TEXT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.advance_reception_checkin_workflow_secure(
  UUID, INTEGER, TEXT, TEXT, UUID, UUID, BIGINT, BIGINT, JSONB, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_reception_checkin_workflow_secure(
  UUID, INTEGER, TEXT, TEXT, UUID, UUID, BIGINT, BIGINT, JSONB, TEXT, TEXT
) TO authenticated, app_prontomedic;

DROP POLICY IF EXISTS appointments_reception_rpc_select
  ON public.appointments;
CREATE POLICY appointments_reception_rpc_select
  ON public.appointments
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

DROP POLICY IF EXISTS reception_workflow_rpc_select
  ON public.reception_checkin_workflows;
CREATE POLICY reception_workflow_rpc_select
  ON public.reception_checkin_workflows
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND private.reception_actor_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS reception_checkins_rpc_owner
  ON public.reception_checkins;
CREATE POLICY reception_checkins_rpc_owner
  ON public.reception_checkins
  FOR ALL TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

DROP POLICY IF EXISTS reception_queue_rpc_owner
  ON public.reception_queue_tickets;
CREATE POLICY reception_queue_rpc_owner
  ON public.reception_queue_tickets
  FOR ALL TO prontomedic_reception_rpc_owner
  USING (company_id = public.current_company_id())
  WITH CHECK (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
    AND (
      issued_unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, issued_unit_id)
    )
  );

DROP POLICY IF EXISTS reception_admin_history_rpc_owner
  ON public.reception_admin_history;
CREATE POLICY reception_admin_history_rpc_owner
  ON public.reception_admin_history
  FOR INSERT TO prontomedic_reception_rpc_owner
  WITH CHECK (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

DROP FUNCTION IF EXISTS public.perform_reception_checkin_secure(
  BIGINT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.perform_reception_checkin_secure(
  p_workflow_id UUID,
  p_appointment_id BIGINT,
  p_priority TEXT DEFAULT 'normal',
  p_exception_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_actor RECORD;
  v_workflow public.reception_checkin_workflows;
  v_appointment public.appointments;
  v_readiness JSONB;
  v_precheck JSONB;
  v_issues JSONB := '[]'::JSONB;
  v_ready BOOLEAN;
  v_checkin public.reception_checkins;
  v_ticket public.reception_queue_tickets;
  v_number INTEGER;
  v_exception_reason TEXT;
  v_requested_exception_reason TEXT;
  v_priority TEXT := lower(trim(COALESCE(p_priority, '')));
  v_requested_priority TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_workflow_id::TEXT, 0)
  );
  SELECT * INTO v_workflow
    FROM public.reception_checkin_workflows workflow
   WHERE workflow.id = p_workflow_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow de check-in nao encontrado ou fora do escopo';
  END IF;
  IF v_workflow.company_id <> v_actor.company_id
     OR v_workflow.appointment_id <> p_appointment_id THEN
    RAISE EXCEPTION 'Workflow de check-in fora do escopo do usuario';
  END IF;
  v_requested_priority := lower(trim(COALESCE(
    v_workflow.request_payload->>'priority',
    'normal'
  )));
  v_requested_exception_reason := NULLIF(
    trim(COALESCE(v_workflow.request_payload->>'exception_reason', '')),
    ''
  );
  v_exception_reason := NULLIF(trim(COALESCE(p_exception_reason, '')), '');
  IF v_priority IS DISTINCT FROM v_requested_priority
     OR v_exception_reason IS DISTINCT FROM v_requested_exception_reason THEN
    RAISE EXCEPTION
      'Retry do check-in possui parametros divergentes do workflow';
  END IF;
  IF v_workflow.status <> 'in_progress'
     OR v_workflow.current_step <> 'checkin' THEN
    RAISE EXCEPTION 'Workflow nao esta pronto para o check-in';
  END IF;
  IF v_workflow.billing_account_id IS NULL THEN
    RAISE EXCEPTION 'Pre-conta obrigatoria antes do check-in';
  END IF;
  IF v_workflow.requires_tiss AND v_workflow.tiss_guide_id IS NULL THEN
    RAISE EXCEPTION 'Guia TISS obrigatoria antes do check-in';
  END IF;
  IF v_workflow.requires_financial
     AND v_workflow.financial_transaction_id IS NULL THEN
    RAISE EXCEPTION 'Titulo financeiro obrigatorio antes do check-in';
  END IF;

  SELECT * INTO v_appointment
    FROM public.appointments appointment
   WHERE appointment.id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado ou fora do escopo';
  END IF;
  IF v_appointment.company_id <> v_actor.company_id
     OR v_appointment.company_id <> v_workflow.company_id
     OR v_appointment.unit_id IS DISTINCT FROM v_workflow.unit_id THEN
    RAISE EXCEPTION 'Agendamento fora do escopo do workflow';
  END IF;
  IF v_priority NOT IN ('normal', 'legal', 'urgent') THEN
    RAISE EXCEPTION 'Prioridade invalida';
  END IF;
  IF NOT private.reception_can_checkin(
    v_actor.user_id,
    v_actor.company_id,
    v_appointment.unit_id,
    v_actor.role_name
  ) THEN
    RAISE EXCEPTION 'Usuario sem permissao reception.checkin';
  END IF;

  v_readiness := public.get_reception_checkin_readiness(p_appointment_id);
  v_precheck := public.get_reception_precheckin_context(p_appointment_id);
  v_issues := COALESCE(v_readiness->'issues', '[]'::JSONB)
    || COALESCE(v_precheck->'issues', '[]'::JSONB);
  v_ready := (v_readiness->>'ready')::BOOLEAN
    AND (v_precheck->>'ready')::BOOLEAN;

  IF NOT v_ready THEN
    IF NOT private.reception_can_release_exception(
      v_actor.user_id,
      v_actor.company_id,
      v_appointment.unit_id,
      v_actor.role_name
    ) THEN
      RAISE EXCEPTION 'Usuario sem permissao reception.release_exception';
    END IF;
    IF v_exception_reason IS NULL OR length(v_exception_reason) < 20 THEN
      RAISE EXCEPTION 'Justificativa da excecao deve ter pelo menos 20 caracteres';
    END IF;
  END IF;

  SELECT * INTO v_checkin
    FROM public.reception_checkins checkin
   WHERE checkin.appointment_id = v_appointment.id;

  IF FOUND THEN
    IF v_workflow.checkin_id IS NOT NULL
       AND v_workflow.checkin_id <> v_checkin.id THEN
      RAISE EXCEPTION 'Workflow vinculado a outro check-in';
    END IF;

    SELECT * INTO v_ticket
      FROM public.reception_queue_tickets ticket
     WHERE ticket.company_id = v_actor.company_id
       AND ticket.checkin_id = v_checkin.id
     ORDER BY ticket.id
     LIMIT 1;

    IF FOUND THEN
      IF v_ticket.unit_id IS NOT NULL
         AND NOT private.reception_actor_can_access_unit(
           v_ticket.company_id,
           v_ticket.unit_id
         ) THEN
        RAISE EXCEPTION 'Senha transferida para unidade fora do escopo';
      END IF;
      RETURN jsonb_build_object(
        'checkin_id', v_checkin.id,
        'ticket_id', v_ticket.id,
        'ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
        'released_by_exception', v_checkin.released_by_exception,
        'issues', v_issues,
        'idempotent', TRUE
      );
    END IF;
  ELSE
    INSERT INTO public.reception_checkins(
      company_id,
      unit_id,
      patient_id,
      appointment_id,
      status,
      priority,
      released_by_exception,
      created_by
    )
    VALUES (
      v_appointment.company_id,
      v_appointment.unit_id,
      v_appointment.patient_id,
      v_appointment.id,
      'checked_in',
      v_priority,
      NOT v_ready,
      v_actor.user_id
    )
    RETURNING * INTO v_checkin;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(v_appointment.company_id::TEXT),
    hashtext(
      COALESCE(v_appointment.unit_id::TEXT, 'global')
      || ':' || CURRENT_DATE::TEXT || ':C'
    )
  );
  SELECT COALESCE(max(ticket.number), 0) + 1
    INTO v_number
    FROM public.reception_queue_tickets ticket
   WHERE ticket.company_id = v_appointment.company_id
     AND ticket.issued_unit_id IS NOT DISTINCT FROM v_appointment.unit_id
     AND ticket.ticket_date = CURRENT_DATE
     AND ticket.prefix = 'C';

  INSERT INTO public.reception_queue_tickets(
    company_id,
    unit_id,
    issued_unit_id,
    checkin_id,
    patient_id,
    appointment_id,
    number,
    priority
  )
  VALUES (
    v_appointment.company_id,
    v_appointment.unit_id,
    v_appointment.unit_id,
    v_checkin.id,
    v_appointment.patient_id,
    v_appointment.id,
    v_number,
    v_priority
  )
  RETURNING * INTO v_ticket;

  INSERT INTO public.reception_admin_history(
    company_id,
    unit_id,
    entity_type,
    entity_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    details,
    actor_user_id
  )
  VALUES (
    v_appointment.company_id,
    v_appointment.unit_id,
    'checkin',
    v_checkin.id::TEXT,
    v_appointment.id,
    NULL,
    'checked_in',
    CASE WHEN v_ready THEN 'Check-in realizado' ELSE v_exception_reason END,
    jsonb_build_object(
      'workflow_id', v_workflow.id,
      'ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
      'issues', v_issues,
      'exception_authorized', NOT v_ready,
      'exception_authorized_by_role',
        CASE WHEN v_ready THEN NULL ELSE v_actor.role_name END
    ),
    v_actor.user_id
  );

  PERFORM public.update_appointment_status_secure(
    v_appointment.id,
    'waiting',
    CASE
      WHEN v_ready THEN 'Check-in realizado'
      ELSE 'Check-in liberado por excecao autorizada'
    END
  );

  RETURN jsonb_build_object(
    'checkin_id', v_checkin.id,
    'ticket_id', v_ticket.id,
    'ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
    'released_by_exception', NOT v_ready,
    'issues', v_issues,
    'idempotent', FALSE
  );
END;
$function$;

ALTER FUNCTION public.perform_reception_checkin_secure(
  UUID, BIGINT, TEXT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;

GRANT USAGE ON SCHEMA public, private, auth
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m11_advance_workflow(
  UUID, INTEGER, TEXT, TEXT, UUID, UUID, BIGINT, BIGINT, JSONB, TEXT, TEXT
) TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.get_scheduling_actor()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.assert_scheduling_permission()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.get_scheduling_actor()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.get_reception_checkin_readiness(BIGINT)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.get_reception_precheckin_context(BIGINT)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.update_appointment_status_secure(
  BIGINT, TEXT, TEXT
) TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO prontomedic_reception_rpc_owner;

GRANT SELECT ON TABLE
  public.appointments,
  public.reception_checkin_workflows,
  public.reception_checkins,
  public.reception_queue_tickets
TO prontomedic_reception_rpc_owner;
GRANT INSERT ON TABLE
  public.reception_checkins,
  public.reception_queue_tickets,
  public.reception_admin_history
TO prontomedic_reception_rpc_owner;

DO $sequence_grants$
DECLARE
  v_table TEXT;
  v_sequence TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'reception_checkins',
    'reception_queue_tickets',
    'reception_admin_history'
  ]
  LOOP
    SELECT pg_get_serial_sequence('public.' || v_table, 'id')
      INTO v_sequence;
    IF v_sequence IS NOT NULL THEN
      EXECUTE format(
        'GRANT USAGE, SELECT ON SEQUENCE %s TO prontomedic_reception_rpc_owner',
        v_sequence
      );
      IF EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_rpc_owner'
      ) THEN
        EXECUTE format(
          'GRANT USAGE, SELECT ON SEQUENCE %s TO prontomedic_rpc_owner',
          v_sequence
        );
      END IF;
    END IF;
  END LOOP;
END
$sequence_grants$;

REVOKE ALL ON FUNCTION public.perform_reception_checkin_secure(
  UUID, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perform_reception_checkin_secure(
  UUID, BIGINT, TEXT, TEXT
) TO authenticated, app_prontomedic;

REVOKE INSERT, UPDATE, DELETE ON
  public.reception_checkins,
  public.reception_queue_tickets,
  public.reception_admin_history
FROM authenticated, app_prontomedic;

DO $ledger$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.prontomedic_deployment_migrations
        WHERE filename = '20260726103000_module11_reception_security_closure.sql'
     ) THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260726103000_module11_reception_security_closure.sql', NOW());
  END IF;
END
$ledger$;

COMMIT;

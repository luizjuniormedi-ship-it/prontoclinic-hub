-- Module 11: make the remaining reception RPCs compatible with FORCE RLS.
-- Additive hardening only. DataSIGH is not involved.

BEGIN;

DO $prerequisites$
BEGIN
  IF to_regclass('public.reception_payments') IS NULL
     OR to_regclass('public.reception_term_acceptances') IS NULL
     OR to_regclass('public.reception_document_pickups') IS NULL
     OR to_regclass('public.reception_queue_tickets') IS NULL
     OR to_regclass('public.reception_admin_history') IS NULL
     OR to_regclass('public.patients') IS NULL
     OR to_regclass('public.appointments') IS NULL THEN
    RAISE EXCEPTION 'Module 11 reception operational tables are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = 'prontomedic_reception_rpc_owner'
       AND NOT rolsuper
       AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION
      'prontomedic_reception_rpc_owner must exist without SUPERUSER or BYPASSRLS';
  END IF;
END
$prerequisites$;

ALTER TABLE public.reception_queue_tickets
  ADD COLUMN IF NOT EXISTS sector VARCHAR(30) DEFAULT 'consulta',
  ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
UPDATE public.reception_queue_tickets
   SET sector = 'consulta'
 WHERE sector IS NULL;
ALTER TABLE public.reception_queue_tickets
  ALTER COLUMN sector SET DEFAULT 'consulta',
  ALTER COLUMN sector SET NOT NULL;

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_actor UUID;
  v_company UUID;
BEGIN
  BEGIN
    v_actor := COALESCE(
      NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID,
      auth.uid()
    );
  EXCEPTION WHEN invalid_text_representation THEN
    v_actor := auth.uid();
  END;

  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT CASE
           WHEN count(DISTINCT profile.company_id) = 1
             THEN min(profile.company_id::TEXT)::UUID
           ELSE NULL
         END
    INTO v_company
    FROM public.user_profiles profile
   WHERE (
     profile.id = v_actor
     OR profile.user_id = v_actor
   )
     AND profile.company_id IS NOT NULL
     AND profile.lg_ativo = TRUE;

  RETURN v_company;
END;
$function$;

REVOKE ALL ON FUNCTION public.current_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO authenticated, app_prontomedic, prontomedic_reception_rpc_owner;

DROP POLICY IF EXISTS patients_reception_rpc_select ON public.patients;
CREATE POLICY patients_reception_rpc_select
  ON public.patients
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS reception_payments_rpc_insert
  ON public.reception_payments;
DROP POLICY IF EXISTS reception_payments_rpc_select
  ON public.reception_payments;
CREATE POLICY reception_payments_rpc_select
  ON public.reception_payments
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );
CREATE POLICY reception_payments_rpc_insert
  ON public.reception_payments
  FOR INSERT TO prontomedic_reception_rpc_owner
  WITH CHECK (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

DROP POLICY IF EXISTS reception_terms_rpc_insert
  ON public.reception_term_acceptances;
DROP POLICY IF EXISTS reception_terms_rpc_select
  ON public.reception_term_acceptances;
CREATE POLICY reception_terms_rpc_select
  ON public.reception_term_acceptances
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );
CREATE POLICY reception_terms_rpc_insert
  ON public.reception_term_acceptances
  FOR INSERT TO prontomedic_reception_rpc_owner
  WITH CHECK (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

DROP POLICY IF EXISTS reception_pickups_rpc_select
  ON public.reception_document_pickups;
CREATE POLICY reception_pickups_rpc_select
  ON public.reception_document_pickups
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

DROP POLICY IF EXISTS reception_pickups_rpc_insert
  ON public.reception_document_pickups;
CREATE POLICY reception_pickups_rpc_insert
  ON public.reception_document_pickups
  FOR INSERT TO prontomedic_reception_rpc_owner
  WITH CHECK (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

DROP POLICY IF EXISTS reception_pickups_rpc_update
  ON public.reception_document_pickups;
CREATE POLICY reception_pickups_rpc_update
  ON public.reception_document_pickups
  FOR UPDATE TO prontomedic_reception_rpc_owner
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

CREATE OR REPLACE FUNCTION public.m11_reception_assert_appointment(
  p_appointment_id BIGINT,
  OUT v_company_id UUID,
  OUT v_unit_id INTEGER,
  OUT v_patient_id BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_appointment public.appointments;
BEGIN
  SELECT *
    INTO v_appointment
    FROM public.appointments
   WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado';
  END IF;

  v_company_id := v_appointment.company_id;
  v_unit_id := v_appointment.unit_id;
  v_patient_id := v_appointment.patient_id;
  IF v_company_id <> public.current_company_id() THEN
    RAISE EXCEPTION 'Agendamento fora do tenant';
  END IF;
  IF v_unit_id IS NOT NULL
     AND NOT private.reception_actor_can_access_unit(
       v_company_id,
       v_unit_id
     ) THEN
    RAISE EXCEPTION 'Agendamento fora da unidade autorizada';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_reception_document_pickup_secure(
  p_pickup_id UUID,
  p_recipient_name TEXT,
  p_recipient_cpf TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_pickup public.reception_document_pickups;
  v_actor UUID := NULLIF(
    current_setting('request.jwt.claim.sub', TRUE),
    ''
  )::UUID;
BEGIN
  IF NOT public.audit_has_role(
    ARRAY['admin','gestor','recepcao']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'Perfil sem permissao para liberar documento';
  END IF;

  SELECT *
    INTO v_pickup
    FROM public.reception_document_pickups
   WHERE id = p_pickup_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_pickup.company_id <> public.current_company_id() THEN
    RAISE EXCEPTION 'Retirada fora do tenant';
  END IF;
  IF v_pickup.unit_id IS NOT NULL
     AND NOT private.reception_actor_can_access_unit(
       v_pickup.company_id,
       v_pickup.unit_id
     ) THEN
    RAISE EXCEPTION 'Retirada fora da unidade autorizada';
  END IF;
  IF v_pickup.status NOT IN ('requested','ready') THEN
    RAISE EXCEPTION 'Retirada nao esta pendente';
  END IF;
  IF NULLIF(btrim(p_recipient_name),'') IS NULL
     OR NULLIF(btrim(p_recipient_cpf),'') IS NULL THEN
    RAISE EXCEPTION 'Nome e CPF do recebedor sao obrigatorios';
  END IF;

  UPDATE public.reception_document_pickups
     SET status = 'released',
         recipient_name = btrim(p_recipient_name),
         recipient_cpf = regexp_replace(
           p_recipient_cpf,
           '[^0-9]',
           '',
           'g'
         ),
         released_at = NOW(),
         released_by = v_actor,
         updated_at = NOW()
   WHERE id = p_pickup_id;

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
    v_pickup.company_id,
    v_pickup.unit_id,
    'document_pickup',
    p_pickup_id::TEXT,
    v_pickup.appointment_id,
    v_pickup.status,
    'released',
    'Documento entregue',
    jsonb_build_object(
      'recipient_name',
      btrim(p_recipient_name),
      'recipient_cpf',
      regexp_replace(p_recipient_cpf, '[^0-9]', '', 'g')
    ),
    v_actor
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.transition_reception_queue_ticket(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT,
  p_destination_unit_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_ticket public.reception_queue_tickets;
  v_actor RECORD;
  v_from_status TEXT;
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_company UUID := public.current_company_id();
  v_history_unit_id INTEGER;
BEGIN
  IF NOT public.audit_has_role(
    ARRAY[
      'admin',
      'gestor',
      'recepcao',
      'enfermagem',
      'enfermeiro',
      'medico'
    ]::TEXT[]
  ) THEN
    RAISE EXCEPTION 'Perfil sem permissao para alterar fila de recepcao';
  END IF;
  IF p_to_status NOT IN (
    'waiting',
    'called',
    'transferred',
    'completed',
    'cancelled',
    'no_show'
  ) THEN
    RAISE EXCEPTION 'Status de fila invalido';
  END IF;
  IF p_to_status = 'transferred'
     AND p_destination_unit_id IS NULL THEN
    RAISE EXCEPTION 'Unidade de destino obrigatoria para transferencia';
  END IF;
  IF p_to_status <> 'transferred'
     AND p_destination_unit_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Unidade de destino so pode ser usada em transferencia';
  END IF;

  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  SELECT *
    INTO v_ticket
    FROM public.reception_queue_tickets ticket
   WHERE ticket.id = p_ticket_id
     AND ticket.company_id = v_company
     AND ticket.unit_id IS NOT NULL
     AND private.reception_actor_can_access_unit(
       ticket.company_id,
       ticket.unit_id
     )
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Senha de recepcao fora do escopo';
  END IF;

  v_from_status := v_ticket.status;
  IF v_from_status = p_to_status
     AND p_to_status <> 'transferred' THEN
    RETURN jsonb_build_object(
      'ticket_id', v_ticket.id,
      'from_status', v_from_status,
      'to_status', p_to_status,
      'idempotent', TRUE
    );
  END IF;
  IF NOT (
    (
      v_from_status = 'waiting'
      AND p_to_status IN (
        'called',
        'cancelled',
        'no_show',
        'transferred'
      )
    )
    OR (
      v_from_status = 'called'
      AND p_to_status IN (
        'waiting',
        'transferred',
        'completed',
        'cancelled',
        'no_show'
      )
    )
    OR (
      v_from_status = 'transferred'
      AND p_to_status IN ('waiting','called','cancelled')
    )
  ) THEN
    RAISE EXCEPTION
      'Transicao de fila invalida: % -> %',
      v_from_status,
      p_to_status;
  END IF;

  IF p_to_status = 'transferred'
     AND NOT private.reception_actor_can_access_unit(
       v_company,
       p_destination_unit_id
     ) THEN
    RAISE EXCEPTION 'Unidade de destino fora do escopo';
  END IF;

  v_history_unit_id := CASE
    WHEN p_to_status = 'transferred' THEN p_destination_unit_id
    ELSE v_ticket.unit_id
  END;

  UPDATE public.reception_queue_tickets
     SET status = p_to_status,
         unit_id = CASE
           WHEN p_to_status = 'transferred'
             THEN p_destination_unit_id
           ELSE unit_id
         END,
         transferred_to_unit_id = CASE
           WHEN p_to_status = 'transferred'
             THEN p_destination_unit_id
           ELSE transferred_to_unit_id
         END,
         transferred_at = CASE
           WHEN p_to_status = 'transferred' THEN NOW()
           ELSE transferred_at
         END,
         called_at = CASE
           WHEN p_to_status = 'called' AND called_at IS NULL THEN NOW()
           ELSE called_at
         END,
         completed_at = CASE
           WHEN p_to_status IN ('completed','cancelled','no_show')
             THEN COALESCE(completed_at, NOW())
           ELSE completed_at
         END,
         sla_due_at = CASE
           WHEN p_to_status IN ('waiting','transferred')
             THEN NOW() + make_interval(mins => sla_minutes)
           ELSE sla_due_at
         END
   WHERE id = v_ticket.id;

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
    v_company,
    v_history_unit_id,
    'reception_queue_ticket',
    v_ticket.id::TEXT,
    v_ticket.appointment_id,
    v_from_status,
    p_to_status,
    COALESCE(v_reason, 'Transicao de fila'),
    jsonb_build_object(
      'ticket',
      v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
      'source_unit_id',
      v_ticket.unit_id,
      'destination_unit_id',
      p_destination_unit_id,
      'sla_minutes',
      v_ticket.sla_minutes
    ),
    v_actor.user_id
  );

  RETURN jsonb_build_object(
    'ticket_id', v_ticket.id,
    'from_status', v_from_status,
    'to_status', p_to_status,
    'destination_unit_id', p_destination_unit_id,
    'sla_due_at',
      CASE
        WHEN p_to_status IN ('waiting','transferred')
          THEN NOW() + make_interval(mins => v_ticket.sla_minutes)
        ELSE v_ticket.sla_due_at
      END,
    'idempotent', FALSE
  );
END;
$function$;

ALTER FUNCTION public.m11_reception_assert_appointment(BIGINT)
  OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.record_reception_payment_secure(
  BIGINT, NUMERIC, TEXT, TEXT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.record_reception_term_acceptance_secure(
  BIGINT, TEXT, TEXT, TEXT, BIGINT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.create_reception_document_pickup_secure(
  BIGINT, TEXT, BIGINT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.release_reception_document_pickup_secure(
  UUID, TEXT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;

ALTER FUNCTION private.transition_reception_queue_ticket(
  BIGINT, TEXT, TEXT, INTEGER
) OWNER TO prontomedic_reception_rpc_owner;

CREATE OR REPLACE FUNCTION public.transition_reception_queue_ticket_secure(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
BEGIN
  RETURN private.transition_reception_queue_ticket(
    p_ticket_id,
    p_to_status,
    p_reason,
    NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.transition_reception_queue_ticket_secure(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT,
  p_destination_unit_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
BEGIN
  RETURN private.transition_reception_queue_ticket(
    p_ticket_id,
    p_to_status,
    p_reason,
    p_destination_unit_id
  );
END;
$function$;

ALTER FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT, INTEGER
) OWNER TO prontomedic_reception_rpc_owner;

GRANT USAGE ON SCHEMA public, private, auth
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.audit_has_role(TEXT[])
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.get_scheduling_actor()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.m11_reception_assert_appointment(BIGINT)
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION private.transition_reception_queue_ticket(
  BIGINT, TEXT, TEXT, INTEGER
) TO prontomedic_reception_rpc_owner;

GRANT SELECT ON TABLE
  public.patients,
  public.appointments,
  public.reception_payments,
  public.reception_term_acceptances,
  public.reception_document_pickups,
  public.reception_queue_tickets
TO prontomedic_reception_rpc_owner;
GRANT INSERT ON TABLE
  public.reception_payments,
  public.reception_term_acceptances,
  public.reception_document_pickups,
  public.reception_admin_history
TO prontomedic_reception_rpc_owner;
GRANT UPDATE ON TABLE
  public.reception_document_pickups,
  public.reception_queue_tickets
TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION private.transition_reception_queue_ticket(
  BIGINT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_reception_payment_secure(
  BIGINT, NUMERIC, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_reception_term_acceptance_secure(
  BIGINT, TEXT, TEXT, TEXT, BIGINT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_reception_document_pickup_secure(
  BIGINT, TEXT, BIGINT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_reception_document_pickup_secure(
  UUID, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT, INTEGER
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.record_reception_payment_secure(
  BIGINT, NUMERIC, TEXT, TEXT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.record_reception_term_acceptance_secure(
  BIGINT, TEXT, TEXT, TEXT, BIGINT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.create_reception_document_pickup_secure(
  BIGINT, TEXT, BIGINT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.release_reception_document_pickup_secure(
  UUID, TEXT, TEXT
) TO authenticated, app_prontomedic;

REVOKE INSERT, UPDATE, DELETE ON
  public.reception_payments,
  public.reception_term_acceptances,
  public.reception_document_pickups,
  public.reception_queue_tickets,
  public.reception_admin_history
FROM authenticated, app_prontomedic;

DO $ledger$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.prontomedic_deployment_migrations
        WHERE filename =
          '20260726113000_module11_reception_owner_acl_closure.sql'
     ) THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES (
      '20260726113000_module11_reception_owner_acl_closure.sql',
      NOW()
    );
  END IF;
END
$ledger$;

COMMIT;

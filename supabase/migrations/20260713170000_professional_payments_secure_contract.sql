-- P0 secure contract for professional payments/repasses.
-- PostgreSQL-only. This migration does not read or write DataSIGH.

DO $preflight$
BEGIN
  IF to_regclass('public.professional_payments') IS NULL
     OR to_regclass('public.professionals') IS NULL
     OR to_regclass('public.units') IS NULL
     OR to_regclass('public.user_profiles') IS NULL
     OR to_regclass('public.roles') IS NULL THEN
    RAISE EXCEPTION 'Professional payments preflight: canonical relations are missing';
  END IF;
END
$preflight$;

ALTER TABLE public.professional_payments
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS idempotency_hash TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

CREATE TABLE IF NOT EXISTS public.professional_payment_events (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID,
  professional_payment_id BIGINT,
  actor_id UUID,
  action TEXT,
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  idempotency_key UUID,
  request_hash TEXT,
  result_snapshot JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT professional_payment_events_initial_id_uq UNIQUE (id)
);

ALTER TABLE public.professional_payment_events
  ADD COLUMN IF NOT EXISTS id BIGINT,
  ADD COLUMN IF NOT EXISTS company_id UUID,
  ADD COLUMN IF NOT EXISTS professional_payment_id BIGINT,
  ADD COLUMN IF NOT EXISTS actor_id UUID,
  ADD COLUMN IF NOT EXISTS action TEXT,
  ADD COLUMN IF NOT EXISTS from_status TEXT,
  ADD COLUMN IF NOT EXISTS to_status TEXT,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS request_hash TEXT,
  ADD COLUMN IF NOT EXISTS result_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

CREATE SEQUENCE IF NOT EXISTS public.professional_payment_events_id_seq;
ALTER SEQUENCE public.professional_payment_events_id_seq
  OWNED BY public.professional_payment_events.id;
ALTER TABLE public.professional_payment_events
  ALTER COLUMN id SET DEFAULT nextval('public.professional_payment_events_id_seq'),
  ALTER COLUMN occurred_at SET DEFAULT CURRENT_TIMESTAMP;

UPDATE public.professional_payment_events AS event
   SET result_snapshot = to_jsonb(payment) || jsonb_build_object(
     'status', event.to_status,
     'dt_pago', CASE WHEN event.to_status = 'pago' THEN payment.dt_pago ELSE NULL END,
     'cancel_reason', CASE WHEN event.to_status = 'cancelado' THEN event.reason ELSE NULL END,
     'updated_by', event.actor_id,
     'updated_at', event.occurred_at
   )
  FROM public.professional_payments AS payment
 WHERE event.result_snapshot IS NULL
   AND payment.id = event.professional_payment_id
   AND payment.company_id = event.company_id;

DO $partial_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.professional_payment_events
     WHERE id IS NULL OR company_id IS NULL OR professional_payment_id IS NULL
        OR actor_id IS NULL OR action IS NULL OR to_status IS NULL
        OR idempotency_key IS NULL OR request_hash IS NULL
        OR result_snapshot IS NULL OR occurred_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Professional payment events partial object contains unrecoverable rows';
  END IF;
END
$partial_preflight$;

ALTER TABLE public.professional_payment_events
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN professional_payment_id SET NOT NULL,
  ALTER COLUMN actor_id SET NOT NULL,
  ALTER COLUMN action SET NOT NULL,
  ALTER COLUMN to_status SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN request_hash SET NOT NULL,
  ALTER COLUMN result_snapshot SET NOT NULL,
  ALTER COLUMN occurred_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS professionals_company_id_id_uq_idx
  ON public.professionals(company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS units_company_id_id_uq_idx
  ON public.units(company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS professional_payments_company_id_id_uq_idx
  ON public.professional_payments(company_id, id);

ALTER TABLE public.professional_payments
  DROP CONSTRAINT IF EXISTS professional_payments_idempotency_pair_check,
  DROP CONSTRAINT IF EXISTS professional_payments_company_idempotency_uq,
  DROP CONSTRAINT IF EXISTS professional_payments_professional_tenant_fkey,
  DROP CONSTRAINT IF EXISTS professional_payments_unit_tenant_fkey;
ALTER TABLE public.professional_payments
  ADD CONSTRAINT professional_payments_idempotency_pair_check CHECK (
    (idempotency_key IS NULL AND idempotency_hash IS NULL)
    OR (idempotency_key IS NOT NULL AND idempotency_hash IS NOT NULL
      AND length(idempotency_hash) = 32)
  ) NOT VALID,
  ADD CONSTRAINT professional_payments_company_idempotency_uq
    UNIQUE (company_id, idempotency_key),
  ADD CONSTRAINT professional_payments_professional_tenant_fkey
    FOREIGN KEY (company_id, cd_professional)
    REFERENCES public.professionals(company_id, id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT professional_payments_unit_tenant_fkey
    FOREIGN KEY (company_id, cd_unit)
    REFERENCES public.units(company_id, id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE public.professional_payment_events
  DROP CONSTRAINT IF EXISTS professional_payment_events_initial_id_uq,
  DROP CONSTRAINT IF EXISTS professional_payment_events_pkey,
  DROP CONSTRAINT IF EXISTS professional_payment_events_company_idempotency_uq,
  DROP CONSTRAINT IF EXISTS professional_payment_events_action_check,
  DROP CONSTRAINT IF EXISTS professional_payment_events_status_check,
  DROP CONSTRAINT IF EXISTS professional_payment_events_hash_check,
  DROP CONSTRAINT IF EXISTS professional_payment_events_company_fkey,
  DROP CONSTRAINT IF EXISTS professional_payment_events_payment_tenant_fkey,
  DROP CONSTRAINT IF EXISTS professional_payment_events_actor_fkey;
ALTER TABLE public.professional_payment_events
  ADD CONSTRAINT professional_payment_events_pkey PRIMARY KEY (id),
  ADD CONSTRAINT professional_payment_events_company_idempotency_uq
    UNIQUE (company_id, idempotency_key),
  ADD CONSTRAINT professional_payment_events_action_check
    CHECK (action IN ('created', 'transitioned', 'cancelled')),
  ADD CONSTRAINT professional_payment_events_status_check
    CHECK (to_status IN ('apurado', 'conferido', 'pago', 'cancelado')),
  ADD CONSTRAINT professional_payment_events_hash_check
    CHECK (length(request_hash) = 32),
  ADD CONSTRAINT professional_payment_events_company_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  ADD CONSTRAINT professional_payment_events_payment_tenant_fkey
    FOREIGN KEY (company_id, professional_payment_id)
    REFERENCES public.professional_payments(company_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT professional_payment_events_actor_fkey
    FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.professional_payments
  VALIDATE CONSTRAINT professional_payments_idempotency_pair_check;
ALTER TABLE public.professional_payments
  VALIDATE CONSTRAINT professional_payments_professional_tenant_fkey;
ALTER TABLE public.professional_payments
  VALIDATE CONSTRAINT professional_payments_unit_tenant_fkey;

CREATE INDEX IF NOT EXISTS professional_payments_tenant_list_idx
  ON public.professional_payments(company_id, dt_reference DESC, id DESC);
CREATE INDEX IF NOT EXISTS professional_payments_tenant_professional_idx
  ON public.professional_payments(company_id, cd_professional, dt_reference DESC);
CREATE INDEX IF NOT EXISTS professional_payment_events_payment_idx
  ON public.professional_payment_events(company_id, professional_payment_id, occurred_at);

DO $owner$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'professional_payments_data_owner') THEN
    CREATE ROLE professional_payments_data_owner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'professional_payments_ledger_owner') THEN
    CREATE ROLE professional_payments_ledger_owner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'professional_payments_rpc_owner') THEN
    CREATE ROLE professional_payments_rpc_owner;
  END IF;

  ALTER ROLE professional_payments_data_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ALTER ROLE professional_payments_ledger_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ALTER ROLE professional_payments_rpc_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
END
$owner$;

DO $owner_memberships$
DECLARE
  v_membership RECORD;
BEGIN
  FOR v_membership IN
    SELECT granted_role.rolname AS owner_name,
           member_role.rolname AS member_name
      FROM pg_auth_members AS membership
      JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles AS member_role ON member_role.oid = membership.member
     WHERE granted_role.rolname IN (
       'professional_payments_data_owner',
       'professional_payments_ledger_owner',
       'professional_payments_rpc_owner'
     )
  LOOP
    EXECUTE format(
      'REVOKE %I FROM %I',
      v_membership.owner_name,
      v_membership.member_name
    );
  END LOOP;
END
$owner_memberships$;

ALTER TABLE public.professional_payments OWNER TO professional_payments_data_owner;
ALTER SEQUENCE public.professional_payments_id_seq OWNER TO professional_payments_data_owner;
ALTER TABLE public.professional_payment_events OWNER TO professional_payments_ledger_owner;
ALTER SEQUENCE public.professional_payment_events_id_seq
  OWNER TO professional_payments_ledger_owner;

CREATE OR REPLACE FUNCTION public.guard_professional_payment_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'dt_pago', 'cancel_reason', 'updated_by', 'updated_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'dt_pago', 'cancel_reason', 'updated_by', 'updated_at']) THEN
    RAISE EXCEPTION 'Professional payment economic and tenant fields are immutable';
  END IF;
  IF NOT (
    (OLD.status = 'apurado' AND NEW.status = 'conferido')
    OR (OLD.status = 'conferido' AND NEW.status = 'pago')
    OR (OLD.status IN ('apurado', 'conferido') AND NEW.status = 'cancelado')
  ) THEN
    RAISE EXCEPTION 'Professional payment state transition is invalid: % -> %',
      OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'cancelado'
     AND NULLIF(trim(COALESCE(NEW.cancel_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Professional payment cancellation reason is required';
  END IF;
  IF NEW.status = 'pago' AND NEW.dt_pago IS NULL THEN
    RAISE EXCEPTION 'Professional payment paid date is required';
  END IF;
  IF NEW.status <> 'pago' AND NEW.dt_pago IS NOT NULL THEN
    RAISE EXCEPTION 'Professional payment paid date is only valid for pago';
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION public.guard_professional_payment_update()
  OWNER TO professional_payments_data_owner;
REVOKE ALL ON FUNCTION public.guard_professional_payment_update()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_professional_payment_update()
  TO professional_payments_data_owner, professional_payments_rpc_owner;

DROP TRIGGER IF EXISTS professional_payments_00_guard_update
  ON public.professional_payments;
CREATE TRIGGER professional_payments_00_guard_update
  BEFORE UPDATE ON public.professional_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_professional_payment_update();

CREATE OR REPLACE FUNCTION public.deny_professional_payment_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'Professional payment audit ledger is append-only';
END
$function$;

ALTER FUNCTION public.deny_professional_payment_event_mutation()
  OWNER TO professional_payments_ledger_owner;
REVOKE ALL ON FUNCTION public.deny_professional_payment_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deny_professional_payment_event_mutation()
  TO professional_payments_ledger_owner, professional_payments_rpc_owner;

DROP TRIGGER IF EXISTS professional_payment_events_deny_update_delete
  ON public.professional_payment_events;
CREATE TRIGGER professional_payment_events_deny_update_delete
  BEFORE UPDATE OR DELETE ON public.professional_payment_events
  FOR EACH ROW EXECUTE FUNCTION public.deny_professional_payment_event_mutation();

DROP TRIGGER IF EXISTS professional_payment_events_deny_truncate
  ON public.professional_payment_events;
CREATE TRIGGER professional_payment_events_deny_truncate
  BEFORE TRUNCATE ON public.professional_payment_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.deny_professional_payment_event_mutation();

ALTER TABLE public.professional_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.professional_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_payment_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prof_payments_select" ON public.professional_payments;
DROP POLICY IF EXISTS "prof_payments_financial" ON public.professional_payments;

DROP POLICY IF EXISTS professional_payments_rpc_actor_lookup ON public.user_profiles;
CREATE POLICY professional_payments_rpc_actor_lookup
  ON public.user_profiles FOR SELECT TO professional_payments_rpc_owner
  USING (id = (SELECT auth.uid()) AND lg_ativo = TRUE);

DROP POLICY IF EXISTS professional_payments_rpc_role_lookup ON public.roles;
CREATE POLICY professional_payments_rpc_role_lookup
  ON public.roles FOR SELECT TO professional_payments_rpc_owner
  USING (lg_ativo = TRUE);

DROP POLICY IF EXISTS professional_payments_rpc_professional_lookup ON public.professionals;
CREATE POLICY professional_payments_rpc_professional_lookup
  ON public.professionals FOR SELECT TO professional_payments_rpc_owner
  USING (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS professional_payments_rpc_unit_lookup ON public.units;
CREATE POLICY professional_payments_rpc_unit_lookup
  ON public.units FOR SELECT TO professional_payments_rpc_owner
  USING (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS professional_payments_rpc_select ON public.professional_payments;
CREATE POLICY professional_payments_rpc_select
  ON public.professional_payments FOR SELECT TO professional_payments_rpc_owner
  USING (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS professional_payments_rpc_insert ON public.professional_payments;
CREATE POLICY professional_payments_rpc_insert
  ON public.professional_payments FOR INSERT TO professional_payments_rpc_owner
  WITH CHECK (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
    AND created_by = (SELECT auth.uid())
    AND updated_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS professional_payments_rpc_update ON public.professional_payments;
CREATE POLICY professional_payments_rpc_update
  ON public.professional_payments FOR UPDATE TO professional_payments_rpc_owner
  USING (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  )
  WITH CHECK (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
    AND updated_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS professional_payment_events_rpc_select
  ON public.professional_payment_events;
CREATE POLICY professional_payment_events_rpc_select
  ON public.professional_payment_events FOR SELECT TO professional_payments_rpc_owner
  USING (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
  );

DROP POLICY IF EXISTS professional_payment_events_rpc_insert
  ON public.professional_payment_events;
CREATE POLICY professional_payment_events_rpc_insert
  ON public.professional_payment_events FOR INSERT TO professional_payments_rpc_owner
  WITH CHECK (
    company_id = (
      SELECT profile.company_id FROM public.user_profiles AS profile
       WHERE profile.id = (SELECT auth.uid()) AND profile.lg_ativo = TRUE
    )
    AND actor_id = (SELECT auth.uid())
  );

GRANT USAGE ON SCHEMA public, auth TO professional_payments_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO professional_payments_rpc_owner;
GRANT SELECT ON public.user_profiles, public.roles, public.professionals, public.units
  TO professional_payments_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON public.professional_payments
  TO professional_payments_rpc_owner;
GRANT SELECT, INSERT ON public.professional_payment_events
  TO professional_payments_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.professional_payments_id_seq,
  public.professional_payment_events_id_seq TO professional_payments_rpc_owner;

-- Remove every stale overload before recreating the three canonical RPCs. This
-- also strips inherited EXECUTE ACLs from canonical signatures on every replay.
DO $rpc_overloads$
DECLARE
  v_function REGPROCEDURE;
BEGIN
  FOR v_function IN
    SELECT procedure.oid::REGPROCEDURE
      FROM pg_proc AS procedure
      JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname IN (
         'create_professional_payment',
         'list_professional_payments',
         'transition_professional_payment'
       )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, professional_payments_rpc_owner',
      v_function
    );
    IF v_function::OID NOT IN (
      COALESCE(to_regprocedure(
        'public.create_professional_payment(uuid,bigint,bigint,date,text,integer,numeric,numeric,text,numeric,text)'
      )::OID, 0),
      COALESCE(to_regprocedure(
        'public.list_professional_payments(bigint,bigint,text,date,date,integer,integer,text)'
      )::OID, 0),
      COALESCE(to_regprocedure(
        'public.transition_professional_payment(uuid,bigint,text,text,date)'
      )::OID, 0)
    ) THEN
      EXECUTE format('DROP FUNCTION %s', v_function);
    END IF;
  END LOOP;
END
$rpc_overloads$;

CREATE OR REPLACE FUNCTION public.create_professional_payment(
  p_idempotency_key UUID,
  p_professional_id BIGINT,
  p_unit_id BIGINT,
  p_reference_date DATE,
  p_reference_description TEXT DEFAULT NULL,
  p_total_procedures INTEGER DEFAULT 0,
  p_total_value NUMERIC DEFAULT 0,
  p_total_received NUMERIC DEFAULT 0,
  p_remuneration_type TEXT DEFAULT 'PERCENTAGE',
  p_percentage NUMERIC DEFAULT 0,
  p_observation TEXT DEFAULT NULL
)
RETURNS TABLE(
  id BIGINT, company_id UUID, professional_id BIGINT, unit_id BIGINT,
  reference_date DATE, reference_description TEXT, total_procedures INTEGER,
  total_value NUMERIC, total_received NUMERIC, remuneration_type TEXT,
  percentage NUMERIC, status TEXT, paid_on DATE, observation TEXT,
  cancel_reason TEXT, created_by UUID, updated_by UUID,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_hash TEXT;
  v_payment public.professional_payments%ROWTYPE;
  v_event public.professional_payment_events%ROWTYPE;
  v_is_new BOOLEAN := FALSE;
  v_description TEXT := NULLIF(trim(p_reference_description), '');
  v_observation TEXT := NULLIF(trim(p_observation), '');
  v_remuneration TEXT := upper(trim(COALESCE(p_remuneration_type, '')));
BEGIN
  SELECT profile.id, profile.company_id, canonical_role.name AS role_name
    INTO v_actor
    FROM public.user_profiles AS profile
    JOIN public.roles AS canonical_role
      ON canonical_role.id = profile.role_id AND canonical_role.lg_ativo = TRUE
   WHERE profile.id = auth.uid() AND profile.lg_ativo = TRUE;

  IF v_actor.id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Ator autenticado sem perfil ativo e empresa';
  END IF;
  IF v_actor.role_name NOT IN ('admin', 'financeiro') THEN
    RAISE EXCEPTION 'Perfil sem permissao para criar repasse';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Chave de idempotencia e obrigatoria';
  END IF;
  IF p_reference_date IS NULL OR p_professional_id IS NULL THEN
    RAISE EXCEPTION 'Profissional e data de referencia sao obrigatorios';
  END IF;
  IF COALESCE(p_total_procedures, -1) < 0
     OR COALESCE(p_total_value, -1) < 0
     OR COALESCE(p_total_received, -1) < 0
     OR p_total_received > p_total_value THEN
    RAISE EXCEPTION 'Totais do repasse sao invalidos';
  END IF;
  IF v_remuneration NOT IN ('FIXED', 'PACKAGE', 'CH', 'PERCENTAGE') THEN
    RAISE EXCEPTION 'Tipo de remuneracao invalido';
  END IF;
  IF COALESCE(p_percentage, -1) < 0 OR p_percentage > 100 THEN
    RAISE EXCEPTION 'Percentual deve estar entre 0 e 100';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.professionals AS professional
     WHERE professional.id = p_professional_id
       AND professional.company_id = v_actor.company_id
       AND professional.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Profissional inexistente, inativo ou fora do tenant';
  END IF;
  IF p_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.units AS unit
     WHERE unit.id = p_unit_id
       AND unit.company_id = v_actor.company_id
       AND unit.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Unidade inexistente, inativa ou fora do tenant';
  END IF;

  v_hash := md5(jsonb_build_object(
    'professional_id', p_professional_id,
    'unit_id', p_unit_id,
    'reference_date', p_reference_date,
    'reference_description', v_description,
    'total_procedures', p_total_procedures,
    'total_value', round(p_total_value, 2)::TEXT,
    'total_received', round(p_total_received, 2)::TEXT,
    'remuneration_type', v_remuneration,
    'percentage', round(p_percentage, 2)::TEXT,
    'observation', v_observation
  )::TEXT);

  INSERT INTO public.professional_payments (
    company_id, cd_professional, cd_unit, dt_reference, ds_reference,
    total_procedures, total_value, total_received, tp_remuneration,
    percentage, status, ds_observacao, lg_ativo, idempotency_key,
    idempotency_hash, created_by, updated_by
  ) VALUES (
    v_actor.company_id, p_professional_id, p_unit_id, p_reference_date, v_description,
    p_total_procedures, round(p_total_value, 2), round(p_total_received, 2),
    v_remuneration, round(p_percentage, 2), 'apurado', v_observation, TRUE,
    p_idempotency_key, v_hash, v_actor.id, v_actor.id
  )
  ON CONFLICT ON CONSTRAINT professional_payments_company_idempotency_uq DO NOTHING
  RETURNING professional_payments.* INTO v_payment;

  IF FOUND THEN
    v_is_new := TRUE;
    INSERT INTO public.professional_payment_events (
      company_id, professional_payment_id, actor_id, action, from_status,
      to_status, idempotency_key, request_hash, result_snapshot
    ) VALUES (
      v_actor.company_id, v_payment.id, v_actor.id, 'created', NULL,
      'apurado', p_idempotency_key, v_hash, to_jsonb(v_payment)
    );
  ELSE
    SELECT event.* INTO v_event
      FROM public.professional_payment_events AS event
     WHERE event.company_id = v_actor.company_id
       AND event.idempotency_key = p_idempotency_key
       AND event.action = 'created';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Falha ao resolver chave de idempotencia';
    END IF;
    IF v_event.request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'Chave de idempotencia reutilizada com payload diferente';
    END IF;
    SELECT snapshot.* INTO v_payment
      FROM jsonb_populate_record(
        NULL::public.professional_payments, v_event.result_snapshot
      ) AS snapshot;
  END IF;

  RETURN QUERY SELECT
    v_payment.id, v_payment.company_id, v_payment.cd_professional::BIGINT,
    v_payment.cd_unit::BIGINT, v_payment.dt_reference, v_payment.ds_reference::TEXT,
    v_payment.total_procedures, v_payment.total_value, v_payment.total_received,
    v_payment.tp_remuneration::TEXT, v_payment.percentage, v_payment.status::TEXT,
    v_payment.dt_pago, v_payment.ds_observacao, v_payment.cancel_reason,
    v_payment.created_by, v_payment.updated_by, v_payment.created_at,
    v_payment.updated_at, NOT v_is_new;
END
$function$;

CREATE OR REPLACE FUNCTION public.list_professional_payments(
  p_professional_id BIGINT DEFAULT NULL,
  p_unit_id BIGINT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_reference_from DATE DEFAULT NULL,
  p_reference_to DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE(
  id BIGINT, company_id UUID, professional_id BIGINT, professional_name TEXT,
  unit_id BIGINT, unit_name TEXT, reference_date DATE, reference_description TEXT,
  total_procedures INTEGER, total_value NUMERIC, total_received NUMERIC,
  remuneration_type TEXT, percentage NUMERIC, status TEXT, paid_on DATE,
  observation TEXT, cancel_reason TEXT, created_by UUID, updated_by UUID,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_status TEXT := lower(NULLIF(trim(p_status), ''));
  v_search TEXT := NULLIF(trim(p_search), '');
BEGIN
  SELECT profile.id, profile.company_id, canonical_role.name AS role_name
    INTO v_actor
    FROM public.user_profiles AS profile
    JOIN public.roles AS canonical_role
      ON canonical_role.id = profile.role_id AND canonical_role.lg_ativo = TRUE
   WHERE profile.id = auth.uid() AND profile.lg_ativo = TRUE;

  IF v_actor.id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Ator autenticado sem perfil ativo e empresa';
  END IF;
  IF v_actor.role_name NOT IN ('admin', 'financeiro') THEN
    RAISE EXCEPTION 'Perfil sem permissao para listar repasses';
  END IF;
  IF v_status IS NOT NULL
     AND v_status NOT IN ('apurado', 'conferido', 'pago', 'cancelado') THEN
    RAISE EXCEPTION 'Status de filtro invalido';
  END IF;
  IF p_reference_from IS NOT NULL AND p_reference_to IS NOT NULL
     AND p_reference_from > p_reference_to THEN
    RAISE EXCEPTION 'Intervalo de referencia invalido';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500
     OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Paginacao invalida';
  END IF;

  RETURN QUERY
  SELECT payment.id, payment.company_id, payment.cd_professional::BIGINT,
         professional.full_name::TEXT, payment.cd_unit::BIGINT,
         unit.ds_nome::TEXT, payment.dt_reference, payment.ds_reference::TEXT,
         COALESCE(payment.total_procedures, 0), payment.total_value,
         COALESCE(payment.total_received, 0),
         COALESCE(payment.tp_remuneration, 'PERCENTAGE')::TEXT,
         COALESCE(payment.percentage, 0), payment.status::TEXT,
         payment.dt_pago, payment.ds_observacao, payment.cancel_reason,
         payment.created_by, payment.updated_by, payment.created_at,
         payment.updated_at, count(*) OVER ()
    FROM public.professional_payments AS payment
    JOIN public.professionals AS professional
      ON professional.id = payment.cd_professional
     AND professional.company_id = payment.company_id
    LEFT JOIN public.units AS unit
      ON unit.id = payment.cd_unit AND unit.company_id = payment.company_id
   WHERE payment.company_id = v_actor.company_id
     AND payment.lg_ativo = TRUE
     AND (p_professional_id IS NULL OR payment.cd_professional = p_professional_id)
     AND (p_unit_id IS NULL OR payment.cd_unit = p_unit_id)
     AND (v_status IS NULL OR payment.status = v_status)
     AND (p_reference_from IS NULL OR payment.dt_reference >= p_reference_from)
     AND (p_reference_to IS NULL OR payment.dt_reference <= p_reference_to)
     AND (
       v_search IS NULL
       OR professional.full_name ILIKE '%' || v_search || '%'
       OR COALESCE(payment.ds_reference, '') ILIKE '%' || v_search || '%'
     )
   ORDER BY payment.dt_reference DESC, payment.id DESC
   LIMIT p_limit OFFSET p_offset;
END
$function$;

CREATE OR REPLACE FUNCTION public.transition_professional_payment(
  p_idempotency_key UUID,
  p_payment_id BIGINT,
  p_target_status TEXT,
  p_reason TEXT DEFAULT NULL,
  p_payment_date DATE DEFAULT NULL
)
RETURNS TABLE(
  id BIGINT, company_id UUID, professional_id BIGINT, unit_id BIGINT,
  reference_date DATE, status TEXT, paid_on DATE, cancel_reason TEXT,
  updated_by UUID, updated_at TIMESTAMPTZ, idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_payment public.professional_payments%ROWTYPE;
  v_event public.professional_payment_events%ROWTYPE;
  v_target TEXT := lower(NULLIF(trim(p_target_status), ''));
  v_reason TEXT := NULLIF(trim(p_reason), '');
  v_hash TEXT;
  v_replay BOOLEAN := FALSE;
  v_from_status TEXT;
BEGIN
  SELECT profile.id, profile.company_id, canonical_role.name AS role_name
    INTO v_actor
    FROM public.user_profiles AS profile
    JOIN public.roles AS canonical_role
      ON canonical_role.id = profile.role_id AND canonical_role.lg_ativo = TRUE
   WHERE profile.id = auth.uid() AND profile.lg_ativo = TRUE;

  IF v_actor.id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Ator autenticado sem perfil ativo e empresa';
  END IF;
  IF v_actor.role_name NOT IN ('admin', 'financeiro') THEN
    RAISE EXCEPTION 'Perfil sem permissao para transicionar repasse';
  END IF;
  IF p_idempotency_key IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'Chave de idempotencia e repasse sao obrigatorios';
  END IF;
  IF v_target NOT IN ('conferido', 'pago', 'cancelado') THEN
    RAISE EXCEPTION 'Estado de destino invalido';
  END IF;
  IF v_target = 'cancelado' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Motivo de cancelamento e obrigatorio';
  END IF;
  IF v_target <> 'cancelado' AND v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Motivo somente e aceito para cancelamento';
  END IF;
  IF length(COALESCE(v_reason, '')) > 1000 THEN
    RAISE EXCEPTION 'Motivo de cancelamento excede 1000 caracteres';
  END IF;
  IF v_target <> 'pago' AND p_payment_date IS NOT NULL THEN
    RAISE EXCEPTION 'Data de pagamento somente e aceita no estado pago';
  END IF;

  v_hash := md5(jsonb_build_object(
    'payment_id', p_payment_id, 'target_status', v_target,
    'reason', v_reason, 'payment_date', p_payment_date
  )::TEXT);

  SELECT event.* INTO v_event
    FROM public.professional_payment_events AS event
   WHERE event.company_id = v_actor.company_id
     AND event.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_event.request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'Chave de idempotencia reutilizada com payload diferente';
    END IF;
    SELECT snapshot.* INTO v_payment
      FROM jsonb_populate_record(
        NULL::public.professional_payments, v_event.result_snapshot
      ) AS snapshot;
    v_replay := TRUE;
  ELSE
    SELECT payment.* INTO v_payment
      FROM public.professional_payments AS payment
     WHERE payment.id = p_payment_id
       AND payment.company_id = v_actor.company_id
       AND payment.lg_ativo = TRUE
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Repasse inexistente, inativo ou fora do tenant';
    END IF;

    SELECT event.* INTO v_event
      FROM public.professional_payment_events AS event
     WHERE event.company_id = v_actor.company_id
       AND event.idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_event.request_hash IS DISTINCT FROM v_hash THEN
        RAISE EXCEPTION 'Chave de idempotencia reutilizada com payload diferente';
      END IF;
      SELECT snapshot.* INTO v_payment
        FROM jsonb_populate_record(
          NULL::public.professional_payments, v_event.result_snapshot
        ) AS snapshot;
      v_replay := TRUE;
    ELSE
      IF NOT (
        (v_payment.status = 'apurado' AND v_target = 'conferido')
        OR (v_payment.status = 'conferido' AND v_target = 'pago')
        OR (v_payment.status IN ('apurado', 'conferido') AND v_target = 'cancelado')
      ) THEN
        RAISE EXCEPTION 'Transicao de estado invalida: % -> %', v_payment.status, v_target;
      END IF;

      v_from_status := v_payment.status;

      UPDATE public.professional_payments AS payment
         SET status = v_target,
             dt_pago = CASE WHEN v_target = 'pago'
                            THEN COALESCE(
                              p_payment_date,
                              timezone('America/Sao_Paulo', CURRENT_TIMESTAMP)::DATE
                            )
                            ELSE NULL END,
             cancel_reason = CASE WHEN v_target = 'cancelado' THEN v_reason ELSE NULL END,
             updated_by = v_actor.id,
             updated_at = CURRENT_TIMESTAMP
       WHERE payment.id = v_payment.id
       RETURNING payment.* INTO v_payment;

      INSERT INTO public.professional_payment_events (
        company_id, professional_payment_id, actor_id, action, from_status,
        to_status, reason, idempotency_key, request_hash, result_snapshot
      ) VALUES (
        v_actor.company_id, v_payment.id, v_actor.id,
        CASE WHEN v_target = 'cancelado' THEN 'cancelled' ELSE 'transitioned' END,
        v_from_status, v_target, v_reason, p_idempotency_key, v_hash,
        to_jsonb(v_payment)
      );
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_payment.id, v_payment.company_id, v_payment.cd_professional::BIGINT,
    v_payment.cd_unit::BIGINT, v_payment.dt_reference, v_payment.status::TEXT,
    v_payment.dt_pago, v_payment.cancel_reason, v_payment.updated_by,
    v_payment.updated_at, v_replay;
END
$function$;

ALTER FUNCTION public.create_professional_payment(
  UUID, BIGINT, BIGINT, DATE, TEXT, INTEGER, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT
) OWNER TO professional_payments_rpc_owner;
ALTER FUNCTION public.list_professional_payments(
  BIGINT, BIGINT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT
) OWNER TO professional_payments_rpc_owner;
ALTER FUNCTION public.transition_professional_payment(UUID, BIGINT, TEXT, TEXT, DATE)
  OWNER TO professional_payments_rpc_owner;

REVOKE ALL ON FUNCTION public.create_professional_payment(
  UUID, BIGINT, BIGINT, DATE, TEXT, INTEGER, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT
) FROM PUBLIC, anon, authenticated, service_role, professional_payments_rpc_owner;
REVOKE ALL ON FUNCTION public.list_professional_payments(
  BIGINT, BIGINT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated, service_role, professional_payments_rpc_owner;
REVOKE ALL ON FUNCTION public.transition_professional_payment(UUID, BIGINT, TEXT, TEXT, DATE)
  FROM PUBLIC, anon, authenticated, service_role, professional_payments_rpc_owner;

GRANT EXECUTE ON FUNCTION public.create_professional_payment(
  UUID, BIGINT, BIGINT, DATE, TEXT, INTEGER, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_professional_payments(
  BIGINT, BIGINT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_professional_payment(UUID, BIGINT, TEXT, TEXT, DATE)
  TO authenticated, service_role;

REVOKE ALL ON public.professional_payments, public.professional_payment_events
  FROM PUBLIC, anon, authenticated, service_role, professional_payments_rpc_owner;
REVOKE ALL ON SEQUENCE public.professional_payments_id_seq,
  public.professional_payment_events_id_seq
  FROM PUBLIC, anon, authenticated, service_role, professional_payments_rpc_owner;

GRANT SELECT, INSERT, UPDATE ON public.professional_payments
  TO professional_payments_rpc_owner;
GRANT SELECT, INSERT ON public.professional_payment_events
  TO professional_payments_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.professional_payments_id_seq,
  public.professional_payment_events_id_seq TO professional_payments_rpc_owner;

COMMENT ON TABLE public.professional_payment_events IS
  'Append-only audit and idempotency ledger for professional payment RPC mutations.';
COMMENT ON FUNCTION public.create_professional_payment(
  UUID, BIGINT, BIGINT, DATE, TEXT, INTEGER, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT
) IS 'Creates an apurado payment for the auth.uid tenant after canonical admin/financeiro authorization.';
COMMENT ON FUNCTION public.list_professional_payments(
  BIGINT, BIGINT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT
) IS 'Lists only the auth.uid tenant payments for canonical admin/financeiro roles, with optional server-side search.';
COMMENT ON FUNCTION public.transition_professional_payment(UUID, BIGINT, TEXT, TEXT, DATE)
  IS 'Idempotent state machine: apurado->conferido->pago, or cancel from apurado/conferido with a reason.';


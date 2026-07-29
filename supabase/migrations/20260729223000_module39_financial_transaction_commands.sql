-- Module 39: canonical commands for creating and settling receivables.
-- Browser users keep read-only table access; all writes pass through these RPCs.

BEGIN;

DO $requirements$
BEGIN
  IF to_regclass('public.financial_transactions') IS NULL
     OR to_regclass('public.billings') IS NULL
     OR to_regclass('public.billing_accounts') IS NULL
     OR to_regclass('public.patients') IS NULL
     OR to_regclass('public.professionals') IS NULL
     OR to_regclass('public.professional_schedule_grades') IS NULL
     OR to_regclass('public.user_profiles') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL
     OR to_regprocedure('public.active_unit_id()') IS NULL
     OR to_regprocedure('public.digest(bytea,text)') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('public.audit_trigger_func()') IS NULL
     OR to_regprocedure('public.finalize_attendance_secure(bigint,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.sync_completed_appointment_billing_secure(bigint,text)') IS NULL
     OR to_regrole('prontomedic_reception_rpc_owner') IS NULL THEN
    RAISE EXCEPTION 'Module 39 financial command dependencies are missing';
  END IF;
END
$requirements$;

DO $owner$
DECLARE
  v_executor_is_superuser BOOLEAN;
BEGIN
  SELECT rolsuper INTO v_executor_is_superuser
  FROM pg_roles
  WHERE rolname = CURRENT_USER;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'prontomedic_financial_rpc_owner'
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION
        'Module 39 requires a superuser to create prontomedic_financial_rpc_owner';
    END IF;
    EXECUTE
      'CREATE ROLE prontomedic_financial_rpc_owner NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'prontomedic_financial_rpc_owner'
      AND (
        rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper
        OR rolcreatedb OR rolcreaterole OR rolreplication
      )
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION
        'Module 39 cannot harden prontomedic_financial_rpc_owner without a superuser';
    END IF;
    EXECUTE
      'ALTER ROLE prontomedic_financial_rpc_owner NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid = membership.member
    JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
    WHERE member_role.rolname = 'prontomedic_financial_rpc_owner'
       OR granted_role.rolname = 'prontomedic_financial_rpc_owner'
  ) THEN
    RAISE EXCEPTION
      'prontomedic_financial_rpc_owner must not have role memberships';
  END IF;
END
$owner$;

GRANT USAGE ON SCHEMA public, auth TO prontomedic_financial_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO prontomedic_financial_rpc_owner;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO prontomedic_financial_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_unit_id()
  TO prontomedic_financial_rpc_owner;
GRANT EXECUTE ON FUNCTION public.digest(BYTEA, TEXT)
  TO prontomedic_financial_rpc_owner;
GRANT SELECT ON TABLE public.patients, public.professionals,
  public.professional_schedule_grades, public.user_profiles
  TO prontomedic_financial_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON TABLE public.financial_transactions
  TO prontomedic_financial_rpc_owner;
GRANT SELECT, INSERT ON TABLE public.billings, public.billing_accounts
  TO prontomedic_financial_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.financial_transactions_id_seq
  TO prontomedic_financial_rpc_owner;
GRANT EXECUTE ON FUNCTION public.m18_can_edit_attendance()
  TO prontomedic_reception_rpc_owner;
GRANT UPDATE ON TABLE public.appointments
  TO prontomedic_reception_rpc_owner;

DROP POLICY IF EXISTS appointments_reception_billing_lock
  ON public.appointments;
CREATE POLICY appointments_reception_billing_lock
  ON public.appointments
  FOR ALL TO prontomedic_reception_rpc_owner
  USING (TRUE)
  WITH CHECK (TRUE);

ALTER TABLE public.billings
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS billing_type TEXT,
  ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS professional_id BIGINT,
  ADD COLUMN IF NOT EXISTS command_operation TEXT,
  ADD COLUMN IF NOT EXISTS command_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS command_request_hash TEXT;

DO $billing_command_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.billings'::regclass
      AND conname = 'billings_command_key_chk'
  ) THEN
    ALTER TABLE public.billings
      ADD CONSTRAINT billings_command_key_chk CHECK (
        command_idempotency_key IS NULL
        OR (
          command_operation IS NOT NULL
          AND command_request_hash ~ '^[0-9a-f]{64}$'
        )
      ) NOT VALID;
    ALTER TABLE public.billings
      VALIDATE CONSTRAINT billings_command_key_chk;
  END IF;
END
$billing_command_constraint$;

CREATE UNIQUE INDEX IF NOT EXISTS billings_command_operation_key_uq
  ON public.billings(company_id, command_operation, command_idempotency_key)
  WHERE command_idempotency_key IS NOT NULL;

ALTER TABLE public.billings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billings FORCE ROW LEVEL SECURITY;

DO $billing_sequence$
DECLARE
  v_sequence TEXT;
BEGIN
  SELECT pg_get_serial_sequence('public.billings', 'id') INTO v_sequence;
  IF v_sequence IS NOT NULL THEN
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE %s TO prontomedic_financial_rpc_owner',
      v_sequence
    );
  END IF;
END
$billing_sequence$;

DROP POLICY IF EXISTS patients_financial_rpc_select ON public.patients;
CREATE POLICY patients_financial_rpc_select
  ON public.patients
  FOR SELECT TO prontomedic_financial_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );

DROP POLICY IF EXISTS professionals_financial_rpc_select ON public.professionals;
CREATE POLICY professionals_financial_rpc_select
  ON public.professionals
  FOR SELECT TO prontomedic_financial_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND lg_ativo = TRUE
  );

DROP POLICY IF EXISTS professional_grades_financial_rpc_select
  ON public.professional_schedule_grades;
CREATE POLICY professional_grades_financial_rpc_select
  ON public.professional_schedule_grades
  FOR SELECT TO prontomedic_financial_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );

DROP POLICY IF EXISTS user_profiles_financial_rpc_select ON public.user_profiles;
CREATE POLICY user_profiles_financial_rpc_select
  ON public.user_profiles
  FOR SELECT TO prontomedic_financial_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND lg_ativo = TRUE
    AND (id = auth.uid() OR user_id = auth.uid())
  );

DROP POLICY IF EXISTS financial_transactions_command_access
  ON public.financial_transactions;
DROP POLICY IF EXISTS financial_transactions_command_select
  ON public.financial_transactions;
DROP POLICY IF EXISTS financial_transactions_command_insert
  ON public.financial_transactions;
DROP POLICY IF EXISTS financial_transactions_command_update
  ON public.financial_transactions;
DROP POLICY IF EXISTS financial_transactions_runtime_select
  ON public.financial_transactions;

CREATE POLICY financial_transactions_runtime_select
  ON public.financial_transactions
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles profile
      WHERE (profile.id = auth.uid() OR profile.user_id = auth.uid())
        AND profile.company_id = public.current_company_id()
        AND profile.lg_ativo = TRUE
        AND lower(COALESCE(profile.role_name, '')) IN (
          'admin','administrador','gestor','financeiro','financial'
        )
    )
  );

CREATE POLICY financial_transactions_command_select
  ON public.financial_transactions
  FOR SELECT TO prontomedic_financial_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );
CREATE POLICY financial_transactions_command_insert
  ON public.financial_transactions
  FOR INSERT TO prontomedic_financial_rpc_owner
  WITH CHECK (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );
CREATE POLICY financial_transactions_command_update
  ON public.financial_transactions
  FOR UPDATE TO prontomedic_financial_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );

DROP POLICY IF EXISTS billings_financial_command_select ON public.billings;
DROP POLICY IF EXISTS billings_financial_command_insert ON public.billings;
DROP POLICY IF EXISTS billings_financial_runtime_select ON public.billings;
DROP POLICY IF EXISTS billings_reception_command_select ON public.billings;
DROP POLICY IF EXISTS billings_reception_command_insert ON public.billings;
DROP POLICY IF EXISTS billings_reception_command_update ON public.billings;
CREATE POLICY billings_financial_runtime_select
  ON public.billings
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles profile
      WHERE (profile.id = auth.uid() OR profile.user_id = auth.uid())
        AND profile.company_id = public.current_company_id()
        AND profile.lg_ativo = TRUE
        AND lower(COALESCE(profile.role_name, '')) IN (
          'admin','administrador','gestor','financeiro','financial'
        )
    )
  );
CREATE POLICY billings_financial_command_select
  ON public.billings
  FOR SELECT TO prontomedic_financial_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );
CREATE POLICY billings_financial_command_insert
  ON public.billings
  FOR INSERT TO prontomedic_financial_rpc_owner
  WITH CHECK (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );
CREATE POLICY billings_reception_command_select
  ON public.billings
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );
CREATE POLICY billings_reception_command_insert
  ON public.billings
  FOR INSERT TO prontomedic_reception_rpc_owner
  WITH CHECK (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );
CREATE POLICY billings_reception_command_update
  ON public.billings
  FOR UPDATE TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );

DROP POLICY IF EXISTS billing_accounts_financial_command_select
  ON public.billing_accounts;
DROP POLICY IF EXISTS billing_accounts_financial_command_insert
  ON public.billing_accounts;
CREATE POLICY billing_accounts_financial_command_select
  ON public.billing_accounts
  FOR SELECT TO prontomedic_financial_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );
CREATE POLICY billing_accounts_financial_command_insert
  ON public.billing_accounts
  FOR INSERT TO prontomedic_financial_rpc_owner
  WITH CHECK (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
  );

DROP TRIGGER IF EXISTS trg_audit_financial_transactions
  ON public.financial_transactions;
CREATE TRIGGER trg_audit_financial_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

REVOKE INSERT, UPDATE, DELETE ON TABLE public.billings
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT SELECT ON TABLE public.billings TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.create_financial_receivable_secure(
  p_patient_id BIGINT,
  p_amount NUMERIC,
  p_due_date DATE,
  p_payment_method TEXT,
  p_notes TEXT,
  p_idempotency_key TEXT
)
RETURNS public.financial_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = on
AS $function$
DECLARE
  v_company_id UUID := public.current_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_method TEXT := NULLIF(trim(COALESCE(p_payment_method, '')), '');
  v_hash TEXT;
  v_constraint_name TEXT;
  v_row public.financial_transactions%ROWTYPE;
BEGIN
  IF v_company_id IS NULL OR v_unit_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Contexto financeiro exige empresa e unidade ativas'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE (profile.id = auth.uid() OR profile.user_id = auth.uid())
      AND profile.company_id = v_company_id
      AND profile.lg_ativo = TRUE
      AND lower(COALESCE(profile.role_name, '')) IN (
        'admin','administrador','gestor','financeiro','financial'
      )
  ) THEN
    RAISE EXCEPTION 'Perfil financeiro inválido para a empresa ativa'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 9999999999.99 THEN
    RAISE EXCEPTION 'Valor da cobrança inválido';
  END IF;
  IF p_idempotency_key IS NULL
     OR length(p_idempotency_key) NOT BETWEEN 8 AND 120
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'Chave de idempotência inválida';
  END IF;
  IF v_method IS NOT NULL AND v_method NOT IN (
    'dinheiro','pix','cartao_debito','cartao_credito',
    'transferencia','convenio'
  ) THEN
    RAISE EXCEPTION 'Forma de pagamento inválida';
  END IF;
  PERFORM 1
    FROM public.patients patient
    WHERE patient.id = p_patient_id
      AND patient.company_id = v_company_id
      AND patient.unit_id = v_unit_id
      AND patient.lg_ativo = TRUE
    FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  v_hash := encode(public.digest(convert_to(
    jsonb_build_object(
      'patient_id', p_patient_id,
      'amount', round(p_amount, 2),
      'due_date', p_due_date,
      'payment_method', v_method,
      'notes', NULLIF(trim(COALESCE(p_notes, '')), '')
    )::TEXT,
    'UTF8'
  ), 'sha256'), 'hex');

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_company_id::TEXT || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO v_row
  FROM public.financial_transactions transaction_record
  WHERE transaction_record.company_id = v_company_id
    AND transaction_record.unit_id = v_unit_id
    AND transaction_record.checkin_operation = 'financial_manual_receivable'
    AND transaction_record.checkin_idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_row.checkin_request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'Chave de idempotência reutilizada com outro conteúdo';
    END IF;
    RETURN v_row;
  END IF;

  BEGIN
    INSERT INTO public.financial_transactions (
      company_id, unit_id, patient_id, status, tipo, notes, description,
      amount, total, payment_method, due_date, total_amount, paid_amount,
      net_amount, checkin_operation, checkin_idempotency_key,
      checkin_request_hash
    )
    VALUES (
      v_company_id, v_unit_id, p_patient_id, 'pendente', 'receivable',
      NULLIF(trim(COALESCE(p_notes, '')), ''),
      'Cobrança registrada pelo Financeiro',
      round(p_amount, 2), round(p_amount, 2), v_method, p_due_date,
      round(p_amount, 2), 0, round(p_amount, 2),
      'financial_manual_receivable', p_idempotency_key, v_hash
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name = 'financial_transactions_checkin_operation_key_uq' THEN
      RAISE EXCEPTION 'Chave de idempotência já utilizada em outro contexto';
    END IF;
    RAISE;
  END;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_manual_billing_secure(
  p_patient_id BIGINT,
  p_professional_id BIGINT,
  p_billing_type TEXT,
  p_gross_amount NUMERIC,
  p_discount NUMERIC,
  p_net_amount NUMERIC,
  p_notes TEXT,
  p_idempotency_key TEXT
)
RETURNS public.billings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = on
AS $function$
DECLARE
  v_company_id UUID := public.current_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_billing_type TEXT := lower(trim(COALESCE(p_billing_type, '')));
  v_hash TEXT;
  v_account_id UUID;
  v_constraint_name TEXT;
  v_row public.billings%ROWTYPE;
BEGIN
  IF v_company_id IS NULL OR v_unit_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Contexto financeiro exige empresa e unidade ativas'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE (profile.id = auth.uid() OR profile.user_id = auth.uid())
      AND profile.company_id = v_company_id
      AND profile.lg_ativo = TRUE
      AND lower(COALESCE(profile.role_name, '')) IN (
        'admin','administrador','gestor','financeiro','financial'
      )
  ) THEN
    RAISE EXCEPTION 'Perfil financeiro inválido para a empresa ativa'
      USING ERRCODE = '42501';
  END IF;
  IF v_billing_type NOT IN ('particular', 'convenio', 'retorno') THEN
    RAISE EXCEPTION 'Tipo de faturamento inválido';
  END IF;
  IF p_gross_amount IS NULL OR p_gross_amount <= 0
     OR p_gross_amount > 9999999999.99
     OR COALESCE(p_discount, 0) < 0
     OR COALESCE(p_discount, 0) > p_gross_amount
     OR p_net_amount IS NULL
     OR round(p_net_amount, 2) <> round(p_gross_amount - COALESCE(p_discount, 0), 2) THEN
    RAISE EXCEPTION 'Valores do faturamento são inválidos';
  END IF;
  IF p_idempotency_key IS NULL
     OR length(p_idempotency_key) NOT BETWEEN 8 AND 120
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'Chave de idempotência inválida';
  END IF;

  PERFORM 1
    FROM public.patients patient
   WHERE patient.id = p_patient_id
     AND patient.company_id = v_company_id
     AND patient.unit_id = v_unit_id
     AND patient.lg_ativo = TRUE
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_professional_id IS NOT NULL THEN
    PERFORM 1
      FROM public.professionals professional
     WHERE professional.id = p_professional_id
       AND professional.company_id = v_company_id
       AND professional.lg_ativo = TRUE
     FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profissional não encontrado na empresa ativa'
        USING ERRCODE = 'P0002';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.professional_schedule_grades grade
      WHERE grade.company_id = v_company_id
        AND grade.unit_id = v_unit_id
        AND grade.professional_id = p_professional_id
        AND grade.status IN ('published', 'active')
        AND grade.valid_from <= CURRENT_DATE
        AND (grade.valid_until IS NULL OR grade.valid_until >= CURRENT_DATE)
    ) THEN
      RAISE EXCEPTION 'Profissional não está habilitado na unidade ativa'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_hash := encode(public.digest(convert_to(
    jsonb_build_object(
      'patient_id', p_patient_id,
      'professional_id', p_professional_id,
      'billing_type', v_billing_type,
      'gross_amount', round(p_gross_amount, 2),
      'discount', round(COALESCE(p_discount, 0), 2),
      'net_amount', round(p_net_amount, 2),
      'notes', NULLIF(trim(COALESCE(p_notes, '')), '')
    )::TEXT,
    'UTF8'
  ), 'sha256'), 'hex');

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_company_id::TEXT || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO v_row
    FROM public.billings billing
   WHERE billing.company_id = v_company_id
     AND billing.unit_id = v_unit_id
     AND billing.command_operation = 'financial_manual_billing'
     AND billing.command_idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_row.command_request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'Chave de idempotência reutilizada com outro conteúdo';
    END IF;
    RETURN v_row;
  END IF;

  INSERT INTO public.billing_accounts (
    company_id, unit_id, patient_id, billing_type, account_type, status,
    competence_month, total_gross_amount, total_net_amount,
    total_pending_amount
  ) VALUES (
    v_company_id, v_unit_id, p_patient_id,
    CASE WHEN v_billing_type = 'convenio' THEN 'convenio' ELSE 'particular' END,
    'ambulatorial',
    CASE WHEN v_billing_type = 'convenio' THEN 'aberta' ELSE 'particular_pendente' END,
    date_trunc('month', CURRENT_DATE)::DATE,
    round(p_gross_amount, 2), round(p_net_amount, 2), round(p_net_amount, 2)
  )
  RETURNING id INTO v_account_id;

  BEGIN
    INSERT INTO public.billings (
      company_id, unit_id, patient_id, professional_id, billing_type,
      amount, discount, total, status, notes, billing_account_id, command_operation,
      command_idempotency_key, command_request_hash
    ) VALUES (
      v_company_id, v_unit_id, p_patient_id, p_professional_id, v_billing_type,
      round(p_gross_amount, 2), round(COALESCE(p_discount, 0), 2),
      round(p_net_amount, 2), 'em_aberto',
      NULLIF(trim(COALESCE(p_notes, '')), ''), v_account_id,
      'financial_manual_billing',
      p_idempotency_key, v_hash
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name = 'billings_command_operation_key_uq' THEN
      RAISE EXCEPTION 'Chave de idempotência já utilizada em outro contexto';
    END IF;
    RAISE;
  END;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_attendance_with_billing_secure(
  p_appointment_id BIGINT,
  p_anamnesis TEXT DEFAULT NULL,
  p_evolution TEXT DEFAULT NULL,
  p_vital_signs JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_record JSONB;
BEGIN
  v_record := public.finalize_attendance_secure(
    p_appointment_id,
    p_anamnesis,
    p_evolution,
    p_vital_signs
  );

  PERFORM public.sync_completed_appointment_billing_secure(
    p_appointment_id,
    'Faturamento consolidado na finalização do atendimento'
  );

  RETURN v_record;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_financial_transaction_secure(
  p_transaction_id BIGINT,
  p_payment_method TEXT
)
RETURNS public.financial_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = on
AS $function$
DECLARE
  v_company_id UUID := public.current_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_method TEXT := trim(COALESCE(p_payment_method, ''));
  v_paid_amount NUMERIC;
  v_row public.financial_transactions%ROWTYPE;
BEGIN
  IF v_company_id IS NULL OR v_unit_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Contexto financeiro exige empresa e unidade ativas'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE (profile.id = auth.uid() OR profile.user_id = auth.uid())
      AND profile.company_id = v_company_id
      AND profile.lg_ativo = TRUE
      AND lower(COALESCE(profile.role_name, '')) IN (
        'admin','administrador','gestor','financeiro','financial'
      )
  ) THEN
    RAISE EXCEPTION 'Perfil financeiro inválido para a empresa ativa'
      USING ERRCODE = '42501';
  END IF;
  IF v_method NOT IN (
    'dinheiro','pix','cartao_debito','cartao_credito',
    'transferencia','convenio'
  ) THEN
    RAISE EXCEPTION 'Forma de pagamento inválida';
  END IF;

  SELECT * INTO v_row
  FROM public.financial_transactions transaction_record
  WHERE transaction_record.id = p_transaction_id
    AND transaction_record.company_id = v_company_id
    AND transaction_record.unit_id = v_unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobrança não encontrada no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_row.lg_cancelado IS TRUE OR v_row.status = 'cancelado' THEN
    RAISE EXCEPTION 'Cobrança cancelada não pode ser liquidada';
  END IF;
  IF v_row.status = 'pago' THEN
    IF v_row.payment_method IS DISTINCT FROM v_method THEN
      RAISE EXCEPTION 'Cobrança já liquidada com outra forma de pagamento';
    END IF;
    RETURN v_row;
  END IF;
  IF v_row.status NOT IN ('pendente', 'em_aberto') THEN
    RAISE EXCEPTION 'Estado da cobrança não permite liquidação';
  END IF;

  v_paid_amount := COALESCE(
    NULLIF(v_row.net_amount, 0),
    NULLIF(v_row.total_amount, 0),
    NULLIF(v_row.total, 0),
    NULLIF(v_row.amount, 0)
  );
  IF v_paid_amount IS NULL OR v_paid_amount <= 0 THEN
    RAISE EXCEPTION 'Cobrança sem saldo positivo não pode ser liquidada';
  END IF;

  UPDATE public.financial_transactions transaction_record
  SET status = 'pago',
      payment_method = v_method,
      payment_date = CURRENT_DATE,
      paid_at = now(),
      paid_amount = v_paid_amount,
      updated_at = now()
  WHERE transaction_record.id = v_row.id
    AND transaction_record.company_id = v_company_id
    AND transaction_record.unit_id = v_unit_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

ALTER FUNCTION public.create_financial_receivable_secure(
  BIGINT, NUMERIC, DATE, TEXT, TEXT, TEXT
) OWNER TO prontomedic_financial_rpc_owner;
ALTER FUNCTION public.create_manual_billing_secure(
  BIGINT, BIGINT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT
) OWNER TO prontomedic_financial_rpc_owner;
ALTER FUNCTION public.settle_financial_transaction_secure(
  BIGINT, TEXT
) OWNER TO prontomedic_financial_rpc_owner;

REVOKE ALL ON FUNCTION public.create_financial_receivable_secure(
  BIGINT, NUMERIC, DATE, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_manual_billing_secure(
  BIGINT, BIGINT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_financial_transaction_secure(
  BIGINT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_attendance_with_billing_secure(
  BIGINT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_financial_receivable_secure(
  BIGINT, NUMERIC, DATE, TEXT, TEXT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.create_manual_billing_secure(
  BIGINT, BIGINT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.settle_financial_transaction_secure(
  BIGINT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.finalize_attendance_with_billing_secure(
  BIGINT, TEXT, TEXT, JSONB
) TO authenticated, app_prontomedic;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260729223000_module39_financial_transaction_commands.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

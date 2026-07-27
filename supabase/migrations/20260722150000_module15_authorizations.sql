-- Módulo 15: autorizações centralizadas, tenant-aware e auditáveis.
-- Complementa insurance_authorizations existente; não cria uma segunda fonte
-- para reception_authorizations, que permanece como view de compatibilidade.

BEGIN;

ALTER TABLE public.insurance_authorizations
  ADD COLUMN IF NOT EXISTS request_reference TEXT,
  ADD COLUMN IF NOT EXISTS procedure_code TEXT,
  ADD COLUMN IF NOT EXISTS diagnosis_code TEXT,
  ADD COLUMN IF NOT EXISTS justification TEXT,
  ADD COLUMN IF NOT EXISTS valid_from DATE,
  ADD COLUMN IF NOT EXISTS requested_by UUID,
  ADD COLUMN IF NOT EXISTS requested_professional_id BIGINT,
  ADD COLUMN IF NOT EXISTS renewal_of_id UUID,
  ADD COLUMN IF NOT EXISTS extension_of_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'insurance_authorizations_renewal_fk'
      AND conrelid = 'public.insurance_authorizations'::regclass
  ) THEN
    ALTER TABLE public.insurance_authorizations
      ADD CONSTRAINT insurance_authorizations_renewal_fk
      FOREIGN KEY (renewal_of_id) REFERENCES public.insurance_authorizations(id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'insurance_authorizations_extension_fk'
      AND conrelid = 'public.insurance_authorizations'::regclass
  ) THEN
    ALTER TABLE public.insurance_authorizations
      ADD CONSTRAINT insurance_authorizations_extension_fk
      FOREIGN KEY (extension_of_id) REFERENCES public.insurance_authorizations(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.insurance_authorization_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  authorization_id UUID NOT NULL REFERENCES public.insurance_authorizations(id) ON DELETE RESTRICT,
  event_type VARCHAR(40) NOT NULL,
  from_status VARCHAR(40),
  to_status VARCHAR(40),
  quantity_requested INTEGER,
  quantity_authorized INTEGER,
  quantity_used INTEGER,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT insurance_authorization_events_type_chk CHECK (event_type IN (
    'requested','updated','protocol_updated','authorized','partially_authorized',
    'denied','renewed','extended','quantity_updated','cancelled','note'
  )),
  CONSTRAINT insurance_authorization_events_quantity_chk CHECK (
    COALESCE(quantity_requested, 0) >= 0
    AND COALESCE(quantity_authorized, 0) >= 0
    AND COALESCE(quantity_used, 0) >= 0
  )
);

CREATE TABLE IF NOT EXISTS public.insurance_authorization_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  authorization_id UUID NOT NULL REFERENCES public.insurance_authorizations(id) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  file_size BIGINT,
  checksum TEXT,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT insurance_authorization_attachments_path_chk CHECK (
    storage_path <> '' AND storage_path NOT LIKE '%://%' AND storage_path NOT LIKE '/%'
  ),
  CONSTRAINT insurance_authorization_attachments_size_chk CHECK (file_size IS NULL OR file_size >= 0)
);

CREATE INDEX IF NOT EXISTS idx_insurance_authorizations_request
  ON public.insurance_authorizations(company_id, request_reference);
CREATE INDEX IF NOT EXISTS idx_insurance_authorizations_validity
  ON public.insurance_authorizations(company_id, valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_insurance_authorization_events_authorization
  ON public.insurance_authorization_events(company_id, authorization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_authorization_attachments_authorization
  ON public.insurance_authorization_attachments(company_id, authorization_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.m15_can_operate_authorizations()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT lower(COALESCE(role_name, '')) IN (
    'admin','administrador','recepcao','recepção','reception',
    'gestor','gerente','medico','médico','financeiro','faturista'
  ) FROM public.get_scheduling_actor()), FALSE)
$$;

ALTER TABLE public.insurance_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_authorizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_authorization_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_authorization_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_authorization_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_authorization_attachments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS insurance_authorizations_tenant ON public.insurance_authorizations;
DROP POLICY IF EXISTS m15_authorizations_select ON public.insurance_authorizations;
DROP POLICY IF EXISTS m15_authorizations_insert ON public.insurance_authorizations;
DROP POLICY IF EXISTS m15_authorizations_update ON public.insurance_authorizations;
CREATE POLICY m15_authorizations_select ON public.insurance_authorizations
  FOR SELECT TO authenticated, app_prontomedic
  USING (company_id = public.current_company_id());
-- Escritas passam pelos RPCs abaixo para impedir company_id forjado e manter auditoria.
CREATE POLICY m15_authorizations_insert ON public.insurance_authorizations
  FOR INSERT TO authenticated, app_prontomedic WITH CHECK (FALSE);
CREATE POLICY m15_authorizations_update ON public.insurance_authorizations
  FOR UPDATE TO authenticated, app_prontomedic USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS m15_authorization_events_select ON public.insurance_authorization_events;
CREATE POLICY m15_authorization_events_select ON public.insurance_authorization_events
  FOR SELECT TO authenticated, app_prontomedic
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS m15_authorization_attachments_select ON public.insurance_authorization_attachments;
CREATE POLICY m15_authorization_attachments_select ON public.insurance_authorization_attachments
  FOR SELECT TO authenticated, app_prontomedic
  USING (company_id = public.current_company_id() AND deleted_at IS NULL);

REVOKE ALL ON public.insurance_authorization_events, public.insurance_authorization_attachments FROM PUBLIC, anon;
GRANT SELECT ON public.insurance_authorization_events, public.insurance_authorization_attachments TO authenticated, app_prontomedic;
GRANT SELECT ON public.insurance_authorizations TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.m15_authorization_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_event VARCHAR(40);
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event := CASE WHEN NEW.renewal_of_id IS NOT NULL THEN 'renewed'
                    WHEN NEW.extension_of_id IS NOT NULL THEN 'extended'
                    ELSE 'requested' END;
    INSERT INTO public.insurance_authorization_events(
      company_id, authorization_id, event_type, to_status,
      quantity_requested, quantity_authorized, quantity_used, reason, actor_user_id
    ) VALUES (
      NEW.company_id, NEW.id, v_event, NEW.status,
      NEW.quantity_requested, NEW.quantity_authorized, NEW.quantity_used,
      NEW.justification, COALESCE(v_actor, NEW.created_by)
    );
    RETURN NEW;
  END IF;

  v_event := CASE
    WHEN OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'autorizada' THEN 'authorized'
    WHEN OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'parcialmente_autorizada' THEN 'partially_authorized'
    WHEN OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'negada' THEN 'denied'
    WHEN OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelada' THEN 'cancelled'
    WHEN OLD.protocol_number IS DISTINCT FROM NEW.protocol_number THEN 'protocol_updated'
    WHEN OLD.quantity_used IS DISTINCT FROM NEW.quantity_used
      OR OLD.quantity_authorized IS DISTINCT FROM NEW.quantity_authorized THEN 'quantity_updated'
    ELSE 'updated'
  END;
  INSERT INTO public.insurance_authorization_events(
    company_id, authorization_id, event_type, from_status, to_status,
    quantity_requested, quantity_authorized, quantity_used, reason, metadata, actor_user_id
  ) VALUES (
    NEW.company_id, NEW.id, v_event, OLD.status, NEW.status,
    NEW.quantity_requested, NEW.quantity_authorized, NEW.quantity_used,
    CASE WHEN NEW.status = 'negada' THEN NEW.denial_reason ELSE NEW.justification END,
    jsonb_build_object('protocol_changed', OLD.protocol_number IS DISTINCT FROM NEW.protocol_number,
                       'authorization_changed', OLD.authorization_number IS DISTINCT FROM NEW.authorization_number),
    COALESCE(v_actor, NEW.updated_by)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_m15_authorization_audit ON public.insurance_authorizations;
CREATE TRIGGER trg_m15_authorization_audit
  AFTER INSERT OR UPDATE ON public.insurance_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.m15_authorization_audit();

CREATE OR REPLACE FUNCTION public.create_insurance_authorization_secure(
  p_patient_id BIGINT DEFAULT NULL,
  p_appointment_id BIGINT DEFAULT NULL,
  p_insurance_id INTEGER DEFAULT NULL,
  p_insurance_plan_id INTEGER DEFAULT NULL,
  p_procedure_id BIGINT DEFAULT NULL,
  p_procedure_code TEXT DEFAULT NULL,
  p_procedure_desc TEXT DEFAULT NULL,
  p_request_reference TEXT DEFAULT NULL,
  p_requested_professional_id BIGINT DEFAULT NULL,
  p_diagnosis_code TEXT DEFAULT NULL,
  p_justification TEXT DEFAULT NULL,
  p_quantity_requested INTEGER DEFAULT 1,
  p_valid_from DATE DEFAULT NULL,
  p_valid_until DATE DEFAULT NULL
)
RETURNS public.insurance_authorizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_row public.insurance_authorizations;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL OR NOT public.m15_can_operate_authorizations() THEN
    RAISE EXCEPTION 'Usuario sem permissao para solicitar autorizacao';
  END IF;
  IF COALESCE(p_quantity_requested, 0) <= 0 THEN RAISE EXCEPTION 'Quantidade solicitada deve ser positiva'; END IF;
  IF p_valid_until IS NOT NULL AND p_valid_from IS NOT NULL AND p_valid_until < p_valid_from THEN
    RAISE EXCEPTION 'Validade final anterior ao inicio';
  END IF;
  IF p_appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments a WHERE a.id = p_appointment_id AND a.company_id = v_actor.company_id
  ) THEN RAISE EXCEPTION 'Agendamento fora do tenant'; END IF;
  INSERT INTO public.insurance_authorizations(
    company_id, patient_id, appointment_id, insurance_id, insurance_plan_id,
    procedure_id, procedure_code, procedure_desc, request_reference,
    requested_professional_id, diagnosis_code, justification,
    quantity_requested, valid_from, valid_until, requested_by, created_by
  ) VALUES (
    v_actor.company_id, p_patient_id, p_appointment_id, p_insurance_id, p_insurance_plan_id,
    p_procedure_id, NULLIF(trim(p_procedure_code), ''), NULLIF(trim(p_procedure_desc), ''),
    NULLIF(trim(p_request_reference), ''), p_requested_professional_id,
    NULLIF(trim(p_diagnosis_code), ''), NULLIF(trim(p_justification), ''),
    p_quantity_requested, p_valid_from, p_valid_until, v_actor.user_id, v_actor.user_id
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

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
AS $$
DECLARE
  v_actor RECORD;
  v_old public.insurance_authorizations;
  v_row public.insurance_authorizations;
  v_authorized INTEGER;
  v_used INTEGER;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL OR NOT public.m15_can_operate_authorizations() THEN
    RAISE EXCEPTION 'Usuario sem permissao para atualizar autorizacao'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_old FROM public.insurance_authorizations WHERE id = p_authorization_id AND company_id = v_actor.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Autorizacao nao encontrada no tenant atual'; END IF;
  IF p_status NOT IN ('pendente','solicitada','em_analise','autorizada','parcialmente_autorizada','negada','vencida','cancelada','reenviada','liberada_excecao','nao_necessaria') THEN
    RAISE EXCEPTION 'Status de autorizacao invalido';
  END IF;
  v_authorized := COALESCE(p_quantity_authorized, v_old.quantity_authorized);
  IF p_status = 'autorizada' THEN v_authorized := COALESCE(p_quantity_authorized, v_old.quantity_requested); END IF;
  v_used := COALESCE(p_quantity_used, v_old.quantity_used);
  IF v_authorized < 0 OR v_authorized > v_old.quantity_requested THEN RAISE EXCEPTION 'Quantidade autorizada invalida'; END IF;
  IF v_used < 0 OR v_used > v_authorized THEN RAISE EXCEPTION 'Quantidade utilizada invalida'; END IF;
  IF p_status IN ('autorizada','parcialmente_autorizada','liberada_excecao')
     AND NULLIF(trim(COALESCE(p_authorization_number, v_old.authorization_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Numero da autorizacao e obrigatorio';
  END IF;
  IF p_status = 'negada' AND NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Motivo da negativa e obrigatorio'; END IF;
  UPDATE public.insurance_authorizations SET
    status = p_status,
    protocol_number = COALESCE(NULLIF(trim(p_protocol_number), ''), protocol_number),
    authorization_number = COALESCE(NULLIF(trim(p_authorization_number), ''), authorization_number),
    password_number = COALESCE(NULLIF(trim(p_password_number), ''), password_number),
    valid_until = COALESCE(p_valid_until, valid_until),
    quantity_authorized = v_authorized,
    quantity_used = v_used,
    authorized_at = CASE WHEN p_status IN ('autorizada','parcialmente_autorizada','liberada_excecao') THEN COALESCE(authorized_at, NOW()) ELSE authorized_at END,
    denied_at = CASE WHEN p_status = 'negada' THEN NOW() ELSE denied_at END,
    denial_reason = CASE WHEN p_status = 'negada' THEN NULLIF(trim(p_reason), '') ELSE denial_reason END,
    notes = concat_ws(E'\n', notes, NULLIF(trim(p_reason), '')),
    updated_by = v_actor.user_id, updated_at = NOW()
  WHERE id = p_authorization_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_insurance_authorization_followup_secure(
  p_authorization_id UUID,
  p_followup_type TEXT,
  p_justification TEXT,
  p_valid_from DATE DEFAULT NULL,
  p_valid_until DATE DEFAULT NULL,
  p_quantity_requested INTEGER DEFAULT NULL
)
RETURNS public.insurance_authorizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_parent public.insurance_authorizations;
  v_row public.insurance_authorizations;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL OR NOT public.m15_can_operate_authorizations() THEN RAISE EXCEPTION 'Usuario sem permissao'; END IF;
  IF p_followup_type NOT IN ('renovacao','prorrogacao') THEN RAISE EXCEPTION 'Tipo de seguimento invalido'; END IF;
  IF NULLIF(trim(COALESCE(p_justification, '')), '') IS NULL THEN RAISE EXCEPTION 'Justificativa obrigatoria'; END IF;
  SELECT * INTO v_parent FROM public.insurance_authorizations WHERE id = p_authorization_id AND company_id = v_actor.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Autorizacao original nao encontrada no tenant atual'; END IF;
  INSERT INTO public.insurance_authorizations(
    company_id, patient_id, appointment_id, insurance_id, insurance_plan_id,
    procedure_id, procedure_code, procedure_desc, request_reference,
    requested_professional_id, diagnosis_code, justification, quantity_requested,
    valid_from, valid_until, renewal_of_id, extension_of_id, requested_by, created_by
  ) VALUES (
    v_parent.company_id, v_parent.patient_id, v_parent.appointment_id, v_parent.insurance_id, v_parent.insurance_plan_id,
    v_parent.procedure_id, v_parent.procedure_code, v_parent.procedure_desc, v_parent.request_reference,
    v_parent.requested_professional_id, v_parent.diagnosis_code, trim(p_justification),
    COALESCE(p_quantity_requested, GREATEST(v_parent.quantity_requested - v_parent.quantity_used, 1)),
    p_valid_from, p_valid_until,
    CASE WHEN p_followup_type = 'renovacao' THEN v_parent.id ELSE NULL END,
    CASE WHEN p_followup_type = 'prorrogacao' THEN v_parent.id ELSE NULL END,
    v_actor.user_id, v_actor.user_id
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_insurance_authorization_attachment_secure(
  p_authorization_id UUID,
  p_storage_path TEXT,
  p_file_name TEXT,
  p_mime_type TEXT DEFAULT 'application/octet-stream',
  p_file_size BIGINT DEFAULT NULL,
  p_checksum TEXT DEFAULT NULL
)
RETURNS public.insurance_authorization_attachments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_row public.insurance_authorization_attachments;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL OR NOT public.m15_can_operate_authorizations() THEN RAISE EXCEPTION 'Usuario sem permissao'; END IF;
  IF NULLIF(trim(COALESCE(p_storage_path, '')), '') IS NULL OR p_storage_path LIKE '%://%' OR p_storage_path LIKE '/%' THEN RAISE EXCEPTION 'Caminho de anexo invalido'; END IF;
  IF NULLIF(trim(COALESCE(p_file_name, '')), '') IS NULL THEN RAISE EXCEPTION 'Nome do arquivo obrigatorio'; END IF;
  IF p_file_size IS NOT NULL AND p_file_size < 0 THEN RAISE EXCEPTION 'Tamanho de arquivo invalido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.insurance_authorizations WHERE id = p_authorization_id AND company_id = v_actor.company_id) THEN RAISE EXCEPTION 'Autorizacao fora do tenant'; END IF;
  INSERT INTO public.insurance_authorization_attachments(company_id, authorization_id, storage_path, file_name, mime_type, file_size, checksum, uploaded_by)
  VALUES(v_actor.company_id, p_authorization_id, trim(p_storage_path), trim(p_file_name), COALESCE(NULLIF(trim(p_mime_type), ''), 'application/octet-stream'), p_file_size, NULLIF(trim(p_checksum), ''), v_actor.user_id)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_insurance_authorization(
  p_authorization_id UUID,
  p_quantity INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_quantity INTEGER;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL OR NOT public.m15_can_operate_authorizations() THEN
    RAISE EXCEPTION 'Usuario sem permissao para consumir autorizacao';
  END IF;
  IF COALESCE(p_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'Quantidade de consumo deve ser positiva';
  END IF;

  UPDATE public.insurance_authorizations
  SET quantity_used = quantity_used + p_quantity,
      updated_by = v_actor.user_id,
      updated_at = NOW()
  WHERE id = p_authorization_id
    AND company_id = v_actor.company_id
    AND status IN ('autorizada', 'parcialmente_autorizada', 'liberada_excecao')
    AND quantity_used + p_quantity <= quantity_authorized
    AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
  RETURNING quantity_used INTO v_quantity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quantidade indisponivel ou autorizacao expirada';
  END IF;
  RETURN v_quantity;
END;
$$;

REVOKE ALL ON FUNCTION public.m15_can_operate_authorizations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_insurance_authorization_secure(BIGINT,BIGINT,INTEGER,INTEGER,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,INTEGER,DATE,DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_insurance_authorization_secure(UUID,TEXT,TEXT,TEXT,TEXT,DATE,INTEGER,INTEGER,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_insurance_authorization_followup_secure(UUID,TEXT,TEXT,DATE,DATE,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_insurance_authorization_attachment_secure(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_insurance_authorization(UUID,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.m15_can_operate_authorizations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_insurance_authorization_secure(BIGINT,BIGINT,INTEGER,INTEGER,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,INTEGER,DATE,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_insurance_authorization_secure(UUID,TEXT,TEXT,TEXT,TEXT,DATE,INTEGER,INTEGER,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_insurance_authorization_followup_secure(UUID,TEXT,TEXT,DATE,DATE,INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_insurance_authorization_attachment_secure(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_insurance_authorization(UUID,INTEGER) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    EXECUTE 'GRANT SELECT ON public.insurance_authorizations, public.insurance_authorization_events, public.insurance_authorization_attachments TO app_prontomedic';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_insurance_authorization_secure(BIGINT,BIGINT,INTEGER,INTEGER,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,INTEGER,DATE,DATE) TO app_prontomedic';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.transition_insurance_authorization_secure(UUID,TEXT,TEXT,TEXT,TEXT,DATE,INTEGER,INTEGER,TEXT) TO app_prontomedic';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_insurance_authorization_followup_secure(UUID,TEXT,TEXT,DATE,DATE,INTEGER) TO app_prontomedic';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.add_insurance_authorization_attachment_secure(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT) TO app_prontomedic';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.consume_insurance_authorization(UUID,INTEGER) TO app_prontomedic';
  END IF;
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename)
    VALUES ('20260722150000_module15_authorizations.sql') ON CONFLICT (filename) DO NOTHING;
  END IF;
END $$;

COMMIT;

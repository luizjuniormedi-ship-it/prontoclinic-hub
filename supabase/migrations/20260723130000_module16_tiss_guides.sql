-- Module 16: versioned TISS guides over the existing XML/billing model.
-- Local candidate only in this slice. No provider credentials or DataSIGH access.
BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.tiss_guide_number_seq;

CREATE TABLE IF NOT EXISTS public.tiss_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER,
  appointment_id BIGINT,
  billing_account_id UUID,
  source_xml_id BIGINT,
  substitution_of_id UUID REFERENCES public.tiss_guides(id),
  guide_number BIGINT NOT NULL DEFAULT nextval('public.tiss_guide_number_seq'),
  guide_type TEXT NOT NULL CHECK (guide_type IN (
    'CONSULTA','SP/SADT','INTERNACAO','RESUMO_INTERNACAO',
    'HONORARIO','OUTRAS_DESPESAS','RECURSO_GLOSA'
  )),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','VALIDATED','SIGNED','CANCELLED','SUBSTITUTED'
  )),
  tiss_version TEXT NOT NULL DEFAULT '4.03.00',
  environment TEXT NOT NULL DEFAULT 'HOMOLOGACAO' CHECK (environment IN ('HOMOLOGACAO','PRODUCAO')),
  validation_errors JSONB NOT NULL DEFAULT '[]'::JSONB,
  signed_by UUID,
  signed_at TIMESTAMPTZ,
  signature_sha256 TEXT,
  signature_reference TEXT,
  cancelled_by UUID,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  substitution_reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tiss_guides_company_number_uq UNIQUE(company_id, guide_number),
  CONSTRAINT tiss_guides_substitution_self_chk CHECK (substitution_of_id IS NULL OR substitution_of_id <> id)
);

ALTER TABLE public.tiss_xml
  ADD COLUMN IF NOT EXISTS guide_id UUID,
  ADD COLUMN IF NOT EXISTS billing_account_id UUID;

CREATE INDEX IF NOT EXISTS idx_tiss_guides_tenant_status
  ON public.tiss_guides(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tiss_guides_appointment
  ON public.tiss_guides(company_id, appointment_id);
CREATE INDEX IF NOT EXISTS idx_tiss_guides_billing
  ON public.tiss_guides(company_id, billing_account_id);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_guide
  ON public.tiss_xml(company_id, guide_id);

CREATE TABLE IF NOT EXISTS public.tiss_guide_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  guide_id UUID NOT NULL REFERENCES public.tiss_guides(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created','validated','signed','cancelled','substituted'
  )),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.m16_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.company_id', true), '')::UUID,
    public.current_company_id()
  )
$fn$;

CREATE OR REPLACE FUNCTION public.m16_can_operate_guides()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN current_user = 'app_prontomedic' THEN TRUE
    ELSE COALESCE((
      SELECT lower(COALESCE(role_name,'')) IN (
        'admin','administrador','financeiro','faturista','billing','gestor'
      )
      FROM public.user_profiles
      WHERE user_id = auth.uid()
      LIMIT 1
    ), FALSE)
  END
$fn$;

ALTER TABLE public.tiss_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_guides FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_guide_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_guide_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS m16_tiss_guides_select ON public.tiss_guides;
CREATE POLICY m16_tiss_guides_select
  ON public.tiss_guides FOR SELECT TO authenticated, app_prontomedic
  USING (company_id = public.m16_company_id());

DROP POLICY IF EXISTS m16_tiss_guides_insert ON public.tiss_guides;
CREATE POLICY m16_tiss_guides_insert
  ON public.tiss_guides FOR INSERT TO authenticated, app_prontomedic
  WITH CHECK (company_id = public.m16_company_id() AND public.m16_can_operate_guides());

DROP POLICY IF EXISTS m16_tiss_guides_update ON public.tiss_guides;
CREATE POLICY m16_tiss_guides_update
  ON public.tiss_guides FOR UPDATE TO authenticated, app_prontomedic
  USING (company_id = public.m16_company_id() AND public.m16_can_operate_guides())
  WITH CHECK (company_id = public.m16_company_id());

DROP POLICY IF EXISTS m16_tiss_guide_events_select ON public.tiss_guide_events;
CREATE POLICY m16_tiss_guide_events_select
  ON public.tiss_guide_events FOR SELECT TO authenticated, app_prontomedic
  USING (company_id = public.m16_company_id());

-- Event rows are append-only trigger output. The table is not writable by the
-- application roles; the private trigger function below is the only writer.
DROP POLICY IF EXISTS m16_tiss_guide_events_trigger_insert ON public.tiss_guide_events;
CREATE POLICY m16_tiss_guide_events_trigger_insert
  ON public.tiss_guide_events FOR INSERT TO PUBLIC
  WITH CHECK (company_id = public.m16_company_id());

REVOKE ALL ON public.tiss_guides, public.tiss_guide_events FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.tiss_guides TO authenticated, app_prontomedic;
GRANT SELECT ON public.tiss_guide_events TO authenticated, app_prontomedic;
REVOKE INSERT, UPDATE, DELETE ON public.tiss_guide_events FROM authenticated, app_prontomedic;
GRANT USAGE, SELECT ON SEQUENCE public.tiss_guide_number_seq TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m16_company_id() TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m16_can_operate_guides() TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.m16_guard_tiss_guide()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (
      OLD.status IN ('CANCELLED','SUBSTITUTED')
      OR (OLD.status = 'SIGNED' AND NEW.status = 'SIGNED')
    )
    AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      RAISE EXCEPTION 'Guia TISS imutavel apos assinatura/cancelamento/substituicao';
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
      (OLD.status = 'DRAFT' AND NEW.status = 'VALIDATED') OR
      (OLD.status = 'VALIDATED' AND NEW.status = 'SIGNED') OR
      (OLD.status IN ('DRAFT','VALIDATED') AND NEW.status = 'CANCELLED') OR
      (OLD.status = 'SIGNED' AND NEW.status IN ('CANCELLED','SUBSTITUTED'))
    ) THEN
      RAISE EXCEPTION 'Transicao de guia TISS invalida';
    END IF;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_m16_guard_tiss_guide ON public.tiss_guides;
CREATE TRIGGER trg_m16_guard_tiss_guide
  BEFORE UPDATE ON public.tiss_guides
  FOR EACH ROW EXECUTE FUNCTION public.m16_guard_tiss_guide();

CREATE OR REPLACE FUNCTION public.m16_record_tiss_guide_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO public.tiss_guide_events(
    company_id, guide_id, event_type, from_status, to_status,
    reason, actor_user_id
  ) VALUES (
    NEW.company_id, NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN 'created'
         WHEN NEW.status = 'VALIDATED' THEN 'validated'
         WHEN NEW.status = 'SIGNED' THEN 'signed'
         WHEN NEW.status = 'CANCELLED' THEN 'cancelled'
         ELSE 'substituted' END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    CASE WHEN NEW.status = 'CANCELLED' THEN NEW.cancellation_reason
         WHEN NEW.status = 'SUBSTITUTED' THEN NEW.substitution_reason END,
    COALESCE(NEW.signed_by, NEW.cancelled_by, NEW.created_by)
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_m16_tiss_guide_event ON public.tiss_guides;
DROP FUNCTION IF EXISTS public.m16_record_tiss_guide_event();
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO app_prontomedic;

CREATE OR REPLACE FUNCTION private.m16_record_tiss_guide_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO public.tiss_guide_events(
    company_id, guide_id, event_type, from_status, to_status,
    reason, actor_user_id
  ) VALUES (
    NEW.company_id, NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN 'created'
         WHEN NEW.status = 'VALIDATED' THEN 'validated'
         WHEN NEW.status = 'SIGNED' THEN 'signed'
         WHEN NEW.status = 'CANCELLED' THEN 'cancelled'
         ELSE 'substituted' END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    CASE WHEN NEW.status = 'CANCELLED' THEN NEW.cancellation_reason
         WHEN NEW.status = 'SUBSTITUTED' THEN NEW.substitution_reason END,
    COALESCE(NEW.signed_by, NEW.cancelled_by, NEW.created_by)
  );
  RETURN NEW;
END;
$fn$;

ALTER FUNCTION private.m16_record_tiss_guide_event() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.m16_record_tiss_guide_event() FROM PUBLIC, anon, authenticated, app_prontomedic;

CREATE TRIGGER trg_m16_tiss_guide_event
  AFTER INSERT OR UPDATE OF status ON public.tiss_guides
  FOR EACH ROW EXECUTE FUNCTION private.m16_record_tiss_guide_event();

CREATE OR REPLACE FUNCTION public.create_tiss_guide_secure(
  p_guide_type TEXT,
  p_appointment_id BIGINT DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL,
  p_billing_account_id UUID DEFAULT NULL,
  p_source_xml_id BIGINT DEFAULT NULL,
  p_environment TEXT DEFAULT 'HOMOLOGACAO'
)
RETURNS public.tiss_guides
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company UUID := public.m16_company_id();
  v_row public.tiss_guides;
BEGIN
  IF v_company IS NULL OR NOT public.m16_can_operate_guides() THEN
    RAISE EXCEPTION 'Usuario sem permissao para criar guia TISS';
  END IF;
  IF p_guide_type NOT IN ('CONSULTA','SP/SADT','INTERNACAO','RESUMO_INTERNACAO','HONORARIO','OUTRAS_DESPESAS','RECURSO_GLOSA') THEN
    RAISE EXCEPTION 'Tipo de guia TISS invalido';
  END IF;
  IF p_environment NOT IN ('HOMOLOGACAO','PRODUCAO') THEN
    RAISE EXCEPTION 'Ambiente TISS invalido';
  END IF;
  INSERT INTO public.tiss_guides(
    company_id, appointment_id, unit_id, billing_account_id, source_xml_id,
    guide_type, environment, created_by
  ) VALUES (
    v_company, p_appointment_id, p_unit_id, p_billing_account_id, p_source_xml_id,
    p_guide_type, p_environment, auth.uid()
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.validate_tiss_guide_secure(
  p_guide_id UUID,
  p_errors JSONB DEFAULT '[]'::JSONB
)
RETURNS public.tiss_guides
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.tiss_guides;
BEGIN
  IF NOT public.m16_can_operate_guides() THEN RAISE EXCEPTION 'Usuario sem permissao'; END IF;
  IF jsonb_typeof(p_errors) <> 'array' OR jsonb_array_length(p_errors) > 0 THEN
    RAISE EXCEPTION 'Guia TISS possui pendencias de validacao';
  END IF;
  UPDATE public.tiss_guides
  SET status = 'VALIDATED', validation_errors = p_errors
  WHERE id = p_guide_id AND company_id = public.m16_company_id() AND status = 'DRAFT'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Guia TISS nao encontrada ou fora do estado DRAFT'; END IF;
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.sign_tiss_guide_secure(
  p_guide_id UUID,
  p_signature_sha256 TEXT,
  p_signature_reference TEXT DEFAULT NULL
)
RETURNS public.tiss_guides
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.tiss_guides;
BEGIN
  IF NOT public.m16_can_operate_guides() THEN RAISE EXCEPTION 'Usuario sem permissao'; END IF;
  IF length(trim(COALESCE(p_signature_sha256,''))) < 32 THEN
    RAISE EXCEPTION 'Hash de assinatura obrigatorio';
  END IF;
  UPDATE public.tiss_guides
  SET status = 'SIGNED', signed_by = auth.uid(), signed_at = NOW(),
      signature_sha256 = lower(trim(p_signature_sha256)),
      signature_reference = NULLIF(trim(COALESCE(p_signature_reference,'')), '')
  WHERE id = p_guide_id AND company_id = public.m16_company_id() AND status = 'VALIDATED'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Guia TISS nao encontrada ou fora do estado VALIDATED'; END IF;
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_tiss_guide_secure(
  p_guide_id UUID,
  p_reason TEXT
)
RETURNS public.tiss_guides
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.tiss_guides;
BEGIN
  IF NOT public.m16_can_operate_guides() THEN RAISE EXCEPTION 'Usuario sem permissao'; END IF;
  IF NULLIF(trim(COALESCE(p_reason,'')), '') IS NULL THEN RAISE EXCEPTION 'Motivo do cancelamento obrigatorio'; END IF;
  UPDATE public.tiss_guides
  SET status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_at = NOW(),
      cancellation_reason = trim(p_reason)
  WHERE id = p_guide_id AND company_id = public.m16_company_id()
    AND status IN ('DRAFT','VALIDATED','SIGNED')
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Guia TISS nao encontrada ou ja encerrada'; END IF;
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.substitute_tiss_guide_secure(
  p_guide_id UUID,
  p_reason TEXT
)
RETURNS public.tiss_guides
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_old public.tiss_guides;
  v_new public.tiss_guides;
BEGIN
  IF NOT public.m16_can_operate_guides() THEN RAISE EXCEPTION 'Usuario sem permissao'; END IF;
  IF NULLIF(trim(COALESCE(p_reason,'')), '') IS NULL THEN RAISE EXCEPTION 'Motivo da substituicao obrigatorio'; END IF;
  SELECT * INTO v_old FROM public.tiss_guides
  WHERE id = p_guide_id AND company_id = public.m16_company_id() AND status = 'SIGNED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Somente guia SIGNED pode ser substituida'; END IF;
  UPDATE public.tiss_guides SET status='SUBSTITUTED', substitution_reason=trim(p_reason) WHERE id=v_old.id;
  INSERT INTO public.tiss_guides(
    company_id, unit_id, appointment_id, billing_account_id, source_xml_id,
    substitution_of_id, guide_type, environment, created_by
  ) VALUES (
    v_old.company_id, v_old.unit_id, v_old.appointment_id, v_old.billing_account_id,
    v_old.source_xml_id, v_old.id, v_old.guide_type, v_old.environment, auth.uid()
  ) RETURNING * INTO v_new;
  RETURN v_new;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.link_tiss_xml_guide_secure(
  p_guide_id UUID,
  p_xml_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.m16_can_operate_guides() THEN RAISE EXCEPTION 'Usuario sem permissao'; END IF;
  UPDATE public.tiss_xml
  SET guide_id = p_guide_id, updated_at = NOW()
  WHERE id = p_xml_id AND company_id = public.m16_company_id()
    AND EXISTS (SELECT 1 FROM public.tiss_guides g WHERE g.id=p_guide_id AND g.company_id=public.m16_company_id());
  RETURN FOUND;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_tiss_guide_secure(TEXT,BIGINT,INTEGER,UUID,BIGINT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_tiss_guide_secure(UUID,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sign_tiss_guide_secure(UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_tiss_guide_secure(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.substitute_tiss_guide_secure(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_tiss_xml_guide_secure(UUID,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tiss_guide_secure(TEXT,BIGINT,INTEGER,UUID,BIGINT,TEXT) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.validate_tiss_guide_secure(UUID,JSONB) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.sign_tiss_guide_secure(UUID,TEXT,TEXT) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.cancel_tiss_guide_secure(UUID,TEXT) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.substitute_tiss_guide_secure(UUID,TEXT) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.link_tiss_xml_guide_secure(UUID,BIGINT) TO authenticated, app_prontomedic;

DO $fn$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260723130000_module16_tiss_guides.sql', NOW())
    ON CONFLICT (filename) DO NOTHING;
  END IF;
END
$fn$;

COMMIT;

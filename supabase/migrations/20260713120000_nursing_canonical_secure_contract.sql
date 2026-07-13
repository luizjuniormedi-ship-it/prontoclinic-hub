-- Canonical P0 nursing contract aligned with src/services/nursingCareService.ts.
-- Browser roles read tenant rows and mutate only through the six secure RPCs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nursing_rpc_owner') THEN
    CREATE ROLE nursing_rpc_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE nursing_rpc_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nursing_data_owner') THEN
    CREATE ROLE nursing_data_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE nursing_data_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$role$;

DO $preflight$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL THEN
    RAISE EXCEPTION 'Nursing P0 requires auth.uid() and public.current_company_id()';
  END IF;
  IF to_regclass('public.companies') IS NULL
     OR to_regclass('public.user_profiles') IS NULL
     OR to_regclass('public.patients') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permissions') IS NULL THEN
    RAISE EXCEPTION 'Nursing P0 canonical dependencies are missing';
  END IF;
END
$preflight$;

INSERT INTO public.role_permissions
  (role_id,module,can_view,can_create,can_edit,can_delete,can_export)
SELECT role.id,'enfermagem',TRUE,TRUE,TRUE,FALSE,FALSE
  FROM public.roles AS role
 WHERE role.name IN ('admin','enfermagem')
ON CONFLICT (role_id,module) DO UPDATE
  SET can_view=TRUE,
      can_create=TRUE,
      can_edit=TRUE,
      can_delete=FALSE,
      updated_at=clock_timestamp();

CREATE UNIQUE INDEX IF NOT EXISTS patients_company_id_uq
  ON public.patients(company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_company_id_uq
  ON public.user_profiles(company_id, id);

CREATE TABLE public.nursing_medication_administrations (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id),
  patient_id BIGINT NOT NULL,
  medication TEXT NOT NULL CHECK (btrim(medication) <> ''),
  dose TEXT,
  via TEXT,
  scheduled_at TIMESTAMPTZ,
  prepared_at TIMESTAMPTZ NOT NULL,
  prepared_by UUID NOT NULL,
  administered_at TIMESTAMPTZ,
  administered_by UUID,
  refused_at TIMESTAMPTZ,
  refused_by UUID,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'em_preparo', 'administrado', 'recusado', 'suspenso', 'atrasado', 'cancelado')),
  bedside_check_ok BOOLEAN NOT NULL DEFAULT FALSE,
  bedside_confirmed_patient_id BIGINT,
  bedside_checked_at TIMESTAMPTZ,
  bedside_checked_by UUID,
  refusal_reason TEXT,
  creation_idempotency_key UUID NOT NULL,
  creation_request_hash TEXT NOT NULL CHECK (length(creation_request_hash) = 64),
  administration_idempotency_key UUID,
  administration_request_hash TEXT CHECK (administration_request_hash IS NULL OR length(administration_request_hash) = 64),
  refusal_idempotency_key UUID,
  refusal_request_hash TEXT CHECK (refusal_request_hash IS NULL OR length(refusal_request_hash) = 64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT nursing_med_patient_fkey
    FOREIGN KEY (company_id, patient_id) REFERENCES public.patients(company_id, id),
  CONSTRAINT nursing_med_prepared_by_fkey
    FOREIGN KEY (company_id, prepared_by) REFERENCES public.user_profiles(company_id, id),
  CONSTRAINT nursing_med_administered_by_fkey
    FOREIGN KEY (company_id, administered_by) REFERENCES public.user_profiles(company_id, id),
  CONSTRAINT nursing_med_refused_by_fkey
    FOREIGN KEY (company_id, refused_by) REFERENCES public.user_profiles(company_id, id),
  CONSTRAINT nursing_med_bedside_by_fkey
    FOREIGN KEY (company_id, bedside_checked_by) REFERENCES public.user_profiles(company_id, id),
  CONSTRAINT nursing_med_bedside_patient_fkey
    FOREIGN KEY (company_id, bedside_confirmed_patient_id) REFERENCES public.patients(company_id, id),
  CONSTRAINT nursing_med_creation_idempotency_uq UNIQUE (company_id, creation_idempotency_key),
  CONSTRAINT nursing_med_state_consistency CHECK (
    (status = 'administrado' AND administered_at IS NOT NULL AND administered_by IS NOT NULL
       AND bedside_check_ok AND bedside_checked_at IS NOT NULL AND bedside_checked_by IS NOT NULL
       AND bedside_confirmed_patient_id = patient_id
       AND refusal_reason IS NULL AND refused_at IS NULL AND refused_by IS NULL)
    OR
    (status = 'recusado' AND refusal_reason IS NOT NULL AND refused_at IS NOT NULL
       AND refused_by IS NOT NULL AND administered_at IS NULL AND administered_by IS NULL)
    OR
    (status NOT IN ('administrado', 'recusado') AND administered_at IS NULL
       AND administered_by IS NULL AND refused_at IS NULL AND refused_by IS NULL
       AND refusal_reason IS NULL)
  )
);

CREATE UNIQUE INDEX nursing_med_administration_idempotency_uq
  ON public.nursing_medication_administrations(company_id, administration_idempotency_key)
  WHERE administration_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX nursing_med_refusal_idempotency_uq
  ON public.nursing_medication_administrations(company_id, refusal_idempotency_key)
  WHERE refusal_idempotency_key IS NOT NULL;

CREATE TABLE public.nursing_incidents (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id),
  patient_id BIGINT NOT NULL,
  incident_type TEXT NOT NULL CHECK (btrim(incident_type) <> ''),
  severity TEXT NOT NULL CHECK (severity IN ('leve', 'moderada', 'grave', 'critica')),
  description TEXT NOT NULL CHECK (btrim(description) <> ''),
  medico_notificado BOOLEAN NOT NULL,
  reported_by UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT nursing_incident_patient_fkey
    FOREIGN KEY (company_id, patient_id) REFERENCES public.patients(company_id, id),
  CONSTRAINT nursing_incident_reporter_fkey
    FOREIGN KEY (company_id, reported_by) REFERENCES public.user_profiles(company_id, id),
  CONSTRAINT nursing_incident_idempotency_uq UNIQUE (company_id, idempotency_key)
);

CREATE TABLE public.nursing_procedures (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id),
  patient_id BIGINT NOT NULL,
  procedure_type TEXT NOT NULL CHECK (btrim(procedure_type) <> ''),
  description TEXT,
  faturavel BOOLEAN NOT NULL DEFAULT FALSE,
  performed_at TIMESTAMPTZ NOT NULL,
  performed_by UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT nursing_procedure_patient_fkey
    FOREIGN KEY (company_id, patient_id) REFERENCES public.patients(company_id, id),
  CONSTRAINT nursing_procedure_actor_fkey
    FOREIGN KEY (company_id, performed_by) REFERENCES public.user_profiles(company_id, id),
  CONSTRAINT nursing_procedure_idempotency_uq UNIQUE (company_id, idempotency_key)
);

CREATE TABLE public.nursing_shift_handoffs (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id),
  shift_date DATE NOT NULL,
  shift_type TEXT NOT NULL CHECK (btrim(shift_type) <> ''),
  summary TEXT NOT NULL CHECK (btrim(summary) <> ''),
  pending_items JSONB,
  critical_patients JSONB,
  notes TEXT,
  created_by UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT nursing_handoff_creator_fkey
    FOREIGN KEY (company_id, created_by) REFERENCES public.user_profiles(company_id, id),
  CONSTRAINT nursing_handoff_idempotency_uq UNIQUE (company_id, idempotency_key),
  CONSTRAINT nursing_handoff_pending_json_check
    CHECK (pending_items IS NULL OR jsonb_typeof(pending_items) IN ('array', 'object')),
  CONSTRAINT nursing_handoff_critical_json_check
    CHECK (critical_patients IS NULL OR jsonb_typeof(critical_patients) IN ('array', 'object'))
);

CREATE INDEX nursing_med_patient_status_idx
  ON public.nursing_medication_administrations(company_id, patient_id, status, scheduled_at);
CREATE INDEX nursing_incident_patient_time_idx
  ON public.nursing_incidents(company_id, patient_id, created_at DESC);
CREATE INDEX nursing_procedure_patient_time_idx
  ON public.nursing_procedures(company_id, patient_id, performed_at DESC);
CREATE INDEX nursing_handoff_shift_idx
  ON public.nursing_shift_handoffs(company_id, shift_date DESC, shift_type);

GRANT USAGE, CREATE ON SCHEMA public TO nursing_data_owner;
ALTER TABLE public.nursing_medication_administrations OWNER TO nursing_data_owner;
ALTER TABLE public.nursing_incidents OWNER TO nursing_data_owner;
ALTER TABLE public.nursing_procedures OWNER TO nursing_data_owner;
ALTER TABLE public.nursing_shift_handoffs OWNER TO nursing_data_owner;
REVOKE CREATE ON SCHEMA public FROM nursing_data_owner;

ALTER TABLE public.nursing_medication_administrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_medication_administrations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_procedures FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_shift_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_shift_handoffs FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.nursing_has_permission_secure(p_action TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT p_action IN ('view','create','edit') AND EXISTS (
    SELECT 1
      FROM public.user_profiles AS profile
      JOIN public.roles AS role
        ON role.lg_ativo
       AND (
         role.id=profile.role_id
         OR (
           profile.role_id IS NULL
           AND role.name=CASE lower(COALESCE(profile.role_name,''))
             WHEN 'administrador' THEN 'admin'
             ELSE lower(COALESCE(profile.role_name,''))
           END
         )
       )
      JOIN public.role_permissions AS permission
        ON permission.role_id=role.id
       AND permission.module='enfermagem'
       AND CASE p_action
         WHEN 'view' THEN permission.can_view
         WHEN 'create' THEN permission.can_create
         WHEN 'edit' THEN permission.can_edit
         ELSE FALSE
       END
     WHERE profile.id=auth.uid()
       AND profile.company_id=public.current_company_id()
       AND profile.lg_ativo
  )
$function$;

CREATE POLICY nursing_med_tenant_select ON public.nursing_medication_administrations
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND company_id=(SELECT public.current_company_id())
    AND (SELECT public.nursing_has_permission_secure('view'))
  );
CREATE POLICY nursing_incident_tenant_select ON public.nursing_incidents
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND company_id=(SELECT public.current_company_id())
    AND (SELECT public.nursing_has_permission_secure('view'))
  );
CREATE POLICY nursing_procedure_tenant_select ON public.nursing_procedures
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND company_id=(SELECT public.current_company_id())
    AND (SELECT public.nursing_has_permission_secure('view'))
  );
CREATE POLICY nursing_handoff_tenant_select ON public.nursing_shift_handoffs
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND company_id=(SELECT public.current_company_id())
    AND (SELECT public.nursing_has_permission_secure('view'))
  );

CREATE POLICY nursing_rpc_actor_lookup ON public.user_profiles
  FOR SELECT TO nursing_rpc_owner
  USING (id = (SELECT auth.uid()) AND company_id = (SELECT public.current_company_id()) AND lg_ativo);
CREATE POLICY nursing_rpc_roles_lookup ON public.roles
  FOR SELECT TO nursing_rpc_owner
  USING (lg_ativo);
CREATE POLICY nursing_rpc_permissions_lookup ON public.role_permissions
  FOR SELECT TO nursing_rpc_owner
  USING (module='enfermagem');
CREATE POLICY nursing_rpc_patient_lookup ON public.patients
  FOR SELECT TO nursing_rpc_owner
  USING (company_id = (SELECT public.current_company_id()));
CREATE POLICY nursing_rpc_med_internal ON public.nursing_medication_administrations
  FOR ALL TO nursing_rpc_owner
  USING (company_id = (SELECT public.current_company_id()))
  WITH CHECK (company_id = (SELECT public.current_company_id()));
CREATE POLICY nursing_rpc_incident_internal ON public.nursing_incidents
  FOR ALL TO nursing_rpc_owner
  USING (company_id = (SELECT public.current_company_id()))
  WITH CHECK (company_id = (SELECT public.current_company_id()));
CREATE POLICY nursing_rpc_procedure_internal ON public.nursing_procedures
  FOR ALL TO nursing_rpc_owner
  USING (company_id = (SELECT public.current_company_id()))
  WITH CHECK (company_id = (SELECT public.current_company_id()));
CREATE POLICY nursing_rpc_handoff_internal ON public.nursing_shift_handoffs
  FOR ALL TO nursing_rpc_owner
  USING (company_id = (SELECT public.current_company_id()))
  WITH CHECK (company_id = (SELECT public.current_company_id()));

GRANT SELECT ON public.user_profiles, public.patients, public.roles, public.role_permissions
  TO nursing_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON
  public.nursing_medication_administrations,
  public.nursing_incidents,
  public.nursing_procedures,
  public.nursing_shift_handoffs TO nursing_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE
  public.nursing_medication_administrations_id_seq,
  public.nursing_incidents_id_seq,
  public.nursing_procedures_id_seq,
  public.nursing_shift_handoffs_id_seq TO nursing_rpc_owner;
GRANT USAGE ON SCHEMA auth TO nursing_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO nursing_rpc_owner;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO nursing_rpc_owner;

CREATE OR REPLACE FUNCTION public.nursing_actor_context_secure(p_action TEXT)
RETURNS TABLE(actor_id UUID, company_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_company UUID := public.current_company_id();
BEGIN
  IF p_action NOT IN ('view','create','edit') THEN
    RAISE EXCEPTION 'Acao RBAC de enfermagem invalida';
  END IF;
  IF v_actor IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Autenticacao e empresa ativa sao obrigatorias para enfermagem';
  END IF;
  IF NOT public.nursing_has_permission_secure(p_action) THEN
    RAISE EXCEPTION 'Perfil sem permissao enfermagem.% ou tenant ativo',p_action;
  END IF;
  RETURN QUERY SELECT v_actor, v_company;
END
$function$;

CREATE OR REPLACE FUNCTION public.create_nursing_medication_secure(
  p_patient_id BIGINT,
  p_medication TEXT,
  p_dose TEXT,
  p_via TEXT,
  p_scheduled_at TIMESTAMPTZ,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID; v_company UUID; v_hash TEXT;
  v_existing public.nursing_medication_administrations;
  v_row public.nursing_medication_administrations;
BEGIN
  SELECT actor_id, company_id INTO v_actor, v_company FROM public.nursing_actor_context_secure('edit');
  IF p_patient_id IS NULL OR p_idempotency_key IS NULL OR btrim(COALESCE(p_medication, '')) = '' THEN
    RAISE EXCEPTION 'Paciente, medicamento e chave idempotente sao obrigatorios';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE company_id=v_company AND id=p_patient_id AND lg_ativo) THEN
    RAISE EXCEPTION 'Paciente inexistente ou fora do tenant do ator';
  END IF;
  v_hash := encode(digest(jsonb_build_object(
    'patient_id',p_patient_id,'medication',btrim(p_medication),
    'dose',NULLIF(btrim(COALESCE(p_dose,'')),''),
    'via',NULLIF(btrim(COALESCE(p_via,'')),''),'scheduled_at',p_scheduled_at
  )::TEXT,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company::TEXT || ':' || p_idempotency_key::TEXT,0));
  SELECT * INTO v_existing FROM public.nursing_medication_administrations
   WHERE company_id=v_company AND creation_idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.creation_request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'Chave idempotente de enfermagem reutilizada com payload diferente';
    END IF;
    RETURN to_jsonb(v_existing) - ARRAY['creation_request_hash','administration_request_hash','refusal_request_hash'];
  END IF;
  INSERT INTO public.nursing_medication_administrations(
    company_id,patient_id,medication,dose,via,scheduled_at,prepared_at,prepared_by,
    status,creation_idempotency_key,creation_request_hash
  ) VALUES (
    v_company,p_patient_id,btrim(p_medication),NULLIF(btrim(COALESCE(p_dose,'')),''),
    NULLIF(btrim(COALESCE(p_via,'')),''),p_scheduled_at,clock_timestamp(),v_actor,
    'pendente',p_idempotency_key,v_hash
  ) RETURNING * INTO v_row;
  RETURN to_jsonb(v_row) - ARRAY['creation_request_hash','administration_request_hash','refusal_request_hash'];
END
$function$;

-- Read-only preview for the bedside dialog. The authoritative patient check is
-- repeated inside administer_nursing_medication_secure under the row lock.
CREATE OR REPLACE FUNCTION public.bedside_check(
  p_admin_id BIGINT,
  p_patient_confirmado BIGINT
)
RETURNS TABLE(certo TEXT, ok BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID; v_company UUID;
  v_med public.nursing_medication_administrations;
  v_ok BOOLEAN;
BEGIN
  SELECT actor_id, company_id INTO v_actor, v_company FROM public.nursing_actor_context_secure('view');
  SELECT * INTO v_med FROM public.nursing_medication_administrations
   WHERE company_id=v_company AND id=p_admin_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medicamento inexistente ou fora do tenant do ator'; END IF;
  v_ok := p_patient_confirmado IS NOT NULL
          AND p_patient_confirmado = v_med.patient_id
          AND v_med.status IN ('pendente','em_preparo');
  RETURN QUERY VALUES ('paciente_certo',v_ok),('medicamento_pendente',v_med.status IN ('pendente','em_preparo'));
END
$function$;

CREATE OR REPLACE FUNCTION public.administer_nursing_medication_secure(
  p_admin_id BIGINT,
  p_patient_confirmed_id BIGINT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID; v_company UUID; v_hash TEXT;
  v_med public.nursing_medication_administrations;
BEGIN
  SELECT actor_id, company_id INTO v_actor, v_company FROM public.nursing_actor_context_secure('edit');
  IF p_admin_id IS NULL OR p_patient_confirmed_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Administracao, paciente confirmado e chave idempotente sao obrigatorios';
  END IF;
  v_hash := encode(digest(jsonb_build_object('admin_id',p_admin_id,'patient_confirmed_id',p_patient_confirmed_id)::TEXT,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company::TEXT || ':' || p_idempotency_key::TEXT,0));
  IF EXISTS (SELECT 1 FROM public.nursing_medication_administrations WHERE company_id=v_company AND administration_idempotency_key=p_idempotency_key AND id<>p_admin_id) THEN
    RAISE EXCEPTION 'Chave idempotente de administracao ja usada em outro medicamento';
  END IF;
  SELECT * INTO v_med FROM public.nursing_medication_administrations
   WHERE company_id=v_company AND id=p_admin_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medicamento inexistente ou fora do tenant do ator'; END IF;
  IF v_med.status='administrado' AND v_med.administration_idempotency_key=p_idempotency_key THEN
    IF v_med.administration_request_hash IS DISTINCT FROM v_hash THEN RAISE EXCEPTION 'Chave idempotente de enfermagem reutilizada com payload diferente'; END IF;
    RETURN to_jsonb(v_med) - ARRAY['creation_request_hash','administration_request_hash','refusal_request_hash'];
  END IF;
  IF v_med.status NOT IN ('pendente','em_preparo') THEN RAISE EXCEPTION 'Medicamento nao esta pendente para administracao'; END IF;
  IF p_patient_confirmed_id IS DISTINCT FROM v_med.patient_id THEN
    RAISE EXCEPTION 'Checagem beira-leito falhou: paciente confirmado nao confere';
  END IF;
  UPDATE public.nursing_medication_administrations
     SET status='administrado', administered_at=clock_timestamp(), administered_by=v_actor,
         bedside_check_ok=TRUE, bedside_confirmed_patient_id=p_patient_confirmed_id,
         bedside_checked_at=clock_timestamp(), bedside_checked_by=v_actor,
         administration_idempotency_key=p_idempotency_key,
         administration_request_hash=v_hash, updated_at=clock_timestamp()
   WHERE id=v_med.id RETURNING * INTO v_med;
  RETURN to_jsonb(v_med) - ARRAY['creation_request_hash','administration_request_hash','refusal_request_hash'];
END
$function$;

CREATE OR REPLACE FUNCTION public.refuse_nursing_medication_secure(
  p_admin_id BIGINT,
  p_reason TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID; v_company UUID; v_hash TEXT;
  v_med public.nursing_medication_administrations;
BEGIN
  SELECT actor_id, company_id INTO v_actor, v_company FROM public.nursing_actor_context_secure('edit');
  IF p_admin_id IS NULL OR p_idempotency_key IS NULL OR btrim(COALESCE(p_reason,''))='' THEN
    RAISE EXCEPTION 'Medicamento, motivo e chave idempotente sao obrigatorios';
  END IF;
  v_hash := encode(digest(jsonb_build_object('admin_id',p_admin_id,'reason',btrim(p_reason))::TEXT,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company::TEXT || ':' || p_idempotency_key::TEXT,0));
  IF EXISTS (SELECT 1 FROM public.nursing_medication_administrations WHERE company_id=v_company AND refusal_idempotency_key=p_idempotency_key AND id<>p_admin_id) THEN
    RAISE EXCEPTION 'Chave idempotente de recusa ja usada em outro medicamento';
  END IF;
  SELECT * INTO v_med FROM public.nursing_medication_administrations
   WHERE company_id=v_company AND id=p_admin_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medicamento inexistente ou fora do tenant do ator'; END IF;
  IF v_med.status='recusado' AND v_med.refusal_idempotency_key=p_idempotency_key THEN
    IF v_med.refusal_request_hash IS DISTINCT FROM v_hash THEN RAISE EXCEPTION 'Chave idempotente de enfermagem reutilizada com payload diferente'; END IF;
    RETURN to_jsonb(v_med) - ARRAY['creation_request_hash','administration_request_hash','refusal_request_hash'];
  END IF;
  IF v_med.status NOT IN ('pendente','em_preparo') THEN RAISE EXCEPTION 'Medicamento nao esta pendente para recusa'; END IF;
  UPDATE public.nursing_medication_administrations
     SET status='recusado', refusal_reason=btrim(p_reason), refused_at=clock_timestamp(),
         refused_by=v_actor, bedside_check_ok=FALSE, bedside_confirmed_patient_id=NULL,
         bedside_checked_at=NULL, bedside_checked_by=NULL,
         refusal_idempotency_key=p_idempotency_key, refusal_request_hash=v_hash,
         updated_at=clock_timestamp()
   WHERE id=v_med.id RETURNING * INTO v_med;
  RETURN to_jsonb(v_med) - ARRAY['creation_request_hash','administration_request_hash','refusal_request_hash'];
END
$function$;

CREATE OR REPLACE FUNCTION public.report_nursing_incident_secure(
  p_patient_id BIGINT,
  p_incident_type TEXT,
  p_severity TEXT,
  p_description TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID; v_company UUID; v_hash TEXT;
  v_existing public.nursing_incidents; v_row public.nursing_incidents;
BEGIN
  SELECT actor_id, company_id INTO v_actor, v_company FROM public.nursing_actor_context_secure('create');
  IF p_patient_id IS NULL OR p_idempotency_key IS NULL OR btrim(COALESCE(p_incident_type,''))=''
     OR btrim(COALESCE(p_description,''))='' OR COALESCE(p_severity,'') NOT IN ('leve','moderada','grave','critica') THEN
    RAISE EXCEPTION 'Dados obrigatorios do incidente sao invalidos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE company_id=v_company AND id=p_patient_id AND lg_ativo) THEN RAISE EXCEPTION 'Paciente inexistente ou fora do tenant do ator'; END IF;
  v_hash := encode(digest(jsonb_build_object('patient_id',p_patient_id,'incident_type',btrim(p_incident_type),'severity',p_severity,'description',btrim(p_description))::TEXT,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company::TEXT || ':' || p_idempotency_key::TEXT,0));
  SELECT * INTO v_existing FROM public.nursing_incidents WHERE company_id=v_company AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM v_hash THEN RAISE EXCEPTION 'Chave idempotente de enfermagem reutilizada com payload diferente'; END IF;
    RETURN to_jsonb(v_existing)-'request_hash';
  END IF;
  INSERT INTO public.nursing_incidents(company_id,patient_id,incident_type,severity,description,medico_notificado,reported_by,idempotency_key,request_hash)
  VALUES(v_company,p_patient_id,btrim(p_incident_type),p_severity,btrim(p_description),p_severity IN ('grave','critica'),v_actor,p_idempotency_key,v_hash)
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row)-'request_hash';
END
$function$;

CREATE OR REPLACE FUNCTION public.record_nursing_procedure_secure(
  p_patient_id BIGINT,
  p_procedure_type TEXT,
  p_description TEXT,
  p_faturavel BOOLEAN,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID; v_company UUID; v_hash TEXT;
  v_existing public.nursing_procedures; v_row public.nursing_procedures;
BEGIN
  SELECT actor_id, company_id INTO v_actor, v_company FROM public.nursing_actor_context_secure('create');
  IF p_patient_id IS NULL OR p_idempotency_key IS NULL OR btrim(COALESCE(p_procedure_type,''))='' THEN RAISE EXCEPTION 'Paciente, procedimento e chave idempotente sao obrigatorios'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE company_id=v_company AND id=p_patient_id AND lg_ativo) THEN RAISE EXCEPTION 'Paciente inexistente ou fora do tenant do ator'; END IF;
  v_hash := encode(digest(jsonb_build_object('patient_id',p_patient_id,'procedure_type',btrim(p_procedure_type),'description',NULLIF(btrim(COALESCE(p_description,'')),''),'faturavel',COALESCE(p_faturavel,FALSE))::TEXT,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company::TEXT || ':' || p_idempotency_key::TEXT,0));
  SELECT * INTO v_existing FROM public.nursing_procedures WHERE company_id=v_company AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM v_hash THEN RAISE EXCEPTION 'Chave idempotente de enfermagem reutilizada com payload diferente'; END IF;
    RETURN to_jsonb(v_existing)-'request_hash';
  END IF;
  INSERT INTO public.nursing_procedures(company_id,patient_id,procedure_type,description,faturavel,performed_at,performed_by,idempotency_key,request_hash)
  VALUES(v_company,p_patient_id,btrim(p_procedure_type),NULLIF(btrim(COALESCE(p_description,'')),''),COALESCE(p_faturavel,FALSE),clock_timestamp(),v_actor,p_idempotency_key,v_hash)
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row)-'request_hash';
END
$function$;

CREATE OR REPLACE FUNCTION public.create_nursing_shift_handoff_secure(
  p_shift_date DATE,
  p_shift_type TEXT,
  p_summary TEXT,
  p_pending_items JSONB,
  p_critical_patients JSONB,
  p_notes TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID; v_company UUID; v_hash TEXT;
  v_existing public.nursing_shift_handoffs; v_row public.nursing_shift_handoffs;
BEGIN
  SELECT actor_id, company_id INTO v_actor, v_company FROM public.nursing_actor_context_secure('create');
  IF p_shift_date IS NULL OR p_idempotency_key IS NULL OR btrim(COALESCE(p_shift_type,''))='' OR btrim(COALESCE(p_summary,''))='' THEN RAISE EXCEPTION 'Data, turno, resumo e chave idempotente sao obrigatorios'; END IF;
  IF (p_pending_items IS NOT NULL AND jsonb_typeof(p_pending_items) NOT IN ('array','object'))
     OR (p_critical_patients IS NOT NULL AND jsonb_typeof(p_critical_patients) NOT IN ('array','object')) THEN RAISE EXCEPTION 'Pendencias e pacientes criticos devem ser JSON array ou objeto'; END IF;
  v_hash := encode(digest(jsonb_build_object('shift_date',p_shift_date,'shift_type',btrim(p_shift_type),'summary',btrim(p_summary),'pending_items',p_pending_items,'critical_patients',p_critical_patients,'notes',NULLIF(btrim(COALESCE(p_notes,'')),''))::TEXT,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company::TEXT || ':' || p_idempotency_key::TEXT,0));
  SELECT * INTO v_existing FROM public.nursing_shift_handoffs WHERE company_id=v_company AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM v_hash THEN RAISE EXCEPTION 'Chave idempotente de enfermagem reutilizada com payload diferente'; END IF;
    RETURN to_jsonb(v_existing)-'request_hash';
  END IF;
  INSERT INTO public.nursing_shift_handoffs(company_id,shift_date,shift_type,summary,pending_items,critical_patients,notes,created_by,idempotency_key,request_hash)
  VALUES(v_company,p_shift_date,btrim(p_shift_type),btrim(p_summary),p_pending_items,p_critical_patients,NULLIF(btrim(COALESCE(p_notes,'')),''),v_actor,p_idempotency_key,v_hash)
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row)-'request_hash';
END
$function$;

REVOKE ALL ON FUNCTION public.nursing_has_permission_secure(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.nursing_actor_context_secure(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_nursing_medication_secure(BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ,UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.bedside_check(BIGINT,BIGINT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.administer_nursing_medication_secure(BIGINT,BIGINT,UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.refuse_nursing_medication_secure(BIGINT,TEXT,UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_nursing_incident_secure(BIGINT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_nursing_procedure_secure(BIGINT,TEXT,TEXT,BOOLEAN,UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_nursing_shift_handoff_secure(DATE,TEXT,TEXT,JSONB,JSONB,TEXT,UUID) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.nursing_has_permission_secure(TEXT) OWNER TO nursing_rpc_owner;
ALTER FUNCTION public.nursing_actor_context_secure(TEXT) OWNER TO nursing_rpc_owner;
ALTER FUNCTION public.create_nursing_medication_secure(BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ,UUID) OWNER TO nursing_rpc_owner;
ALTER FUNCTION public.bedside_check(BIGINT,BIGINT) OWNER TO nursing_rpc_owner;
ALTER FUNCTION public.administer_nursing_medication_secure(BIGINT,BIGINT,UUID) OWNER TO nursing_rpc_owner;
ALTER FUNCTION public.refuse_nursing_medication_secure(BIGINT,TEXT,UUID) OWNER TO nursing_rpc_owner;
ALTER FUNCTION public.report_nursing_incident_secure(BIGINT,TEXT,TEXT,TEXT,UUID) OWNER TO nursing_rpc_owner;
ALTER FUNCTION public.record_nursing_procedure_secure(BIGINT,TEXT,TEXT,BOOLEAN,UUID) OWNER TO nursing_rpc_owner;
ALTER FUNCTION public.create_nursing_shift_handoff_secure(DATE,TEXT,TEXT,JSONB,JSONB,TEXT,UUID) OWNER TO nursing_rpc_owner;

GRANT EXECUTE ON FUNCTION public.nursing_has_permission_secure(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_nursing_medication_secure(BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bedside_check(BIGINT,BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.administer_nursing_medication_secure(BIGINT,BIGINT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_nursing_medication_secure(BIGINT,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_nursing_incident_secure(BIGINT,TEXT,TEXT,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_nursing_procedure_secure(BIGINT,TEXT,TEXT,BOOLEAN,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_nursing_shift_handoff_secure(DATE,TEXT,TEXT,JSONB,JSONB,TEXT,UUID) TO authenticated;

REVOKE ALL ON public.nursing_medication_administrations, public.nursing_incidents,
  public.nursing_procedures, public.nursing_shift_handoffs
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.nursing_medication_administrations, public.nursing_incidents,
  public.nursing_procedures, public.nursing_shift_handoffs TO authenticated;

COMMENT ON FUNCTION public.administer_nursing_medication_secure(BIGINT,BIGINT,UUID) IS
  'Validates the confirmed patient under the medication row lock and atomically records bedside and administration authorship.';


BEGIN;

DO $preconditions$
BEGIN
  IF to_regclass('public.lgpd_termos') IS NULL
     OR to_regclass('public.reception_term_acceptances') IS NULL
     OR to_regclass('public.reception_admin_history') IS NULL
     OR to_regclass('public.patients') IS NULL
     OR to_regclass('public.appointments') IS NULL THEN
    RAISE EXCEPTION 'Reception term catalog dependencies are missing';
  END IF;

  IF to_regrole('prontomedic_reception_rpc_owner') IS NULL THEN
    RAISE EXCEPTION 'Reception RPC owner role is missing';
  END IF;

  IF to_regprocedure(
    'public.record_reception_term_acceptance_secure(bigint,text,text,text,bigint,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Reception term acceptance RPC is missing';
  END IF;
END;
$preconditions$;

ALTER TABLE public.reception_term_acceptances
  ADD COLUMN IF NOT EXISTS catalog_term_id UUID;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'reception_term_acceptances_catalog_term_fk'
       AND conrelid = 'public.reception_term_acceptances'::regclass
  ) THEN
    ALTER TABLE public.reception_term_acceptances
      ADD CONSTRAINT reception_term_acceptances_catalog_term_fk
      FOREIGN KEY (catalog_term_id)
      REFERENCES public.lgpd_termos(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'reception_term_acceptances_catalog_required'
       AND conrelid = 'public.reception_term_acceptances'::regclass
  ) THEN
    ALTER TABLE public.reception_term_acceptances
      ADD CONSTRAINT reception_term_acceptances_catalog_required
      CHECK (catalog_term_id IS NOT NULL)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'reception_term_acceptances_sha256_format'
       AND conrelid = 'public.reception_term_acceptances'::regclass
  ) THEN
    ALTER TABLE public.reception_term_acceptances
      ADD CONSTRAINT reception_term_acceptances_sha256_format
      CHECK (content_hash ~ '^[0-9a-f]{64}$')
      NOT VALID;
  END IF;
END;
$constraints$;

CREATE INDEX IF NOT EXISTS idx_reception_term_acceptances_catalog
  ON public.reception_term_acceptances(
    company_id,
    patient_id,
    catalog_term_id,
    accepted_at DESC
  );

GRANT SELECT ON TABLE public.lgpd_termos
  TO prontomedic_reception_rpc_owner;

DROP POLICY IF EXISTS m11_reception_term_catalog_rpc_read
  ON public.lgpd_termos;
CREATE POLICY m11_reception_term_catalog_rpc_read
  ON public.lgpd_termos
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND lg_ativo = TRUE
  );

CREATE OR REPLACE FUNCTION public.record_reception_term_acceptance_secure(
  p_patient_id BIGINT,
  p_term_code TEXT,
  p_term_version TEXT,
  p_content_hash TEXT,
  p_appointment_id BIGINT DEFAULT NULL,
  p_signature_reference TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_actor RECORD;
  v_company UUID := public.current_company_id();
  v_unit INTEGER;
  v_id UUID;
  v_term RECORD;
  v_client_hash TEXT := lower(btrim(COALESCE(p_content_hash, '')));
  v_computed_hash TEXT;
BEGIN
  SELECT * INTO v_actor
    FROM public.get_scheduling_actor();

  IF v_actor.user_id IS NULL
     OR v_company IS NULL
     OR v_actor.company_id IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional valido';
  END IF;

  IF NOT public.audit_has_role(
    ARRAY[
      'admin',
      'gestor',
      'recepcao',
      'billing',
      'financial',
      'medico',
      'enfermeiro'
    ]::TEXT[]
  ) THEN
    RAISE EXCEPTION 'Perfil sem permissao para aceitar termo';
  END IF;

  IF p_patient_id IS NULL
     OR NULLIF(btrim(p_term_code), '') IS NULL
     OR NULLIF(btrim(p_term_version), '') IS NULL
     OR v_client_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Paciente, termo, versao e hash SHA-256 valido sao obrigatorios';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.patients
     WHERE id = p_patient_id
       AND company_id = v_company
  ) THEN
    RAISE EXCEPTION 'Paciente fora do tenant';
  END IF;

  IF p_appointment_id IS NOT NULL THEN
    SELECT unit_id
      INTO v_unit
      FROM public.appointments
     WHERE id = p_appointment_id
       AND patient_id = p_patient_id
       AND company_id = v_company;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Agendamento invalido para o paciente';
    END IF;
  END IF;

  SELECT id, codigo, versao, texto, texto_hash
    INTO v_term
    FROM public.lgpd_termos
   WHERE company_id = v_company
     AND codigo = btrim(p_term_code)
     AND versao = btrim(p_term_version)
     AND lg_ativo = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Termo versionado ativo nao encontrado no catalogo';
  END IF;

  v_computed_hash := encode(digest(v_term.texto, 'sha256'), 'hex');

  IF v_computed_hash <> lower(btrim(v_term.texto_hash)) THEN
    RAISE EXCEPTION 'Catalogo de termos inconsistente';
  END IF;

  IF v_client_hash <> v_computed_hash THEN
    RAISE EXCEPTION 'Conteudo apresentado diverge do termo ativo';
  END IF;

  INSERT INTO public.reception_term_acceptances(
    company_id,
    unit_id,
    patient_id,
    appointment_id,
    catalog_term_id,
    term_code,
    term_version,
    content_hash,
    accepted_by,
    signature_reference
  )
  VALUES(
    v_company,
    v_unit,
    p_patient_id,
    p_appointment_id,
    v_term.id,
    v_term.codigo,
    v_term.versao,
    v_computed_hash,
    v_actor.user_id,
    NULLIF(btrim(p_signature_reference), '')
  )
  RETURNING id INTO v_id;

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
  VALUES(
    v_company,
    v_unit,
    'term_acceptance',
    v_id::TEXT,
    p_appointment_id,
    NULL,
    'accepted',
    'Termo aceito',
    jsonb_build_object(
      'catalog_term_id', v_term.id,
      'term_code', v_term.codigo,
      'term_version', v_term.versao,
      'content_hash', v_computed_hash,
      'catalog_validated', TRUE
    ),
    v_actor.user_id
  );

  RETURN v_id;
END;
$function$;

ALTER FUNCTION public.record_reception_term_acceptance_secure(
  BIGINT, TEXT, TEXT, TEXT, BIGINT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.record_reception_term_acceptance_secure(
  BIGINT, TEXT, TEXT, TEXT, BIGINT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_reception_term_acceptance_secure(
  BIGINT, TEXT, TEXT, TEXT, BIGINT, TEXT
) TO authenticated, app_prontomedic;

COMMIT;

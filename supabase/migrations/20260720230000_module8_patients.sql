-- Módulo 8: cadastro único de pacientes, vínculos e decisões de duplicidade.
-- Migration aditiva/idempotente para instalações legadas. Não toca DataSIGH.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE IF EXISTS public.patients
  ADD COLUMN IF NOT EXISTS social_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS marital_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS responsible_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS insurance_card_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS allergies TEXT,
  ADD COLUMN IF NOT EXISTS clinical_alerts TEXT,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS clinical_notes TEXT,
  ADD COLUMN IF NOT EXISTS registration_status VARCHAR(20) NOT NULL DEFAULT 'incomplete',
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS inactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inactivated_by UUID;

-- Instalações legadas podem ter criado insurance_plan_id como texto. Preserve
-- os valores numéricos existentes e normalize o tipo antes de criar a FK;
-- valores não numéricos fazem a migration abortar sem alteração parcial.
DO $$
DECLARE
  v_data_type TEXT;
  v_has_column BOOLEAN;
BEGIN
  SELECT data_type INTO v_data_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'patients'
     AND column_name = 'insurance_plan_id';

  v_has_column := v_data_type IS NOT NULL;

  IF NOT v_has_column THEN
    ALTER TABLE public.patients ADD COLUMN insurance_plan_id INTEGER;
  ELSIF v_data_type IN ('character varying', 'text') THEN
    IF EXISTS (
      SELECT 1 FROM public.patients
       WHERE insurance_plan_id IS NOT NULL
         AND btrim(insurance_plan_id::TEXT) <> ''
         AND btrim(insurance_plan_id::TEXT) !~ '^[0-9]+$'
    ) THEN
      RAISE EXCEPTION 'patients.insurance_plan_id contains non-numeric legacy values; migration stopped safely';
    END IF;
    ALTER TABLE public.patients
      ALTER COLUMN insurance_plan_id TYPE INTEGER
      USING NULLIF(btrim(insurance_plan_id::TEXT), '')::INTEGER;
  ELSIF v_data_type NOT IN ('smallint', 'integer', 'bigint') THEN
    RAISE EXCEPTION 'Unsupported patients.insurance_plan_id type: %', v_data_type;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.insurance_plans') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
         WHERE conname = 'patients_insurance_plan_id_fkey'
           AND conrelid = 'public.patients'::regclass
      )
     AND NOT EXISTS (
       SELECT 1
         FROM public.patients p
        WHERE p.insurance_plan_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.insurance_plans ip
             WHERE ip.id = p.insurance_plan_id
          )
     ) THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_insurance_plan_id_fkey
      FOREIGN KEY (insurance_plan_id) REFERENCES public.insurance_plans(id) ON DELETE SET NULL;
  ELSIF to_regclass('public.insurance_plans') IS NOT NULL THEN
    RAISE NOTICE 'M8: orphan legacy insurance_plan_id values preserved; patients FK skipped';
  END IF;
END $$;

ALTER TABLE IF EXISTS public.patients
  DROP CONSTRAINT IF EXISTS patients_registration_status_check,
  DROP CONSTRAINT IF EXISTS patients_status_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patients
     WHERE registration_status IS NOT NULL
       AND registration_status NOT IN ('incomplete', 'complete')
  ) THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_registration_status_check
        CHECK (registration_status IN ('incomplete', 'complete'));
  ELSE
    RAISE NOTICE 'M8: legacy registration_status values preserved; check skipped';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.patients
     WHERE status IS NOT NULL
       AND status NOT IN ('active', 'inactive')
  ) THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_status_check
        CHECK (status IN ('active', 'inactive'));
  ELSE
    RAISE NOTICE 'M8: legacy patient status values preserved; check skipped';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patients_company_cpf_m8
  ON public.patients(company_id, cpf)
  WHERE cpf IS NOT NULL AND btrim(cpf) <> '';
CREATE INDEX IF NOT EXISTS idx_patients_company_name_birth_m8
  ON public.patients(company_id, lower(full_name), birth_date);

-- Impede duplicidade de CPF no mesmo tenant sem quebrar instalações que já
-- possuem dados históricos duplicados. A decisão de similaridade fica auditada.
CREATE OR REPLACE FUNCTION public.patient_reject_duplicate_cpf()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.cpf IS NULL OR btrim(NEW.cpf) = '' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.patients p
     WHERE p.company_id = NEW.company_id
       AND p.id <> COALESCE(NEW.id, -1)
       AND COALESCE(p.lg_ativo, TRUE)
       AND btrim(regexp_replace(p.cpf, '[^0-9]', '', 'g')) =
           btrim(regexp_replace(NEW.cpf, '[^0-9]', '', 'g'))
  ) THEN
    RAISE EXCEPTION 'patient CPF already exists in company'
      USING ERRCODE = '23505', CONSTRAINT = 'patients_company_cpf_unique';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.patient_reject_duplicate_cpf() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_patients_reject_duplicate_cpf ON public.patients;
CREATE TRIGGER trg_patients_reject_duplicate_cpf
  BEFORE INSERT OR UPDATE OF company_id, cpf ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.patient_reject_duplicate_cpf();

CREATE TABLE IF NOT EXISTS public.patient_contacts (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  contact_type VARCHAR(20) NOT NULL CHECK (contact_type IN ('phone', 'email', 'address', 'other')),
  label VARCHAR(80),
  value TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.patient_responsibles (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  full_name VARCHAR(200) NOT NULL,
  relationship VARCHAR(80),
  cpf VARCHAR(14),
  phone VARCHAR(20),
  email VARCHAR(200),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.patient_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  document_type VARCHAR(60) NOT NULL,
  document_number VARCHAR(120),
  document_hash VARCHAR(128),
  storage_ref TEXT,
  expires_at DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.patient_insurances (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE SET NULL,
  card_number VARCHAR(120),
  holder_name VARCHAR(200),
  holder_cpf VARCHAR(14),
  valid_until DATE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.patient_family_links (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  related_patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  relationship VARCHAR(80) NOT NULL,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  CONSTRAINT patient_family_links_not_self CHECK (patient_id <> related_patient_id),
  CONSTRAINT patient_family_links_unique UNIQUE (company_id, patient_id, related_patient_id, relationship)
);

-- Compatibilidade com a tabela legada sem escopo de empresa. O tenant é
-- derivado dos pacientes já existentes; qualquer vínculo órfão ou cruzado
-- interrompe a transação para evitar atribuição incorreta de dados.
DO $$
BEGIN
  IF to_regclass('public.patient_family_links') IS NOT NULL THEN
    ALTER TABLE public.patient_family_links
      ADD COLUMN IF NOT EXISTS company_id UUID,
      ADD COLUMN IF NOT EXISTS lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    UPDATE public.patient_family_links f
       SET company_id = p.company_id
      FROM public.patients p
     WHERE p.id = f.patient_id
       AND f.company_id IS NULL;

    IF EXISTS (
      SELECT 1 FROM public.patient_family_links
       WHERE company_id IS NULL
    ) THEN
      RAISE EXCEPTION 'patient_family_links contains orphan patient references; migration stopped safely';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.patient_family_links f
        JOIN public.patients related ON related.id = f.related_patient_id
       WHERE related.company_id <> f.company_id
    ) THEN
      RAISE EXCEPTION 'patient_family_links contains cross-company references; migration stopped safely';
    END IF;

    ALTER TABLE public.patient_family_links
      ALTER COLUMN company_id SET NOT NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'patient_family_links_company_id_fkey'
         AND conrelid = 'public.patient_family_links'::regclass
    ) THEN
      ALTER TABLE public.patient_family_links
        ADD CONSTRAINT patient_family_links_company_id_fkey
        FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.patient_duplicate_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  candidate_patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  fingerprint TEXT NOT NULL,
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('KEPT', 'MERGED', 'REJECTED')),
  reason TEXT NOT NULL,
  decided_by UUID REFERENCES auth.users(id),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.patient_merge_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  target_patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  merged_by UUID REFERENCES auth.users(id),
  merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT patient_merge_events_not_self CHECK (source_patient_id <> target_patient_id)
);

CREATE TABLE IF NOT EXISTS public.patient_history (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::JSONB,
  actor_id UUID REFERENCES auth.users(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_contacts_scope ON public.patient_contacts(company_id, patient_id, lg_ativo);
CREATE INDEX IF NOT EXISTS idx_patient_responsibles_scope ON public.patient_responsibles(company_id, patient_id, lg_ativo);
CREATE INDEX IF NOT EXISTS idx_patient_documents_scope ON public.patient_documents(company_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_insurances_scope ON public.patient_insurances(company_id, patient_id, status);
CREATE INDEX IF NOT EXISTS idx_patient_family_links_scope ON public.patient_family_links(company_id, patient_id, lg_ativo);
CREATE INDEX IF NOT EXISTS idx_patient_duplicate_decisions_scope ON public.patient_duplicate_decisions(company_id, candidate_patient_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_merge_events_scope ON public.patient_merge_events(company_id, target_patient_id, merged_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_history_scope ON public.patient_history(company_id, patient_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.patient_history_capture()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id UUID;
  v_patient_id BIGINT;
  v_actor_id UUID := NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_company_id := OLD.company_id;
    v_patient_id := OLD.id;
  ELSE
    v_company_id := NEW.company_id;
    v_patient_id := NEW.id;
  END IF;

  INSERT INTO public.patient_history(company_id, patient_id, action, changes, actor_id)
  VALUES (
    v_company_id,
    v_patient_id,
    TG_OP,
    jsonb_build_object('old', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
                       'new', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END),
    v_actor_id
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.patient_history_capture() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_patients_history_m8 ON public.patients;
CREATE TRIGGER trg_patients_history_m8
  AFTER INSERT OR UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.patient_history_capture();

ALTER TABLE public.patient_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_responsibles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_insurances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_family_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_duplicate_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_merge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_history ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.m8_patient_scope_roles()
RETURNS TEXT[] LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT ARRAY['admin','gestor','recepcao','medico','enfermeiro']::TEXT[];
$$;
REVOKE ALL ON FUNCTION public.m8_patient_scope_roles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.m8_patient_scope_roles() TO app_prontomedic, authenticated;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'patient_contacts', 'patient_responsibles', 'patient_documents',
    'patient_insurances', 'patient_family_links', 'patient_duplicate_decisions',
    'patient_merge_events', 'patient_history'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS m8_%s_read ON public.%I', v_table, v_table);
    EXECUTE format('DROP POLICY IF EXISTS m8_%s_write ON public.%I', v_table, v_table);
    EXECUTE format('DROP POLICY IF EXISTS m8_%s_insert ON public.%I', v_table, v_table);
    EXECUTE format('DROP POLICY IF EXISTS m8_%s_update ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE POLICY m8_%s_read ON public.%I FOR SELECT TO app_prontomedic, authenticated USING (company_id = public.audit_current_company_id() AND public.audit_has_role(public.m8_patient_scope_roles()))',
      v_table, v_table
    );
    EXECUTE format(
      'CREATE POLICY m8_%s_insert ON public.%I FOR INSERT TO app_prontomedic, authenticated WITH CHECK (company_id = public.audit_current_company_id() AND public.audit_has_role(public.m8_patient_scope_roles()))',
      v_table, v_table
    );
    EXECUTE format(
      'CREATE POLICY m8_%s_update ON public.%I FOR UPDATE TO app_prontomedic, authenticated USING (company_id = public.audit_current_company_id() AND public.audit_has_role(public.m8_patient_scope_roles())) WITH CHECK (company_id = public.audit_current_company_id() AND public.audit_has_role(public.m8_patient_scope_roles()))',
      v_table, v_table
    );
  END LOOP;
END $$;

-- O histórico é append-only e também recebe linhas de trigger. A permissão de
-- tabela continua restrita pelos GRANTs; PUBLIC aqui só evita que o executor
-- interno do trigger seja confundido com um papel de aplicação.
DROP POLICY IF EXISTS m8_patient_history_insert ON public.patient_history;
CREATE POLICY m8_patient_history_insert
  ON public.patient_history
  FOR INSERT TO PUBLIC
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND public.audit_has_role(public.m8_patient_scope_roles())
  );

-- Unificações alteram a identidade cadastral e exigem privilégio elevado.
DROP POLICY IF EXISTS m8_patient_merge_events_write ON public.patient_merge_events;
DROP POLICY IF EXISTS m8_patient_merge_events_insert ON public.patient_merge_events;
DROP POLICY IF EXISTS m8_patient_merge_events_update ON public.patient_merge_events;
CREATE POLICY m8_patient_merge_events_insert
  ON public.patient_merge_events
  FOR INSERT TO app_prontomedic, authenticated
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND public.audit_has_role(ARRAY['admin', 'gestor']::TEXT[])
  );
CREATE POLICY m8_patient_merge_events_update
  ON public.patient_merge_events
  FOR UPDATE TO app_prontomedic, authenticated
  USING (
    company_id = public.audit_current_company_id()
    AND public.audit_has_role(ARRAY['admin', 'gestor']::TEXT[])
  )
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND public.audit_has_role(ARRAY['admin', 'gestor']::TEXT[])
  );

CREATE OR REPLACE FUNCTION public.patient_merge_patients(
  p_source_patient_id BIGINT,
  p_target_patient_id BIGINT,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id UUID := public.audit_current_company_id();
  v_actor_id UUID := NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
  v_source RECORD;
  v_target RECORD;
BEGIN
  IF p_source_patient_id = p_target_patient_id THEN
    RAISE EXCEPTION 'O paciente de origem deve ser diferente do paciente de destino';
  END IF;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa do contexto não identificada';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A justificativa da unificação é obrigatória';
  END IF;
  IF NOT public.audit_has_role(ARRAY['admin', 'gestor']::TEXT[]) THEN
    RAISE EXCEPTION 'Ação restrita a administrador ou gestor';
  END IF;

  SELECT * INTO v_source
    FROM public.patients
   WHERE id = p_source_patient_id AND company_id = v_company_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente de origem não encontrado no contexto'; END IF;

  SELECT * INTO v_target
    FROM public.patients
   WHERE id = p_target_patient_id AND company_id = v_company_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente de destino não encontrado no contexto'; END IF;

  UPDATE public.patient_contacts SET patient_id = p_target_patient_id, updated_at = NOW()
   WHERE company_id = v_company_id AND patient_id = p_source_patient_id;
  UPDATE public.patient_responsibles SET patient_id = p_target_patient_id, updated_at = NOW()
   WHERE company_id = v_company_id AND patient_id = p_source_patient_id;
  UPDATE public.patient_documents SET patient_id = p_target_patient_id, updated_at = NOW()
   WHERE company_id = v_company_id AND patient_id = p_source_patient_id;
  UPDATE public.patient_insurances SET patient_id = p_target_patient_id, updated_at = NOW()
   WHERE company_id = v_company_id AND patient_id = p_source_patient_id;

  UPDATE public.patient_family_links AS f
     SET patient_id = p_target_patient_id
   WHERE f.company_id = v_company_id
     AND f.patient_id = p_source_patient_id
     AND NOT EXISTS (
       SELECT 1 FROM public.patient_family_links AS existing
        WHERE existing.company_id = v_company_id
          AND existing.patient_id = p_target_patient_id
          AND existing.related_patient_id = f.related_patient_id
          AND existing.relationship = f.relationship
     );
  UPDATE public.patient_family_links AS f
     SET related_patient_id = p_target_patient_id
   WHERE f.company_id = v_company_id
     AND f.related_patient_id = p_source_patient_id
     AND NOT EXISTS (
       SELECT 1 FROM public.patient_family_links AS existing
        WHERE existing.company_id = v_company_id
          AND existing.patient_id = f.patient_id
          AND existing.related_patient_id = p_target_patient_id
          AND existing.relationship = f.relationship
     );
  UPDATE public.patient_family_links
     SET lg_ativo = FALSE
   WHERE company_id = v_company_id
     AND (patient_id = p_source_patient_id OR related_patient_id = p_source_patient_id);

  UPDATE public.patients
     SET status = 'inactive', lg_ativo = FALSE,
         inactivated_at = NOW(), inactivated_by = v_actor_id,
         updated_at = NOW()
   WHERE id = p_source_patient_id AND company_id = v_company_id;

  INSERT INTO public.patient_merge_events(
    company_id, source_patient_id, target_patient_id, reason, snapshot, merged_by
  ) VALUES (
    v_company_id, p_source_patient_id, p_target_patient_id, btrim(p_reason),
    jsonb_build_object('source', to_jsonb(v_source), 'target', to_jsonb(v_target)),
    v_actor_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.patient_merge_patients(BIGINT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.patient_merge_patients(BIGINT, BIGINT, TEXT) TO app_prontomedic, authenticated;

CREATE OR REPLACE FUNCTION public.patient_create_with_duplicate_decision(
  p_patient JSONB,
  p_candidates JSONB,
  p_reason TEXT,
  p_fingerprint TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id UUID := public.audit_current_company_id();
  v_patient_id BIGINT;
BEGIN
  IF v_company_id IS NULL OR (p_patient->>'company_id')::UUID <> v_company_id THEN
    RAISE EXCEPTION 'Empresa do cadastro não corresponde ao contexto';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' OR p_fingerprint IS NULL OR btrim(p_fingerprint) = '' THEN
    RAISE EXCEPTION 'Decisão de duplicidade incompleta';
  END IF;
  IF NOT public.audit_has_role(public.m8_patient_scope_roles()) THEN
    RAISE EXCEPTION 'Perfil sem permissão para cadastrar paciente';
  END IF;

  INSERT INTO public.patients(
    company_id, full_name, cpf, birth_date, sex, phone, email,
    marital_status, responsible_name, emergency_contact_name,
    emergency_contact_phone, insurance_plan_id, insurance_card_number,
    allergies, clinical_alerts, admin_notes, clinical_notes,
    registration_status, status, lg_ativo
  ) VALUES (
    v_company_id, btrim(p_patient->>'full_name'), NULLIF(p_patient->>'cpf', ''),
    (p_patient->>'birth_date')::DATE, p_patient->>'sex',
    NULLIF(p_patient->>'phone', ''), NULLIF(p_patient->>'email', ''),
    NULLIF(p_patient->>'marital_status', ''), NULLIF(p_patient->>'responsible_name', ''),
    NULLIF(p_patient->>'emergency_contact_name', ''), NULLIF(p_patient->>'emergency_contact_phone', ''),
    NULLIF(p_patient->>'insurance_plan_id', '')::INTEGER, NULLIF(p_patient->>'insurance_card_number', ''),
    NULLIF(p_patient->>'allergies', ''), NULLIF(p_patient->>'clinical_alerts', ''),
    NULLIF(p_patient->>'admin_notes', ''), NULLIF(p_patient->>'clinical_notes', ''),
    'complete', 'active', TRUE
  ) RETURNING id INTO v_patient_id;

  INSERT INTO public.patient_duplicate_decisions(
    company_id, candidate_patient_id, fingerprint, decision, reason, decided_by
  )
  SELECT v_company_id, (candidate->>'id')::BIGINT, p_fingerprint, 'KEPT', btrim(p_reason), p_actor_id
    FROM jsonb_array_elements(COALESCE(p_candidates, '[]'::JSONB)) AS candidate;

  RETURN v_patient_id;
END;
$$;

REVOKE ALL ON FUNCTION public.patient_create_with_duplicate_decision(JSONB, JSONB, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.patient_create_with_duplicate_decision(JSONB, JSONB, TEXT, TEXT, UUID) TO app_prontomedic, authenticated;

GRANT SELECT, INSERT, UPDATE ON
  public.patient_contacts, public.patient_responsibles, public.patient_documents,
  public.patient_insurances, public.patient_family_links, public.patient_duplicate_decisions,
  public.patient_merge_events, public.patient_history
TO app_prontomedic, authenticated;
REVOKE DELETE ON
  public.patient_contacts, public.patient_responsibles, public.patient_documents,
  public.patient_insurances, public.patient_family_links, public.patient_duplicate_decisions,
  public.patient_merge_events, public.patient_history
FROM app_prontomedic, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_prontomedic, authenticated;

COMMENT ON TABLE public.patient_duplicate_decisions IS 'Decisão explícita e auditável diante de candidato duplicado no cadastro de pacientes.';
COMMENT ON TABLE public.patient_merge_events IS 'Histórico de unificações; nenhuma exclusão física deve ser feita pelo frontend.';
COMMENT ON TABLE public.patient_history IS 'Histórico cadastral do paciente, separado do prontuário clínico.';

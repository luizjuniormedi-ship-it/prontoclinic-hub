-- Canonical tenant-safe read models for TISS denials and operator protocols.
-- This migration performs no speculative backfill and exposes no TISS payload,
-- endpoint, credential, certificate, or tenant identifier to browser clients.

CREATE TABLE IF NOT EXISTS public.tiss_glosas (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  cd_tiss_xml BIGINT NOT NULL,
  cd_glosa_code VARCHAR(20),
  ds_motivo TEXT,
  vl_glosa NUMERIC(10,2) NOT NULL,
  dt_glosa DATE NOT NULL DEFAULT CURRENT_DATE,
  lg_recurso_enviado BOOLEAN NOT NULL DEFAULT FALSE,
  dt_recurso DATE,
  ds_protocolo_recurso VARCHAR(50),
  ds_status_recurso VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
  cd_procedimento_tuss VARCHAR(20),
  cd_executante VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tiss_protocols (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  cd_convenio INTEGER NOT NULL,
  ds_endpoint VARCHAR(255) NOT NULL,
  ds_versao_tiss VARCHAR(10) NOT NULL DEFAULT '3.05.00',
  tp_ambiente VARCHAR(20) NOT NULL DEFAULT 'HOMOLOGACAO',
  cd_certificado_a1_path TEXT,
  ds_certificado_senha TEXT,
  ds_usuario VARCHAR(50),
  ds_senha TEXT,
  lg_active BOOLEAN NOT NULL DEFAULT TRUE,
  ds_observacao TEXT,
  dt_ultimo_teste TIMESTAMPTZ,
  ds_status_teste VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tiss_glosas
  ADD COLUMN IF NOT EXISTS company_id UUID,
  ADD COLUMN IF NOT EXISTS cd_tiss_xml BIGINT,
  ADD COLUMN IF NOT EXISTS cd_glosa_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS ds_motivo TEXT,
  ADD COLUMN IF NOT EXISTS vl_glosa NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS dt_glosa DATE,
  ADD COLUMN IF NOT EXISTS lg_recurso_enviado BOOLEAN,
  ADD COLUMN IF NOT EXISTS dt_recurso DATE,
  ADD COLUMN IF NOT EXISTS ds_protocolo_recurso VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ds_status_recurso VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cd_procedimento_tuss VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cd_executante VARCHAR(50),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE public.tiss_glosas
  ALTER COLUMN dt_glosa SET DEFAULT CURRENT_DATE,
  ALTER COLUMN lg_recurso_enviado SET DEFAULT FALSE,
  ALTER COLUMN ds_status_recurso SET DEFAULT 'PENDENTE',
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE public.tiss_protocols
  ADD COLUMN IF NOT EXISTS company_id UUID,
  ADD COLUMN IF NOT EXISTS cd_convenio INTEGER,
  ADD COLUMN IF NOT EXISTS ds_versao_tiss VARCHAR(10),
  ADD COLUMN IF NOT EXISTS tp_ambiente VARCHAR(20),
  ADD COLUMN IF NOT EXISTS lg_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS ds_observacao TEXT,
  ADD COLUMN IF NOT EXISTS dt_ultimo_teste TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ds_status_teste VARCHAR(20),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE public.tiss_protocols
  ALTER COLUMN ds_versao_tiss SET DEFAULT '3.05.00',
  ALTER COLUMN tp_ambiente SET DEFAULT 'HOMOLOGACAO',
  ALTER COLUMN lg_active SET DEFAULT TRUE,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tiss_glosas
     WHERE company_id IS NULL OR cd_tiss_xml IS NULL
  ) THEN
    RAISE EXCEPTION
      'tiss_glosas possui referencias tenant nulas; saneamento controlado obrigatorio';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tiss_protocols
     WHERE company_id IS NULL OR cd_convenio IS NULL
  ) THEN
    RAISE EXCEPTION
      'tiss_protocols possui referencias tenant nulas; saneamento controlado obrigatorio';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tiss_glosas
     WHERE vl_glosa IS NULL
        OR vl_glosa < 0
        OR dt_glosa IS NULL
        OR lg_recurso_enviado IS NULL
        OR ds_status_recurso IS NULL
        OR created_at IS NULL
        OR updated_at IS NULL
        OR ds_status_recurso NOT IN (
          'PENDENTE', 'ENVIADO', 'DEFERIDO', 'INDEFERIDO', 'PARCIAL'
        )
  ) THEN
    RAISE EXCEPTION
      'tiss_glosas possui valor/status invalido; saneamento controlado obrigatorio';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tiss_protocols
     WHERE ds_versao_tiss IS NULL
        OR tp_ambiente IS NULL
        OR lg_active IS NULL
        OR created_at IS NULL
        OR updated_at IS NULL
        OR tp_ambiente NOT IN ('HOMOLOGACAO', 'PRODUCAO')
  ) THEN
    RAISE EXCEPTION
      'tiss_protocols possui ambiente invalido; saneamento controlado obrigatorio';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tiss_glosas AS glosa
    LEFT JOIN public.companies AS company ON company.id = glosa.company_id
    LEFT JOIN public.tiss_xml AS tiss
      ON tiss.company_id = glosa.company_id AND tiss.id = glosa.cd_tiss_xml
    WHERE company.id IS NULL OR tiss.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'tiss_glosas possui referencias tenant divergentes; saneamento controlado obrigatorio';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tiss_protocols AS protocol
    LEFT JOIN public.companies AS company ON company.id = protocol.company_id
    LEFT JOIN public.insurance_companies AS operator
      ON operator.company_id = protocol.company_id
     AND operator.id = protocol.cd_convenio
    WHERE company.id IS NULL OR operator.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'tiss_protocols possui referencias tenant divergentes; saneamento controlado obrigatorio';
  END IF;

  IF EXISTS (
    SELECT company_id, cd_convenio, tp_ambiente
      FROM public.tiss_protocols
     GROUP BY company_id, cd_convenio, tp_ambiente
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'tiss_protocols possui operadora/ambiente duplicado; saneamento controlado obrigatorio';
  END IF;
END
$migration$;

ALTER TABLE public.tiss_glosas
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN cd_tiss_xml SET NOT NULL,
  ALTER COLUMN vl_glosa SET NOT NULL,
  ALTER COLUMN dt_glosa SET NOT NULL,
  ALTER COLUMN lg_recurso_enviado SET NOT NULL,
  ALTER COLUMN ds_status_recurso SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.tiss_protocols
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN cd_convenio SET NOT NULL,
  ALTER COLUMN ds_versao_tiss SET NOT NULL,
  ALTER COLUMN tp_ambiente SET NOT NULL,
  ALTER COLUMN lg_active SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tiss_glosas'::REGCLASS
       AND conname = 'tiss_glosas_nonnegative_amount_check'
  ) THEN
    ALTER TABLE public.tiss_glosas
      ADD CONSTRAINT tiss_glosas_nonnegative_amount_check
      CHECK (vl_glosa >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tiss_glosas'::REGCLASS
       AND conname = 'tiss_glosas_status_check'
  ) THEN
    ALTER TABLE public.tiss_glosas
      ADD CONSTRAINT tiss_glosas_status_check
      CHECK (ds_status_recurso IN (
        'PENDENTE', 'ENVIADO', 'DEFERIDO', 'INDEFERIDO', 'PARCIAL'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tiss_protocols'::REGCLASS
       AND conname = 'tiss_protocols_environment_check'
  ) THEN
    ALTER TABLE public.tiss_protocols
      ADD CONSTRAINT tiss_protocols_environment_check
      CHECK (tp_ambiente IN ('HOMOLOGACAO', 'PRODUCAO'));
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS tiss_protocols_company_operator_environment_key
  ON public.tiss_protocols(company_id, cd_convenio, tp_ambiente);

CREATE UNIQUE INDEX IF NOT EXISTS tiss_xml_company_id_id_key
  ON public.tiss_xml(company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS insurance_companies_company_id_id_key
  ON public.insurance_companies(company_id, id);

DO $migration$
DECLARE
  v_constraint RECORD;
BEGIN
  FOR v_constraint IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.tiss_glosas'::REGCLASS
       AND contype = 'f'
       AND confrelid = 'public.tiss_xml'::REGCLASS
       AND conkey = ARRAY[
         (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'public.tiss_glosas'::REGCLASS
             AND attname = 'cd_tiss_xml')
       ]::SMALLINT[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.tiss_glosas DROP CONSTRAINT %I',
      v_constraint.conname
    );
  END LOOP;

  FOR v_constraint IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.tiss_protocols'::REGCLASS
       AND contype = 'f'
       AND confrelid = 'public.insurance_companies'::REGCLASS
       AND conkey = ARRAY[
         (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'public.tiss_protocols'::REGCLASS
             AND attname = 'cd_convenio')
       ]::SMALLINT[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.tiss_protocols DROP CONSTRAINT %I',
      v_constraint.conname
    );
  END LOOP;
END
$migration$;

DO $migration$
DECLARE
  v_constraint RECORD;
BEGIN
  FOR v_constraint IN
    SELECT c.conname, c.conrelid::REGCLASS AS table_name
      FROM pg_constraint AS c
     WHERE c.conrelid IN (
         'public.tiss_glosas'::REGCLASS,
         'public.tiss_protocols'::REGCLASS
       )
       AND c.contype = 'f'
       AND c.confrelid = 'public.companies'::REGCLASS
       AND NOT c.convalidated
       AND c.conkey = ARRAY[(
         SELECT attnum FROM pg_attribute
          WHERE attrelid = c.conrelid AND attname = 'company_id'
       )]::SMALLINT[]
  LOOP
    EXECUTE format(
      'ALTER TABLE %s VALIDATE CONSTRAINT %I',
      v_constraint.table_name,
      v_constraint.conname
    );
  END LOOP;
END
$migration$;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tiss_glosas'::REGCLASS
       AND conname = 'tiss_glosas_company_tiss_xml_fkey'
  ) THEN
    ALTER TABLE public.tiss_glosas
      ADD CONSTRAINT tiss_glosas_company_tiss_xml_fkey
      FOREIGN KEY (company_id, cd_tiss_xml)
      REFERENCES public.tiss_xml(company_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tiss_protocols'::REGCLASS
       AND conname = 'tiss_protocols_company_insurance_fkey'
  ) THEN
    ALTER TABLE public.tiss_protocols
      ADD CONSTRAINT tiss_protocols_company_insurance_fkey
      FOREIGN KEY (company_id, cd_convenio)
      REFERENCES public.insurance_companies(company_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE public.tiss_glosas
  VALIDATE CONSTRAINT tiss_glosas_company_tiss_xml_fkey;
ALTER TABLE public.tiss_protocols
  VALIDATE CONSTRAINT tiss_protocols_company_insurance_fkey;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tiss_glosas'::REGCLASS
       AND contype = 'f'
       AND confrelid = 'public.companies'::REGCLASS
       AND conkey = ARRAY[(
         SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.tiss_glosas'::REGCLASS AND attname = 'company_id'
       )]::SMALLINT[]
  ) THEN
    ALTER TABLE public.tiss_glosas
      ADD CONSTRAINT tiss_glosas_company_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id)
      ON DELETE RESTRICT NOT VALID;
    ALTER TABLE public.tiss_glosas VALIDATE CONSTRAINT tiss_glosas_company_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tiss_protocols'::REGCLASS
       AND contype = 'f'
       AND confrelid = 'public.companies'::REGCLASS
       AND conkey = ARRAY[(
         SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.tiss_protocols'::REGCLASS AND attname = 'company_id'
       )]::SMALLINT[]
  ) THEN
    ALTER TABLE public.tiss_protocols
      ADD CONSTRAINT tiss_protocols_company_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id)
      ON DELETE RESTRICT NOT VALID;
    ALTER TABLE public.tiss_protocols VALIDATE CONSTRAINT tiss_protocols_company_fkey;
  END IF;
END
$migration$;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.tiss_glosas'::REGCLASS
       AND tgname = 'trg_tiss_glosas_updated_at'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_tiss_glosas_updated_at
      BEFORE UPDATE ON public.tiss_glosas
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.tiss_protocols'::REGCLASS
       AND tgname = 'trg_tiss_protocols_updated_at'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_tiss_protocols_updated_at
      BEFORE UPDATE ON public.tiss_protocols
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idx_tiss_glosas_company_date
  ON public.tiss_glosas(company_id, dt_glosa DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tiss_glosas_company_xml
  ON public.tiss_glosas(company_id, cd_tiss_xml);
CREATE INDEX IF NOT EXISTS idx_tiss_protocols_company_insurance
  ON public.tiss_protocols(company_id, cd_convenio, id);

ALTER TABLE public.tiss_glosas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_glosas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_protocols FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tiss_glosas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tiss_protocols FROM PUBLIC, anon, authenticated;

DO $migration$
BEGIN
  IF to_regprocedure('public.tiss_get_stats(uuid,integer)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.tiss_get_stats(UUID, INTEGER) FROM PUBLIC, anon, authenticated';
  END IF;

  IF to_regclass('public.vw_tiss_glosas_pendentes') IS NOT NULL THEN
    EXECUTE 'REVOKE SELECT ON TABLE public.vw_tiss_glosas_pendentes FROM PUBLIC, anon, authenticated';
  END IF;
END
$migration$;

DO $migration$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('tiss_glosas', 'tiss_protocols')
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  END LOOP;

  CREATE POLICY tiss_glosas_tenant_select
    ON public.tiss_glosas FOR SELECT TO authenticated
    USING (company_id = public.get_my_company_id());
  CREATE POLICY tiss_protocols_tenant_select
    ON public.tiss_protocols FOR SELECT TO authenticated
    USING (company_id = public.get_my_company_id());
END
$migration$;

CREATE OR REPLACE FUNCTION public.list_tiss_glosas_read_secure(
  p_tiss_xml_id BIGINT DEFAULT NULL
)
RETURNS TABLE(
  id BIGINT,
  tiss_xml_id BIGINT,
  billing_id BIGINT,
  denial_code VARCHAR(20),
  denial_reason TEXT,
  denial_amount NUMERIC,
  denial_date DATE,
  appeal_sent BOOLEAN,
  appeal_date DATE,
  appeal_protocol VARCHAR(50),
  appeal_status VARCHAR(20),
  procedure_code VARCHAR(20),
  executor_code VARCHAR(50),
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT actor.company_id
    INTO v_company_id
    FROM public.user_profiles AS actor
    JOIN public.roles AS actor_role
      ON lower(actor_role.name) = lower(actor.role_name)
     AND actor_role.lg_ativo = TRUE
    JOIN public.role_permissions AS permission
      ON permission.role_id = actor_role.id
     AND permission.module = 'faturamento'
     AND permission.can_view = TRUE
   WHERE actor.id = auth.uid()
     AND actor.company_id IS NOT NULL
     AND COALESCE(actor.lg_ativo, FALSE) = TRUE
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil ativo sem permissao para consultar glosas TISS'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    glosa.id,
    glosa.cd_tiss_xml,
    tiss.billing_id,
    glosa.cd_glosa_code,
    glosa.ds_motivo,
    glosa.vl_glosa,
    glosa.dt_glosa,
    COALESCE(glosa.lg_recurso_enviado, FALSE),
    glosa.dt_recurso,
    glosa.ds_protocolo_recurso,
    glosa.ds_status_recurso,
    glosa.cd_procedimento_tuss,
    glosa.cd_executante,
    glosa.created_at,
    glosa.updated_at
  FROM public.tiss_glosas AS glosa
  JOIN public.tiss_xml AS tiss
    ON tiss.company_id = glosa.company_id
   AND tiss.id = glosa.cd_tiss_xml
  WHERE glosa.company_id = v_company_id
    AND (p_tiss_xml_id IS NULL OR glosa.cd_tiss_xml = p_tiss_xml_id)
  ORDER BY glosa.dt_glosa DESC, glosa.id DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_tiss_protocols_read_secure()
RETURNS TABLE(
  id BIGINT,
  insurance_company_id INTEGER,
  insurance_company_name VARCHAR(100),
  tiss_version VARCHAR(10),
  environment VARCHAR(20),
  active BOOLEAN,
  last_test_at TIMESTAMPTZ,
  last_test_status VARCHAR(20),
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT actor.company_id
    INTO v_company_id
    FROM public.user_profiles AS actor
    JOIN public.roles AS actor_role
      ON lower(actor_role.name) = lower(actor.role_name)
     AND actor_role.lg_ativo = TRUE
    JOIN public.role_permissions AS permission
      ON permission.role_id = actor_role.id
     AND permission.module = 'faturamento'
     AND permission.can_view = TRUE
   WHERE actor.id = auth.uid()
     AND actor.company_id IS NOT NULL
     AND COALESCE(actor.lg_ativo, FALSE) = TRUE
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil ativo sem permissao para consultar protocolos TISS'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    protocol.id::BIGINT,
    protocol.cd_convenio::INTEGER,
    operator.name::VARCHAR(100),
    protocol.ds_versao_tiss,
    protocol.tp_ambiente,
    COALESCE(protocol.lg_active, FALSE),
    protocol.dt_ultimo_teste,
    protocol.ds_status_teste,
    protocol.created_at,
    protocol.updated_at
  FROM public.tiss_protocols AS protocol
  JOIN public.insurance_companies AS operator
    ON operator.company_id = protocol.company_id
   AND operator.id = protocol.cd_convenio
  WHERE protocol.company_id = v_company_id
  ORDER BY operator.name, protocol.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_tiss_glosas_read_secure(BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_tiss_protocols_read_secure()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tiss_glosas_read_secure(BIGINT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tiss_protocols_read_secure()
  TO authenticated;

COMMENT ON FUNCTION public.list_tiss_glosas_read_secure(BIGINT) IS
  'Tenant-scoped read-only TISS denial projection without XML or company_id.';
COMMENT ON FUNCTION public.list_tiss_protocols_read_secure() IS
  'Tenant-scoped read-only protocol metadata without endpoints, credentials, certificates, XML, or company_id.';

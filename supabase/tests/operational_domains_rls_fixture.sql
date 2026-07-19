\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    CREATE ROLE app_prontomedic NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
ALTER FUNCTION auth.uid() SET search_path = pg_catalog;

CREATE TABLE public.companies (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  role_name text NOT NULL
);

CREATE OR REPLACE FUNCTION public.request_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.company_id', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION public.current_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT company_id FROM public.user_profiles WHERE id = auth.uid()
$$;
CREATE OR REPLACE FUNCTION public.is_lab_user(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = uid AND role_name IN ('admin', 'laboratorio', 'laboratório', 'medico')
  )
$$;
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles WHERE id = uid AND role_name = 'admin'
  )
$$;

CREATE TABLE public.exames_lab_catalogo (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  ds_exame text NOT NULL,
  ds_sigla text NOT NULL
);
CREATE TABLE public.exames_lab_valor_referencia (
  id bigserial PRIMARY KEY,
  cd_exame bigint NOT NULL REFERENCES public.exames_lab_catalogo(id),
  ds_parametro text NOT NULL
);
CREATE TABLE public.exames_lab_pedido (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  cd_paciente bigint NOT NULL,
  cd_medico bigint NOT NULL
);
CREATE TABLE public.exames_lab_pedido_itens (
  id bigserial PRIMARY KEY,
  cd_pedido bigint NOT NULL REFERENCES public.exames_lab_pedido(id),
  cd_exame bigint NOT NULL REFERENCES public.exames_lab_catalogo(id)
);
CREATE TABLE public.exames_lab_resultado (
  id bigserial PRIMARY KEY,
  cd_item_pedido bigint NOT NULL REFERENCES public.exames_lab_pedido_itens(id),
  cd_valor_referencia bigint REFERENCES public.exames_lab_valor_referencia(id),
  ds_parametro text NOT NULL
);
CREATE TABLE public.exames_lab_alerta_critico (
  id bigserial PRIMARY KEY,
  cd_resultado bigint NOT NULL REFERENCES public.exames_lab_resultado(id),
  cd_paciente bigint NOT NULL,
  cd_medico bigint NOT NULL
);

CREATE TABLE public.nps_pesquisas (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  ds_titulo text NOT NULL
);
CREATE TABLE public.nps_respostas (
  id bigserial PRIMARY KEY,
  cd_pesquisa bigint NOT NULL REFERENCES public.nps_pesquisas(id),
  cd_paciente bigint NOT NULL,
  nr_nota_nps smallint CHECK (nr_nota_nps BETWEEN 0 AND 10),
  UNIQUE (cd_pesquisa, cd_paciente)
);

CREATE TABLE public.pre_cadastro (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  full_name text NOT NULL,
  cpf text NOT NULL,
  email text NOT NULL,
  versao_termo text NOT NULL,
  texto_termo_hash char(64) NOT NULL,
  token_confirmacao text NOT NULL,
  dt_token_exp timestamptz NOT NULL
);

CREATE TABLE public.notification_templates (
  id uuid PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id),
  code text UNIQUE NOT NULL,
  channel text NOT NULL,
  body text NOT NULL
);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  recipient_type text NOT NULL,
  recipient_id bigint,
  channel text NOT NULL,
  body text NOT NULL
);
CREATE TABLE public.notification_preferences (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  recipient_type text NOT NULL,
  recipient_id bigint NOT NULL,
  channel text NOT NULL
);
CREATE TABLE public.notification_logs (
  id bigserial PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES public.notifications(id),
  attempt_number smallint NOT NULL,
  channel text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL
);

ALTER TABLE public.nps_respostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_cadastro ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anonymous can submit NPS" ON public.nps_respostas
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "pre_cadastro_anon_insert" ON public.pre_cadastro
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(full_name) >= 3
    AND length(cpf) IN (11, 14)
    AND length(email) >= 5
    AND email LIKE '%@%'
  );

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_company_id() TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_lab_user(uuid), public.is_admin(uuid) TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON public.nps_respostas, public.pre_cadastro TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

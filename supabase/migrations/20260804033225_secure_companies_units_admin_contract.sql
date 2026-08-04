BEGIN;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS units_admin ON public.units;
DROP POLICY IF EXISTS units_insert ON public.units;
DROP POLICY IF EXISTS units_update ON public.units;
DROP POLICY IF EXISTS units_delete ON public.units;

REVOKE INSERT, UPDATE, DELETE ON public.companies FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.units FROM authenticated;
REVOKE USAGE, UPDATE ON SEQUENCE public.units_id_seq FROM authenticated;

CREATE OR REPLACE FUNCTION public.update_active_company_admin(
  p_name TEXT,
  p_cnpj TEXT,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL
)
RETURNS public.companies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = off
AS $function$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_name TEXT := btrim(p_name);
  v_cnpj TEXT := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  v_company public.companies%ROWTYPE;
BEGIN
  IF v_company_id IS NULL
     OR NOT public.current_context_is_company_admin(v_company_id) THEN
    RAISE EXCEPTION 'Alteracao de empresa exige contexto administrativo AAL2'
      USING ERRCODE = '42501';
  END IF;
  IF v_name = '' OR length(v_name) > 200 THEN
    RAISE EXCEPTION 'Nome da empresa invalido' USING ERRCODE = '23514';
  END IF;
  IF length(v_cnpj) <> 14 THEN
    RAISE EXCEPTION 'CNPJ deve conter 14 digitos' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(btrim(coalesce(p_email, '')), '') IS NOT NULL
     AND btrim(p_email) !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'E-mail invalido' USING ERRCODE = '23514';
  END IF;

  UPDATE public.companies
     SET name = v_name,
         cnpj = v_cnpj,
         phone = NULLIF(btrim(coalesce(p_phone, '')), ''),
         email = lower(NULLIF(btrim(coalesce(p_email, '')), '')),
         updated_at = NOW()
   WHERE id = v_company_id
   RETURNING * INTO v_company;

  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa ativa nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_company;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_active_company_unit_admin(
  p_unit_id INTEGER,
  p_code TEXT,
  p_name TEXT,
  p_type TEXT,
  p_cnpj TEXT DEFAULT NULL,
  p_active BOOLEAN DEFAULT TRUE
)
RETURNS public.units
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = off
AS $function$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_code TEXT := upper(btrim(p_code));
  v_name TEXT := btrim(p_name);
  v_type TEXT := lower(btrim(p_type));
  v_persisted_type TEXT;
  v_cnpj TEXT := NULLIF(regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g'), '');
  v_unit public.units%ROWTYPE;
BEGIN
  IF v_company_id IS NULL
     OR NOT public.current_context_is_company_admin(v_company_id) THEN
    RAISE EXCEPTION 'Alteracao de unidade exige contexto administrativo AAL2'
      USING ERRCODE = '42501';
  END IF;
  IF v_code = '' OR length(v_code) > 20 OR v_code !~ '^[A-Z0-9_-]+$' THEN
    RAISE EXCEPTION 'Codigo da unidade invalido' USING ERRCODE = '23514';
  END IF;
  IF v_name = '' OR length(v_name) > 100 THEN
    RAISE EXCEPTION 'Nome da unidade invalido' USING ERRCODE = '23514';
  END IF;
  IF v_type NOT IN ('matriz', 'filial', 'ambulatorio', 'laboratorio', 'hospital', 'upa', 'ubs', 'consultorio') THEN
    RAISE EXCEPTION 'Tipo da unidade invalido' USING ERRCODE = '23514';
  END IF;
  v_persisted_type := CASE v_type
    WHEN 'matriz' THEN 'MATRIZ'
    WHEN 'filial' THEN 'FILIAL'
    WHEN 'ambulatorio' THEN 'CLINICA'
    WHEN 'laboratorio' THEN 'LABORATORIO'
    WHEN 'hospital' THEN 'HOSPITAL'
    WHEN 'upa' THEN 'UPA'
    WHEN 'ubs' THEN 'UBS'
    WHEN 'consultorio' THEN 'CONSULTORIO'
  END;
  IF v_cnpj IS NOT NULL AND length(v_cnpj) <> 14 THEN
    RAISE EXCEPTION 'CNPJ deve conter 14 digitos' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text, 0));
  IF v_type = 'matriz' AND EXISTS (
    SELECT 1 FROM public.units
     WHERE company_id = v_company_id
       AND lg_principal = TRUE
       AND lg_ativo = TRUE
       AND (p_unit_id IS NULL OR id <> p_unit_id)
  ) THEN
    RAISE EXCEPTION 'A empresa ativa ja possui uma unidade matriz'
      USING ERRCODE = '23505';
  END IF;

  IF p_unit_id IS NULL THEN
    INSERT INTO public.units (
      company_id, cd_codigo, ds_nome, tp_unidade, nr_cnpj,
      lg_principal, lg_ativo
    ) VALUES (
      v_company_id, v_code, v_name, v_persisted_type, v_cnpj,
      v_type = 'matriz', p_active
    ) RETURNING * INTO v_unit;
  ELSE
    UPDATE public.units
       SET cd_codigo = v_code,
           ds_nome = v_name,
           tp_unidade = v_persisted_type,
           nr_cnpj = v_cnpj,
           lg_principal = v_type = 'matriz',
           lg_ativo = p_active,
           updated_at = NOW()
     WHERE id = p_unit_id
       AND company_id = v_company_id
     RETURNING * INTO v_unit;
    IF v_unit.id IS NULL THEN
      RAISE EXCEPTION 'Unidade nao encontrada na empresa ativa' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN v_unit;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Codigo de unidade ja utilizado nesta empresa'
      USING ERRCODE = '23505';
END;
$function$;

ALTER FUNCTION public.update_active_company_admin(TEXT, TEXT, TEXT, TEXT)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION public.upsert_active_company_unit_admin(INTEGER, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
  OWNER TO prontomedic_rpc_owner;
GRANT SELECT, UPDATE ON public.companies TO prontomedic_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON public.units TO prontomedic_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.units_id_seq TO prontomedic_rpc_owner;

REVOKE ALL ON FUNCTION public.update_active_company_admin(TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.upsert_active_company_unit_admin(INTEGER, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_active_company_admin(TEXT, TEXT, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_active_company_unit_admin(INTEGER, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
  TO authenticated;

COMMENT ON FUNCTION public.update_active_company_admin(TEXT, TEXT, TEXT, TEXT) IS
  'Updates only the company selected in an active administrative AAL2 context.';
COMMENT ON FUNCTION public.upsert_active_company_unit_admin(INTEGER, TEXT, TEXT, TEXT, TEXT, BOOLEAN) IS
  'Creates or updates a unit only inside the company selected in an active administrative AAL2 context.';

DO $audit$
DECLARE
  v_authenticated oid := to_regrole('authenticated');
BEGIN
  IF NOT COALESCE((
    SELECT count(*) = 2
       AND bool_and(relrowsecurity)
       AND bool_and(relforcerowsecurity)
    FROM pg_class
    WHERE oid IN ('public.companies'::regclass, 'public.units'::regclass)
  ), false) THEN
    RAISE EXCEPTION 'Auditoria falhou: RLS/FORCE RLS de empresas e unidades';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'units'
      AND policyname IN ('units_admin', 'units_insert', 'units_update', 'units_delete')
  ) THEN
    RAISE EXCEPTION 'Auditoria falhou: policies legadas de unidades permanecem ativas';
  END IF;

  IF v_authenticated IS NULL
     OR has_table_privilege(v_authenticated, 'public.companies', 'INSERT')
     OR has_table_privilege(v_authenticated, 'public.companies', 'UPDATE')
     OR has_table_privilege(v_authenticated, 'public.companies', 'DELETE')
     OR has_table_privilege(v_authenticated, 'public.units', 'INSERT')
     OR has_table_privilege(v_authenticated, 'public.units', 'UPDATE')
     OR has_table_privilege(v_authenticated, 'public.units', 'DELETE') THEN
    RAISE EXCEPTION 'Auditoria falhou: DML direto permanece concedido a authenticated';
  END IF;

  IF NOT has_function_privilege(v_authenticated,
       'public.update_active_company_admin(text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege(v_authenticated,
       'public.upsert_active_company_unit_admin(integer,text,text,text,text,boolean)', 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc AS procedure
       CROSS JOIN LATERAL aclexplode(
         coalesce(procedure.proacl, acldefault('f', procedure.proowner))
       ) AS privilege
       WHERE procedure.oid IN (
         'public.update_active_company_admin(text,text,text,text)'::regprocedure,
         'public.upsert_active_company_unit_admin(integer,text,text,text,text,boolean)'::regprocedure
       )
         AND privilege.grantee = 0
         AND privilege.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Auditoria falhou: grants das RPCs administrativas';
  END IF;
END;
$audit$;

COMMIT;

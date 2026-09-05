\set ON_ERROR_STOP on

DO $smoke$
DECLARE
  v_definition TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'prontomedic_nursing_rpc_owner'
       AND NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls
       AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
  ) THEN
    RAISE EXCEPTION 'Owner restrito das RPCs de Enfermagem ausente';
  END IF;
  IF pg_get_userbyid(
       (SELECT proowner FROM pg_proc WHERE oid =
         'public.nursing_administer_medication_secure(bigint,bigint)'::regprocedure)
     ) <> 'prontomedic_nursing_rpc_owner'
     OR pg_get_userbyid(
       (SELECT proowner FROM pg_proc WHERE oid =
         'public.nursing_refuse_medication_secure(bigint,text)'::regprocedure)
     ) <> 'prontomedic_nursing_rpc_owner' THEN
    RAISE EXCEPTION 'RPC mutante conserva owner privilegiado';
  END IF;
  IF NOT COALESCE((
    SELECT relrowsecurity FROM pg_class
     WHERE oid = 'public.nursing_medication_administrations'::regclass
  ), FALSE) THEN
    RAISE EXCEPTION 'RLS da administracao de medicamentos esta desativado';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'nursing_medication_administrations'
          AND policyname = 'nursing_rpc_owner_select'
          AND roles = ARRAY['prontomedic_nursing_rpc_owner']::name[]
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'nursing_medication_administrations'
          AND policyname = 'nursing_rpc_owner_update'
          AND roles = ARRAY['prontomedic_nursing_rpc_owner']::name[]
          AND with_check IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Policies restritas do owner de Enfermagem ausentes';
  END IF;
  SELECT pg_get_functiondef('public.check_prescription_safety(bigint,text)'::regprocedure)
    INTO v_definition;
  IF v_definition NOT ILIKE '%can_access(''prontuario'', ''view'')%'
     OR v_definition NOT ILIKE '%ERRCODE = ''42501''%' THEN
    RAISE EXCEPTION 'Checagem de prescricao nao exige permissao clinica';
  END IF;
END;
$smoke$;

\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF to_regprocedure('public.nursing_administer_medication_secure(bigint,bigint)') IS NULL
     OR to_regprocedure('public.nursing_refuse_medication_secure(bigint,text)') IS NULL
     OR to_regprocedure('public.check_prescription_safety(bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'Baseline canonica das RPCs de Enfermagem ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'prontomedic_rpc_owner' AND rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Baseline inesperada do owner legado';
  END IF;
END;
$smoke$;

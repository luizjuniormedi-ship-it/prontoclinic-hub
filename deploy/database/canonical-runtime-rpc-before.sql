\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF to_regprocedure('public.active_company_id()') IS NULL
     OR to_regprocedure('public.active_unit_id()') IS NULL
     OR to_regrole('prontomedic_rpc_owner') IS NULL THEN
    RAISE EXCEPTION 'Baseline de contexto/RPC ausente';
  END IF;
  IF to_regclass('public.nursing_medication_administrations') IS NULL
     OR to_regclass('public.patients') IS NULL
     OR to_regclass('public.appointments') IS NULL THEN
    RAISE EXCEPTION 'Baseline de Enfermagem/Agenda ausente';
  END IF;
END;
$smoke$;

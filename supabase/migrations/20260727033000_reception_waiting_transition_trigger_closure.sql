-- Permite somente a transicao de check-in da Recepcao para waiting.
-- Outras alteracoes em appointments continuam exigindo permissao de agenda.
BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure(
       'public.enforce_clinical_unit_company()'
     ) IS NULL
     OR to_regprocedure('public.can_access(text,text)') IS NULL
     OR to_regprocedure(
       'private.reception_mark_appointment_waiting(bigint,text)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'Reception waiting transition dependencies are missing';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.enforce_clinical_unit_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_module TEXT := TG_TABLE_NAME;
  v_alt_module TEXT := CASE TG_TABLE_NAME
    WHEN 'patients' THEN 'pacientes'
    WHEN 'appointments' THEN 'agenda'
    WHEN 'medical_records' THEN 'prontuario'
  END;
  v_action TEXT := CASE TG_OP
    WHEN 'INSERT' THEN 'create'
    WHEN 'UPDATE' THEN 'edit'
  END;
  v_reception_checkin_transition BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    NEW.company_id := COALESCE(
      NEW.company_id,
      public.active_company_id()
    );
    NEW.unit_id := COALESCE(
      NEW.unit_id,
      public.active_unit_id()
    );
  END IF;

  IF NEW.company_id IS NULL
     OR NEW.unit_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.units unit_record
       WHERE unit_record.id = NEW.unit_id
         AND unit_record.company_id = NEW.company_id
         AND unit_record.lg_ativo IS TRUE
     ) THEN
    RAISE EXCEPTION
      'Empresa e unidade clinica devem ser validas e consistentes'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'appointments' AND TG_OP = 'UPDATE' THEN
    v_reception_checkin_transition :=
      NEW.status = 'waiting'
      AND OLD.status IS DISTINCT FROM NEW.status
      AND (
        to_jsonb(NEW) - ARRAY['status', 'notes', 'updated_at']
      ) = (
        to_jsonb(OLD) - ARRAY['status', 'notes', 'updated_at']
      )
      AND public.can_access('recepcao', 'edit');
  END IF;

  IF auth.uid() IS NOT NULL AND (
    NEW.company_id IS DISTINCT FROM public.active_company_id()
    OR NEW.unit_id IS DISTINCT FROM public.active_unit_id()
    OR NOT (
      public.can_access(v_module, v_action)
      OR public.can_access(v_alt_module, v_action)
      OR v_reception_checkin_transition
    )
  ) THEN
    RAISE EXCEPTION
      'Escrita clinica fora do contexto ativo ou sem permissao'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

DO $ledger$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.prontomedic_deployment_migrations
       WHERE filename =
         '20260727033000_reception_waiting_transition_trigger_closure.sql'
     ) THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES (
      '20260727033000_reception_waiting_transition_trigger_closure.sql',
      NOW()
    );
  END IF;
END
$ledger$;

COMMIT;

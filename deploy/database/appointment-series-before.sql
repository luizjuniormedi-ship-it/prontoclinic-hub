\set ON_ERROR_STOP on
DO $smoke$
BEGIN
  IF to_regprocedure(
    'public.create_appointment_with_requirements_secure(bigint,bigint,date,time,time,uuid,integer,integer,bigint,bigint,text,boolean,boolean,text,integer,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Contrato canonico de agendamento individual ausente';
  END IF;
END;
$smoke$;

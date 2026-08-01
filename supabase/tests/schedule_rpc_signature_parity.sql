BEGIN;

DO $$
DECLARE
  v_signatures TEXT[];
BEGIN
  SELECT array_agg(oid::regprocedure::TEXT ORDER BY oid::regprocedure::TEXT)
    INTO v_signatures
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'create_appointment_with_requirements_secure';

  IF cardinality(v_signatures) <> 1 THEN
    RAISE EXCEPTION
      'Scheduling RPC must have one unambiguous signature, found: %',
      v_signatures;
  END IF;

  IF v_signatures[1] <> (
    'create_appointment_with_requirements_secure('
    || 'bigint,bigint,date,time without time zone,time without time zone,'
    || 'uuid,integer,integer,bigint,bigint,text,boolean,boolean,text,integer,text,text)'
  ) THEN
    RAISE EXCEPTION 'Unexpected scheduling RPC signature: %', v_signatures[1];
  END IF;
END;
$$;

ROLLBACK;

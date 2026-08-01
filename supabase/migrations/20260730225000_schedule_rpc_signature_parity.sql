-- Remove the superseded scheduling overload that makes named RPC calls
-- ambiguous. The application contract uses the 17-argument signature.
DROP FUNCTION IF EXISTS public.create_appointment_with_requirements_secure(
  BIGINT,
  BIGINT,
  DATE,
  TIME,
  TIME,
  UUID,
  INTEGER,
  INTEGER,
  BIGINT,
  BIGINT,
  TEXT,
  BOOLEAN,
  BOOLEAN,
  TEXT,
  BIGINT,
  TEXT,
  TEXT,
  BIGINT,
  BIGINT,
  INTEGER,
  TEXT,
  BOOLEAN
);

DO $$
DECLARE
  v_signature_count INTEGER;
BEGIN
  SELECT count(*)
    INTO v_signature_count
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'create_appointment_with_requirements_secure';

  IF v_signature_count <> 1 THEN
    RAISE EXCEPTION
      'Expected one create_appointment_with_requirements_secure signature, found %',
      v_signature_count;
  END IF;

  IF to_regprocedure(
    'public.create_appointment_with_requirements_secure(bigint,bigint,date,time,time,uuid,integer,integer,bigint,bigint,text,boolean,boolean,text,integer,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Canonical scheduling RPC signature is missing';
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.m18_complete_attendance_secure(uuid,jsonb,text)') IS NULL
     OR to_regprocedure('public.sync_completed_appointment_billing_secure(bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'contratos clínico-financeiros predecessores ausentes';
  END IF;
  IF to_regprocedure('public.m18_finalize_appointment_with_billing_secure(bigint,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'handoff clínico-financeiro já existe antes da migration';
  END IF;
END;
$$;

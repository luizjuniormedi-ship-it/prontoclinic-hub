-- Compatibility checkpoint only.
-- 000_p0_p1_consolidated.sql is the sole creator of canonical insurance objects.
DO $$
BEGIN
  IF to_regclass('public.insurance_authorizations') IS NULL
     OR to_regclass('public.insurance_eligibility_checks') IS NULL
     OR to_regclass('public.reception_authorizations') IS NULL
     OR to_regclass('public.reception_eligibility_checks') IS NULL THEN
    RAISE EXCEPTION 'Canonical insurance objects must be created by 000_p0_p1_consolidated.sql';
  END IF;
END
$$;

DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('insurance_authorizations', 'insurance_eligibility_checks')
       AND policyname NOT IN (
         'insurance_authorizations_select_unit',
         'insurance_authorizations_insert_unit',
         'insurance_authorizations_update_unit',
         'm11_billing_authz_trigger_select',
         'm15_authorizations_reception_owner_select',
         'm15_authorizations_reception_owner_insert',
         'm15_authorizations_reception_owner_update',
         'authorizations_series_owner_access',
         'm16_materialization_authorizations_read',
         'm16_materialization_authorizations_lock',
         'insurance_eligibility_select_unit',
         'insurance_eligibility_insert_unit',
         'insurance_eligibility_update_unit',
         'insurance_eligibility_reception_owner',
         'insurance_eligibility_reception_owner_select',
         'insurance_eligibility_reception_owner_update',
         'eligibility_series_owner_access'
       )
  LOOP
    RAISE EXCEPTION 'OPERATIONAL_RLS_UNKNOWN_POLICY: public.%.%',
      v_policy.tablename, v_policy.policyname;
  END LOOP;
END;
$$;

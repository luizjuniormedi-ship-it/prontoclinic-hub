-- F1 gate: appointment writes cannot cross the authenticated session tenant.
DO $f1$
DECLARE
  v_tenant_a UUID := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_tenant_b UUID := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_user UUID := 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
  v_appointment_id BIGINT;
BEGIN
  INSERT INTO public.companies (id, name, lg_ativo)
  VALUES (v_tenant_a, 'F1 Agenda Tenant A', TRUE), (v_tenant_b, 'F1 Agenda Tenant B', TRUE)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (id)
  VALUES (v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id, lg_ativo)
  VALUES (v_user, 'F1 Agenda User', 'f1-agenda@example.test', 'reception', v_tenant_a, TRUE)
  ON CONFLICT (id) DO UPDATE
    SET company_id = EXCLUDED.company_id, role_name = EXCLUDED.role_name, lg_ativo = TRUE;

  CREATE OR REPLACE FUNCTION auth.uid()
  RETURNS uuid
  LANGUAGE sql STABLE
  AS $uid$ SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::uuid $uid$;

  PERFORM set_config('request.jwt.claim.sub', v_user::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);

  INSERT INTO public.appointments (
    company_id, appointment_date, start_time, end_time, status
  ) VALUES (
    v_tenant_a, CURRENT_DATE, TIME '08:00', TIME '08:30', 'scheduled'
  ) RETURNING id INTO v_appointment_id;

  BEGIN
    INSERT INTO public.appointments (
      company_id, appointment_date, start_time, end_time, status
    ) VALUES (
      v_tenant_b, CURRENT_DATE, TIME '09:00', TIME '09:30', 'scheduled'
    );
    RAISE EXCEPTION 'F1 blocker: cross-tenant appointment write was accepted';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN
      NULL;
  END;

  DELETE FROM public.appointments WHERE id = v_appointment_id;
  DELETE FROM public.user_profiles WHERE id = v_user;
  DELETE FROM public.companies WHERE id IN (v_tenant_a, v_tenant_b);

  RAISE NOTICE 'F1_APPOINTMENT_SESSION_TENANT=PASS';
END
$f1$;

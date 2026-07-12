-- ProntoMedic MVP P0/P1 consolidated migration.
-- Review/local artifact only. One transaction. No backfill or deduplication.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_temp;

DO $$
DECLARE required_table TEXT;
BEGIN
  FOREACH required_table IN ARRAY ARRAY['companies','patients','professionals','appointments','insurance_companies','insurance_plans','audit_logs'] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN RAISE EXCEPTION 'P0/P1 preflight: required table public.% is missing', required_table; END IF;
  END LOOP;
  IF to_regprocedure('public.get_my_company_id()') IS NULL THEN RAISE EXCEPTION 'P0/P1 preflight: tenant helper get_my_company_id() is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_logs' AND column_name='company_id') THEN RAISE EXCEPTION 'P0/P1 preflight: audit_logs.company_id is required'; END IF;
END $$;

-- P1 least-privilege boundary. RLS policies below still govern every row.
REVOKE ALL ON TABLE public.medical_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.billings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.insurance_authorizations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.insurance_eligibility_checks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon, authenticated;
-- Direct table writes are denied to the browser role. Mutations must use the
-- tenant-aware, audited RPC surface granted below.
GRANT SELECT ON TABLE public.medical_records TO authenticated;
GRANT SELECT ON TABLE public.billings TO authenticated;
GRANT SELECT ON TABLE public.insurance_authorizations TO authenticated;
GRANT SELECT ON TABLE public.insurance_eligibility_checks TO authenticated;
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.medical_records_id_seq,
  public.billings_id_seq TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.appointments WHERE company_id IS NULL) THEN RAISE EXCEPTION 'P0/P1 preflight: appointments.company_id contains NULL'; END IF;
  IF EXISTS (SELECT 1 FROM public.appointments GROUP BY company_id,id HAVING COUNT(*) > 1) THEN RAISE EXCEPTION 'P0/P1 preflight: duplicate appointments(company_id,id)'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.billings') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billings' AND column_name='company_id') OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billings' AND column_name='appointment_id') THEN
      RAISE EXCEPTION 'P0/P1 preflight: existing billings lacks tenant/appointment columns';
    END IF;
    IF EXISTS (SELECT 1 FROM public.billings WHERE company_id IS NULL OR appointment_id IS NULL) THEN RAISE EXCEPTION 'P0/P1 preflight: billings contains NULL tenant key'; END IF;
    IF EXISTS (SELECT 1 FROM public.billings GROUP BY company_id,appointment_id HAVING COUNT(*) > 1) THEN RAISE EXCEPTION 'P0/P1 preflight: duplicate billings(company_id,appointment_id)'; END IF;
  END IF;
  IF to_regclass('public.medical_records') IS NOT NULL AND EXISTS (SELECT 1 FROM public.medical_records WHERE company_id IS NULL) THEN RAISE EXCEPTION 'P0/P1 preflight: medical_records.company_id contains NULL'; END IF;
  IF to_regclass('public.insurance_authorizations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.insurance_authorizations WHERE company_id IS NULL) THEN RAISE EXCEPTION 'P0/P1 preflight: insurance_authorizations.company_id contains NULL'; END IF;
  IF to_regclass('public.insurance_eligibility_checks') IS NOT NULL AND EXISTS (SELECT 1 FROM public.insurance_eligibility_checks WHERE company_id IS NULL) THEN RAISE EXCEPTION 'P0/P1 preflight: insurance_eligibility_checks.company_id contains NULL'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.medical_records (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id BIGINT REFERENCES public.professionals(id) ON DELETE SET NULL,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  chief_complaint TEXT, diagnosis TEXT, prescription TEXT, notes TEXT,
  created_by UUID, updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE SET NULL, appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  insurance_id INTEGER REFERENCES public.insurance_companies(id) ON DELETE SET NULL, insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE SET NULL,
  procedure_id BIGINT, status VARCHAR(40) NOT NULL DEFAULT 'pendente', protocol_number VARCHAR(120), authorization_number VARCHAR(120), password_number VARCHAR(120),
  valid_until DATE, quantity_requested INTEGER NOT NULL DEFAULT 1, quantity_authorized INTEGER NOT NULL DEFAULT 0, quantity_used INTEGER NOT NULL DEFAULT 0,
  denial_reason TEXT, notes TEXT, created_by UUID, updated_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_eligibility_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE SET NULL, appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  insurance_id INTEGER REFERENCES public.insurance_companies(id) ON DELETE SET NULL, insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE SET NULL,
  card_number VARCHAR(120), status VARCHAR(40) NOT NULL DEFAULT 'pendente', protocol_number VARCHAR(120), source VARCHAR(40), result_detail TEXT,
  checked_at TIMESTAMPTZ, checked_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF to_regclass('public.reception_authorizations') IS NULL THEN EXECUTE 'CREATE VIEW public.reception_authorizations WITH (security_invoker = true) AS SELECT * FROM public.insurance_authorizations'; END IF;
  IF to_regclass('public.reception_eligibility_checks') IS NULL THEN EXECUTE 'CREATE VIEW public.reception_eligibility_checks WITH (security_invoker = true) AS SELECT * FROM public.insurance_eligibility_checks'; END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_company_id_id_key ON public.appointments(company_id,id);

CREATE TABLE IF NOT EXISTS public.billings (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  appointment_id BIGINT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  guide_number VARCHAR(120), tiss_status VARCHAR(40),
  dt_vencimento DATE, dt_pagamento DATE, created_by UUID, updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.appointments ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.billings ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.billings ALTER COLUMN appointment_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.billings'::regclass AND conname='billings_company_appointment_key') THEN
    ALTER TABLE public.billings ADD CONSTRAINT billings_company_appointment_key UNIQUE(company_id,appointment_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.billings'::regclass AND conname='billings_company_appointment_fkey') THEN
    ALTER TABLE public.billings ADD CONSTRAINT billings_company_appointment_fkey FOREIGN KEY(company_id,appointment_id) REFERENCES public.appointments(company_id,id);
  END IF;
END $$;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['medical_records','billings','insurance_authorizations','insurance_eligibility_checks','audit_logs'] LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN RAISE EXCEPTION 'P0/P1 preflight: protected table public.% is missing', table_name; END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name AND coalesce(qual,'') ~* ('^\s*\(?\s*' || chr(116) || chr(114) || chr(117) || chr(101) || '\s*\)?\s*$')) THEN RAISE EXCEPTION 'P0/P1 preflight: broad tenant policy on public.%', table_name; END IF;
  END LOOP;
END $$;

ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_eligibility_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_records FORCE ROW LEVEL SECURITY;
ALTER TABLE public.billings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_authorizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_eligibility_checks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

DO $$
DECLARE relation_name TEXT; owner_name TEXT; owner_bypass BOOLEAN;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['medical_records','billings','insurance_authorizations','insurance_eligibility_checks','audit_logs'] LOOP
    SELECT r.rolname, r.rolbypassrls INTO owner_name, owner_bypass
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    WHERE n.nspname='public' AND c.relname=relation_name;
    IF owner_name IS NULL THEN RAISE EXCEPTION 'P0/P1 role preflight: owner missing for public.%', relation_name; END IF;
    IF owner_bypass THEN RAISE EXCEPTION 'P0/P1 role preflight: owner % of public.% has rolbypassrls=true', owner_name, relation_name; END IF;
  END LOOP;
  FOREACH owner_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=owner_name) THEN RAISE EXCEPTION 'P0/P1 role preflight: role % is missing', owner_name; END IF;
    IF (SELECT rolbypassrls FROM pg_roles WHERE rolname=owner_name) THEN RAISE EXCEPTION 'P0/P1 role preflight: role % has rolbypassrls=true', owner_name; END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='mvp_medical_records_tenant' AND tablename='medical_records') THEN
    CREATE POLICY mvp_medical_records_tenant ON public.medical_records FOR ALL TO authenticated USING(company_id=public.get_my_company_id()) WITH CHECK(company_id=public.get_my_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='mvp_billings_tenant' AND tablename='billings') THEN
    CREATE POLICY mvp_billings_tenant ON public.billings FOR ALL TO authenticated USING(company_id=public.get_my_company_id()) WITH CHECK(company_id=public.get_my_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='mvp_insurance_authorizations_tenant' AND tablename='insurance_authorizations') THEN
    CREATE POLICY mvp_insurance_authorizations_tenant ON public.insurance_authorizations FOR ALL TO authenticated USING(company_id=public.get_my_company_id()) WITH CHECK(company_id=public.get_my_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='mvp_insurance_eligibility_tenant' AND tablename='insurance_eligibility_checks') THEN
    CREATE POLICY mvp_insurance_eligibility_tenant ON public.insurance_eligibility_checks FOR ALL TO authenticated USING(company_id=public.get_my_company_id()) WITH CHECK(company_id=public.get_my_company_id());
  END IF;
  DROP POLICY IF EXISTS mvp_audit_logs_tenant ON public.audit_logs;
  CREATE POLICY mvp_audit_logs_tenant ON public.audit_logs FOR SELECT TO authenticated USING(company_id=public.get_my_company_id());
END $$;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.patients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.professionals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.appointments FORCE ROW LEVEL SECURITY;

DO $
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_profiles' AND policyname='mvp_user_profiles_tenant') THEN
    CREATE POLICY mvp_user_profiles_tenant ON public.user_profiles FOR ALL TO authenticated
      USING (company_id=public.get_my_company_id()) WITH CHECK (company_id=public.get_my_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='patients' AND policyname='mvp_patients_tenant') THEN
    CREATE POLICY mvp_patients_tenant ON public.patients FOR ALL TO authenticated
      USING (company_id=public.get_my_company_id()) WITH CHECK (company_id=public.get_my_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='professionals' AND policyname='mvp_professionals_tenant') THEN
    CREATE POLICY mvp_professionals_tenant ON public.professionals FOR ALL TO authenticated
      USING (company_id=public.get_my_company_id()) WITH CHECK (company_id=public.get_my_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='appointments' AND policyname='mvp_appointments_tenant') THEN
    CREATE POLICY mvp_appointments_tenant ON public.appointments FOR ALL TO authenticated
      USING (company_id=public.get_my_company_id()) WITH CHECK (company_id=public.get_my_company_id());
  END IF;
END $;

DO $
BEGIN
  IF to_regprocedure('public.get_scheduling_actor()') IS NULL OR to_regprocedure('public.create_appointment_secure(bigint,bigint,date,time without time zone,time without time zone,uuid,integer,integer,bigint,bigint,text,boolean,boolean,text)') IS NULL OR to_regprocedure('public.update_appointment_status_secure(bigint,text,text)') IS NULL OR to_regprocedure('public.reschedule_appointment_secure(bigint,date,time without time zone,time without time zone,text)') IS NULL THEN
    RAISE EXCEPTION 'P0/P1 preflight: proven RPC definition missing';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.get_scheduling_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_scheduling_actor() TO authenticated;
REVOKE ALL ON FUNCTION public.create_appointment_secure(BIGINT,BIGINT,DATE,TIME,TIME,UUID,INTEGER,INTEGER,BIGINT,BIGINT,TEXT,BOOLEAN,BOOLEAN,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_appointment_secure(BIGINT,BIGINT,DATE,TIME,TIME,UUID,INTEGER,INTEGER,BIGINT,BIGINT,TEXT,BOOLEAN,BOOLEAN,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.update_appointment_status_secure(BIGINT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_appointment_status_secure(BIGINT,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.reschedule_appointment_secure(BIGINT,DATE,TIME,TIME,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_appointment_secure(BIGINT,DATE,TIME,TIME,TEXT) TO authenticated;

CREATE INDEX IF NOT EXISTS audit_logs_company_event_idx ON public.audit_logs(company_id,dt_evento DESC);
COMMIT;


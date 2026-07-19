-- LOCAL-ONLY FIXTURE SEED. Operator-run after baseline replay.
-- Synthetic IDs/names only. Do not run against shared or remote data.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.companies (id, name, cnpj, lg_ativo) VALUES
 ('00000000-0000-4000-8000-0000000000a1','MVP Fixture A',NULL,TRUE),
 ('00000000-0000-4000-8000-0000000000b1','MVP Fixture B',NULL,TRUE)
 ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, lg_ativo=EXCLUDED.lg_ativo;
INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id, lg_ativo) VALUES
 ('00000000-0000-4000-8000-00000000a001','MVP User A','mvp-a@example.invalid','admin','00000000-0000-4000-8000-0000000000a1',TRUE),
 ('00000000-0000-4000-8000-00000000b001','MVP User B','mvp-b@example.invalid','admin','00000000-0000-4000-8000-0000000000b1',TRUE)
 ON CONFLICT (id) DO UPDATE SET company_id=EXCLUDED.company_id, role_name=EXCLUDED.role_name, lg_ativo=EXCLUDED.lg_ativo;
INSERT INTO public.patients (company_id,full_name,cpf,birth_date,sex,lg_ativo)
 SELECT '00000000-0000-4000-8000-0000000000a1','MVP Patient A',NULL,DATE '1990-01-01','O',TRUE
 WHERE NOT EXISTS (SELECT 1 FROM public.patients WHERE company_id='00000000-0000-4000-8000-0000000000a1'::uuid AND full_name='MVP Patient A');
INSERT INTO public.patients (company_id,full_name,cpf,birth_date,sex,lg_ativo)
 SELECT '00000000-0000-4000-8000-0000000000b1','MVP Patient B',NULL,DATE '1990-01-02','O',TRUE
 WHERE NOT EXISTS (SELECT 1 FROM public.patients WHERE company_id='00000000-0000-4000-8000-0000000000b1'::uuid AND full_name='MVP Patient B');
COMMIT;
SELECT json_build_object('company_a','00000000-0000-4000-8000-0000000000a1','company_b','00000000-0000-4000-8000-0000000000b1','user_a','00000000-0000-4000-8000-00000000a001','user_b','00000000-0000-4000-8000-00000000b001','patient_a_id',(SELECT id FROM public.patients WHERE company_id='00000000-0000-4000-8000-0000000000a1'::uuid AND full_name='MVP Patient A' ORDER BY id DESC LIMIT 1),'patient_b_id',(SELECT id FROM public.patients WHERE company_id='00000000-0000-4000-8000-0000000000b1'::uuid AND full_name='MVP Patient B' ORDER BY id DESC LIMIT 1))::text AS fixture_variables;

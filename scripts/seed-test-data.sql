-- =============================================================================
-- seed-test-data.sql
-- Popula banco com dados sintéticos para validação E2E
-- 1 empresa, 5 profissionais, 5 pacientes, 3 convênios, 20 agendamentos,
-- 1 log de auditoria, 1 notificação pendente
-- =============================================================================

BEGIN;

-- 1. Empresa
INSERT INTO public.companies (id, name, cnpj, status, lg_ativo, dt_criacao)
VALUES ('00000000-0000-0000-0000-000000000001', 'Clínica Teste E2E', '11222333000181', 'active', TRUE, NOW())
ON CONFLICT (id) DO NOTHING;

-- 2. User admin (necessário para RLS)
INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'admin@test.local', '{"role":"admin"}'::jsonb, '{"role_name":"admin"}'::jsonb, NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (id, company_id, full_name, role, role_name, email, lg_ativo, dt_criacao)
VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001',
        'Admin Teste', 'admin', 'admin', 'admin@test.local', TRUE, NOW())
ON CONFLICT (id) DO NOTHING;

-- 3. 5 Profissionais
INSERT INTO public.professionals (company_id, name, crm, crm_uf, specialty, lg_ativo, dt_criacao)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Dr. João Silva', '12345', 'RJ', 'Cardiologia', TRUE, NOW()),
  ('00000000-0000-0000-0000-000000000001', 'Dra. Maria Santos', '67890', 'RJ', 'Pediatria', TRUE, NOW()),
  ('00000000-0000-0000-0000-000000000001', 'Dr. Pedro Costa', '11111', 'RJ', 'Clínica Geral', TRUE, NOW()),
  ('00000000-0000-0000-0000-000000000001', 'Dra. Ana Oliveira', '22222', 'RJ', 'Dermatologia', TRUE, NOW()),
  ('00000000-0000-0000-0000-000000000001', 'Dr. Carlos Lima', '33333', 'RJ', 'Ortopedia', TRUE, NOW())
ON CONFLICT DO NOTHING;

-- 4. 5 Pacientes
INSERT INTO public.patients (company_id, name, cpf, birth_date, gender, phone, email, lg_ativo, dt_criacao)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'João Silva', '11111111111', '1985-03-15', 'M', '11999990001', 'joao@test.local', TRUE, NOW()),
  ('00000000-0000-0000-0000-000000000001', 'Maria Santos', '22222222222', '1990-07-22', 'F', '11999990002', 'maria@test.local', TRUE, NOW()),
  ('00000000-0000-0000-0000-000000000001', 'Pedro Oliveira', '33333333333', '1978-11-08', 'M', '11999990003', 'pedro@test.local', TRUE, NOW()),
  ('00000000-0000-0000-0000-000000000001', 'Ana Pereira', '44444444444', '1995-01-30', 'F', '11999990004', 'ana@test.local', TRUE, NOW()),
  ('00000000-0000-0000-0000-000000000001', 'Carlos Souza', '55555555555', '1982-09-12', 'M', '11999990005', 'carlos@test.local', TRUE, NOW())
ON CONFLICT (cpf) DO NOTHING;

-- 5. 3 Fontes Pagadoras (Convênios)
INSERT INTO public.payment_sources (company_id, name, type, lg_ativo)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'PARTICULAR', 'PARTICULAR', TRUE),
  ('00000000-0000-0000-0000-000000000001', 'UNIMED', 'CONVENIO', TRUE),
  ('00000000-0000-0000-0000-000000000001', 'AMIL', 'CONVENIO', TRUE)
ON CONFLICT DO NOTHING;

-- 6. 20 Agendamentos (4 por dia, próximos 5 dias)
DO $$
DECLARE
  v_patient_id BIGINT;
  v_prof_id BIGINT;
  v_day DATE := CURRENT_DATE;
  v_hour TIME;
  v_patients BIGINT[];
  v_profs BIGINT[];
  v_i INT;
  v_d INT;
  v_h INT;
BEGIN
  SELECT ARRAY(SELECT id FROM public.patients ORDER BY id LIMIT 5) INTO v_patients;
  SELECT ARRAY(SELECT id FROM public.professionals ORDER BY id LIMIT 5) INTO v_profs;

  FOR v_d IN 0..4 LOOP
    FOR v_h IN 0..3 LOOP
      v_patient_id := v_patients[(v_h % 5) + 1];
      v_prof_id := v_profs[(v_h % 5) + 1];
      v_hour := ('09:00'::TIME + (v_h * INTERVAL '1 hour'));

      INSERT INTO public.appointments (company_id, patient_id, professional_id, scheduled_at, duration_minutes, status, dt_criacao)
      VALUES (
        '00000000-0000-0000-0000-000000000001',
        v_patient_id,
        v_prof_id,
        (v_day + v_d + v_hour)::TIMESTAMPTZ,
        30,
        CASE v_h WHEN 0 THEN 'scheduled' WHEN 1 THEN 'confirmed' WHEN 2 THEN 'arrived' ELSE 'scheduled' END,
        NOW()
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- 7. 1 Log de Auditoria
INSERT INTO public.audit_logs (company_id, cd_usuario, cd_usuario_nome, role_name, acao, tabela, registro_id, ip_origem)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'Admin Teste',
  'admin',
  'CREATE',
  'patient',
  (SELECT id FROM public.patients LIMIT 1)::TEXT,
  '127.0.0.1'::INET
);

-- 8. 1 Template de Notificação
INSERT INTO public.notification_templates (company_id, code, channel, subject, body, is_active, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'APPOINTMENT_REMINDER',
  'EMAIL',
  'Lembrete: sua consulta é amanhã',
  'Olá {nome}, sua consulta com {profissional} é amanhã às {hora}.',
  TRUE,
  NOW()
)
ON CONFLICT (code) DO NOTHING;

-- 9. 1 Notificação Pendente
INSERT INTO public.notifications (company_id, recipient_type, recipient_id, recipient_email, channel, subject, body, status, dt_scheduled_for, dt_queued)
SELECT
  '00000000-0000-0000-0000-000000000001',
  'PATIENT',
  p.id,
  p.email,
  'EMAIL',
  'Lembrete: sua consulta é amanhã',
  'Olá ' || p.name || ', sua consulta é amanhã.',
  'PENDING',
  NOW() + INTERVAL '1 day',
  NOW()
FROM public.patients p
LIMIT 1;

COMMIT;

-- Validação: contagens finais
SELECT
  (SELECT COUNT(*) FROM public.companies) AS companies,
  (SELECT COUNT(*) FROM public.professionals) AS professionals,
  (SELECT COUNT(*) FROM public.patients) AS patients,
  (SELECT COUNT(*) FROM public.payment_sources) AS payment_sources,
  (SELECT COUNT(*) FROM public.appointments) AS appointments,
  (SELECT COUNT(*) FROM public.audit_logs) AS audit_logs,
  (SELECT COUNT(*) FROM public.notifications) AS notifications;

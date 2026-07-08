-- =============================================================================
-- Scheduling phase 2B: call center contact logs and operator tasks
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.scheduling_contact_logs (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE SET NULL,
  lead_id BIGINT,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  operator_id UUID,
  channel VARCHAR(30) NOT NULL DEFAULT 'telefone',
  direction VARCHAR(20) NOT NULL DEFAULT 'inbound',
  contact_reason VARCHAR(80) NOT NULL,
  result VARCHAR(40) NOT NULL,
  notes TEXT,
  next_action VARCHAR(80),
  next_action_at TIMESTAMPTZ,
  call_recording_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scheduling_contact_logs_channel_chk CHECK (channel IN ('telefone', 'whatsapp', 'email', 'portal', 'presencial', 'campanha', 'instagram', 'google', 'site', 'convenio', 'indicacao')),
  CONSTRAINT scheduling_contact_logs_direction_chk CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT scheduling_contact_logs_result_chk CHECK (result IN ('agendado', 'confirmado', 'cancelado', 'remarcado', 'nao_atendeu', 'recado', 'sem_interesse', 'numero_invalido', 'retornar_depois'))
);

CREATE TABLE IF NOT EXISTS public.scheduling_call_center_tasks (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE SET NULL,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  contact_log_id BIGINT REFERENCES public.scheduling_contact_logs(id) ON DELETE SET NULL,
  assigned_to UUID,
  task_type VARCHAR(60) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  due_at TIMESTAMPTZ,
  description TEXT NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scheduling_call_center_tasks_priority_chk CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT scheduling_call_center_tasks_status_chk CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_scheduling_contact_logs_patient_created
  ON public.scheduling_contact_logs(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduling_contact_logs_company_created
  ON public.scheduling_contact_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduling_contact_logs_result
  ON public.scheduling_contact_logs(result, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduling_call_center_tasks_status_due
  ON public.scheduling_call_center_tasks(status, due_at NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduling_call_center_tasks_patient
  ON public.scheduling_call_center_tasks(patient_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_scheduling_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scheduling_contact_logs_updated_at ON public.scheduling_contact_logs;
CREATE TRIGGER trg_scheduling_contact_logs_updated_at
  BEFORE UPDATE ON public.scheduling_contact_logs
  FOR EACH ROW EXECUTE FUNCTION public.touch_scheduling_updated_at();

DROP TRIGGER IF EXISTS trg_scheduling_call_center_tasks_updated_at ON public.scheduling_call_center_tasks;
CREATE TRIGGER trg_scheduling_call_center_tasks_updated_at
  BEFORE UPDATE ON public.scheduling_call_center_tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_scheduling_updated_at();

ALTER TABLE public.scheduling_contact_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_call_center_tasks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    DROP POLICY IF EXISTS "scheduling_contact_logs_select_company" ON public.scheduling_contact_logs;
    DROP POLICY IF EXISTS "scheduling_contact_logs_insert_company" ON public.scheduling_contact_logs;
    DROP POLICY IF EXISTS "scheduling_call_center_tasks_select_company" ON public.scheduling_call_center_tasks;
    DROP POLICY IF EXISTS "scheduling_call_center_tasks_insert_company" ON public.scheduling_call_center_tasks;
    DROP POLICY IF EXISTS "scheduling_call_center_tasks_update_company" ON public.scheduling_call_center_tasks;

    CREATE POLICY "scheduling_contact_logs_select_company"
      ON public.scheduling_contact_logs FOR SELECT TO authenticated
      USING (company_id = (SELECT company_id FROM public.get_scheduling_actor()));

    CREATE POLICY "scheduling_contact_logs_insert_company"
      ON public.scheduling_contact_logs FOR INSERT TO authenticated
      WITH CHECK (company_id = (SELECT company_id FROM public.get_scheduling_actor()));

    CREATE POLICY "scheduling_call_center_tasks_select_company"
      ON public.scheduling_call_center_tasks FOR SELECT TO authenticated
      USING (company_id = (SELECT company_id FROM public.get_scheduling_actor()));

    CREATE POLICY "scheduling_call_center_tasks_insert_company"
      ON public.scheduling_call_center_tasks FOR INSERT TO authenticated
      WITH CHECK (company_id = (SELECT company_id FROM public.get_scheduling_actor()));

    CREATE POLICY "scheduling_call_center_tasks_update_company"
      ON public.scheduling_call_center_tasks FOR UPDATE TO authenticated
      USING (company_id = (SELECT company_id FROM public.get_scheduling_actor()))
      WITH CHECK (company_id = (SELECT company_id FROM public.get_scheduling_actor()));

    GRANT SELECT, INSERT ON public.scheduling_contact_logs TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON public.scheduling_call_center_tasks TO authenticated;
    GRANT USAGE, SELECT ON SEQUENCE public.scheduling_contact_logs_id_seq TO authenticated;
    GRANT USAGE, SELECT ON SEQUENCE public.scheduling_call_center_tasks_id_seq TO authenticated;
  END IF;
END $$;

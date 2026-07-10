CREATE TABLE IF NOT EXISTS public.scheduling_confirmation_queue (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  appointment_id BIGINT NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scheduling_confirmation_queue_status_chk CHECK (status IN ('pending','contacting','confirmed','cancelled','no_response','expired'))
);

CREATE TABLE IF NOT EXISTS public.scheduling_confirmation_attempts (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  queue_id BIGINT NOT NULL REFERENCES public.scheduling_confirmation_queue(id) ON DELETE CASCADE,
  appointment_id BIGINT NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL,
  outcome VARCHAR(30) NOT NULL,
  notes TEXT,
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scheduling_confirmation_attempt_channel_chk CHECK (channel IN ('telefone','whatsapp','sms','email','portal','presencial')),
  CONSTRAINT scheduling_confirmation_attempt_outcome_chk CHECK (outcome IN ('confirmed','cancelled','no_answer','message_sent','invalid_number','callback_requested'))
);

CREATE INDEX IF NOT EXISTS idx_scheduling_confirmation_queue_due ON public.scheduling_confirmation_queue(status,due_at);
CREATE INDEX IF NOT EXISTS idx_scheduling_confirmation_attempts_appointment ON public.scheduling_confirmation_attempts(appointment_id,created_at DESC);
DROP TRIGGER IF EXISTS trg_scheduling_confirmation_queue_updated_at ON public.scheduling_confirmation_queue;
CREATE TRIGGER trg_scheduling_confirmation_queue_updated_at BEFORE UPDATE ON public.scheduling_confirmation_queue FOR EACH ROW EXECUTE FUNCTION public.touch_scheduling_updated_at();

CREATE OR REPLACE FUNCTION public.refresh_confirmation_queue_secure(p_days_ahead INTEGER DEFAULT 3)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count INTEGER;
BEGIN
  PERFORM public.assert_scheduling_permission();
  INSERT INTO public.scheduling_confirmation_queue(company_id,appointment_id,patient_id,due_at)
  SELECT a.company_id,a.id,a.patient_id,(a.appointment_date + a.start_time) - INTERVAL '24 hours'
  FROM public.appointments a
  WHERE a.appointment_date BETWEEN CURRENT_DATE AND CURRENT_DATE + LEAST(GREATEST(p_days_ahead,1),30)
    AND a.status='scheduled'
  ON CONFLICT (appointment_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.record_confirmation_attempt_secure(
  p_queue_id BIGINT,p_channel TEXT,p_outcome TEXT,p_notes TEXT DEFAULT NULL
)
RETURNS public.scheduling_confirmation_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor RECORD; v_queue public.scheduling_confirmation_queue; v_target TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_scheduling_permission();
  SELECT * INTO v_queue FROM public.scheduling_confirmation_queue WHERE id=p_queue_id FOR UPDATE;
  IF NOT FOUND OR v_queue.status IN ('confirmed','cancelled','expired') THEN RAISE EXCEPTION 'Item de confirmacao nao esta ativo'; END IF;
  INSERT INTO public.scheduling_confirmation_attempts(company_id,queue_id,appointment_id,channel,outcome,notes,actor_user_id)
  VALUES(v_queue.company_id,v_queue.id,v_queue.appointment_id,p_channel,p_outcome,NULLIF(trim(COALESCE(p_notes,'')),''),v_actor.user_id);
  IF p_outcome='confirmed' THEN
    PERFORM public.update_appointment_status_secure(v_queue.appointment_id,'confirmed',COALESCE(p_notes,'Confirmado pelo call center'));
    UPDATE public.scheduling_confirmation_queue SET status='confirmed',attempt_count=attempt_count+1,last_attempt_at=NOW(),confirmed_at=NOW(),closed_at=NOW() WHERE id=p_queue_id RETURNING * INTO v_queue;
  ELSIF p_outcome='cancelled' THEN
    IF NULLIF(trim(COALESCE(p_notes,'')),'') IS NULL THEN RAISE EXCEPTION 'Motivo obrigatorio para cancelamento'; END IF;
    PERFORM public.update_appointment_status_secure(v_queue.appointment_id,'cancelled',p_notes);
    UPDATE public.scheduling_confirmation_queue SET status='cancelled',attempt_count=attempt_count+1,last_attempt_at=NOW(),closed_at=NOW() WHERE id=p_queue_id RETURNING * INTO v_queue;
  ELSE
    UPDATE public.scheduling_confirmation_queue SET status=CASE WHEN attempt_count+1>=3 THEN 'no_response' ELSE 'contacting' END,attempt_count=attempt_count+1,last_attempt_at=NOW() WHERE id=p_queue_id RETURNING * INTO v_queue;
  END IF;
  RETURN v_queue;
END $$;

CREATE OR REPLACE FUNCTION public.mark_overdue_appointments_no_show_secure(p_date DATE,p_grace_minutes INTEGER DEFAULT 60)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor RECORD; v_row RECORD; v_count INTEGER:=0;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_scheduling_permission();
  IF p_date >= CURRENT_DATE THEN RAISE EXCEPTION 'No-show em lote permitido apenas para datas passadas'; END IF;
  FOR v_row IN SELECT * FROM public.appointments a WHERE a.appointment_date=p_date AND a.status IN ('scheduled','confirmed') AND (a.appointment_date+COALESCE(a.end_time,a.start_time+INTERVAL '30 minutes')+make_interval(mins=>p_grace_minutes))<NOW() FOR UPDATE LOOP
    UPDATE public.appointments SET status='no_show',notes=concat_ws(E'\n',notes,'No-show operacional em lote'),updated_at=NOW() WHERE id=v_row.id;
    INSERT INTO public.scheduling_status_history(company_id,appointment_id,from_status,to_status,reason,actor_user_id) VALUES(v_row.company_id,v_row.id,v_row.status,'no_show','No-show operacional em lote',v_actor.user_id);
    UPDATE public.scheduling_confirmation_queue SET status='expired',closed_at=NOW() WHERE appointment_id=v_row.id AND status IN ('pending','contacting','no_response');
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END $$;

ALTER TABLE public.scheduling_confirmation_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_confirmation_attempts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  DROP POLICY IF EXISTS scheduling_confirmation_queue_company ON public.scheduling_confirmation_queue;
  DROP POLICY IF EXISTS scheduling_confirmation_attempts_company ON public.scheduling_confirmation_attempts;
  CREATE POLICY scheduling_confirmation_queue_company ON public.scheduling_confirmation_queue FOR SELECT TO authenticated USING(company_id=(SELECT company_id FROM public.get_scheduling_actor()));
  CREATE POLICY scheduling_confirmation_attempts_company ON public.scheduling_confirmation_attempts FOR SELECT TO authenticated USING(company_id=(SELECT company_id FROM public.get_scheduling_actor()));
  GRANT SELECT ON public.scheduling_confirmation_queue,public.scheduling_confirmation_attempts TO authenticated;
  GRANT EXECUTE ON FUNCTION public.refresh_confirmation_queue_secure(INTEGER) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.record_confirmation_attempt_secure(BIGINT,TEXT,TEXT,TEXT) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.mark_overdue_appointments_no_show_secure(DATE,INTEGER) TO authenticated;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_prontomedic') THEN
  GRANT SELECT ON public.scheduling_confirmation_queue,public.scheduling_confirmation_attempts TO app_prontomedic;
  GRANT USAGE,SELECT ON SEQUENCE public.scheduling_confirmation_queue_id_seq,public.scheduling_confirmation_attempts_id_seq TO app_prontomedic;
  GRANT EXECUTE ON FUNCTION public.refresh_confirmation_queue_secure(INTEGER) TO app_prontomedic;
  GRANT EXECUTE ON FUNCTION public.record_confirmation_attempt_secure(BIGINT,TEXT,TEXT,TEXT) TO app_prontomedic;
  GRANT EXECUTE ON FUNCTION public.mark_overdue_appointments_no_show_secure(DATE,INTEGER) TO app_prontomedic;
 END IF;
END $$;

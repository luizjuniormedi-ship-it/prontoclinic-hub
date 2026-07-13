-- Canonical professional schedule foundation for operational availability.
-- Creates structure only; no DataSIGH backfill or remote write.

CREATE TABLE IF NOT EXISTS public.professional_schedules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  professional_id BIGINT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  day_of_week VARCHAR(30) NOT NULL,
  slot1_start INTEGER,
  slot1_end INTEGER,
  slot1_duration INTEGER,
  slot1_unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  slot2_start INTEGER,
  slot2_end INTEGER,
  slot2_duration INTEGER,
  slot2_unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  slot3_start INTEGER,
  slot3_end INTEGER,
  slot3_duration INTEGER,
  slot3_unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  lg_habilitado BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT professional_schedules_day_chk CHECK (
    lower(day_of_week) IN ('domingo','segunda-feira','terca-feira','terça-feira',
      'quarta-feira','quinta-feira','sexta-feira','sábado','sabado')
  ),
  CONSTRAINT professional_schedules_hhmm_chk CHECK (
    (slot1_start IS NULL OR (slot1_start BETWEEN 0 AND 2359 AND slot1_start % 100 < 60)) AND
    (slot1_end IS NULL OR (slot1_end BETWEEN 0 AND 2359 AND slot1_end % 100 < 60)) AND
    (slot2_start IS NULL OR (slot2_start BETWEEN 0 AND 2359 AND slot2_start % 100 < 60)) AND
    (slot2_end IS NULL OR (slot2_end BETWEEN 0 AND 2359 AND slot2_end % 100 < 60)) AND
    (slot3_start IS NULL OR (slot3_start BETWEEN 0 AND 2359 AND slot3_start % 100 < 60)) AND
    (slot3_end IS NULL OR (slot3_end BETWEEN 0 AND 2359 AND slot3_end % 100 < 60))
  )
);

CREATE INDEX IF NOT EXISTS professional_schedules_professional_day_idx
  ON public.professional_schedules(company_id, professional_id, day_of_week)
  WHERE lg_habilitado = TRUE;

ALTER TABLE public.professional_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_schedules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS professional_schedules_tenant ON public.professional_schedules;
CREATE POLICY professional_schedules_tenant
  ON public.professional_schedules FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

GRANT SELECT ON public.professional_schedules TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.professional_schedules_id_seq TO authenticated;

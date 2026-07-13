-- Foundation for professional availability consumed by scheduling_operations.
-- Existing installations keep their current table and data.
CREATE TABLE IF NOT EXISTS public.professional_schedules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  professional_id BIGINT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  day_of_week VARCHAR(30) NOT NULL,
  lg_habilitado BOOLEAN NOT NULL DEFAULT TRUE,
  slot1_start INTEGER,
  slot1_end INTEGER,
  slot1_duration INTEGER,
  slot1_unit_id INTEGER,
  slot2_start INTEGER,
  slot2_end INTEGER,
  slot2_duration INTEGER,
  slot2_unit_id INTEGER,
  slot3_start INTEGER,
  slot3_end INTEGER,
  slot3_duration INTEGER,
  slot3_unit_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_professional_schedules_lookup
  ON public.professional_schedules(professional_id, day_of_week, lg_habilitado);

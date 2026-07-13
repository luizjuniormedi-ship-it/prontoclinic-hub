-- Complete the canonical clinical record contract without removing legacy fields.
ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS prescription TEXT;

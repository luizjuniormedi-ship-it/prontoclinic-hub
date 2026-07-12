-- Complete the canonical authorization ledger contract used by reception RPCs.
-- Additive and safe for existing installations; DataSIGH is not involved.

ALTER TABLE public.insurance_authorizations
  ADD COLUMN IF NOT EXISTS authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS denied_at TIMESTAMPTZ;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS cd_autorizacao VARCHAR(120);

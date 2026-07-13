-- Canonical read-only encounters projection backed by medical_records.

CREATE VIEW public.v_encounters_read_model
WITH (security_invoker = true)
AS
SELECT
  mr.id,
  mr.company_id,
  mr.patient_id,
  mr.professional_id,
  mr.appointment_id,
  'medical_record'::TEXT AS encounter_type,
  mr.status,
  'normal'::TEXT AS priority,
  mr.chief_complaint,
  COALESCE(mr.evolution, mr.notes, mr.diagnosis) AS summary,
  signer.full_name AS signed_by_name,
  mr.signed_at,
  (appointment.appointment_date + appointment.start_time) AS started_at,
  mr.signed_at AS finished_at,
  mr.created_at,
  patient.full_name AS patient_name
FROM public.medical_records AS mr
LEFT JOIN public.patients AS patient
  ON patient.id = mr.patient_id
 AND patient.company_id = mr.company_id
LEFT JOIN public.appointments AS appointment
  ON appointment.id = mr.appointment_id
 AND appointment.company_id = mr.company_id
LEFT JOIN public.user_profiles AS signer
  ON signer.id = mr.signed_by
 AND signer.company_id = mr.company_id;

COMMENT ON VIEW public.v_encounters_read_model IS
  'Read-only tenant-safe encounter projection backed by medical_records.';

REVOKE ALL PRIVILEGES ON TABLE public.v_encounters_read_model
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.v_encounters_read_model TO authenticated;


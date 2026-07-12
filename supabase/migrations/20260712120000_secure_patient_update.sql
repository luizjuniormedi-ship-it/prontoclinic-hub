-- Secure patient updates with tenant isolation and explicit field allowlist.

CREATE OR REPLACE FUNCTION public.update_patient_secure(
  p_patient_id BIGINT,
  p_patch JSONB
)
RETURNS public.patients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_old public.patients;
  v_row public.patients;
  v_key TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_scheduling_permission();

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION 'Nenhum campo de paciente informado';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN (
      'full_name', 'cpf', 'birth_date', 'phone', 'email', 'sex',
      'insurance_plan_id', 'insurance_card_number', 'allergies', 'clinical_alerts'
    ) THEN
      RAISE EXCEPTION 'Campo de paciente nao editavel por este RPC: %', v_key;
    END IF;
  END LOOP;

  SELECT * INTO v_old
    FROM public.patients
   WHERE id = p_patient_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente nao encontrado';
  END IF;

  IF v_actor.company_id IS NOT NULL AND v_old.company_id IS DISTINCT FROM v_actor.company_id THEN
    RAISE EXCEPTION 'Paciente fora da empresa do usuario';
  END IF;

  UPDATE public.patients
     SET full_name = CASE WHEN p_patch ? 'full_name' THEN NULLIF(trim(p_patch->>'full_name'), '') ELSE full_name END,
         cpf = CASE WHEN p_patch ? 'cpf' THEN NULLIF(trim(p_patch->>'cpf'), '') ELSE cpf END,
         birth_date = CASE WHEN p_patch ? 'birth_date' THEN NULLIF(p_patch->>'birth_date', '')::DATE ELSE birth_date END,
         phone = CASE WHEN p_patch ? 'phone' THEN NULLIF(trim(p_patch->>'phone'), '') ELSE phone END,
         email = CASE WHEN p_patch ? 'email' THEN NULLIF(trim(p_patch->>'email'), '') ELSE email END,
         sex = CASE WHEN p_patch ? 'sex' THEN NULLIF(trim(p_patch->>'sex'), '') ELSE sex END,
         insurance_plan_id = CASE WHEN p_patch ? 'insurance_plan_id' THEN NULLIF(p_patch->>'insurance_plan_id', '')::INTEGER ELSE insurance_plan_id END,
         insurance_card_number = CASE WHEN p_patch ? 'insurance_card_number' THEN NULLIF(trim(p_patch->>'insurance_card_number'), '') ELSE insurance_card_number END,
         allergies = CASE WHEN p_patch ? 'allergies' THEN NULLIF(trim(p_patch->>'allergies'), '') ELSE allergies END,
         clinical_alerts = CASE WHEN p_patch ? 'clinical_alerts' THEN NULLIF(trim(p_patch->>'clinical_alerts'), '') ELSE clinical_alerts END,
         updated_at = NOW()
   WHERE id = p_patient_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_patient_secure(BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_patient_secure(BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_patient_secure(BIGINT, JSONB) TO service_role;

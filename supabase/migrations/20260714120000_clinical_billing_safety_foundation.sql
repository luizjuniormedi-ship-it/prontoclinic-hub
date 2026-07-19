-- Local candidate only. Creates the domain needed by the three RPC contracts.
CREATE TABLE IF NOT EXISTS public.billing_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id), insurance_id BIGINT REFERENCES public.insurance_companies(id),
  billing_type TEXT NOT NULL DEFAULT 'convenio', account_type TEXT NOT NULL DEFAULT 'ambulatorial', status TEXT NOT NULL DEFAULT 'aberta',
  guide_number TEXT, total_net_amount NUMERIC(12,2) NOT NULL DEFAULT 0, total_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  has_pending_issues BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.billing_pending_issues (
  id BIGSERIAL PRIMARY KEY, company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  billing_account_id UUID NOT NULL REFERENCES public.billing_accounts(id) ON DELETE CASCADE,
  issue_code TEXT NOT NULL, resolved BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_pending_issues_unique_open UNIQUE (billing_account_id, issue_code, resolved)
);
CREATE TABLE IF NOT EXISTS public.nursing_medication_administrations (
  id BIGSERIAL PRIMARY KEY, company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id), medication TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendente', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.patient_allergies (
  id BIGSERIAL PRIMARY KEY, company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE, allergen TEXT NOT NULL, reaction TEXT, severity TEXT NOT NULL DEFAULT 'moderada', status TEXT NOT NULL DEFAULT 'ativa', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.patient_medications (
  id BIGSERIAL PRIMARY KEY, company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE, medication TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'em_uso', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION public.bedside_check(p_admin_id BIGINT, p_patient_confirmado BIGINT)
RETURNS TABLE(certo TEXT, ok BOOLEAN) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_patient BIGINT; v_status TEXT; v_med TEXT;
BEGIN
  SELECT patient_id, status, medication INTO v_patient, v_status, v_med FROM public.nursing_medication_administrations WHERE id = p_admin_id AND company_id = public.get_my_company_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Administracao nao encontrada'; END IF;
  RETURN QUERY SELECT 'paciente'::TEXT, v_patient = p_patient_confirmado;
  RETURN QUERY SELECT 'medicamento'::TEXT, length(btrim(v_med)) > 0;
  RETURN QUERY SELECT 'status'::TEXT, v_status IN ('pendente','em_preparo','atrasado');
END; $$;
CREATE OR REPLACE FUNCTION public.billing_check_pending(p_account_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company UUID := public.get_my_company_id(); v_count INTEGER;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_accounts WHERE id=p_account_id AND company_id=v_company) THEN RAISE EXCEPTION 'Conta nao encontrada'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.billing_pending_issues WHERE billing_account_id=p_account_id AND company_id=v_company AND resolved=FALSE;
  UPDATE public.billing_accounts SET has_pending_issues=(v_count>0), updated_at=NOW() WHERE id=p_account_id AND company_id=v_company;
  RETURN v_count;
END; $$;
CREATE OR REPLACE FUNCTION public.check_prescription_safety(p_patient_id BIGINT, p_medication TEXT)
RETURNS TABLE(alert_type TEXT, severity TEXT, descricao TEXT) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id=p_patient_id AND company_id=public.get_my_company_id()) THEN RAISE EXCEPTION 'Paciente nao encontrado'; END IF;
  RETURN QUERY SELECT 'alergia'::TEXT, a.severity::TEXT, ('Alergia registrada: '||a.allergen)::TEXT FROM public.patient_allergies a WHERE a.patient_id=p_patient_id AND a.company_id=public.get_my_company_id() AND a.status='ativa' AND lower(btrim(a.allergen))=lower(btrim(p_medication));
  RETURN QUERY SELECT 'duplicidade'::TEXT, 'moderada'::TEXT, ('Medicamento em uso: '||m.medication)::TEXT FROM public.patient_medications m WHERE m.patient_id=p_patient_id AND m.company_id=public.get_my_company_id() AND m.status='em_uso' AND lower(btrim(m.medication))=lower(btrim(p_medication));
END; $$;
REVOKE ALL ON FUNCTION public.bedside_check(BIGINT, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_check_pending(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_prescription_safety(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bedside_check(BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_check_pending(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_prescription_safety(BIGINT, TEXT) TO authenticated;

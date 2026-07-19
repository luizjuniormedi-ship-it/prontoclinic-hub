-- Local candidate only. Replay in disposable PostgreSQL; never DataSIGH/VPS.
REVOKE ALL ON FUNCTION public.log_data_access(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_data_access(TEXT, TEXT, TEXT, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.queue_notification(UUID, VARCHAR, VARCHAR, BIGINT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BIGINT, BIGINT, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_notification(UUID, VARCHAR, VARCHAR, BIGINT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BIGINT, BIGINT, TIMESTAMPTZ, BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.calcular_kpis_diarios(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calcular_kpis_diarios(UUID, DATE) TO authenticated;
REVOKE ALL ON FUNCTION public.detectar_alertas_bi(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detectar_alertas_bi(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.find_price(UUID, BIGINT, BIGINT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_price(UUID, BIGINT, BIGINT, INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.tiss_get_stats(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tiss_get_stats(UUID, INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.current_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;
REVOKE ALL ON FUNCTION public.registrar_consentimento_gravacao(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_consentimento_gravacao(UUID, BOOLEAN) TO authenticated;
CREATE OR REPLACE FUNCTION public.recalc_tiss_total_glosa(p_id BIGINT)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company_id UUID; v_actor_company UUID; v_total NUMERIC(10,2);
BEGIN
  SELECT company_id INTO v_actor_company FROM public.user_profiles WHERE id = auth.uid();
  IF v_actor_company IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  SELECT company_id INTO v_company_id FROM public.tiss_xml WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_company_id IS DISTINCT FROM v_actor_company THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  SELECT COALESCE(SUM(vl_glosa), 0)::NUMERIC(10,2) INTO v_total FROM public.tiss_glosas WHERE cd_tiss_xml = p_id AND company_id = v_company_id;
  UPDATE public.tiss_xml SET vl_glosa = v_total, status = CASE WHEN v_total > 0 THEN 'GLOSADO' ELSE status END, updated_at = NOW() WHERE id = p_id AND company_id = v_company_id;
  RETURN v_total;
END; $$;
REVOKE ALL ON FUNCTION public.recalc_tiss_total_glosa(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_tiss_total_glosa(BIGINT) TO authenticated;

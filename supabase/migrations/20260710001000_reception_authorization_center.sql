CREATE TABLE IF NOT EXISTS public.reception_admin_history (
 id BIGSERIAL PRIMARY KEY,company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
 entity_type VARCHAR(40) NOT NULL,entity_id TEXT NOT NULL,appointment_id BIGINT REFERENCES public.appointments(id),
 from_status VARCHAR(40),to_status VARCHAR(40) NOT NULL,reason TEXT,details JSONB NOT NULL DEFAULT '{}'::JSONB,
 actor_user_id UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reception_admin_history_entity ON public.reception_admin_history(entity_type,entity_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reception_admin_history_appointment ON public.reception_admin_history(appointment_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.update_reception_authorization_secure(
 p_authorization_id UUID,p_status TEXT,p_protocol_number TEXT DEFAULT NULL,p_authorization_number TEXT DEFAULT NULL,
 p_password_number TEXT DEFAULT NULL,p_valid_until DATE DEFAULT NULL,p_quantity_authorized INTEGER DEFAULT NULL,p_reason TEXT DEFAULT NULL
)
RETURNS public.reception_authorizations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor RECORD;v_old reception_authorizations;v_row reception_authorizations;
BEGIN
 SELECT * INTO v_actor FROM get_scheduling_actor();PERFORM assert_scheduling_permission();
 SELECT * INTO v_old FROM reception_authorizations WHERE id=p_authorization_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Autorizacao nao encontrada';END IF;
 IF p_status NOT IN ('pendente','solicitada','em_analise','autorizada','parcialmente_autorizada','negada','vencida','cancelada','reenviada','liberada_excecao') THEN RAISE EXCEPTION 'Status de autorizacao invalido';END IF;
 IF p_status IN ('autorizada','parcialmente_autorizada') AND NULLIF(trim(COALESCE(p_authorization_number,'')),'') IS NULL THEN RAISE EXCEPTION 'Numero da autorizacao e obrigatorio';END IF;
 IF p_status='negada' AND NULLIF(trim(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Motivo da negativa e obrigatorio';END IF;
 IF p_status='liberada_excecao' THEN
  IF COALESCE(v_actor.role_name,'') NOT IN ('admin','administrador','gestor','supervisor','supervisor_recepcao','diretoria') THEN RAISE EXCEPTION 'Perfil sem permissao para liberar excecao';END IF;
  IF NULLIF(trim(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Justificativa da excecao e obrigatoria';END IF;
 END IF;
 UPDATE reception_authorizations SET status=p_status,protocol_number=COALESCE(NULLIF(trim(COALESCE(p_protocol_number,'')),''),protocol_number),
 authorization_number=COALESCE(NULLIF(trim(COALESCE(p_authorization_number,'')),''),authorization_number),password_number=COALESCE(NULLIF(trim(COALESCE(p_password_number,'')),''),password_number),
 valid_until=COALESCE(p_valid_until,valid_until),quantity_authorized=COALESCE(p_quantity_authorized,quantity_authorized),
 authorized_at=CASE WHEN p_status IN ('autorizada','parcialmente_autorizada','liberada_excecao') THEN NOW() ELSE authorized_at END,
 denied_at=CASE WHEN p_status='negada' THEN NOW() ELSE denied_at END,denial_reason=CASE WHEN p_status='negada' THEN p_reason ELSE denial_reason END,
 notes=concat_ws(E'\n',notes,NULLIF(trim(COALESCE(p_reason,'')),'')),updated_by=v_actor.user_id,updated_at=NOW() WHERE id=p_authorization_id RETURNING * INTO v_row;
 IF v_row.appointment_id IS NOT NULL AND p_status IN ('autorizada','parcialmente_autorizada') THEN UPDATE appointments SET cd_autorizacao=v_row.authorization_number,updated_at=NOW() WHERE id=v_row.appointment_id;END IF;
 INSERT INTO reception_admin_history(company_id,entity_type,entity_id,appointment_id,from_status,to_status,reason,details,actor_user_id)
 VALUES(v_row.company_id,'authorization',v_row.id::TEXT,v_row.appointment_id,v_old.status,v_row.status,p_reason,jsonb_build_object('protocol',v_row.protocol_number,'authorization_number',v_row.authorization_number,'valid_until',v_row.valid_until),v_actor.user_id);
 RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.update_reception_eligibility_secure(
 p_eligibility_id UUID,p_status TEXT,p_protocol_number TEXT DEFAULT NULL,p_result_detail TEXT DEFAULT NULL
)
RETURNS public.reception_eligibility_checks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor RECORD;v_old reception_eligibility_checks;v_row reception_eligibility_checks;
BEGIN
 SELECT * INTO v_actor FROM get_scheduling_actor();PERFORM assert_scheduling_permission();
 SELECT * INTO v_old FROM reception_eligibility_checks WHERE id=p_eligibility_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Elegibilidade nao encontrada';END IF;
 IF p_status NOT IN ('elegivel','nao_elegivel','pendente','em_analise','portal_indisponivel','nao_obrigatoria','liberado_excecao') THEN RAISE EXCEPTION 'Status de elegibilidade invalido';END IF;
 IF p_status IN ('nao_elegivel','portal_indisponivel') AND NULLIF(trim(COALESCE(p_result_detail,'')),'') IS NULL THEN RAISE EXCEPTION 'Detalhe do resultado e obrigatorio';END IF;
 IF p_status='liberado_excecao' THEN
  IF COALESCE(v_actor.role_name,'') NOT IN ('admin','administrador','gestor','supervisor','supervisor_recepcao','diretoria') THEN RAISE EXCEPTION 'Perfil sem permissao para liberar excecao';END IF;
  IF NULLIF(trim(COALESCE(p_result_detail,'')),'') IS NULL THEN RAISE EXCEPTION 'Justificativa da excecao e obrigatoria';END IF;
 END IF;
 UPDATE reception_eligibility_checks SET status=p_status,protocol_number=COALESCE(NULLIF(trim(COALESCE(p_protocol_number,'')),''),protocol_number),
 result_detail=COALESCE(NULLIF(trim(COALESCE(p_result_detail,'')),''),result_detail),checked_at=CASE WHEN p_status NOT IN ('pendente','em_analise') THEN NOW() ELSE checked_at END,
 checked_by=v_actor.user_id WHERE id=p_eligibility_id RETURNING * INTO v_row;
 INSERT INTO reception_admin_history(company_id,entity_type,entity_id,appointment_id,from_status,to_status,reason,details,actor_user_id)
 VALUES(v_row.company_id,'eligibility',v_row.id::TEXT,v_row.appointment_id,v_old.status,v_row.status,p_result_detail,jsonb_build_object('protocol',v_row.protocol_number),v_actor.user_id);
 RETURN v_row;
END $$;

ALTER TABLE reception_admin_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_prontomedic') THEN
 GRANT SELECT ON reception_admin_history TO app_prontomedic;GRANT USAGE,SELECT ON SEQUENCE reception_admin_history_id_seq TO app_prontomedic;
 GRANT EXECUTE ON FUNCTION update_reception_authorization_secure(UUID,TEXT,TEXT,TEXT,TEXT,DATE,INTEGER,TEXT) TO app_prontomedic;
 GRANT EXECUTE ON FUNCTION update_reception_eligibility_secure(UUID,TEXT,TEXT,TEXT) TO app_prontomedic;
END IF;END $$;

\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_company UUID := '83000000-0000-0000-0000-000000000001';
  v_other_company UUID := '83000000-0000-0000-0000-000000000002';
  v_user UUID := '83000000-0000-0000-0000-000000000010';
  v_other_user UUID := '83000000-0000-0000-0000-000000000011';
  v_membership UUID;
  v_other_membership UUID;
  v_role_id INTEGER;
  v_admin_role_id INTEGER;
  v_permission public.role_permissions%ROWTYPE;
  v_unit_id INTEGER;
  v_other_unit_id INTEGER;
  v_failed BOOLEAN;
  v_transition JSONB;
  v_reactivated JSONB;
BEGIN
  INSERT INTO public.companies (id, name, lg_ativo)
  VALUES
    (v_company, 'Empresa Provisionamento', TRUE),
    (v_other_company, 'Outra Empresa Provisionamento', TRUE)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.roles (name, description, lg_ativo)
  VALUES ('provision_test_role', 'Papel de provisionamento', TRUE)
  ON CONFLICT (name) DO UPDATE SET lg_ativo = TRUE
  RETURNING id INTO v_role_id;
  IF v_role_id IS NULL THEN
    SELECT id INTO v_role_id FROM public.roles WHERE name = 'provision_test_role';
  END IF;

  INSERT INTO public.units (company_id, cd_codigo, ds_nome, lg_ativo)
  VALUES (v_company, 'PROV-1', 'Unidade Provisionamento', TRUE)
  RETURNING id INTO v_unit_id;
  INSERT INTO public.units (company_id, cd_codigo, ds_nome, lg_ativo)
  VALUES (v_other_company, 'PROV-2', 'Unidade Outra Empresa', TRUE)
  RETURNING id INTO v_other_unit_id;

  INSERT INTO auth.users (id, email)
  VALUES (v_user, 'provisionado@example.test'), (v_other_user, 'outro@example.test')
  ON CONFLICT (id) DO NOTHING;

  IF has_table_privilege('authenticated', 'public.user_profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: authenticated possui escrita privilegiada ampla em user_profiles';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.user_profiles', 'full_name', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.user_profiles', 'role_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.user_profiles', 'lg_ativo', 'UPDATE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: grants por coluna de user_profiles estão incorretos';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  v_failed := FALSE;
  BEGIN
    PERFORM public.provision_user_access(
      v_user, 'provisionado@example.test', 'Pessoa Provisionada',
      v_company, v_role_id, v_unit_id
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: authenticated não pode provisionar usuário';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  v_failed := FALSE;
  BEGIN
    PERFORM public.provision_user_access(
      v_user, 'provisionado@example.test', 'Pessoa Provisionada',
      v_company, v_role_id, v_other_unit_id
    );
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: unidade de outra empresa deveria ser rejeitada';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_user)
     OR EXISTS (SELECT 1 FROM public.memberships WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: falha de provisionamento deixou dados parciais';
  END IF;

  v_membership := public.provision_user_access(
    v_user, 'provisionado@example.test', 'Pessoa Provisionada',
    v_company, v_role_id, v_unit_id
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_user AND user_id = v_user AND company_id = v_company
      AND role_id = v_role_id AND primary_unit_id = v_unit_id AND lg_ativo = TRUE
      AND must_change_password = TRUE
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: perfil funcional não foi criado corretamente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
    JOIN public.membership_roles mr ON mr.membership_id = m.id AND mr.role_id = v_role_id
    JOIN public.membership_units mu ON mu.membership_id = m.id AND mu.unit_id = v_unit_id
    WHERE m.id = v_membership AND m.user_id = v_user
      AND m.company_id = v_company AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: vínculo, papel e unidade não foram criados atomicamente';
  END IF;

  v_failed := FALSE;
  BEGIN
    PERFORM public.provision_user_access(
      v_user, 'alterado@example.test', 'Tentativa Duplicada',
      v_company, v_role_id, v_unit_id
    );
  EXCEPTION WHEN unique_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: provisionamento duplicado deveria falhar fechado';
  END IF;
  IF (SELECT email FROM public.user_profiles WHERE id = v_user) <> 'provisionado@example.test' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: tentativa duplicada alterou perfil existente';
  END IF;

  v_other_membership := public.provision_user_access(
    v_user, 'provisionado@example.test', 'Pessoa Provisionada',
    v_other_company, v_role_id, v_other_unit_id
  );
  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.membership_roles mr ON mr.membership_id = m.id AND mr.role_id = v_role_id
    JOIN public.membership_units mu ON mu.membership_id = m.id AND mu.unit_id = v_other_unit_id
    WHERE m.id = v_other_membership
      AND m.user_id = v_user
      AND m.company_id = v_other_company
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: usuário existente não recebeu acesso à segunda empresa';
  END IF;
  IF (SELECT company_id FROM public.user_profiles WHERE id = v_user) IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: segundo vínculo sobrescreveu a empresa legada do perfil';
  END IF;

  SELECT id INTO v_admin_role_id FROM public.roles WHERE lower(name) = 'admin' AND lg_ativo = TRUE LIMIT 1;
  IF v_admin_role_id IS NULL THEN
    INSERT INTO public.roles (name, description, lg_ativo)
    VALUES ('admin', 'Administrador', TRUE)
    RETURNING id INTO v_admin_role_id;
  END IF;
  INSERT INTO public.membership_roles (membership_id, role_id)
  VALUES (v_membership, v_admin_role_id)
  ON CONFLICT DO NOTHING;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', v_user::TEXT, TRUE);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user::TEXT,
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '83000000-0000-0000-0000-000000000099'
  )::TEXT, TRUE);
  PERFORM public.activate_application_context(
    v_membership,
    v_admin_role_id,
    v_unit_id,
    '83000000-0000-0000-0000-000000000077',
    'Teste auth admin',
    'psql',
    'auth-admin-provisioning'
  );
  IF public.current_context_is_company_admin(v_company) IS DISTINCT FROM TRUE
     OR public.current_context_is_company_admin(v_other_company) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: autorização administrativa não respeita o contexto da sessão';
  END IF;
  IF public.get_my_company_id() IS DISTINCT FROM v_company
     OR public.current_company_id() IS DISTINCT FROM v_company
     OR public.is_admin(v_user) IS DISTINCT FROM TRUE
     OR public.is_staff(v_user) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: helpers legados ignoraram o contexto administrativo ativo';
  END IF;
  UPDATE public.application_sessions
  SET idle_expires_at = created_at
  WHERE user_id = v_user
    AND gotrue_session_id = '83000000-0000-0000-0000-000000000099';
  IF public.current_context_is_company_admin(v_company) IS DISTINCT FROM FALSE
     OR public.get_my_company_id() IS NOT NULL
     OR public.current_company_id() IS NOT NULL
     OR public.is_admin(v_user) IS DISTINCT FROM FALSE
     OR public.is_staff(v_user) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: sessão expirada autorizou helpers de compatibilidade';
  END IF;
  UPDATE public.application_sessions
  SET idle_expires_at = NOW() + INTERVAL '30 minutes'
  WHERE user_id = v_user
    AND gotrue_session_id = '83000000-0000-0000-0000-000000000099';
  IF has_table_privilege('authenticated', 'public.role_permissions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.role_permissions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.role_permissions', 'DELETE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: authenticated possui escrita direta em role_permissions';
  END IF;
  SELECT * INTO v_permission
  FROM public.upsert_role_permission(
    v_role_id, 'agenda', TRUE, FALSE, TRUE, FALSE, FALSE
  );
  IF v_permission.company_id IS DISTINCT FROM v_company
     OR v_permission.role_id IS DISTINCT FROM v_role_id
     OR v_permission.module IS DISTINCT FROM 'agenda'
     OR v_permission.can_view IS DISTINCT FROM TRUE
     OR v_permission.can_edit IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: RPC não gravou permissão no tenant ativo';
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user::TEXT,
    'role', 'authenticated',
    'aal', 'aal1',
    'session_id', '83000000-0000-0000-0000-000000000099'
  )::TEXT, TRUE);
  IF public.current_context_is_company_admin(v_company) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: contexto administrativo aceitou AAL1';
  END IF;
  v_failed := FALSE;
  BEGIN
    PERFORM public.upsert_role_permission(
      v_role_id, 'agenda', FALSE, FALSE, FALSE, FALSE, FALSE
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: RPC de permissões aceitou AAL1';
  END IF;
  IF has_function_privilege('anon', 'public.current_context_is_company_admin(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.current_context_is_company_admin(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: grants da autorização administrativa estão incorretos';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  v_transition := public.prepare_user_access_active(v_user, v_company, FALSE);
  IF NOT COALESCE((v_transition ->> 'found')::BOOLEAN, FALSE)
     OR NOT COALESCE((v_transition ->> 'changed')::BOOLEAN, FALSE)
     OR v_transition ->> 'previous_status' <> 'active'
     OR v_transition ->> 'requested_status' <> 'suspended'
     OR (v_transition ->> 'active_memberships')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: preparação não capturou a transição exata';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_access_context WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: prepare removeu contexto antes da confirmação do Auth';
  END IF;
  IF public.restore_user_access_active(
    v_user,
    (v_transition ->> 'membership_id')::UUID,
    v_transition ->> 'requested_status',
    v_transition ->> 'previous_status',
    (v_transition ->> 'expected_updated_at')::TIMESTAMPTZ
  ) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: compensação CAS válida falhou';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE id = v_membership AND status = 'active') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: compensação não restaurou o estado anterior';
  END IF;

  v_transition := public.prepare_user_access_active(v_user, v_company, FALSE);
  UPDATE public.memberships
  SET updated_at = clock_timestamp() + INTERVAL '1 second'
  WHERE id = v_membership;
  IF public.restore_user_access_active(
    v_user,
    (v_transition ->> 'membership_id')::UUID,
    v_transition ->> 'requested_status',
    v_transition ->> 'previous_status',
    (v_transition ->> 'expected_updated_at')::TIMESTAMPTZ
  ) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: compensação CAS sobrescreveu uma alteração concorrente';
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user::TEXT,
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '83000000-0000-0000-0000-000000000099'
  )::TEXT, TRUE);
  v_reactivated := public.prepare_user_access_active(v_user, v_company, TRUE);
  IF v_reactivated ->> 'requested_status' <> 'pending_activation'
     OR NOT EXISTS (
       SELECT 1 FROM public.memberships
       WHERE id = v_membership AND status = 'pending_activation'
     ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: reativação não permaneceu em estado intermediário fechado';
  END IF;
  IF EXISTS (
       SELECT 1
       FROM jsonb_array_elements(public.list_authorized_access_contexts()) option
       WHERE option ->> 'company_id' = v_company::TEXT
     )
     OR public.active_company_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: pending_activation publicou acesso antes do Auth';
  END IF;
  IF public.finalize_user_access_active(
    v_user,
    (v_reactivated ->> 'membership_id')::UUID,
    v_reactivated ->> 'requested_status',
    (v_reactivated ->> 'expected_updated_at')::TIMESTAMPTZ
  ) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: finalização da reativação falhou';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE id = v_membership AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: finalização não promoveu pending_activation para active';
  END IF;
  v_transition := public.prepare_user_access_active(v_user, v_company, TRUE);
  IF COALESCE((v_transition ->> 'changed')::BOOLEAN, TRUE) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: transição idempotente foi marcada como alteração';
  END IF;

  IF public.set_user_access_active(v_user, v_company, FALSE) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: inativação administrativa não confirmou alteração';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_user AND lg_ativo = TRUE)
     OR EXISTS (SELECT 1 FROM public.memberships WHERE id = v_membership AND status <> 'suspended')
     OR NOT EXISTS (SELECT 1 FROM public.memberships WHERE id = v_other_membership AND status = 'active')
     OR EXISTS (SELECT 1 FROM public.user_access_context WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: inativação de uma empresa afetou outro vínculo legítimo';
  END IF;

  IF public.set_user_access_active(v_user, v_other_company, FALSE) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: segundo vínculo não foi inativado';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_user AND lg_ativo = TRUE) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: perfil permaneceu ativo sem vínculos ativos';
  END IF;

  IF public.set_user_access_active(v_user, '83000000-0000-0000-0000-000000000099', TRUE) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: empresa sem vínculo não pode alterar usuário';
  END IF;

  INSERT INTO public.user_profiles (
    id, user_id, email, full_name, company_id, role_id, role_name, primary_unit_id, lg_ativo
  ) VALUES (
    v_other_user, v_other_user, 'outro@example.test', 'Perfil Sem Vínculo',
    v_company, v_role_id, 'provision_test_role', v_unit_id, TRUE
  );
  v_failed := FALSE;
  BEGIN
    PERFORM public.set_user_access_active(v_other_user, v_company, FALSE);
  EXCEPTION WHEN OTHERS THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: perfil sem membership deveria falhar fechado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_other_user AND lg_ativo = TRUE) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: falha de vínculo alterou parcialmente o perfil';
  END IF;
END;
$$;

ROLLBACK;

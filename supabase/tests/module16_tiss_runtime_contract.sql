\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_database() !~
     '^prontomedic_[a-z0-9_]*(replay|contract|test)[a-z0-9_]*$' THEN
    RAISE EXCEPTION
      'Module 16 runtime contract is restricted to disposable databases';
  END IF;
END
$guard$;

BEGIN;

DO $assert_static_contract$
DECLARE
  v_table TEXT;
  v_owner_oid OID;
  v_function RECORD;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'tiss_xml',
    'tiss_glosas',
    'tiss_protocols',
    'tiss_guides',
    'tiss_guide_events',
    'tiss_operation_requests'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_class relation
        JOIN pg_namespace namespace_row
          ON namespace_row.oid = relation.relnamespace
       WHERE namespace_row.nspname = 'public'
         AND relation.relname = v_table
         AND relation.relrowsecurity
         AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS/FORCE RLS is missing on public.%', v_table;
    END IF;

    IF has_table_privilege(
         'anon',
         'public.' || v_table,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
       )
       OR has_table_privilege(
         'authenticated',
         'public.' || v_table,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
       )
       OR has_table_privilege(
         'app_prontomedic',
         'public.' || v_table,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
       )
       OR has_table_privilege(
         'prontomedic_tiss_gateway',
         'public.' || v_table,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
       ) THEN
      RAISE EXCEPTION 'A client role retains direct access to public.%', v_table;
    END IF;
  END LOOP;

  IF has_table_privilege(
       'authenticated',
       'public.vw_tiss_glosas_pendentes',
       'SELECT'
     )
     OR has_table_privilege(
       'app_prontomedic',
       'public.vw_tiss_glosas_pendentes',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'A client role can read the legacy TISS view directly';
  END IF;

  SELECT oid
    INTO v_owner_oid
    FROM pg_roles
   WHERE rolname = 'prontomedic_tiss_rpc_owner';
  IF v_owner_oid IS NULL OR EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE oid = v_owner_oid
       AND (
         rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb
         OR rolcreaterole OR rolreplication OR rolbypassrls
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_auth_members membership
     WHERE membership.member = v_owner_oid
        OR membership.roleid = v_owner_oid
  ) THEN
    RAISE EXCEPTION 'TISS RPC owner role contract is unsafe';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('m16_persist_xml_secure(uuid,bigint,jsonb)'),
        ('m16_record_transmission_result_gateway(uuid,bigint,boolean,integer,text,text,text,timestamp with time zone)'),
        ('m16_process_return_secure(uuid,bigint,jsonb)'),
        ('m16_record_manual_denial_secure(uuid,bigint,text,numeric,text)'),
        ('m16_generate_monthly_batch_secure(uuid,date)'),
        ('m16_save_protocol_secure(uuid,jsonb)'),
        ('m16_list_xml_secure(integer,integer)'),
        ('m16_list_denials_secure(bigint,integer)'),
        ('m16_list_protocols_secure()'),
        ('m16_list_guides_secure(text,integer)'),
        ('m16_list_guide_events_secure(uuid)'),
        ('m16_get_xml_document_secure(bigint)'),
        ('tiss_get_stats(uuid,integer)')
      ) AS expected(signature)
     WHERE to_regprocedure('public.' || expected.signature) IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more Module 16 RPC signatures are missing';
  END IF;

  IF to_regprocedure(
       'private.m16_require_actor(text[],boolean,text)'
     ) IS NULL
     OR to_regprocedure(
       'private.m16_require_actor(text[],boolean)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy or missing TISS actor authorization helper';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc procedure_row
     WHERE procedure_row.oid =
           'private.m16_require_actor(text[],boolean,text)'::REGPROCEDURE
       AND procedure_row.prosecdef
       AND procedure_row.prosrc LIKE '%public.request_aal()%'
       AND procedure_row.prosrc LIKE '%public.active_company_id()%'
       AND procedure_row.prosrc LIKE
           '%public.can_access(''faturamento'', v_action)%'
       AND procedure_row.prosrc NOT LIKE '%app_prontomedic%'
  ) THEN
    RAISE EXCEPTION
      'TISS actor helper does not enforce canonical AAL2/RBAC context';
  END IF;

  FOR v_function IN
    SELECT
      procedure_row.oid AS function_oid,
      procedure_row.oid::REGPROCEDURE::TEXT AS signature
      FROM pg_proc procedure_row
      JOIN pg_namespace namespace_row
        ON namespace_row.oid = procedure_row.pronamespace
     WHERE namespace_row.nspname = 'private'
       AND procedure_row.proname LIKE 'm16_%'
  LOOP
    IF EXISTS (
         SELECT 1
           FROM aclexplode(
                  COALESCE(
                    (
                      SELECT procedure_row.proacl
                        FROM pg_proc procedure_row
                       WHERE procedure_row.oid = v_function.function_oid
                    ),
                    acldefault(
                      'f',
                      (
                        SELECT procedure_row.proowner
                          FROM pg_proc procedure_row
                         WHERE procedure_row.oid = v_function.function_oid
                      )
                    )
                  )
                ) AS privilege_row
          WHERE privilege_row.grantee = 0
            AND privilege_row.privilege_type = 'EXECUTE'
       )
       OR has_function_privilege('anon', v_function.signature, 'EXECUTE')
       OR has_function_privilege(
            'authenticated',
            v_function.signature,
            'EXECUTE'
          )
       OR has_function_privilege(
            'app_prontomedic',
            v_function.signature,
            'EXECUTE'
          )
       OR has_function_privilege(
            'prontomedic_tiss_gateway',
            v_function.signature,
            'EXECUTE'
          )
       OR NOT has_function_privilege(
            'prontomedic_tiss_rpc_owner',
            v_function.signature,
            'EXECUTE'
          ) THEN
      RAISE EXCEPTION 'Unsafe private TISS helper ACL: %',
        v_function.signature;
    END IF;
  END LOOP;

  IF has_function_privilege(
       'authenticated',
       'public.m16_record_transmission_result_gateway(uuid,bigint,boolean,integer,text,text,text,timestamp with time zone)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'app_prontomedic',
       'public.m16_record_transmission_result_gateway(uuid,bigint,boolean,integer,text,text,text,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'prontomedic_tiss_gateway',
       'public.m16_record_transmission_result_gateway(uuid,bigint,boolean,integer,text,text,text,timestamp with time zone)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Gateway result RPC execute ACL is unsafe';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc procedure_row
      JOIN pg_namespace namespace_row
        ON namespace_row.oid = procedure_row.pronamespace
     WHERE namespace_row.nspname = 'public'
       AND procedure_row.proname =
           'm16_record_transmission_result_gateway'
       AND lower(procedure_row.prosrc) ~
           '(http_(get|post|put|delete|request)|net[.]http_[a-z_]+|dblink|curl|webhook|soap_request)[[:space:]]*[(]'
  ) THEN
    RAISE EXCEPTION 'Gateway result RPC contains a network-capable call';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc procedure_row
      JOIN pg_namespace namespace_row
        ON namespace_row.oid = procedure_row.pronamespace
     WHERE namespace_row.nspname = 'public'
       AND procedure_row.proname = ANY(ARRAY[
         'm16_list_xml_secure',
         'm16_list_denials_secure',
         'm16_list_protocols_secure',
         'm16_list_guides_secure',
         'm16_list_guide_events_secure',
         'tiss_get_stats'
       ])
       AND procedure_row.prosrc ~
           '\m(bl_xml_enviado|bl_xml_retorno|bl_xml_recurso|ds_senha|ds_certificado_senha)\M'
  ) THEN
    RAISE EXCEPTION 'A normal TISS query RPC exposes XML or credentials';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc procedure_row
     WHERE procedure_row.oid =
           'public.m16_get_xml_document_secure(bigint)'::REGPROCEDURE
       AND procedure_row.prosrc LIKE '%m16_require_actor%'
       AND procedure_row.prosrc LIKE '%''export''%'
  ) THEN
    RAISE EXCEPTION 'Full XML RPC is not protected by can_export';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.companies company
      JOIN public.roles role_record
        ON lower(role_record.name) IN (
          'admin',
          'administrador',
          'billing',
          'faturamento',
          'faturista',
          'financeiro',
          'gestor'
        )
       AND role_record.lg_ativo = TRUE
     WHERE company.lg_ativo = TRUE
       AND NOT EXISTS (
         SELECT 1
           FROM public.role_permissions permission_row
          WHERE permission_row.company_id = company.id
            AND permission_row.role_id = role_record.id
            AND lower(permission_row.module) = 'faturamento'
       )
  ) THEN
    RAISE EXCEPTION
      'Canonical faturamento role permission provisioning is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('tiss_xml_company_appointment_fkey'),
        ('tiss_xml_company_guide_fkey'),
        ('tiss_xml_company_billing_account_fkey'),
        ('tiss_glosas_company_xml_fkey'),
        ('tiss_protocols_company_insurance_fkey'),
        ('tiss_guides_company_appointment_fkey'),
        ('tiss_guides_company_source_xml_fkey'),
        ('tiss_guides_company_billing_account_fkey'),
        ('tiss_guides_company_substitution_fkey'),
        ('tiss_guide_events_company_guide_fkey')
      ) AS expected(constraint_name)
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_constraint constraint_row
        WHERE constraint_row.conname = expected.constraint_name
          AND constraint_row.contype = 'f'
          AND pg_get_constraintdef(constraint_row.oid) LIKE
              'FOREIGN KEY (company_id, %'
     )
  ) THEN
    RAISE EXCEPTION 'A required Module 16 composite FK is missing';
  END IF;
END
$assert_static_contract$;

CREATE TEMP TABLE tiss_contract_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE ON tiss_contract_state
  TO authenticated, app_prontomedic, prontomedic_tiss_gateway,
     prontomedic_tiss_rpc_owner;

INSERT INTO public.companies (id, name, cnpj, phone, email, lg_ativo)
VALUES
  (
    '16000000-0000-4000-8000-000000000001',
    'TISS Synthetic A',
    '16000000000001',
    '00000001601',
    'tiss-a@example.invalid',
    TRUE
  ),
  (
    '16000000-0000-4000-8000-000000000002',
    'TISS Synthetic B',
    '16000000000002',
    '00000001602',
    'tiss-b@example.invalid',
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET lg_ativo = TRUE;

INSERT INTO public.units (
  id, company_id, cd_codigo, ds_nome, lg_principal, lg_ativo
)
OVERRIDING SYSTEM VALUE
VALUES
  (
    16001,
    '16000000-0000-4000-8000-000000000001',
    'TISS-A',
    'TISS Synthetic Unit A',
    TRUE,
    TRUE
  ),
  (
    16002,
    '16000000-0000-4000-8000-000000000002',
    'TISS-B',
    'TISS Synthetic Unit B',
    TRUE,
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  lg_ativo = TRUE;

INSERT INTO public.roles (name, description, lg_ativo)
VALUES
  ('faturamento', 'Synthetic TISS full-access role', TRUE),
  (
    'faturamento_viewer_contract',
    'Synthetic TISS read-only role',
    TRUE
  ),
  ('recepcao', 'Synthetic negative reception role', TRUE),
  ('medico', 'Synthetic negative physician role', TRUE),
  ('paciente', 'Synthetic negative patient role', TRUE)
ON CONFLICT (name) DO UPDATE SET lg_ativo = TRUE;

INSERT INTO auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    '16000000-0000-4000-8000-000000000011',
    'tiss-billing-a@example.invalid',
    crypt(gen_random_uuid()::TEXT, gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"TISS Billing A"}',
    NOW(),
    NOW()
  ),
  (
    '16000000-0000-4000-8000-000000000021',
    'tiss-billing-b@example.invalid',
    crypt(gen_random_uuid()::TEXT, gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"TISS Billing B"}',
    NOW(),
    NOW()
  ),
  (
    '16000000-0000-4000-8000-000000000031',
    'tiss-viewer-a@example.invalid',
    crypt(gen_random_uuid()::TEXT, gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"TISS Viewer A"}',
    NOW(),
    NOW()
  ),
  (
    '16000000-0000-4000-8000-000000000041',
    'tiss-reception-a@example.invalid',
    crypt(gen_random_uuid()::TEXT, gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"TISS Reception A"}',
    NOW(),
    NOW()
  ),
  (
    '16000000-0000-4000-8000-000000000051',
    'tiss-physician-a@example.invalid',
    crypt(gen_random_uuid()::TEXT, gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"TISS Physician A"}',
    NOW(),
    NOW()
  ),
  (
    '16000000-0000-4000-8000-000000000061',
    'tiss-patient-a@example.invalid',
    crypt(gen_random_uuid()::TEXT, gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"TISS Patient A"}',
    NOW(),
    NOW()
  )
ON CONFLICT (id) DO UPDATE SET updated_at = NOW();

INSERT INTO public.user_profiles (
  id, user_id, full_name, email, role_name, company_id, primary_unit_id,
  lg_ativo
)
VALUES
  (
    '16000000-0000-4000-8000-000000000011',
    '16000000-0000-4000-8000-000000000011',
    'TISS Billing A',
    'tiss-billing-a@example.invalid',
    'faturamento',
    '16000000-0000-4000-8000-000000000001',
    16001,
    TRUE
  ),
  (
    '16000000-0000-4000-8000-000000000021',
    '16000000-0000-4000-8000-000000000021',
    'TISS Billing B',
    'tiss-billing-b@example.invalid',
    'faturamento',
    '16000000-0000-4000-8000-000000000002',
    16002,
    TRUE
  ),
  (
    '16000000-0000-4000-8000-000000000031',
    '16000000-0000-4000-8000-000000000031',
    'TISS Viewer A',
    'tiss-viewer-a@example.invalid',
    'faturamento_viewer_contract',
    '16000000-0000-4000-8000-000000000001',
    16001,
    TRUE
  ),
  (
    '16000000-0000-4000-8000-000000000041',
    '16000000-0000-4000-8000-000000000041',
    'TISS Reception A',
    'tiss-reception-a@example.invalid',
    'recepcao',
    '16000000-0000-4000-8000-000000000001',
    16001,
    TRUE
  ),
  (
    '16000000-0000-4000-8000-000000000051',
    '16000000-0000-4000-8000-000000000051',
    'TISS Physician A',
    'tiss-physician-a@example.invalid',
    'medico',
    '16000000-0000-4000-8000-000000000001',
    16001,
    TRUE
  ),
  (
    '16000000-0000-4000-8000-000000000061',
    '16000000-0000-4000-8000-000000000061',
    'TISS Patient A',
    'tiss-patient-a@example.invalid',
    'paciente',
    '16000000-0000-4000-8000-000000000001',
    16001,
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET
  role_name = EXCLUDED.role_name,
  company_id = EXCLUDED.company_id,
  primary_unit_id = EXCLUDED.primary_unit_id,
  lg_ativo = TRUE;

INSERT INTO public.memberships (id, user_id, company_id, status)
VALUES
  (
    '16000000-0000-4000-8000-000000000111',
    '16000000-0000-4000-8000-000000000011',
    '16000000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    '16000000-0000-4000-8000-000000000121',
    '16000000-0000-4000-8000-000000000021',
    '16000000-0000-4000-8000-000000000002',
    'active'
  ),
  (
    '16000000-0000-4000-8000-000000000131',
    '16000000-0000-4000-8000-000000000031',
    '16000000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    '16000000-0000-4000-8000-000000000141',
    '16000000-0000-4000-8000-000000000041',
    '16000000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    '16000000-0000-4000-8000-000000000151',
    '16000000-0000-4000-8000-000000000051',
    '16000000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    '16000000-0000-4000-8000-000000000161',
    '16000000-0000-4000-8000-000000000061',
    '16000000-0000-4000-8000-000000000001',
    'active'
  );

INSERT INTO public.membership_roles (membership_id, role_id)
SELECT fixture.membership_id, role_record.id
FROM (
  VALUES
    (
      '16000000-0000-4000-8000-000000000111'::UUID,
      'faturamento'::TEXT
    ),
    (
      '16000000-0000-4000-8000-000000000121'::UUID,
      'faturamento'::TEXT
    ),
    (
      '16000000-0000-4000-8000-000000000131'::UUID,
      'faturamento_viewer_contract'::TEXT
    ),
    (
      '16000000-0000-4000-8000-000000000141'::UUID,
      'recepcao'::TEXT
    ),
    (
      '16000000-0000-4000-8000-000000000151'::UUID,
      'medico'::TEXT
    ),
    (
      '16000000-0000-4000-8000-000000000161'::UUID,
      'paciente'::TEXT
    )
) AS fixture(membership_id, role_name)
JOIN public.roles role_record ON role_record.name = fixture.role_name;

INSERT INTO public.membership_units (membership_id, unit_id)
VALUES
  ('16000000-0000-4000-8000-000000000111', 16001),
  ('16000000-0000-4000-8000-000000000121', 16002),
  ('16000000-0000-4000-8000-000000000131', 16001),
  ('16000000-0000-4000-8000-000000000141', 16001),
  ('16000000-0000-4000-8000-000000000151', 16001),
  ('16000000-0000-4000-8000-000000000161', 16001);

INSERT INTO public.application_devices (
  id,
  user_id,
  company_id,
  unit_id,
  client_device_id,
  display_name,
  platform
)
VALUES
  (
    '16000000-0000-4000-8000-000000000311',
    '16000000-0000-4000-8000-000000000011',
    '16000000-0000-4000-8000-000000000001',
    16001,
    '16000000-0000-4000-8000-000000000411',
    'TISS Contract Billing Device A',
    'contract'
  ),
  (
    '16000000-0000-4000-8000-000000000321',
    '16000000-0000-4000-8000-000000000021',
    '16000000-0000-4000-8000-000000000002',
    16002,
    '16000000-0000-4000-8000-000000000421',
    'TISS Contract Billing Device B',
    'contract'
  ),
  (
    '16000000-0000-4000-8000-000000000331',
    '16000000-0000-4000-8000-000000000031',
    '16000000-0000-4000-8000-000000000001',
    16001,
    '16000000-0000-4000-8000-000000000431',
    'TISS Contract Viewer Device A',
    'contract'
  ),
  (
    '16000000-0000-4000-8000-000000000341',
    '16000000-0000-4000-8000-000000000041',
    '16000000-0000-4000-8000-000000000001',
    16001,
    '16000000-0000-4000-8000-000000000441',
    'TISS Contract Reception Device A',
    'contract'
  ),
  (
    '16000000-0000-4000-8000-000000000351',
    '16000000-0000-4000-8000-000000000051',
    '16000000-0000-4000-8000-000000000001',
    16001,
    '16000000-0000-4000-8000-000000000451',
    'TISS Contract Physician Device A',
    'contract'
  ),
  (
    '16000000-0000-4000-8000-000000000361',
    '16000000-0000-4000-8000-000000000061',
    '16000000-0000-4000-8000-000000000001',
    16001,
    '16000000-0000-4000-8000-000000000461',
    'TISS Contract Patient Device A',
    'contract'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.application_sessions (
  id,
  user_id,
  company_id,
  unit_id,
  device_id,
  gotrue_session_id,
  idle_expires_at,
  absolute_expires_at
)
VALUES
  (
    '16000000-0000-4000-8000-000000000511',
    '16000000-0000-4000-8000-000000000011',
    '16000000-0000-4000-8000-000000000001',
    16001,
    '16000000-0000-4000-8000-000000000311',
    '16000000-0000-4000-8000-000000000211',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  ),
  (
    '16000000-0000-4000-8000-000000000521',
    '16000000-0000-4000-8000-000000000021',
    '16000000-0000-4000-8000-000000000002',
    16002,
    '16000000-0000-4000-8000-000000000321',
    '16000000-0000-4000-8000-000000000221',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  ),
  (
    '16000000-0000-4000-8000-000000000531',
    '16000000-0000-4000-8000-000000000031',
    '16000000-0000-4000-8000-000000000001',
    16001,
    '16000000-0000-4000-8000-000000000331',
    '16000000-0000-4000-8000-000000000231',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  ),
  (
    '16000000-0000-4000-8000-000000000541',
    '16000000-0000-4000-8000-000000000041',
    '16000000-0000-4000-8000-000000000001',
    16001,
    '16000000-0000-4000-8000-000000000341',
    '16000000-0000-4000-8000-000000000241',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  ),
  (
    '16000000-0000-4000-8000-000000000551',
    '16000000-0000-4000-8000-000000000051',
    '16000000-0000-4000-8000-000000000001',
    16001,
    '16000000-0000-4000-8000-000000000351',
    '16000000-0000-4000-8000-000000000251',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  ),
  (
    '16000000-0000-4000-8000-000000000561',
    '16000000-0000-4000-8000-000000000061',
    '16000000-0000-4000-8000-000000000001',
    16001,
    '16000000-0000-4000-8000-000000000361',
    '16000000-0000-4000-8000-000000000261',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.role_permissions (
  company_id,
  role_id,
  module,
  can_view,
  can_create,
  can_edit,
  can_delete,
  can_export
)
SELECT
  fixture.company_id,
  role_record.id,
  fixture.module,
  fixture.can_view,
  fixture.can_create,
  fixture.can_edit,
  FALSE,
  fixture.can_export
FROM (
  VALUES
    (
      '16000000-0000-4000-8000-000000000001'::UUID,
      'faturamento'::TEXT,
      'faturamento'::TEXT,
      TRUE,
      TRUE,
      TRUE,
      TRUE
    ),
    (
      '16000000-0000-4000-8000-000000000002'::UUID,
      'faturamento'::TEXT,
      'faturamento'::TEXT,
      TRUE,
      TRUE,
      TRUE,
      TRUE
    ),
    (
      '16000000-0000-4000-8000-000000000001'::UUID,
      'faturamento_viewer_contract'::TEXT,
      'faturamento'::TEXT,
      TRUE,
      FALSE,
      FALSE,
      FALSE
    ),
    (
      '16000000-0000-4000-8000-000000000001'::UUID,
      'recepcao'::TEXT,
      'recepcao'::TEXT,
      TRUE,
      TRUE,
      TRUE,
      FALSE
    ),
    (
      '16000000-0000-4000-8000-000000000001'::UUID,
      'medico'::TEXT,
      'assistencia'::TEXT,
      TRUE,
      TRUE,
      TRUE,
      FALSE
    ),
    (
      '16000000-0000-4000-8000-000000000001'::UUID,
      'paciente'::TEXT,
      'portal_paciente'::TEXT,
      TRUE,
      TRUE,
      TRUE,
      FALSE
    )
) AS fixture(
  company_id,
  role_name,
  module,
  can_view,
  can_create,
  can_edit,
  can_export
)
JOIN public.roles role_record ON role_record.name = fixture.role_name
ON CONFLICT (company_id, role_id, module) DO UPDATE
SET can_view = EXCLUDED.can_view,
    can_create = EXCLUDED.can_create,
    can_edit = EXCLUDED.can_edit,
    can_delete = EXCLUDED.can_delete,
    can_export = EXCLUDED.can_export,
    updated_at = NOW();

INSERT INTO public.user_access_context (
  user_id, session_id, membership_id, role_id, unit_id
)
SELECT
  fixture.user_id,
  fixture.session_id,
  fixture.membership_id,
  role_record.id,
  fixture.unit_id
FROM (
  VALUES
    (
      '16000000-0000-4000-8000-000000000011'::UUID,
      '16000000-0000-4000-8000-000000000211'::UUID,
      '16000000-0000-4000-8000-000000000111'::UUID,
      'faturamento'::TEXT,
      16001
    ),
    (
      '16000000-0000-4000-8000-000000000021'::UUID,
      '16000000-0000-4000-8000-000000000221'::UUID,
      '16000000-0000-4000-8000-000000000121'::UUID,
      'faturamento'::TEXT,
      16002
    ),
    (
      '16000000-0000-4000-8000-000000000031'::UUID,
      '16000000-0000-4000-8000-000000000231'::UUID,
      '16000000-0000-4000-8000-000000000131'::UUID,
      'faturamento_viewer_contract'::TEXT,
      16001
    ),
    (
      '16000000-0000-4000-8000-000000000041'::UUID,
      '16000000-0000-4000-8000-000000000241'::UUID,
      '16000000-0000-4000-8000-000000000141'::UUID,
      'recepcao'::TEXT,
      16001
    ),
    (
      '16000000-0000-4000-8000-000000000051'::UUID,
      '16000000-0000-4000-8000-000000000251'::UUID,
      '16000000-0000-4000-8000-000000000151'::UUID,
      'medico'::TEXT,
      16001
    ),
    (
      '16000000-0000-4000-8000-000000000061'::UUID,
      '16000000-0000-4000-8000-000000000261'::UUID,
      '16000000-0000-4000-8000-000000000161'::UUID,
      'paciente'::TEXT,
      16001
    )
) AS fixture(
  user_id,
  session_id,
  membership_id,
  role_name,
  unit_id
)
JOIN public.roles role_record ON role_record.name = fixture.role_name;

CREATE OR REPLACE FUNCTION pg_temp.set_tiss_contract_jwt(
  p_user_id UUID,
  p_company_id UUID,
  p_session_id UUID,
  p_aal TEXT DEFAULT 'aal2',
  p_database_role TEXT DEFAULT 'authenticated'
)
RETURNS VOID
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user_id::TEXT, TRUE);
  PERFORM set_config(
    'request.jwt.claim.company_id',
    p_company_id::TEXT,
    TRUE
  );
  PERFORM set_config('request.jwt.claim.role', p_database_role, TRUE);
  PERFORM set_config('request.jwt.claim.aal', p_aal, TRUE);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user_id,
      'company_id', p_company_id,
      'role', p_database_role,
      'session_id', p_session_id,
      'aal', p_aal
    )::TEXT,
    TRUE
  );
END
$function$;

INSERT INTO public.insurance_companies (
  id, company_id, name, registro_ans, lg_ativo
)
OVERRIDING SYSTEM VALUE
VALUES
  (
    160001,
    '16000000-0000-4000-8000-000000000001',
    'TISS Insurance A',
    '160001',
    TRUE
  ),
  (
    160002,
    '16000000-0000-4000-8000-000000000002',
    'TISS Insurance B',
    '160002',
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  lg_ativo = TRUE;

INSERT INTO public.insurance_plans (
  id, company_id, insurance_company_id, name, codigo, lg_ativo
)
OVERRIDING SYSTEM VALUE
VALUES
  (
    160011,
    '16000000-0000-4000-8000-000000000001',
    160001,
    'TISS Plan A',
    'PLAN-A',
    TRUE
  ),
  (
    160012,
    '16000000-0000-4000-8000-000000000002',
    160002,
    'TISS Plan B',
    'PLAN-B',
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  insurance_company_id = EXCLUDED.insurance_company_id,
  lg_ativo = TRUE;

INSERT INTO public.appointments (
  id,
  company_id,
  unit_id,
  appointment_date,
  start_time,
  status,
  insurance_company_id,
  insurance_plan_id
)
OVERRIDING SYSTEM VALUE
VALUES
  (
    160001,
    '16000000-0000-4000-8000-000000000001',
    16001,
    CURRENT_DATE,
    TIME '09:00',
    'COMPLETED',
    160001,
    160011
  ),
  (
    160002,
    '16000000-0000-4000-8000-000000000002',
    16002,
    CURRENT_DATE,
    TIME '10:00',
    'COMPLETED',
    160002,
    160012
  ),
  (
    160003,
    '16000000-0000-4000-8000-000000000001',
    16001,
    CURRENT_DATE,
    TIME '11:00',
    'COMPLETED',
    160001,
    160011
  )
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  unit_id = EXCLUDED.unit_id,
  insurance_company_id = EXCLUDED.insurance_company_id,
  insurance_plan_id = EXCLUDED.insurance_plan_id;

-- A database application role with tenant claims but no canonical session
-- must never regain the former claim-only bypass.
SELECT set_config(
  'request.jwt.claim.sub',
  '16000000-0000-4000-8000-000000000011',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.company_id',
  '16000000-0000-4000-8000-000000000001',
  TRUE
);
SELECT set_config('request.jwt.claim.role', 'app_prontomedic', TRUE);
SELECT set_config('request.jwt.claim.aal', 'aal2', TRUE);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '16000000-0000-4000-8000-000000000011',
    'company_id', '16000000-0000-4000-8000-000000000001',
    'role', 'app_prontomedic',
    'session_id', '16000000-0000-4000-8000-000000009999',
    'aal', 'aal2'
  )::TEXT,
  TRUE
);
SET LOCAL ROLE app_prontomedic;

DO $assert_claim_only_app_denied$
DECLARE
  v_rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM * FROM public.m16_list_xml_secure(NULL, 10);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Claim-only app role read bypass still exists';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.m16_generate_monthly_batch_secure(
      '16000000-0000-4000-8000-000000000901',
      date_trunc('month', CURRENT_DATE)::DATE
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Claim-only app role mutation bypass still exists';
  END IF;
END
$assert_claim_only_app_denied$;

RESET ROLE;

-- Reception, physician and patient have real AAL2 contexts, but no
-- company-scoped faturamento permission.
SET LOCAL ROLE authenticated;

DO $assert_negative_profiles$
DECLARE
  v_fixture RECORD;
  v_rejected BOOLEAN;
BEGIN
  FOR v_fixture IN
    SELECT *
      FROM (VALUES
        (
          'recepcao'::TEXT,
          '16000000-0000-4000-8000-000000000041'::UUID,
          '16000000-0000-4000-8000-000000000241'::UUID
        ),
        (
          'medico'::TEXT,
          '16000000-0000-4000-8000-000000000051'::UUID,
          '16000000-0000-4000-8000-000000000251'::UUID
        ),
        (
          'paciente'::TEXT,
          '16000000-0000-4000-8000-000000000061'::UUID,
          '16000000-0000-4000-8000-000000000261'::UUID
        )
      ) fixture(profile_name, user_id, session_id)
  LOOP
    PERFORM pg_temp.set_tiss_contract_jwt(
      v_fixture.user_id,
      '16000000-0000-4000-8000-000000000001',
      v_fixture.session_id
    );

    v_rejected := FALSE;
    BEGIN
      PERFORM * FROM public.m16_list_xml_secure(NULL, 10);
    EXCEPTION WHEN insufficient_privilege THEN
      v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION
        'Negative profile % read TISS data', v_fixture.profile_name;
    END IF;

    v_rejected := FALSE;
    BEGIN
      PERFORM public.create_tiss_guide_secure(
        'CONSULTA', 160001, 16001, NULL, NULL, 'HOMOLOGACAO'
      );
    EXCEPTION WHEN insufficient_privilege THEN
      v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION
        'Negative profile % mutated TISS data', v_fixture.profile_name;
    END IF;
  END LOOP;
END
$assert_negative_profiles$;

RESET ROLE;

-- A fully authorized membership still fails when the JWT is not AAL2.
SELECT pg_temp.set_tiss_contract_jwt(
  '16000000-0000-4000-8000-000000000011',
  '16000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000211',
  'aal1'
);
SET LOCAL ROLE authenticated;

DO $assert_aal1_denied$
DECLARE
  v_rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM * FROM public.m16_list_xml_secure(NULL, 10);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'AAL1 TISS read unexpectedly succeeded';
  END IF;
END
$assert_aal1_denied$;

RESET ROLE;

-- Read-only billing can use projections and stats, but cannot mutate or
-- retrieve full XML.
SELECT pg_temp.set_tiss_contract_jwt(
  '16000000-0000-4000-8000-000000000031',
  '16000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000231'
);
SET LOCAL ROLE authenticated;

DO $assert_viewer_boundary$
DECLARE
  v_rejected BOOLEAN := FALSE;
BEGIN
  PERFORM * FROM public.m16_list_xml_secure(NULL, 10);
  PERFORM * FROM public.tiss_get_stats(
    '16000000-0000-4000-8000-000000000001',
    EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
  );

  BEGIN
    PERFORM public.create_tiss_guide_secure(
      'CONSULTA', 160001, 16001, NULL, NULL, 'HOMOLOGACAO'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Read-only billing created a TISS guide';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.m16_get_xml_document_secure(1);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Read-only billing exported complete TISS XML';
  END IF;
END
$assert_viewer_boundary$;

RESET ROLE;

-- Full billing A: real canonical membership + session + AAL2.
SELECT pg_temp.set_tiss_contract_jwt(
  '16000000-0000-4000-8000-000000000011',
  '16000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000211'
);
SET LOCAL ROLE authenticated;

DO $assert_direct_access_blocked$
DECLARE
  v_rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM 1 FROM public.tiss_xml LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Authenticated billing can read TISS table directly';
  END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.tiss_xml (
      company_id, appointment_id, cd_convenio, vl_informado
    ) VALUES (
      '16000000-0000-4000-8000-000000000001',
      160001,
      160001,
      10
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Authenticated billing can mutate TISS table directly';
  END IF;
END
$assert_direct_access_blocked$;

INSERT INTO tiss_contract_state (key, value)
SELECT
  'guide_a_draft',
  to_jsonb(public.create_tiss_guide_secure(
    'CONSULTA', 160001, 16001, NULL, NULL, 'HOMOLOGACAO'
  ));

INSERT INTO tiss_contract_state (key, value)
SELECT
  'guide_a_validated',
  to_jsonb(public.validate_tiss_guide_secure(
    (
      SELECT (value->>'id')::UUID
        FROM tiss_contract_state
       WHERE key = 'guide_a_draft'
    ),
    '[]'::JSONB
  ));

INSERT INTO tiss_contract_state (key, value)
SELECT
  'guide_a_signed',
  to_jsonb(public.sign_tiss_guide_secure(
    (
      SELECT (value->>'id')::UUID
        FROM tiss_contract_state
       WHERE key = 'guide_a_draft'
    ),
    repeat('f', 64),
    'synthetic-signature-reference'
  ));

DO $assert_guide_projection$
DECLARE
  v_guide_id UUID := (
    SELECT (value->>'id')::UUID
      FROM tiss_contract_state
     WHERE key = 'guide_a_draft'
  );
BEGIN
  IF (
    SELECT value->>'status'
      FROM tiss_contract_state
     WHERE key = 'guide_a_draft'
  ) <> 'DRAFT'
     OR (
       SELECT value->>'status'
         FROM tiss_contract_state
        WHERE key = 'guide_a_validated'
     ) <> 'VALIDATED'
     OR (
       SELECT value->>'status'
         FROM tiss_contract_state
        WHERE key = 'guide_a_signed'
     ) <> 'SIGNED' THEN
    RAISE EXCEPTION 'TISS guide lifecycle contract failed';
  END IF;

  IF (
    SELECT count(*)
      FROM public.m16_list_guide_events_secure(v_guide_id)
  ) <> 3 THEN
    RAISE EXCEPTION 'TISS guide event projection is incomplete';
  END IF;
END
$assert_guide_projection$;

INSERT INTO tiss_contract_state (key, value)
SELECT
  'xml_a',
  public.m16_persist_xml_secure(
    '16000000-0000-4000-8000-000000000301',
    160001,
    jsonb_build_object(
      'cd_convenio', 160001,
      'ds_descricao', 'Synthetic TISS A',
      'ds_filename', 'synthetic-a.xml',
      'dt_fatura', CURRENT_DATE,
      'ds_tipo_guia', 'CONSULTA',
      'vl_informado', '100.00',
      'bl_xml_enviado',
        '<ans:mensagemTISS><ans:hash>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</ans:hash></ans:mensagemTISS>',
      'ds_hash_envio',
        '685dbaa0a6663822809adf4cd92726ae4e90e9f03a114a64a044bfd373a29443',
      'ds_versao_tiss', '4.03.00',
      'tp_ambiente', 'HOMOLOGACAO'
    )
  );

INSERT INTO tiss_contract_state (key, value)
SELECT
  'xml_a_retry',
  public.m16_persist_xml_secure(
    '16000000-0000-4000-8000-000000000301',
    160001,
    jsonb_build_object(
      'cd_convenio', 160001,
      'ds_descricao', 'Synthetic TISS A',
      'ds_filename', 'synthetic-a.xml',
      'dt_fatura', CURRENT_DATE,
      'ds_tipo_guia', 'CONSULTA',
      'vl_informado', '100.00',
      'bl_xml_enviado',
        '<ans:mensagemTISS><ans:hash>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</ans:hash></ans:mensagemTISS>',
      'ds_hash_envio',
        '685dbaa0a6663822809adf4cd92726ae4e90e9f03a114a64a044bfd373a29443',
      'ds_versao_tiss', '4.03.00',
      'tp_ambiente', 'HOMOLOGACAO'
    )
  );

DO $assert_xml_projection_and_export$
DECLARE
  v_xml_id BIGINT := (
    SELECT (value->>'id')::BIGINT
      FROM tiss_contract_state
     WHERE key = 'xml_a'
  );
  v_document JSONB;
BEGIN
  IF (
    SELECT value FROM tiss_contract_state WHERE key = 'xml_a'
  ) IS DISTINCT FROM (
    SELECT value FROM tiss_contract_state WHERE key = 'xml_a_retry'
  ) THEN
    RAISE EXCEPTION 'TISS XML persist RPC is not idempotent';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.m16_list_xml_secure(NULL, 10)
     WHERE id = v_xml_id
       AND appointment_id = 160001
       AND vl_informado = 100.00
  ) THEN
    RAISE EXCEPTION 'TISS XML minimal projection is incomplete';
  END IF;

  v_document := public.m16_get_xml_document_secure(v_xml_id);
  IF v_document->>'bl_xml_enviado' IS DISTINCT FROM
     '<ans:mensagemTISS><ans:hash>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</ans:hash></ans:mensagemTISS>' THEN
    RAISE EXCEPTION 'Explicit full XML export RPC returned wrong content';
  END IF;
END
$assert_xml_projection_and_export$;

INSERT INTO tiss_contract_state (key, value)
SELECT
  'protocol_a',
  public.m16_save_protocol_secure(
    '16000000-0000-4000-8000-000000000311',
    jsonb_build_object(
      'cd_convenio', 160001,
      'ds_endpoint', 'https://example.invalid/tiss/homologacao',
      'ds_versao_tiss', '4.03.00',
      'tp_ambiente', 'HOMOLOGACAO',
      'lg_active', TRUE,
      'ds_observacao', 'Synthetic metadata only'
    )
  );

DO $assert_protocol_projection_has_no_credentials$
DECLARE
  v_row JSONB;
BEGIN
  SELECT to_jsonb(protocol_row)
    INTO v_row
    FROM public.m16_list_protocols_secure() protocol_row
   WHERE protocol_row.cd_convenio = 160001;
  IF v_row IS NULL
     OR v_row ? 'ds_senha'
     OR v_row ? 'ds_certificado_senha'
     OR v_row ? 'cd_certificado_a1_path' THEN
    RAISE EXCEPTION 'TISS protocol projection leaks credentials';
  END IF;
END
$assert_protocol_projection_has_no_credentials$;

DO $assert_gateway_not_callable_by_user$
DECLARE
  v_rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.m16_record_transmission_result_gateway(
      '16000000-0000-4000-8000-000000000321',
      (
        SELECT (value->>'id')::BIGINT
          FROM tiss_contract_state
         WHERE key = 'xml_a'
      ),
      TRUE,
      200,
      'FORBIDDEN',
      '<retorno/>',
      NULL,
      NOW()
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'User called gateway-only result RPC';
  END IF;
END
$assert_gateway_not_callable_by_user$;

RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '', TRUE);
SELECT set_config(
  'request.jwt.claim.company_id',
  '16000000-0000-4000-8000-000000000001',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.role',
  'prontomedic_tiss_gateway',
  TRUE
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'company_id', '16000000-0000-4000-8000-000000000001',
    'role', 'prontomedic_tiss_gateway'
  )::TEXT,
  TRUE
);
SET LOCAL ROLE prontomedic_tiss_gateway;

INSERT INTO tiss_contract_state (key, value)
SELECT
  'gateway_a',
  public.m16_record_transmission_result_gateway(
    '16000000-0000-4000-8000-000000000321',
    (
      SELECT (value->>'id')::BIGINT
        FROM tiss_contract_state
       WHERE key = 'xml_a'
    ),
    TRUE,
    200,
    'SYNTHETIC-PROTOCOL-A',
    '<retorno><protocolo>SYNTHETIC-PROTOCOL-A</protocolo></retorno>',
    NULL,
    TIMESTAMPTZ '2026-07-27 12:00:00+00'
  );

RESET ROLE;

SELECT pg_temp.set_tiss_contract_jwt(
  '16000000-0000-4000-8000-000000000011',
  '16000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000211'
);
SET LOCAL ROLE authenticated;

INSERT INTO tiss_contract_state (key, value)
SELECT
  'return_a',
  public.m16_process_return_secure(
    '16000000-0000-4000-8000-000000000331',
    (
      SELECT (value->>'id')::BIGINT
        FROM tiss_contract_state
       WHERE key = 'xml_a'
    ),
    jsonb_build_object(
      'protocol', 'SYNTHETIC-PROTOCOL-A',
      'return_xml',
        '<retorno><valorProcessado>100.00</valorProcessado><valorLiberado>80.00</valorLiberado></retorno>',
      'return_hash',
        'c8eeb504cb1b4bc51eae6d2f46206f34c32a2cbd484ce260da5e0eced9ed18e1',
      'processed_amount', '100.00',
      'released_amount', '80.00',
      'glosas', jsonb_build_array(
        jsonb_build_object(
          'code', '7101',
          'reason', 'Synthetic denial only',
          'amount', '20.00',
          'tuss_code', '10101012'
        )
      ),
      'returned_at', '2026-07-27T13:00:00Z'
    )
  );

INSERT INTO tiss_contract_state (key, value)
SELECT
  'manual_denial_a',
  public.m16_record_manual_denial_secure(
    '16000000-0000-4000-8000-000000000341',
    (
      SELECT (value->>'id')::BIGINT
        FROM tiss_contract_state
       WHERE key = 'xml_a'
    ),
    'Synthetic manual denial only',
    5.00,
    '7199'
  );

DO $assert_return_projection$
DECLARE
  v_xml_id BIGINT := (
    SELECT (value->>'id')::BIGINT
      FROM tiss_contract_state
     WHERE key = 'xml_a'
  );
BEGIN
  IF (
    SELECT count(*)
      FROM public.m16_list_denials_secure(v_xml_id, 10)
  ) <> 2 OR NOT EXISTS (
    SELECT 1
      FROM public.m16_list_xml_secure(NULL, 10)
     WHERE id = v_xml_id
       AND vl_glosa = 25.00
  ) THEN
    RAISE EXCEPTION 'TISS return/denial projection contract failed';
  END IF;
END
$assert_return_projection$;

INSERT INTO tiss_contract_state (key, value)
SELECT
  'xml_a_pending',
  public.m16_persist_xml_secure(
    '16000000-0000-4000-8000-000000000351',
    160003,
    jsonb_build_object(
      'cd_convenio', 160001,
      'ds_descricao', 'Synthetic pending TISS A',
      'dt_fatura', CURRENT_DATE,
      'ds_tipo_guia', 'CONSULTA',
      'vl_informado', '50.00',
      'bl_xml_enviado',
        '<ans:mensagemTISS><ans:hash>dddddddddddddddddddddddddddddddd</ans:hash></ans:mensagemTISS>',
      'ds_hash_envio',
        '053db2a8d4c0e8aeb8f2720a545fc7cf12808e241ac6cbc47e9b52866c25fad1',
      'ds_versao_tiss', '4.03.00',
      'tp_ambiente', 'HOMOLOGACAO'
    )
  );

INSERT INTO tiss_contract_state (key, value)
SELECT
  'batch_a',
  public.m16_generate_monthly_batch_secure(
    '16000000-0000-4000-8000-000000000361',
    date_trunc('month', CURRENT_DATE)::DATE
  );

DO $assert_batch_and_stats$
DECLARE
  v_rejected BOOLEAN := FALSE;
BEGIN
  IF (
    SELECT (value->>'total_xmls')::INTEGER
      FROM tiss_contract_state
     WHERE key = 'batch_a'
  ) <> 1 OR NOT EXISTS (
    SELECT 1
      FROM public.tiss_get_stats(
        '16000000-0000-4000-8000-000000000001',
        EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
      )
     WHERE cd_convenio = 160001
       AND total_guias = 2
       AND total_enviado = 150.00
  ) THEN
    RAISE EXCEPTION 'TISS batch/statistics contract failed';
  END IF;

  BEGIN
    PERFORM *
      FROM public.tiss_get_stats(
        '16000000-0000-4000-8000-000000000002',
        EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
      );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'TISS statistics accepted a client-controlled tenant';
  END IF;
END
$assert_batch_and_stats$;

RESET ROLE;

-- Full billing B proves company isolation with another real AAL2 context.
SELECT pg_temp.set_tiss_contract_jwt(
  '16000000-0000-4000-8000-000000000021',
  '16000000-0000-4000-8000-000000000002',
  '16000000-0000-4000-8000-000000000221'
);
SET LOCAL ROLE authenticated;

INSERT INTO tiss_contract_state (key, value)
SELECT
  'xml_b',
  public.m16_persist_xml_secure(
    '16000000-0000-4000-8000-000000000401',
    160002,
    jsonb_build_object(
      'cd_convenio', 160002,
      'ds_descricao', 'Synthetic TISS B',
      'dt_fatura', CURRENT_DATE,
      'ds_tipo_guia', 'CONSULTA',
      'vl_informado', '75.00',
      'bl_xml_enviado',
        '<ans:mensagemTISS><ans:hash>eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee</ans:hash></ans:mensagemTISS>',
      'ds_hash_envio',
        '4245aee5955c441868d2a9a60caedf8690679f57a8f3798fb3ea57d8694a14d5',
      'ds_versao_tiss', '4.03.00',
      'tp_ambiente', 'HOMOLOGACAO'
    )
  );

DO $assert_tenant_b_isolation$
DECLARE
  v_rejected BOOLEAN := FALSE;
  v_xml_a_id BIGINT := (
    SELECT (value->>'id')::BIGINT
      FROM tiss_contract_state
     WHERE key = 'xml_a'
  );
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.m16_list_xml_secure(NULL, 100)
     WHERE appointment_id IN (160001, 160003)
  ) OR NOT EXISTS (
    SELECT 1
      FROM public.m16_list_xml_secure(NULL, 100)
     WHERE appointment_id = 160002
  ) THEN
    RAISE EXCEPTION 'Tenant B TISS projection is not isolated';
  END IF;

  BEGIN
    PERFORM public.m16_get_xml_document_secure(v_xml_a_id);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Tenant B exported tenant A full XML';
  END IF;
END
$assert_tenant_b_isolation$;

RESET ROLE;

-- Database-level guards remain independently enforced under the technical
-- owner and do not depend on client ACL failures.
SELECT pg_temp.set_tiss_contract_jwt(
  '16000000-0000-4000-8000-000000000011',
  '16000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000211'
);
SET LOCAL ROLE prontomedic_tiss_rpc_owner;

DO $assert_database_guards$
DECLARE
  v_rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.tiss_xml (
      company_id, appointment_id, cd_convenio, vl_informado
    ) VALUES (
      '16000000-0000-4000-8000-000000000001',
      160002,
      160001,
      10.00
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Composite TISS FK accepted cross-company ancestry';
  END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.tiss_xml (
      company_id, appointment_id, cd_convenio, vl_informado
    ) VALUES (
      '16000000-0000-4000-8000-000000000001',
      160001,
      160001,
      -0.01
    );
  EXCEPTION WHEN check_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'TISS financial CHECK accepted a negative amount';
  END IF;
END
$assert_database_guards$;

RESET ROLE;
ROLLBACK;

SELECT 'module16_tiss_runtime_contract: ok' AS result;

-- Migration: 20260727011730
-- Module 23 / LIS runtime security closure.
-- Additive, fail-closed and safe to replay.
-- DataSIGH is deliberately outside this migration.
BEGIN;

-- Never wait indefinitely for ACCESS EXCLUSIVE locks in a live replay. Any
-- contention aborts the whole transaction instead of leaving a partial state.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

DO $preflight$
DECLARE
  v_table TEXT;
  v_column TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    RAISE EXCEPTION 'Module 23 requires role app_prontomedic';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Module 23 requires role authenticated';
  END IF;
  IF to_regprocedure('public.current_company_id()') IS NULL THEN
    RAISE EXCEPTION 'Module 23 requires public.current_company_id()';
  END IF;
  IF to_regprocedure('public.request_company_id()') IS NULL THEN
    RAISE EXCEPTION 'Module 23 requires public.request_company_id()';
  END IF;
  IF to_regprocedure('public.classificar_resultado_lab(numeric,numeric,numeric)') IS NULL THEN
    RAISE EXCEPTION 'Module 23 requires public.classificar_resultado_lab(numeric,numeric,numeric)';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'companies',
    'user_profiles',
    'patients',
    'professionals',
    'appointments',
    'exames_lab_catalogo',
    'exames_lab_valor_referencia',
    'exames_lab_pedido',
    'exames_lab_pedido_itens',
    'exames_lab_resultado',
    'exames_lab_alerta_critico'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'Module 23 requires public.%', v_table;
    END IF;
  END LOOP;

  FOR v_table, v_column IN
    SELECT *
      FROM (VALUES
        ('user_profiles', 'id'),
        ('user_profiles', 'user_id'),
        ('user_profiles', 'company_id'),
        ('user_profiles', 'role_name'),
        ('user_profiles', 'lg_ativo'),
        ('patients', 'id'),
        ('patients', 'company_id'),
        ('patients', 'birth_date'),
        ('patients', 'sex'),
        ('professionals', 'id'),
        ('professionals', 'company_id'),
        ('appointments', 'id'),
        ('appointments', 'company_id'),
        ('exames_lab_catalogo', 'id'),
        ('exames_lab_catalogo', 'company_id'),
        ('exames_lab_valor_referencia', 'id'),
        ('exames_lab_valor_referencia', 'cd_exame'),
        ('exames_lab_valor_referencia', 'ds_parametro'),
        ('exames_lab_valor_referencia', 'vl_minimo'),
        ('exames_lab_valor_referencia', 'vl_maximo'),
        ('exames_lab_valor_referencia', 'ds_unidade'),
        ('exames_lab_valor_referencia', 'cd_sexo'),
        ('exames_lab_valor_referencia', 'nr_idade_min'),
        ('exames_lab_valor_referencia', 'nr_idade_max'),
        ('exames_lab_valor_referencia', 'lg_ativo'),
        ('exames_lab_pedido', 'id'),
        ('exames_lab_pedido', 'company_id'),
        ('exames_lab_pedido', 'cd_paciente'),
        ('exames_lab_pedido', 'cd_medico'),
        ('exames_lab_pedido', 'cd_appointment'),
        ('exames_lab_pedido_itens', 'id'),
        ('exames_lab_pedido_itens', 'cd_pedido'),
        ('exames_lab_pedido_itens', 'cd_exame'),
        ('exames_lab_pedido_itens', 'tp_status'),
        ('exames_lab_pedido_itens', 'dt_coleta'),
        ('exames_lab_pedido_itens', 'ds_amostra_id'),
        ('exames_lab_resultado', 'id'),
        ('exames_lab_resultado', 'cd_item_pedido'),
        ('exames_lab_resultado', 'cd_valor_referencia'),
        ('exames_lab_alerta_critico', 'id'),
        ('exames_lab_alerta_critico', 'cd_resultado'),
        ('exames_lab_alerta_critico', 'cd_paciente'),
        ('exames_lab_alerta_critico', 'cd_medico')
      ) AS required_columns(table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = v_table
         AND column_name = v_column
    ) THEN
      RAISE EXCEPTION 'Module 23 requires public.%.%', v_table, v_column;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_proc procedure_row
      JOIN pg_namespace namespace_row
        ON namespace_row.oid = procedure_row.pronamespace
     WHERE namespace_row.nspname = 'public'
       AND procedure_row.proname IN (
         'm23_upsert_equipment_secure',
         'm23_record_qc_run_secure'
       )
  ) THEN
    RAISE EXCEPTION
      'Equipment/QC RPCs are prohibited until real Module 23 tables and contracts exist';
  END IF;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

DO $role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_lis_rpc_owner'
  ) THEN
    CREATE ROLE prontomedic_lis_rpc_owner;
  END IF;
END
$role$;

ALTER ROLE prontomedic_lis_rpc_owner
  NOLOGIN
  NOINHERIT
  NOBYPASSRLS
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION;

DO $role_membership_preflight$
DECLARE
  v_owner_oid OID;
  v_memberships TEXT;
BEGIN
  SELECT oid
    INTO v_owner_oid
    FROM pg_roles
   WHERE rolname = 'prontomedic_lis_rpc_owner';

  IF EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE oid = v_owner_oid
       AND (
         rolcanlogin
         OR rolinherit
         OR rolsuper
         OR rolcreatedb
         OR rolcreaterole
         OR rolreplication
         OR rolbypassrls
       )
  ) THEN
    RAISE EXCEPTION
      'prontomedic_lis_rpc_owner has unsafe role attributes';
  END IF;

  SELECT string_agg(
           CASE
             WHEN membership.member = v_owner_oid
               THEN 'member-of:' || granted_role.rolname
             ELSE 'granted-to:' || member_role.rolname
           END,
           ', ' ORDER BY granted_role.rolname, member_role.rolname
         )
    INTO v_memberships
    FROM pg_auth_members membership
    JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
    JOIN pg_roles member_role ON member_role.oid = membership.member
   WHERE membership.member = v_owner_oid
      OR membership.roleid = v_owner_oid;

  IF v_memberships IS NOT NULL THEN
    RAISE EXCEPTION
      'prontomedic_lis_rpc_owner must have no role memberships: %',
      v_memberships;
  END IF;
END
$role_membership_preflight$;

ALTER TABLE public.exames_lab_valor_referencia
  ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE public.exames_lab_pedido_itens
  ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE public.exames_lab_resultado
  ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE public.exames_lab_alerta_critico
  ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE public.exames_lab_alerta_critico
  ADD COLUMN IF NOT EXISTS tp_status VARCHAR(20);
ALTER TABLE public.exames_lab_alerta_critico
  ADD COLUMN IF NOT EXISTS dt_resolucao TIMESTAMPTZ;
ALTER TABLE public.exames_lab_alerta_critico
  ADD COLUMN IF NOT EXISTS cd_usuario_resolveu UUID;
ALTER TABLE public.exames_lab_alerta_critico
  ADD COLUMN IF NOT EXISTS ds_motivo_resolucao VARCHAR(100);

UPDATE public.exames_lab_alerta_critico
   SET tp_status = CASE
     WHEN COALESCE(lg_comunicado, FALSE) THEN 'COMUNICADO'
     ELSE 'PENDENTE'
   END
 WHERE tp_status IS NULL;

DO $tenant_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_valor_referencia reference_row
      LEFT JOIN public.exames_lab_catalogo catalog
        ON catalog.id = reference_row.cd_exame
     WHERE catalog.id IS NULL
        OR (
          reference_row.company_id IS NOT NULL
          AND reference_row.company_id IS DISTINCT FROM catalog.company_id
        )
  ) THEN
    RAISE EXCEPTION
      'Module 23 preflight failed: reference range has missing/cross-company exam';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_pedido order_row
      LEFT JOIN public.patients patient
        ON patient.id = order_row.cd_paciente
      LEFT JOIN public.professionals professional
        ON professional.id = order_row.cd_medico
      LEFT JOIN public.appointments appointment
        ON appointment.id = order_row.cd_appointment
     WHERE patient.id IS NULL
        OR professional.id IS NULL
        OR patient.company_id IS DISTINCT FROM order_row.company_id
        OR professional.company_id IS DISTINCT FROM order_row.company_id
        OR (
          order_row.cd_appointment IS NOT NULL
          AND (
            appointment.id IS NULL
            OR appointment.company_id IS DISTINCT FROM order_row.company_id
          )
        )
  ) THEN
    RAISE EXCEPTION
      'Module 23 preflight failed: lab order has missing/cross-company patient, professional or appointment';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_pedido_itens item
      LEFT JOIN public.exames_lab_pedido order_row
        ON order_row.id = item.cd_pedido
      LEFT JOIN public.exames_lab_catalogo catalog
        ON catalog.id = item.cd_exame
     WHERE order_row.id IS NULL
        OR catalog.id IS NULL
        OR order_row.company_id IS DISTINCT FROM catalog.company_id
        OR (
          item.company_id IS NOT NULL
          AND item.company_id IS DISTINCT FROM order_row.company_id
        )
  ) THEN
    RAISE EXCEPTION
      'Module 23 preflight failed: lab order item has missing/cross-company order or exam';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_resultado result_row
      LEFT JOIN public.exames_lab_pedido_itens item
        ON item.id = result_row.cd_item_pedido
      LEFT JOIN public.exames_lab_pedido order_row
        ON order_row.id = item.cd_pedido
      LEFT JOIN public.exames_lab_valor_referencia reference_row
        ON reference_row.id = result_row.cd_valor_referencia
     WHERE item.id IS NULL
        OR order_row.id IS NULL
        OR (
          result_row.company_id IS NOT NULL
          AND result_row.company_id IS DISTINCT FROM order_row.company_id
        )
        OR (
          result_row.cd_valor_referencia IS NOT NULL
          AND (
            reference_row.id IS NULL
            OR reference_row.company_id IS DISTINCT FROM order_row.company_id
            OR reference_row.cd_exame IS DISTINCT FROM item.cd_exame
          )
        )
  ) THEN
    RAISE EXCEPTION
      'Module 23 preflight failed: result has missing/cross-company item or reference range';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_alerta_critico alert_row
      LEFT JOIN public.exames_lab_resultado result_row
        ON result_row.id = alert_row.cd_resultado
      LEFT JOIN public.exames_lab_pedido_itens item
        ON item.id = result_row.cd_item_pedido
      LEFT JOIN public.exames_lab_pedido order_row
        ON order_row.id = item.cd_pedido
      LEFT JOIN public.patients patient
        ON patient.id = alert_row.cd_paciente
      LEFT JOIN public.professionals professional
        ON professional.id = alert_row.cd_medico
     WHERE result_row.id IS NULL
        OR item.id IS NULL
        OR order_row.id IS NULL
        OR patient.id IS NULL
        OR professional.id IS NULL
        OR alert_row.cd_paciente IS DISTINCT FROM order_row.cd_paciente
        OR alert_row.cd_medico IS DISTINCT FROM order_row.cd_medico
        OR patient.company_id IS DISTINCT FROM order_row.company_id
        OR professional.company_id IS DISTINCT FROM order_row.company_id
        OR (
          alert_row.company_id IS NOT NULL
          AND alert_row.company_id IS DISTINCT FROM order_row.company_id
        )
  ) THEN
    RAISE EXCEPTION
      'Module 23 preflight failed: critical alert has missing/cross-company ancestry';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_alerta_critico
     WHERE tp_status IN ('PENDENTE', 'COMUNICADO')
     GROUP BY cd_resultado
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Module 23 preflight failed: more than one active critical alert exists for a result';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_catalogo
     WHERE nr_prazo_dias < 0
        OR vl_particular < 0
        OR vl_convenio < 0
  ) THEN
    RAISE EXCEPTION
      'Module 23 preflight failed: negative deadline or price exists in lab catalog';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_resultado
     GROUP BY company_id, cd_item_pedido, lower(btrim(ds_parametro))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Module 23 preflight failed: duplicate normalized result parameter exists in a tenant/item';
  END IF;
END
$tenant_preflight$;

UPDATE public.exames_lab_valor_referencia reference_row
   SET company_id = catalog.company_id
  FROM public.exames_lab_catalogo catalog
 WHERE catalog.id = reference_row.cd_exame
   AND reference_row.company_id IS NULL;

UPDATE public.exames_lab_pedido_itens item
   SET company_id = order_row.company_id
  FROM public.exames_lab_pedido order_row
 WHERE order_row.id = item.cd_pedido
   AND item.company_id IS NULL;

UPDATE public.exames_lab_resultado result_row
   SET company_id = item.company_id
  FROM public.exames_lab_pedido_itens item
 WHERE item.id = result_row.cd_item_pedido
   AND result_row.company_id IS NULL;

UPDATE public.exames_lab_alerta_critico alert_row
   SET company_id = result_row.company_id
  FROM public.exames_lab_resultado result_row
 WHERE result_row.id = alert_row.cd_resultado
   AND alert_row.company_id IS NULL;

DO $tenant_null_assert$
DECLARE
  v_table TEXT;
  v_has_null BOOLEAN;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'exames_lab_valor_referencia',
    'exames_lab_pedido_itens',
    'exames_lab_resultado',
    'exames_lab_alerta_critico'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = v_table
         AND column_name = 'company_id'
         AND data_type = 'uuid'
    ) THEN
      RAISE EXCEPTION 'public.%.company_id must exist as UUID', v_table;
    END IF;
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE company_id IS NULL)',
      v_table
    ) INTO v_has_null;
    IF v_has_null THEN
      RAISE EXCEPTION 'Module 23 could not derive company_id for public.%', v_table;
    END IF;
  END LOOP;
END
$tenant_null_assert$;

ALTER TABLE public.exames_lab_valor_referencia
  ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.exames_lab_pedido_itens
  ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.exames_lab_resultado
  ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.exames_lab_alerta_critico
  ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.exames_lab_alerta_critico
  ALTER COLUMN tp_status SET DEFAULT 'PENDENTE';
ALTER TABLE public.exames_lab_alerta_critico
  ALTER COLUMN tp_status SET NOT NULL;

DO $unique_constraints$
DECLARE
  v_spec RECORD;
BEGIN
  FOR v_spec IN
    SELECT *
      FROM (VALUES
        ('patients', 'patients_company_id_id_m23_uq'),
        ('professionals', 'professionals_company_id_id_m23_uq'),
        ('appointments', 'appointments_company_id_id_m23_uq'),
        ('exames_lab_catalogo', 'lab_catalog_company_id_id_uq'),
        ('exames_lab_valor_referencia', 'lab_reference_company_id_id_uq'),
        ('exames_lab_pedido', 'lab_order_company_id_id_uq'),
        ('exames_lab_pedido_itens', 'lab_item_company_id_id_uq'),
        ('exames_lab_resultado', 'lab_result_company_id_id_uq')
      ) AS specs(table_name, constraint_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conrelid = format('public.%I', v_spec.table_name)::regclass
         AND conname = v_spec.constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (company_id, id)',
        v_spec.table_name,
        v_spec.constraint_name
      );
    END IF;
    IF (
      SELECT regexp_replace(lower(pg_get_constraintdef(oid)), '\s+', '', 'g')
        FROM pg_constraint
       WHERE conrelid = format('public.%I', v_spec.table_name)::regclass
         AND conname = v_spec.constraint_name
    ) IS DISTINCT FROM 'unique(company_id,id)' THEN
      RAISE EXCEPTION 'Constraint % exists with an unsafe definition',
        v_spec.constraint_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.exames_lab_alerta_critico'::regclass
       AND conname = 'lab_alert_company_result_uq'
       AND regexp_replace(
             lower(pg_get_constraintdef(oid)),
             '[[:space:]"]+',
             '',
             'g'
           ) IS DISTINCT FROM 'unique(company_id,cd_resultado)'
  ) THEN
    RAISE EXCEPTION
      'Constraint lab_alert_company_result_uq has an unsafe definition';
  END IF;

  ALTER TABLE public.exames_lab_alerta_critico
    DROP CONSTRAINT IF EXISTS lab_alert_company_result_uq;

  IF EXISTS (
    SELECT 1
      FROM pg_constraint constraint_row
     WHERE constraint_row.conrelid =
           'public.exames_lab_alerta_critico'::regclass
       AND constraint_row.contype = 'u'
       AND regexp_replace(
             lower(pg_get_constraintdef(constraint_row.oid)),
             '[[:space:]"]+',
             '',
             'g'
           ) = 'unique(company_id,cd_resultado)'
  ) THEN
    RAISE EXCEPTION
      'Unexpected full unique constraint blocks critical alert history';
  END IF;
END
$unique_constraints$;

DO $check_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.exames_lab_catalogo'::regclass
       AND conname = 'lab_catalog_nonnegative_values_ck'
  ) THEN
    ALTER TABLE public.exames_lab_catalogo
      ADD CONSTRAINT lab_catalog_nonnegative_values_ck
      CHECK (
        nr_prazo_dias >= 0
        AND (vl_particular IS NULL OR vl_particular >= 0)
        AND (vl_convenio IS NULL OR vl_convenio >= 0)
      ) NOT VALID;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.exames_lab_catalogo'::regclass
       AND conname = 'lab_catalog_nonnegative_values_ck'
       AND regexp_replace(
             regexp_replace(
               lower(pg_get_constraintdef(oid)),
               '[[:space:]"():]+',
               '',
               'g'
             ),
             'notvalid$',
             ''
           ) IS DISTINCT FROM
           'checknr_prazo_dias>=0andvl_particularisnullorvl_particular>=0numericandvl_convenioisnullorvl_convenio>=0numeric'
  ) THEN
    RAISE EXCEPTION
      'Constraint lab_catalog_nonnegative_values_ck has an unsafe definition';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.exames_lab_alerta_critico'::regclass
       AND conname = 'lab_alert_status_ck'
  ) THEN
    ALTER TABLE public.exames_lab_alerta_critico
      ADD CONSTRAINT lab_alert_status_ck
      CHECK (tp_status IN ('PENDENTE', 'COMUNICADO', 'RESOLVIDO'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.exames_lab_alerta_critico'::regclass
       AND conname = 'lab_alert_lifecycle_ck'
  ) THEN
    ALTER TABLE public.exames_lab_alerta_critico
      ADD CONSTRAINT lab_alert_lifecycle_ck
      CHECK (
        (
          NOT COALESCE(lg_comunicado, FALSE)
          AND dt_comunicacao IS NULL
        )
        OR (
          lg_comunicado
          AND dt_comunicacao IS NOT NULL
        )
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.exames_lab_alerta_critico'::regclass
       AND conname = 'lab_alert_resolution_ck'
  ) THEN
    ALTER TABLE public.exames_lab_alerta_critico
      ADD CONSTRAINT lab_alert_resolution_ck
      CHECK (
        (
          tp_status = 'RESOLVIDO'
          AND dt_resolucao IS NOT NULL
          AND ds_motivo_resolucao IS NOT NULL
        )
        OR (
          tp_status IN ('PENDENTE', 'COMUNICADO')
          AND dt_resolucao IS NULL
          AND cd_usuario_resolveu IS NULL
          AND ds_motivo_resolucao IS NULL
        )
      )
      NOT VALID;
  END IF;

  IF (
    SELECT regexp_replace(
             regexp_replace(
               lower(pg_get_constraintdef(oid)),
               '[[:space:]"]+',
               '',
               'g'
             ),
             'notvalid$',
             ''
           )
      FROM pg_constraint
     WHERE conrelid = 'public.exames_lab_alerta_critico'::regclass
       AND conname = 'lab_alert_status_ck'
       AND contype = 'c'
  ) IS DISTINCT FROM
     'check(((tp_status)::text=any((array[''pendente''::charactervarying,''comunicado''::charactervarying,''resolvido''::charactervarying])::text[])))' THEN
    RAISE EXCEPTION
      'Constraint lab_alert_status_ck has an unsafe definition';
  END IF;

  IF (
    SELECT regexp_replace(
             regexp_replace(
               lower(pg_get_constraintdef(oid)),
               '[[:space:]"]+',
               '',
               'g'
             ),
             'notvalid$',
             ''
           )
      FROM pg_constraint
     WHERE conrelid = 'public.exames_lab_alerta_critico'::regclass
       AND conname = 'lab_alert_lifecycle_ck'
       AND contype = 'c'
  ) IS DISTINCT FROM
     'check((((notcoalesce(lg_comunicado,false))and(dt_comunicacaoisnull))or(lg_comunicadoand(dt_comunicacaoisnotnull))))' THEN
    RAISE EXCEPTION
      'Constraint lab_alert_lifecycle_ck has an unsafe definition';
  END IF;

  IF (
    SELECT regexp_replace(
             regexp_replace(
               lower(pg_get_constraintdef(oid)),
               '[[:space:]"]+',
               '',
               'g'
             ),
             'notvalid$',
             ''
           )
      FROM pg_constraint
     WHERE conrelid = 'public.exames_lab_alerta_critico'::regclass
       AND conname = 'lab_alert_resolution_ck'
       AND contype = 'c'
  ) IS DISTINCT FROM
     'check(((((tp_status)::text=''resolvido''::text)and(dt_resolucaoisnotnull)and(ds_motivo_resolucaoisnotnull))or(((tp_status)::text=any((array[''pendente''::charactervarying,''comunicado''::charactervarying])::text[]))and(dt_resolucaoisnull)and(cd_usuario_resolveuisnull)and(ds_motivo_resolucaoisnull))))' THEN
    RAISE EXCEPTION
      'Constraint lab_alert_resolution_ck has an unsafe definition';
  END IF;
END
$check_constraints$;

ALTER TABLE public.exames_lab_catalogo
  VALIDATE CONSTRAINT lab_catalog_nonnegative_values_ck;
ALTER TABLE public.exames_lab_alerta_critico
  VALIDATE CONSTRAINT lab_alert_status_ck;
ALTER TABLE public.exames_lab_alerta_critico
  VALIDATE CONSTRAINT lab_alert_lifecycle_ck;
ALTER TABLE public.exames_lab_alerta_critico
  VALIDATE CONSTRAINT lab_alert_resolution_ck;

DO $foreign_keys$
DECLARE
  v_spec RECORD;
  v_definition TEXT;
  v_expected TEXT;
BEGIN
  FOR v_spec IN
    SELECT *
      FROM (VALUES
        (
          'exames_lab_valor_referencia',
          'lab_reference_company_exam_fk',
          'company_id, cd_exame',
          'exames_lab_catalogo',
          'company_id, id',
          'ON DELETE CASCADE'
        ),
        (
          'exames_lab_pedido',
          'lab_order_company_patient_fk',
          'company_id, cd_paciente',
          'patients',
          'company_id, id',
          'ON DELETE RESTRICT'
        ),
        (
          'exames_lab_pedido',
          'lab_order_company_professional_fk',
          'company_id, cd_medico',
          'professionals',
          'company_id, id',
          'ON DELETE RESTRICT'
        ),
        (
          'exames_lab_pedido',
          'lab_order_company_appointment_fk',
          'company_id, cd_appointment',
          'appointments',
          'company_id, id',
          'ON DELETE RESTRICT'
        ),
        (
          'exames_lab_pedido_itens',
          'lab_item_company_order_fk',
          'company_id, cd_pedido',
          'exames_lab_pedido',
          'company_id, id',
          'ON DELETE CASCADE'
        ),
        (
          'exames_lab_pedido_itens',
          'lab_item_company_exam_fk',
          'company_id, cd_exame',
          'exames_lab_catalogo',
          'company_id, id',
          'ON DELETE RESTRICT'
        ),
        (
          'exames_lab_resultado',
          'lab_result_company_item_fk',
          'company_id, cd_item_pedido',
          'exames_lab_pedido_itens',
          'company_id, id',
          'ON DELETE CASCADE'
        ),
        (
          'exames_lab_resultado',
          'lab_result_company_reference_fk',
          'company_id, cd_valor_referencia',
          'exames_lab_valor_referencia',
          'company_id, id',
          'ON DELETE RESTRICT'
        ),
        (
          'exames_lab_alerta_critico',
          'lab_alert_company_result_fk',
          'company_id, cd_resultado',
          'exames_lab_resultado',
          'company_id, id',
          'ON DELETE CASCADE'
        ),
        (
          'exames_lab_alerta_critico',
          'lab_alert_company_patient_fk',
          'company_id, cd_paciente',
          'patients',
          'company_id, id',
          'ON DELETE RESTRICT'
        ),
        (
          'exames_lab_alerta_critico',
          'lab_alert_company_professional_fk',
          'company_id, cd_medico',
          'professionals',
          'company_id, id',
          'ON DELETE RESTRICT'
        )
      ) AS specs(
        table_name,
        constraint_name,
        local_columns,
        referenced_table,
        referenced_columns,
        delete_action
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conrelid = format('public.%I', v_spec.table_name)::regclass
         AND conname = v_spec.constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES public.%I (%s) %s NOT VALID',
        v_spec.table_name,
        v_spec.constraint_name,
        v_spec.local_columns,
        v_spec.referenced_table,
        v_spec.referenced_columns,
        v_spec.delete_action
      );
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I VALIDATE CONSTRAINT %I',
      v_spec.table_name,
      v_spec.constraint_name
    );

    SELECT pg_get_constraintdef(constraint_row.oid)
      INTO v_definition
      FROM pg_constraint constraint_row
     WHERE constraint_row.conrelid =
           format('public.%I', v_spec.table_name)::regclass
       AND constraint_row.conname = v_spec.constraint_name
       AND constraint_row.contype = 'f'
       AND constraint_row.convalidated;
    IF v_definition IS NULL THEN
      RAISE EXCEPTION 'Constraint % is absent or unvalidated',
        v_spec.constraint_name;
    END IF;

    v_definition := replace(
      regexp_replace(lower(v_definition), '[[:space:]"]+', '', 'g'),
      'public.',
      ''
    );
    v_expected := format(
      'foreignkey(%s)references%s(%s)%s',
      replace(lower(v_spec.local_columns), ' ', ''),
      lower(v_spec.referenced_table),
      replace(lower(v_spec.referenced_columns), ' ', ''),
      replace(lower(v_spec.delete_action), ' ', '')
    );
    IF v_definition IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'Constraint % has unsafe definition: %',
        v_spec.constraint_name,
        v_definition;
    END IF;
  END LOOP;
END
$foreign_keys$;

CREATE INDEX IF NOT EXISTS idx_lab_reference_company_exam
  ON public.exames_lab_valor_referencia(company_id, cd_exame);
CREATE INDEX IF NOT EXISTS idx_lab_item_company_order
  ON public.exames_lab_pedido_itens(company_id, cd_pedido);
CREATE INDEX IF NOT EXISTS idx_lab_item_company_exam
  ON public.exames_lab_pedido_itens(company_id, cd_exame);
CREATE INDEX IF NOT EXISTS idx_lab_result_company_item
  ON public.exames_lab_resultado(company_id, cd_item_pedido);
CREATE UNIQUE INDEX IF NOT EXISTS lab_result_item_parameter_uq
  ON public.exames_lab_resultado(
    company_id,
    cd_item_pedido,
    lower(btrim(ds_parametro))
  );
CREATE INDEX IF NOT EXISTS idx_lab_alert_company_pending
  ON public.exames_lab_alerta_critico(company_id, tp_status, dt_alerta)
  WHERE tp_status = 'PENDENTE' AND lg_comunicado = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS lab_alert_one_active_result_uq
  ON public.exames_lab_alerta_critico(company_id, cd_resultado)
  WHERE tp_status IN ('PENDENTE', 'COMUNICADO');

DO $lis_unique_index_contract$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT regexp_replace(
           lower(pg_get_indexdef(index_row.indexrelid)),
           '[[:space:]"]+',
           '',
           'g'
         )
    INTO v_definition
    FROM pg_index index_row
    JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
   WHERE index_row.indrelid = 'public.exames_lab_resultado'::regclass
     AND index_class.relname = 'lab_result_item_parameter_uq'
     AND index_row.indisunique
     AND index_row.indisvalid
     AND index_row.indisready
     AND index_row.indpred IS NULL;
  IF v_definition IS NULL
     OR v_definition NOT LIKE
        'createuniqueindexlab_result_item_parameter_uqonpublic.exames_lab_resultadousingbtree(company_id,cd_item_pedido,lower(btrim(%ds_parametro%)))' THEN
    RAISE EXCEPTION
      'lab_result_item_parameter_uq is absent or has an unsafe definition: %',
      v_definition;
  END IF;

  SELECT regexp_replace(
           lower(pg_get_indexdef(index_row.indexrelid)),
           '[[:space:]"]+',
           '',
           'g'
         )
    INTO v_definition
    FROM pg_index index_row
    JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
   WHERE index_row.indrelid =
         'public.exames_lab_alerta_critico'::regclass
     AND index_class.relname = 'lab_alert_one_active_result_uq'
     AND index_row.indisunique
     AND index_row.indisvalid
     AND index_row.indisready
     AND index_row.indpred IS NOT NULL;
  IF v_definition IS NULL
     OR v_definition NOT LIKE
        'createuniqueindexlab_alert_one_active_result_uqonpublic.exames_lab_alerta_criticousingbtree(company_id,cd_resultado)where%tp_status%any%pendente%comunicado%' THEN
    RAISE EXCEPTION
      'lab_alert_one_active_result_uq is absent or has an unsafe definition: %',
      v_definition;
  END IF;
END
$lis_unique_index_contract$;

CREATE TABLE IF NOT EXISTS public.lab_order_operation_requests (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL,
  operation_type TEXT NOT NULL DEFAULT 'create_order'
    CHECK (operation_type = 'create_order'),
  request_hash TEXT NOT NULL,
  request_payload JSONB NOT NULL
    CHECK (
      jsonb_typeof(request_payload) = 'object'
      AND jsonb_typeof(request_payload->'order') = 'object'
      AND jsonb_typeof(request_payload->'items') = 'array'
    ),
  pedido_id BIGINT NOT NULL,
  itens_ids JSONB NOT NULL
    CHECK (jsonb_typeof(itens_ids) = 'array'),
  actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, operation_id),
  CONSTRAINT lab_order_operation_company_order_fk
    FOREIGN KEY (company_id, pedido_id)
    REFERENCES public.exames_lab_pedido(company_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.lab_result_operation_requests (
  company_id UUID NOT NULL
    REFERENCES public.companies(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL,
  item_id BIGINT NOT NULL,
  request_hash TEXT NOT NULL,
  request_payload JSONB NOT NULL
    CHECK (
      jsonb_typeof(request_payload) = 'object'
      AND jsonb_typeof(request_payload->'item_id') = 'number'
      AND jsonb_typeof(request_payload->'results') = 'array'
      AND jsonb_array_length(request_payload->'results') > 0
    ),
  response_payload JSONB NOT NULL
    CHECK (jsonb_typeof(response_payload) = 'array'),
  actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, operation_id),
  CONSTRAINT lab_result_operation_company_item_fk
    FOREIGN KEY (company_id, item_id)
    REFERENCES public.exames_lab_pedido_itens(company_id, id)
    ON DELETE RESTRICT
);

DO $ledger_contract_preflight$
DECLARE
  v_spec RECORD;
  v_type TEXT;
  v_not_null BOOLEAN;
  v_definition TEXT;
BEGIN
  FOR v_spec IN
    SELECT *
      FROM (VALUES
        ('lab_order_operation_requests', 'company_id', 'uuid', TRUE),
        ('lab_order_operation_requests', 'operation_id', 'uuid', TRUE),
        ('lab_order_operation_requests', 'operation_type', 'text', TRUE),
        ('lab_order_operation_requests', 'request_hash', 'text', TRUE),
        ('lab_order_operation_requests', 'request_payload', 'jsonb', TRUE),
        ('lab_order_operation_requests', 'pedido_id', 'bigint', TRUE),
        ('lab_order_operation_requests', 'itens_ids', 'jsonb', TRUE),
        ('lab_order_operation_requests', 'actor_id', 'uuid', TRUE),
        (
          'lab_order_operation_requests',
          'created_at',
          'timestamp with time zone',
          TRUE
        ),
        ('lab_result_operation_requests', 'company_id', 'uuid', TRUE),
        ('lab_result_operation_requests', 'operation_id', 'uuid', TRUE),
        ('lab_result_operation_requests', 'item_id', 'bigint', TRUE),
        ('lab_result_operation_requests', 'request_hash', 'text', TRUE),
        ('lab_result_operation_requests', 'request_payload', 'jsonb', TRUE),
        ('lab_result_operation_requests', 'response_payload', 'jsonb', TRUE),
        ('lab_result_operation_requests', 'actor_id', 'uuid', TRUE),
        (
          'lab_result_operation_requests',
          'created_at',
          'timestamp with time zone',
          TRUE
        )
      ) AS specs(table_name, column_name, expected_type, expected_not_null)
  LOOP
    SELECT format_type(attribute.atttypid, attribute.atttypmod),
           attribute.attnotnull
      INTO v_type, v_not_null
      FROM pg_attribute attribute
     WHERE attribute.attrelid =
           format('public.%I', v_spec.table_name)::regclass
       AND attribute.attname = v_spec.column_name
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped;

    IF NOT FOUND
       OR v_type IS DISTINCT FROM v_spec.expected_type
       OR v_not_null IS DISTINCT FROM v_spec.expected_not_null THEN
      RAISE EXCEPTION
        'Ledger column public.%.% has unsafe definition (type %, not-null %)',
        v_spec.table_name,
        v_spec.column_name,
        v_type,
        v_not_null;
    END IF;
  END LOOP;

  SELECT regexp_replace(
           lower(pg_get_constraintdef(constraint_row.oid)),
           '[[:space:]"]+',
           '',
           'g'
         )
    INTO v_definition
    FROM pg_constraint constraint_row
   WHERE constraint_row.conrelid =
         'public.lab_order_operation_requests'::regclass
     AND constraint_row.contype = 'p';
  IF v_definition IS DISTINCT FROM 'primarykey(company_id,operation_id)' THEN
    RAISE EXCEPTION
      'Order idempotency ledger primary key is unsafe: %',
      v_definition;
  END IF;

  FOR v_spec IN
    SELECT unnest(ARRAY[
      'lab_order_operation_requests',
      'lab_result_operation_requests'
    ]) AS table_name
  LOOP
    IF (
      SELECT count(*)
        FROM pg_constraint constraint_row
       WHERE constraint_row.conrelid =
             format('public.%I', v_spec.table_name)::regclass
         AND constraint_row.contype IN ('p', 'u')
    ) <> 1 THEN
      RAISE EXCEPTION
        'Ledger public.% has unexpected unique constraints',
        v_spec.table_name;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM pg_index index_row
        LEFT JOIN pg_constraint constraint_row
          ON constraint_row.conindid = index_row.indexrelid
       WHERE index_row.indrelid =
             format('public.%I', v_spec.table_name)::regclass
         AND index_row.indisunique
         AND constraint_row.oid IS NULL
    ) THEN
      RAISE EXCEPTION
        'Ledger public.% has an unexpected standalone unique index',
        v_spec.table_name;
    END IF;
  END LOOP;

  SELECT regexp_replace(
           lower(pg_get_constraintdef(constraint_row.oid)),
           '[[:space:]"]+',
           '',
           'g'
         )
    INTO v_definition
    FROM pg_constraint constraint_row
   WHERE constraint_row.conrelid =
         'public.lab_result_operation_requests'::regclass
     AND constraint_row.contype = 'p';
  IF v_definition IS DISTINCT FROM 'primarykey(company_id,operation_id)' THEN
    RAISE EXCEPTION
      'Result idempotency ledger primary key is unsafe: %',
      v_definition;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint constraint_row
     WHERE constraint_row.conrelid =
           'public.lab_order_operation_requests'::regclass
       AND constraint_row.contype = 'c'
        AND regexp_replace(
              lower(pg_get_constraintdef(constraint_row.oid)),
              '[[:space:]"]+',
              '',
              'g'
            ) =
            'check((operation_type=''create_order''::text))'
  ) THEN
    RAISE EXCEPTION
      'Order idempotency ledger operation_type check is absent or unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint constraint_row
     WHERE constraint_row.conrelid =
           'public.lab_order_operation_requests'::regclass
       AND constraint_row.contype = 'c'
        AND regexp_replace(
              lower(pg_get_constraintdef(constraint_row.oid)),
              '[[:space:]"]+',
              '',
              'g'
            ) =
            'check(((jsonb_typeof(request_payload)=''object''::text)and(jsonb_typeof((request_payload->''order''::text))=''object''::text)and(jsonb_typeof((request_payload->''items''::text))=''array''::text)))'
  ) THEN
    RAISE EXCEPTION
      'Order idempotency ledger request payload check is absent or unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint constraint_row
     WHERE constraint_row.conrelid =
           'public.lab_order_operation_requests'::regclass
       AND constraint_row.contype = 'c'
        AND regexp_replace(
              lower(pg_get_constraintdef(constraint_row.oid)),
              '[[:space:]"]+',
              '',
              'g'
            ) =
            'check((jsonb_typeof(itens_ids)=''array''::text))'
  ) THEN
    RAISE EXCEPTION
      'Order idempotency ledger response check is absent or unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint constraint_row
     WHERE constraint_row.conrelid =
           'public.lab_result_operation_requests'::regclass
       AND constraint_row.contype = 'c'
        AND regexp_replace(
              lower(pg_get_constraintdef(constraint_row.oid)),
              '[[:space:]"]+',
              '',
              'g'
            ) =
            'check(((jsonb_typeof(request_payload)=''object''::text)and(jsonb_typeof((request_payload->''item_id''::text))=''number''::text)and(jsonb_typeof((request_payload->''results''::text))=''array''::text)and(jsonb_array_length((request_payload->''results''::text))>0)))'
  ) THEN
    RAISE EXCEPTION
      'Result idempotency ledger request payload check is absent or unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint constraint_row
     WHERE constraint_row.conrelid =
           'public.lab_result_operation_requests'::regclass
       AND constraint_row.contype = 'c'
        AND regexp_replace(
              lower(pg_get_constraintdef(constraint_row.oid)),
              '[[:space:]"]+',
              '',
              'g'
            ) =
            'check((jsonb_typeof(response_payload)=''array''::text))'
  ) THEN
    RAISE EXCEPTION
      'Result idempotency ledger response check is absent or unsafe';
  END IF;

  FOR v_spec IN
    SELECT *
      FROM (VALUES
        (
          'lab_order_operation_requests',
          'company_id',
          'companies',
          'id',
          'cascade'
        ),
        (
          'lab_order_operation_requests',
          'company_id,pedido_id',
          'exames_lab_pedido',
          'company_id,id',
          'restrict'
        ),
        (
          'lab_result_operation_requests',
          'company_id',
          'companies',
          'id',
          'cascade'
        ),
        (
          'lab_result_operation_requests',
          'company_id,item_id',
          'exames_lab_pedido_itens',
          'company_id,id',
          'restrict'
        )
      ) AS specs(
        table_name,
        local_columns,
        referenced_table,
        referenced_columns,
        delete_action
      )
  LOOP
    SELECT replace(
             regexp_replace(
               lower(pg_get_constraintdef(constraint_row.oid)),
               '[[:space:]"]+',
               '',
               'g'
             ),
             'public.',
             ''
           )
      INTO v_definition
      FROM pg_constraint constraint_row
     WHERE constraint_row.conrelid =
           format('public.%I', v_spec.table_name)::regclass
       AND constraint_row.contype = 'f'
       AND constraint_row.convalidated
       AND replace(
             regexp_replace(
               lower(pg_get_constraintdef(constraint_row.oid)),
               '[[:space:]"]+',
               '',
               'g'
             ),
             'public.',
             ''
           ) =
           format(
             'foreignkey(%s)references%s(%s)ondelete%s',
             v_spec.local_columns,
             v_spec.referenced_table,
             v_spec.referenced_columns,
             v_spec.delete_action
           );
    IF v_definition IS NULL THEN
      RAISE EXCEPTION
        'Ledger %.% foreign key is absent, unvalidated or unsafe',
        v_spec.table_name,
        v_spec.local_columns;
    END IF;
  END LOOP;

  IF (
    SELECT regexp_replace(
             lower(pg_get_expr(default_row.adbin, default_row.adrelid)),
             '[[:space:]":]+',
             '',
             'g'
           )
      FROM pg_attrdef default_row
      JOIN pg_attribute attribute
        ON attribute.attrelid = default_row.adrelid
       AND attribute.attnum = default_row.adnum
     WHERE default_row.adrelid =
           'public.lab_order_operation_requests'::regclass
       AND attribute.attname = 'operation_type'
  ) IS DISTINCT FROM '''create_order''text' THEN
    RAISE EXCEPTION
      'Order idempotency ledger operation_type default is unsafe';
  END IF;
END
$ledger_contract_preflight$;

CREATE OR REPLACE FUNCTION private.m23_normalize_role(p_role TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  WITH normalized AS (
    SELECT regexp_replace(
      translate(
        lower(btrim(COALESCE(p_role, ''))),
        'áàâãäéèêëíìîïóòôõöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'
      ),
      '[[:space:]-]+',
      '_',
      'g'
    ) AS value
  )
  SELECT CASE value
    WHEN 'administrador' THEN 'admin'
    WHEN 'admin_master' THEN 'admin'
    WHEN 'master_admin' THEN 'admin'
    WHEN 'master' THEN 'admin'
    WHEN 'doctor' THEN 'medico'
    WHEN 'doutor' THEN 'medico'
    WHEN 'nurse' THEN 'enfermagem'
    WHEN 'enfermeiro' THEN 'enfermagem'
    WHEN 'enfermeira' THEN 'enfermagem'
    WHEN 'laboratory' THEN 'laboratorio'
    ELSE value
  END
  FROM normalized;
$function$;

CREATE OR REPLACE FUNCTION private.m23_require_actor(p_allowed_roles TEXT[])
RETURNS TABLE(user_id UUID, company_id UUID, role_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'JWT valido obrigatorio'
      USING ERRCODE = '28000';
  END IF;

  SELECT
    COALESCE(profile.user_id, profile.id),
    profile.company_id,
    private.m23_normalize_role(profile.role_name)
    INTO user_id, company_id, role_name
  FROM public.user_profiles profile
  WHERE (profile.id = v_user_id OR profile.user_id = v_user_id)
    AND COALESCE(profile.lg_ativo, TRUE)
    AND profile.company_id IS NOT NULL
  ORDER BY (profile.id = v_user_id) DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional ativo'
      USING ERRCODE = '42501';
  END IF;

  IF role_name <> ALL(COALESCE(p_allowed_roles, ARRAY[]::TEXT[])) THEN
    RAISE EXCEPTION 'Perfil sem permissao para a operacao laboratorial'
      USING ERRCODE = '42501';
  END IF;

  IF company_id IS DISTINCT FROM public.current_company_id() THEN
    RAISE EXCEPTION 'JWT e perfil pertencem a empresas diferentes'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_lab_user(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT
      1
      FROM public.user_profiles profile
     WHERE (profile.id = uid OR profile.user_id = uid)
       AND COALESCE(profile.lg_ativo, TRUE)
       AND profile.company_id = public.current_company_id()
       AND private.m23_normalize_role(profile.role_name)
           IN ('admin', 'laboratorio', 'medico')
  );
$function$;

ALTER FUNCTION private.m23_normalize_role(TEXT)
  OWNER TO prontomedic_lis_rpc_owner;
ALTER FUNCTION private.m23_require_actor(TEXT[])
  OWNER TO prontomedic_lis_rpc_owner;
ALTER FUNCTION public.is_lab_user(UUID)
  OWNER TO prontomedic_lis_rpc_owner;

GRANT USAGE ON SCHEMA public, private, auth
  TO prontomedic_lis_rpc_owner;
GRANT SELECT (id, user_id, company_id, role_name, lg_ativo)
  ON public.user_profiles
  TO prontomedic_lis_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid()
  TO prontomedic_lis_rpc_owner;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO prontomedic_lis_rpc_owner;
GRANT EXECUTE ON FUNCTION public.classificar_resultado_lab(NUMERIC, NUMERIC, NUMERIC)
  TO prontomedic_lis_rpc_owner;

DO $drop_lis_policies$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY(ARRAY[
         'exames_lab_catalogo',
         'exames_lab_valor_referencia',
         'exames_lab_pedido',
         'exames_lab_pedido_itens',
          'exames_lab_resultado',
          'exames_lab_alerta_critico',
          'lab_order_operation_requests',
          'lab_result_operation_requests'
       ])
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  END LOOP;
END
$drop_lis_policies$;

ALTER TABLE public.exames_lab_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_catalogo FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_valor_referencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_valor_referencia FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_resultado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_resultado FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_alerta_critico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_alerta_critico FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lab_order_operation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_order_operation_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lab_result_operation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_result_operation_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY m23_catalog_authenticated_read
  ON public.exames_lab_catalogo
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());
CREATE POLICY m23_catalog_app_read
  ON public.exames_lab_catalogo
  FOR SELECT TO app_prontomedic
  USING (company_id = public.request_company_id());
CREATE POLICY m23_catalog_owner_all
  ON public.exames_lab_catalogo
  FOR ALL TO prontomedic_lis_rpc_owner
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY m23_reference_authenticated_read
  ON public.exames_lab_valor_referencia
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());
CREATE POLICY m23_reference_app_read
  ON public.exames_lab_valor_referencia
  FOR SELECT TO app_prontomedic
  USING (company_id = public.request_company_id());
CREATE POLICY m23_reference_owner_all
  ON public.exames_lab_valor_referencia
  FOR ALL TO prontomedic_lis_rpc_owner
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY m23_order_authenticated_read
  ON public.exames_lab_pedido
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());
CREATE POLICY m23_order_app_read
  ON public.exames_lab_pedido
  FOR SELECT TO app_prontomedic
  USING (company_id = public.request_company_id());
CREATE POLICY m23_order_owner_all
  ON public.exames_lab_pedido
  FOR ALL TO prontomedic_lis_rpc_owner
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY m23_item_authenticated_read
  ON public.exames_lab_pedido_itens
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());
CREATE POLICY m23_item_app_read
  ON public.exames_lab_pedido_itens
  FOR SELECT TO app_prontomedic
  USING (company_id = public.request_company_id());
CREATE POLICY m23_item_owner_all
  ON public.exames_lab_pedido_itens
  FOR ALL TO prontomedic_lis_rpc_owner
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY m23_result_authenticated_read
  ON public.exames_lab_resultado
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.is_lab_user(auth.uid())
  );
CREATE POLICY m23_result_app_read
  ON public.exames_lab_resultado
  FOR SELECT TO app_prontomedic
  USING (company_id = public.request_company_id());
CREATE POLICY m23_result_owner_all
  ON public.exames_lab_resultado
  FOR ALL TO prontomedic_lis_rpc_owner
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY m23_alert_authenticated_read
  ON public.exames_lab_alerta_critico
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.is_lab_user(auth.uid())
  );
CREATE POLICY m23_alert_app_read
  ON public.exames_lab_alerta_critico
  FOR SELECT TO app_prontomedic
  USING (company_id = public.request_company_id());
CREATE POLICY m23_alert_owner_all
  ON public.exames_lab_alerta_critico
  FOR ALL TO prontomedic_lis_rpc_owner
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY m23_operation_owner_all
  ON public.lab_order_operation_requests
  FOR ALL TO prontomedic_lis_rpc_owner
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY m23_result_operation_owner_all
  ON public.lab_result_operation_requests
  FOR ALL TO prontomedic_lis_rpc_owner
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

DROP POLICY IF EXISTS m23_owner_profile_self_read ON public.user_profiles;
CREATE POLICY m23_owner_profile_self_read
  ON public.user_profiles
  FOR SELECT TO prontomedic_lis_rpc_owner
  USING (
    COALESCE(lg_ativo, TRUE)
    AND (id = auth.uid() OR user_id = auth.uid())
  );

DROP POLICY IF EXISTS m23_owner_patient_demographics_read ON public.patients;
CREATE POLICY m23_owner_patient_demographics_read
  ON public.patients
  FOR SELECT TO prontomedic_lis_rpc_owner
  USING (company_id = public.current_company_id());

REVOKE ALL ON
  public.exames_lab_catalogo,
  public.exames_lab_valor_referencia,
  public.exames_lab_pedido,
  public.exames_lab_pedido_itens,
  public.exames_lab_resultado,
  public.exames_lab_alerta_critico,
  public.lab_order_operation_requests,
  public.lab_result_operation_requests
FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT SELECT ON
  public.exames_lab_catalogo,
  public.exames_lab_valor_referencia,
  public.exames_lab_pedido,
  public.exames_lab_pedido_itens,
  public.exames_lab_resultado,
  public.exames_lab_alerta_critico
TO authenticated, app_prontomedic;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.exames_lab_catalogo,
  public.exames_lab_valor_referencia,
  public.exames_lab_pedido,
  public.exames_lab_pedido_itens,
  public.exames_lab_resultado,
  public.exames_lab_alerta_critico,
  public.lab_order_operation_requests,
  public.lab_result_operation_requests
TO prontomedic_lis_rpc_owner;

GRANT SELECT (id, company_id, birth_date, sex)
  ON public.patients
  TO prontomedic_lis_rpc_owner;

REVOKE ALL ON SEQUENCE
  public.exames_lab_catalogo_id_seq,
  public.exames_lab_valor_referencia_id_seq,
  public.exames_lab_pedido_id_seq,
  public.exames_lab_pedido_itens_id_seq,
  public.exames_lab_resultado_id_seq,
  public.exames_lab_alerta_critico_id_seq
FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT USAGE, SELECT ON SEQUENCE
  public.exames_lab_catalogo_id_seq,
  public.exames_lab_valor_referencia_id_seq,
  public.exames_lab_pedido_id_seq,
  public.exames_lab_pedido_itens_id_seq,
  public.exames_lab_resultado_id_seq,
  public.exames_lab_alerta_critico_id_seq
TO prontomedic_lis_rpc_owner;

CREATE OR REPLACE FUNCTION public.fn_gerar_alerta_critico()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_order public.exames_lab_pedido;
  v_active_alert public.exames_lab_alerta_critico;
  v_reference_text TEXT;
BEGIN
  SELECT order_row.*
    INTO v_order
    FROM public.exames_lab_pedido_itens item
    JOIN public.exames_lab_pedido order_row
      ON order_row.id = item.cd_pedido
     AND order_row.company_id = item.company_id
   WHERE item.id = NEW.cd_item_pedido
     AND item.company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lab result has no tenant-bound lab order';
  END IF;

  IF NEW.tp_resultado NOT IN ('CRITICO_BAIXO', 'CRITICO_ALTO') THEN
    UPDATE public.exames_lab_alerta_critico
       SET tp_status = 'RESOLVIDO',
           dt_resolucao = NOW(),
           cd_usuario_resolveu = COALESCE(
             auth.uid(),
             NEW.cd_usuario_laboratorio
           ),
           ds_motivo_resolucao = 'RETIFICACAO_RESULTADO_NAO_CRITICO'
     WHERE company_id = NEW.company_id
       AND cd_resultado = NEW.id
       AND tp_status IN ('PENDENTE', 'COMUNICADO');
    RETURN NEW;
  END IF;

  v_reference_text := concat_ws(
    '-',
    COALESCE(NEW.vl_minimo_referencia::TEXT, ''),
    COALESCE(NEW.vl_maximo_referencia::TEXT, '')
  );

  SELECT *
    INTO v_active_alert
    FROM public.exames_lab_alerta_critico
   WHERE company_id = NEW.company_id
     AND cd_resultado = NEW.id
     AND tp_status IN ('PENDENTE', 'COMUNICADO')
   FOR UPDATE;

  IF FOUND
     AND v_active_alert.tp_alerta IS NOT DISTINCT FROM NEW.tp_resultado
     AND v_active_alert.ds_parametro IS NOT DISTINCT FROM NEW.ds_parametro
     AND v_active_alert.vl_resultado IS NOT DISTINCT FROM NEW.vl_resultado
     AND v_active_alert.vl_referencia IS NOT DISTINCT FROM v_reference_text THEN
    RETURN NEW;
  END IF;

  IF FOUND THEN
    UPDATE public.exames_lab_alerta_critico
       SET tp_status = 'RESOLVIDO',
           dt_resolucao = NOW(),
           cd_usuario_resolveu = COALESCE(
             auth.uid(),
             NEW.cd_usuario_laboratorio
           ),
           ds_motivo_resolucao = 'RETIFICACAO_RESULTADO_CRITICO'
     WHERE id = v_active_alert.id
       AND company_id = NEW.company_id;
  END IF;

  INSERT INTO public.exames_lab_alerta_critico (
    company_id,
    cd_resultado,
    cd_paciente,
    cd_medico,
    tp_alerta,
    ds_parametro,
    vl_resultado,
    vl_referencia,
    tp_status,
    lg_comunicado
  ) VALUES (
    NEW.company_id,
    NEW.id,
    v_order.cd_paciente,
    v_order.cd_medico,
    NEW.tp_resultado,
    NEW.ds_parametro,
    NEW.vl_resultado,
    v_reference_text,
    'PENDENTE',
    FALSE
  );

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_gerar_alerta_critico()
  OWNER TO prontomedic_lis_rpc_owner;
REVOKE ALL ON FUNCTION public.fn_gerar_alerta_critico() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_gerar_alerta_critico
  ON public.exames_lab_resultado;
CREATE TRIGGER trg_gerar_alerta_critico
  AFTER INSERT OR UPDATE OF tp_resultado, vl_resultado,
    vl_minimo_referencia, vl_maximo_referencia
  ON public.exames_lab_resultado
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_gerar_alerta_critico();

CREATE OR REPLACE FUNCTION public.m23_upsert_exam_catalog_secure(
  p_exam JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_row public.exames_lab_catalogo;
  v_id BIGINT;
  v_name TEXT;
  v_code TEXT;
  v_deadline SMALLINT;
  v_private_price NUMERIC(10,2);
  v_insurance_price NUMERIC(10,2);
BEGIN
  SELECT * INTO v_actor
    FROM private.m23_require_actor(ARRAY['admin', 'laboratorio']);

  IF p_exam IS NULL OR jsonb_typeof(p_exam) <> 'object' THEN
    RAISE EXCEPTION 'Exam catalog payload must be a JSON object';
  END IF;
  IF p_exam ? 'company_id'
     AND NULLIF(p_exam->>'company_id', '')::UUID IS DISTINCT FROM v_actor.company_id THEN
    RAISE EXCEPTION 'Exam catalog company does not match authenticated tenant';
  END IF;

  v_id := NULLIF(p_exam->>'id', '')::BIGINT;
  IF v_id IS NULL THEN
    v_name := btrim(COALESCE(p_exam->>'ds_exame', ''));
    v_code := upper(btrim(COALESCE(p_exam->>'ds_sigla', '')));
    v_deadline := COALESCE(NULLIF(p_exam->>'nr_prazo_dias', '')::SMALLINT, 3);
    v_private_price := NULLIF(btrim(COALESCE(p_exam->>'vl_particular', '')), '')::NUMERIC(10,2);
    v_insurance_price := NULLIF(btrim(COALESCE(p_exam->>'vl_convenio', '')), '')::NUMERIC(10,2);
    IF char_length(v_name) < 2 OR char_length(v_name) > 200 THEN
      RAISE EXCEPTION 'Exam name must have between 2 and 200 characters';
    END IF;
    IF char_length(v_code) < 1 OR char_length(v_code) > 20 THEN
      RAISE EXCEPTION 'Exam abbreviation must have between 1 and 20 characters';
    END IF;
    IF v_deadline < 0
       OR v_private_price < 0
       OR v_insurance_price < 0 THEN
      RAISE EXCEPTION 'Exam deadline and prices cannot be negative';
    END IF;

    INSERT INTO public.exames_lab_catalogo (
      company_id,
      ds_exame,
      ds_sigla,
      cd_tuss,
      cd_loinc,
      ds_categoria,
      ds_metodo,
      ds_material,
      nr_prazo_dias,
      vl_particular,
      vl_convenio,
      lg_ativo,
      cd_origem_sigh
    ) VALUES (
      v_actor.company_id,
      v_name,
      v_code,
      NULLIF(btrim(COALESCE(p_exam->>'cd_tuss', '')), ''),
      NULLIF(btrim(COALESCE(p_exam->>'cd_loinc', '')), ''),
      NULLIF(upper(btrim(COALESCE(p_exam->>'ds_categoria', ''))), ''),
      NULLIF(btrim(COALESCE(p_exam->>'ds_metodo', '')), ''),
      NULLIF(upper(btrim(COALESCE(p_exam->>'ds_material', ''))), ''),
      v_deadline,
      v_private_price,
      v_insurance_price,
      COALESCE((p_exam->>'lg_ativo')::BOOLEAN, TRUE),
      NULLIF(p_exam->>'cd_origem_sigh', '')::INTEGER
    )
    RETURNING * INTO v_row;
  ELSE
    SELECT *
      INTO v_row
      FROM public.exames_lab_catalogo
     WHERE id = v_id
       AND company_id = v_actor.company_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Exam catalog row not found in authenticated tenant';
    END IF;

    v_name := CASE
      WHEN p_exam ? 'ds_exame'
        THEN btrim(COALESCE(p_exam->>'ds_exame', ''))
      ELSE v_row.ds_exame
    END;
    v_code := CASE
      WHEN p_exam ? 'ds_sigla'
        THEN upper(btrim(COALESCE(p_exam->>'ds_sigla', '')))
      ELSE v_row.ds_sigla
    END;
    v_deadline := CASE
      WHEN p_exam ? 'nr_prazo_dias'
        THEN NULLIF(p_exam->>'nr_prazo_dias', '')::SMALLINT
      ELSE v_row.nr_prazo_dias
    END;
    v_private_price := CASE
      WHEN p_exam ? 'vl_particular'
        THEN NULLIF(btrim(COALESCE(p_exam->>'vl_particular', '')), '')::NUMERIC(10,2)
      ELSE v_row.vl_particular
    END;
    v_insurance_price := CASE
      WHEN p_exam ? 'vl_convenio'
        THEN NULLIF(btrim(COALESCE(p_exam->>'vl_convenio', '')), '')::NUMERIC(10,2)
      ELSE v_row.vl_convenio
    END;
    IF char_length(v_name) < 2 OR char_length(v_name) > 200
       OR char_length(v_code) < 1 OR char_length(v_code) > 20 THEN
      RAISE EXCEPTION 'Invalid exam name or abbreviation';
    END IF;
    IF v_deadline IS NULL OR v_deadline < 0
       OR v_private_price < 0
       OR v_insurance_price < 0 THEN
      RAISE EXCEPTION 'Exam deadline and prices cannot be negative/null';
    END IF;

    UPDATE public.exames_lab_catalogo
       SET ds_exame = v_name,
           ds_sigla = v_code,
           cd_tuss = CASE WHEN p_exam ? 'cd_tuss'
             THEN NULLIF(btrim(COALESCE(p_exam->>'cd_tuss', '')), '')
             ELSE cd_tuss END,
           cd_loinc = CASE WHEN p_exam ? 'cd_loinc'
             THEN NULLIF(btrim(COALESCE(p_exam->>'cd_loinc', '')), '')
             ELSE cd_loinc END,
           ds_categoria = CASE WHEN p_exam ? 'ds_categoria'
             THEN NULLIF(upper(btrim(COALESCE(p_exam->>'ds_categoria', ''))), '')
             ELSE ds_categoria END,
           ds_metodo = CASE WHEN p_exam ? 'ds_metodo'
             THEN NULLIF(btrim(COALESCE(p_exam->>'ds_metodo', '')), '')
             ELSE ds_metodo END,
           ds_material = CASE WHEN p_exam ? 'ds_material'
             THEN NULLIF(upper(btrim(COALESCE(p_exam->>'ds_material', ''))), '')
             ELSE ds_material END,
           nr_prazo_dias = v_deadline,
           vl_particular = v_private_price,
           vl_convenio = v_insurance_price,
           lg_ativo = CASE WHEN p_exam ? 'lg_ativo'
             THEN (p_exam->>'lg_ativo')::BOOLEAN
             ELSE lg_ativo END,
           cd_origem_sigh = CASE WHEN p_exam ? 'cd_origem_sigh'
             THEN NULLIF(p_exam->>'cd_origem_sigh', '')::INTEGER
             ELSE cd_origem_sigh END
     WHERE id = v_id
       AND company_id = v_actor.company_id
    RETURNING * INTO v_row;
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.m23_upsert_reference_range_secure(
  p_reference JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_row public.exames_lab_valor_referencia;
  v_id BIGINT;
  v_exam_id BIGINT;
  v_parameter TEXT;
  v_minimum NUMERIC(15,6);
  v_maximum NUMERIC(15,6);
  v_age_min SMALLINT;
  v_age_max SMALLINT;
  v_sex CHAR(1);
BEGIN
  SELECT * INTO v_actor
    FROM private.m23_require_actor(ARRAY['admin', 'laboratorio']);

  IF p_reference IS NULL OR jsonb_typeof(p_reference) <> 'object' THEN
    RAISE EXCEPTION 'Reference range payload must be a JSON object';
  END IF;
  IF p_reference ? 'company_id'
     AND NULLIF(p_reference->>'company_id', '')::UUID IS DISTINCT FROM v_actor.company_id THEN
    RAISE EXCEPTION 'Reference range company does not match authenticated tenant';
  END IF;

  v_id := NULLIF(p_reference->>'id', '')::BIGINT;
  IF v_id IS NULL THEN
    v_exam_id := NULLIF(p_reference->>'cd_exame', '')::BIGINT;
    v_parameter := btrim(COALESCE(p_reference->>'ds_parametro', ''));
    v_minimum := NULLIF(btrim(COALESCE(p_reference->>'vl_minimo', '')), '')::NUMERIC(15,6);
    v_maximum := NULLIF(btrim(COALESCE(p_reference->>'vl_maximo', '')), '')::NUMERIC(15,6);
    v_age_min := COALESCE(NULLIF(p_reference->>'nr_idade_min', '')::SMALLINT, 0);
    v_age_max := COALESCE(NULLIF(p_reference->>'nr_idade_max', '')::SMALLINT, 120);
    v_sex := NULLIF(upper(btrim(COALESCE(p_reference->>'cd_sexo', ''))), '')::CHAR(1);
  ELSE
    SELECT *
      INTO v_row
      FROM public.exames_lab_valor_referencia
     WHERE id = v_id
       AND company_id = v_actor.company_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reference range not found in authenticated tenant';
    END IF;
    v_exam_id := CASE WHEN p_reference ? 'cd_exame'
      THEN NULLIF(p_reference->>'cd_exame', '')::BIGINT
      ELSE v_row.cd_exame END;
    v_parameter := CASE WHEN p_reference ? 'ds_parametro'
      THEN btrim(COALESCE(p_reference->>'ds_parametro', ''))
      ELSE v_row.ds_parametro END;
    v_minimum := CASE WHEN p_reference ? 'vl_minimo'
      THEN NULLIF(btrim(COALESCE(p_reference->>'vl_minimo', '')), '')::NUMERIC(15,6)
      ELSE v_row.vl_minimo END;
    v_maximum := CASE WHEN p_reference ? 'vl_maximo'
      THEN NULLIF(btrim(COALESCE(p_reference->>'vl_maximo', '')), '')::NUMERIC(15,6)
      ELSE v_row.vl_maximo END;
    v_age_min := CASE WHEN p_reference ? 'nr_idade_min'
      THEN NULLIF(p_reference->>'nr_idade_min', '')::SMALLINT
      ELSE v_row.nr_idade_min END;
    v_age_max := CASE WHEN p_reference ? 'nr_idade_max'
      THEN NULLIF(p_reference->>'nr_idade_max', '')::SMALLINT
      ELSE v_row.nr_idade_max END;
    v_sex := CASE WHEN p_reference ? 'cd_sexo'
      THEN NULLIF(upper(btrim(COALESCE(p_reference->>'cd_sexo', ''))), '')::CHAR(1)
      ELSE v_row.cd_sexo END;
  END IF;

  IF v_exam_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.exames_lab_catalogo catalog
     WHERE catalog.id = v_exam_id
       AND catalog.company_id = v_actor.company_id
       AND catalog.lg_ativo
  ) THEN
    RAISE EXCEPTION 'Reference range requires an active same-tenant exam';
  END IF;
  IF char_length(v_parameter) < 1 OR char_length(v_parameter) > 100 THEN
    RAISE EXCEPTION 'Reference parameter must have between 1 and 100 characters';
  END IF;
  IF v_minimum IS NOT NULL AND v_maximum IS NOT NULL
     AND v_minimum > v_maximum THEN
    RAISE EXCEPTION 'Reference minimum cannot exceed maximum';
  END IF;
  IF v_age_min IS NULL OR v_age_max IS NULL
     OR v_age_min < 0 OR v_age_max < v_age_min OR v_age_max > 150 THEN
    RAISE EXCEPTION 'Invalid reference age range';
  END IF;
  IF v_sex IS NOT NULL AND v_sex NOT IN ('M', 'F', 'A') THEN
    RAISE EXCEPTION 'Invalid reference sex';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.exames_lab_valor_referencia (
      company_id,
      cd_exame,
      ds_parametro,
      vl_minimo,
      vl_maximo,
      ds_unidade,
      cd_sexo,
      nr_idade_min,
      nr_idade_max,
      lg_ativo
    ) VALUES (
      v_actor.company_id,
      v_exam_id,
      v_parameter,
      v_minimum,
      v_maximum,
      NULLIF(btrim(COALESCE(p_reference->>'ds_unidade', '')), ''),
      v_sex,
      v_age_min,
      v_age_max,
      COALESCE((p_reference->>'lg_ativo')::BOOLEAN, TRUE)
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.exames_lab_valor_referencia
       SET cd_exame = v_exam_id,
           ds_parametro = v_parameter,
           vl_minimo = v_minimum,
           vl_maximo = v_maximum,
           ds_unidade = CASE WHEN p_reference ? 'ds_unidade'
             THEN NULLIF(btrim(COALESCE(p_reference->>'ds_unidade', '')), '')
             ELSE ds_unidade END,
           cd_sexo = v_sex,
           nr_idade_min = v_age_min,
           nr_idade_max = v_age_max,
           lg_ativo = CASE WHEN p_reference ? 'lg_ativo'
             THEN (p_reference->>'lg_ativo')::BOOLEAN
             ELSE lg_ativo END
     WHERE id = v_id
       AND company_id = v_actor.company_id
    RETURNING * INTO v_row;
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.m23_create_lab_order_secure(
  p_operation_id UUID,
  p_order JSONB,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_request_hash TEXT;
  v_request_payload JSONB;
  v_existing public.lab_order_operation_requests;
  v_order public.exames_lab_pedido;
  v_item JSONB;
  v_item_id BIGINT;
  v_item_ids BIGINT[] := ARRAY[]::BIGINT[];
  v_exam_id BIGINT;
BEGIN
  SELECT * INTO v_actor
    FROM private.m23_require_actor(
      ARRAY['admin', 'laboratorio', 'medico', 'enfermagem']
    );

  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Order operation id is required';
  END IF;
  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'object' THEN
    RAISE EXCEPTION 'Lab order payload must be a JSON object';
  END IF;
  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Lab order requires at least one item';
  END IF;
  IF p_order ? 'company_id'
     AND NULLIF(p_order->>'company_id', '')::UUID IS DISTINCT FROM v_actor.company_id THEN
    RAISE EXCEPTION 'Lab order company does not match authenticated tenant';
  END IF;

  v_request_hash := md5(concat_ws(
    '|',
    'm23_create_lab_order_secure',
    v_actor.company_id::TEXT,
    p_order::TEXT,
    p_items::TEXT
  ));
  v_request_payload := jsonb_build_object(
    'order', p_order,
    'items', p_items
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_actor.company_id::TEXT || ':' || p_operation_id::TEXT,
    0
  ));

  SELECT *
    INTO v_existing
    FROM public.lab_order_operation_requests
   WHERE company_id = v_actor.company_id
     AND operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM v_request_hash
       OR v_existing.request_payload IS DISTINCT FROM v_request_payload THEN
      RAISE EXCEPTION 'Order operation id reused with different payload';
    END IF;
    RETURN jsonb_build_object(
      'pedido_id', v_existing.pedido_id,
      'itens_ids', v_existing.itens_ids
    );
  END IF;

  INSERT INTO public.exames_lab_pedido (
    company_id,
    cd_paciente,
    cd_medico,
    cd_appointment,
    cd_tipo_atendimento,
    tp_prioridade,
    ds_hipotese_diagnostica,
    ds_observacoes,
    cd_lab_externo,
    nr_protocolo_lab
  ) VALUES (
    v_actor.company_id,
    NULLIF(p_order->>'cd_paciente', '')::BIGINT,
    NULLIF(p_order->>'cd_medico', '')::BIGINT,
    NULLIF(p_order->>'cd_appointment', '')::BIGINT,
    COALESCE(NULLIF(upper(p_order->>'cd_tipo_atendimento'), ''), 'AMBULATORIAL'),
    COALESCE(NULLIF(upper(p_order->>'tp_prioridade'), ''), 'ROTINA'),
    NULLIF(btrim(COALESCE(p_order->>'ds_hipotese_diagnostica', '')), ''),
    NULLIF(btrim(COALESCE(p_order->>'ds_observacoes', '')), ''),
    NULLIF(btrim(COALESCE(p_order->>'cd_lab_externo', '')), ''),
    NULLIF(btrim(COALESCE(p_order->>'nr_protocolo_lab', '')), '')
  )
  RETURNING * INTO v_order;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Each lab order item must be a JSON object';
    END IF;
    IF v_item ? 'company_id'
       AND NULLIF(v_item->>'company_id', '')::UUID IS DISTINCT FROM v_actor.company_id THEN
      RAISE EXCEPTION 'Lab item company does not match authenticated tenant';
    END IF;
    v_exam_id := NULLIF(v_item->>'cd_exame', '')::BIGINT;
    IF v_exam_id IS NULL OR NOT EXISTS (
      SELECT 1
        FROM public.exames_lab_catalogo catalog
       WHERE catalog.id = v_exam_id
         AND catalog.company_id = v_actor.company_id
         AND catalog.lg_ativo
    ) THEN
      RAISE EXCEPTION 'Lab item requires an active same-tenant exam';
    END IF;

    INSERT INTO public.exames_lab_pedido_itens (
      company_id,
      cd_pedido,
      cd_exame,
      ds_observacao
    ) VALUES (
      v_actor.company_id,
      v_order.id,
      v_exam_id,
      NULLIF(btrim(COALESCE(v_item->>'ds_observacao', '')), '')
    )
    RETURNING id INTO v_item_id;
    v_item_ids := array_append(v_item_ids, v_item_id);
  END LOOP;

  INSERT INTO public.lab_order_operation_requests (
    company_id,
    operation_id,
    request_hash,
    request_payload,
    pedido_id,
    itens_ids,
    actor_id
  ) VALUES (
    v_actor.company_id,
    p_operation_id,
    v_request_hash,
    v_request_payload,
    v_order.id,
    to_jsonb(v_item_ids),
    v_actor.user_id
  );

  RETURN jsonb_build_object(
    'pedido_id', v_order.id,
    'itens_ids', to_jsonb(v_item_ids)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.m23_collect_specimen_secure(
  p_item_id BIGINT,
  p_sample_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_item public.exames_lab_pedido_itens;
  v_sample_id TEXT := NULLIF(btrim(COALESCE(p_sample_id, '')), '');
BEGIN
  SELECT * INTO v_actor
    FROM private.m23_require_actor(
      ARRAY['admin', 'laboratorio', 'enfermagem']
    );
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'Lab order item id is required';
  END IF;
  IF v_sample_id IS NULL THEN
    RAISE EXCEPTION 'Sample id is required';
  END IF;
  IF char_length(v_sample_id) > 50 THEN
    RAISE EXCEPTION 'Sample id cannot exceed 50 characters';
  END IF;

  SELECT *
    INTO v_item
    FROM public.exames_lab_pedido_itens
   WHERE id = p_item_id
     AND company_id = v_actor.company_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lab order item not found in authenticated tenant';
  END IF;
  IF v_item.tp_status IN ('LIBERADO', 'CANCELADO') THEN
    RAISE EXCEPTION 'Released/cancelled lab item cannot be collected';
  END IF;
  IF v_item.tp_status IN ('COLETADO', 'EM_ANALISE') THEN
    IF NULLIF(btrim(COALESCE(v_item.ds_amostra_id, '')), '') IS NULL THEN
      RAISE EXCEPTION
        'Collected lab item has no immutable sample id';
    END IF;
    IF v_sample_id IS DISTINCT FROM btrim(v_item.ds_amostra_id) THEN
      RAISE EXCEPTION 'Collected sample id cannot be changed';
    END IF;
    RETURN to_jsonb(v_item);
  END IF;

  UPDATE public.exames_lab_pedido_itens
     SET tp_status = 'COLETADO',
         dt_coleta = COALESCE(dt_coleta, NOW()),
         ds_amostra_id = v_sample_id
   WHERE id = p_item_id
     AND company_id = v_actor.company_id
  RETURNING * INTO v_item;

  IF NOT EXISTS (
    SELECT 1
      FROM public.exames_lab_pedido_itens sibling
     WHERE sibling.company_id = v_actor.company_id
       AND sibling.cd_pedido = v_item.cd_pedido
       AND sibling.tp_status = 'PENDENTE'
  ) THEN
    UPDATE public.exames_lab_pedido
       SET tp_status = 'COLETADO',
           dt_coleta = COALESCE(dt_coleta, NOW())
     WHERE id = v_item.cd_pedido
       AND company_id = v_actor.company_id
       AND tp_status = 'PENDENTE';
  END IF;

  RETURN to_jsonb(v_item);
END;
$function$;

CREATE OR REPLACE FUNCTION public.m23_transition_specimen_secure(
  p_order_id BIGINT,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_order public.exames_lab_pedido;
  v_target TEXT := upper(btrim(COALESCE(p_status, '')));
BEGIN
  SELECT * INTO v_actor
    FROM private.m23_require_actor(ARRAY['admin', 'laboratorio']);
  IF p_order_id IS NULL OR v_target = '' THEN
    RAISE EXCEPTION 'Lab order id and target status are required';
  END IF;
  IF v_target NOT IN ('COLETADO', 'EM_ANALISE', 'LIBERADO', 'CANCELADO') THEN
    RAISE EXCEPTION 'Unsupported lab order transition target';
  END IF;

  SELECT *
    INTO v_order
    FROM public.exames_lab_pedido
   WHERE id = p_order_id
     AND company_id = v_actor.company_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lab order not found in authenticated tenant';
  END IF;
  IF v_order.tp_status = v_target THEN
    RETURN to_jsonb(v_order);
  END IF;
  IF NOT (
    (v_order.tp_status = 'PENDENTE' AND v_target IN ('COLETADO', 'CANCELADO'))
    OR (v_order.tp_status = 'COLETADO' AND v_target IN ('EM_ANALISE', 'CANCELADO'))
    OR (v_order.tp_status = 'EM_ANALISE' AND v_target IN ('LIBERADO', 'CANCELADO'))
  ) THEN
    RAISE EXCEPTION 'Invalid lab order transition from % to %',
      v_order.tp_status, v_target;
  END IF;

  IF v_target = 'COLETADO' AND EXISTS (
    SELECT 1
      FROM public.exames_lab_pedido_itens item
     WHERE item.company_id = v_actor.company_id
       AND item.cd_pedido = p_order_id
       AND item.tp_status = 'PENDENTE'
  ) THEN
    RAISE EXCEPTION 'All active lab items must be collected first';
  END IF;
  IF v_target = 'EM_ANALISE' AND NOT EXISTS (
    SELECT 1
      FROM public.exames_lab_resultado result_row
      JOIN public.exames_lab_pedido_itens item
        ON item.id = result_row.cd_item_pedido
       AND item.company_id = result_row.company_id
     WHERE item.company_id = v_actor.company_id
       AND item.cd_pedido = p_order_id
  ) THEN
    RAISE EXCEPTION 'At least one result is required to start analysis';
  END IF;
  IF v_target = 'LIBERADO' AND EXISTS (
    SELECT 1
      FROM public.exames_lab_pedido_itens item
     WHERE item.company_id = v_actor.company_id
       AND item.cd_pedido = p_order_id
       AND item.tp_status NOT IN ('LIBERADO', 'CANCELADO')
  ) THEN
    RAISE EXCEPTION 'All active lab items must be released first';
  END IF;

  IF v_target = 'CANCELADO' THEN
    UPDATE public.exames_lab_pedido_itens
       SET tp_status = 'CANCELADO'
     WHERE company_id = v_actor.company_id
       AND cd_pedido = p_order_id
       AND tp_status NOT IN ('LIBERADO', 'CANCELADO');
  END IF;

  UPDATE public.exames_lab_pedido
     SET tp_status = v_target,
         dt_coleta = CASE
           WHEN v_target = 'COLETADO' THEN COALESCE(dt_coleta, NOW())
           ELSE dt_coleta
         END,
         dt_liberacao = CASE
           WHEN v_target = 'LIBERADO' THEN COALESCE(dt_liberacao, NOW())
           ELSE dt_liberacao
         END
   WHERE id = p_order_id
     AND company_id = v_actor.company_id
  RETURNING * INTO v_order;

  RETURN to_jsonb(v_order);
END;
$function$;

DO $drop_legacy_result_rpc$
BEGIN
  IF to_regprocedure(
       'public.m23_record_results_secure(bigint,jsonb)'
     ) IS NOT NULL THEN
    REVOKE ALL ON FUNCTION
      public.m23_record_results_secure(BIGINT, JSONB)
      FROM PUBLIC, anon, authenticated, app_prontomedic;
    DROP FUNCTION public.m23_record_results_secure(BIGINT, JSONB);
  END IF;
END
$drop_legacy_result_rpc$;

CREATE OR REPLACE FUNCTION public.m23_record_results_secure(
  p_item_id BIGINT,
  p_results JSONB,
  p_operation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_existing public.lab_result_operation_requests;
  v_item public.exames_lab_pedido_itens;
  v_input JSONB;
  v_row public.exames_lab_resultado;
  v_rows JSONB := '[]'::JSONB;
  v_request_hash TEXT;
  v_request_payload JSONB;
  v_result_id BIGINT;
  v_existing_result_id BIGINT;
  v_reference_id BIGINT;
  v_reference_ids BIGINT[];
  v_parameter TEXT;
  v_numeric NUMERIC(15,6);
  v_text TEXT;
  v_minimum NUMERIC(15,6);
  v_maximum NUMERIC(15,6);
  v_unit TEXT;
  v_type TEXT;
  v_patient_birth_date DATE;
  v_patient_sex TEXT;
  v_patient_age INTEGER;
BEGIN
  SELECT * INTO v_actor
    FROM private.m23_require_actor(ARRAY['admin', 'laboratorio']);
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Result operation id is required';
  END IF;
  IF p_item_id IS NULL
     OR p_results IS NULL
     OR jsonb_typeof(p_results) <> 'array'
     OR jsonb_array_length(p_results) = 0 THEN
    RAISE EXCEPTION 'Lab item and non-empty results array are required';
  END IF;

  v_request_payload := jsonb_build_object(
    'item_id', p_item_id,
    'results', p_results
  );
  v_request_hash := md5(concat_ws(
    '|',
    'm23_record_results_secure',
    v_actor.company_id::TEXT,
    p_item_id::TEXT,
    p_results::TEXT
  ));

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_actor.company_id::TEXT || ':' || p_operation_id::TEXT,
    23
  ));

  SELECT *
    INTO v_existing
    FROM public.lab_result_operation_requests
   WHERE company_id = v_actor.company_id
     AND operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.item_id IS DISTINCT FROM p_item_id
       OR v_existing.request_hash IS DISTINCT FROM v_request_hash
       OR v_existing.request_payload IS DISTINCT FROM v_request_payload THEN
      RAISE EXCEPTION 'Result operation id reused with different payload';
    END IF;
    RETURN v_existing.response_payload;
  END IF;

  SELECT *
    INTO v_item
    FROM public.exames_lab_pedido_itens
   WHERE id = p_item_id
     AND company_id = v_actor.company_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lab order item not found in authenticated tenant';
  END IF;
  IF v_item.tp_status NOT IN ('COLETADO', 'EM_ANALISE') THEN
    RAISE EXCEPTION
      'Lab item must be COLETADO or EM_ANALISE before receiving results';
  END IF;
  IF v_item.dt_coleta IS NULL
     OR NULLIF(btrim(COALESCE(v_item.ds_amostra_id, '')), '') IS NULL THEN
    RAISE EXCEPTION
      'Lab item requires collection timestamp and sample identifier';
  END IF;

  SELECT patient.birth_date,
         NULLIF(upper(btrim(COALESCE(patient.sex, ''))), '')
    INTO v_patient_birth_date, v_patient_sex
    FROM public.exames_lab_pedido order_row
    JOIN public.patients patient
      ON patient.id = order_row.cd_paciente
     AND patient.company_id = order_row.company_id
   WHERE order_row.id = v_item.cd_pedido
     AND order_row.company_id = v_actor.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Lab item has no tenant-bound patient demographics';
  END IF;
  IF v_patient_birth_date IS NULL
     OR v_patient_birth_date > CURRENT_DATE THEN
    RAISE EXCEPTION
      'Patient birth date is required for server-side reference selection';
  END IF;
  IF v_patient_sex IS NOT NULL
     AND v_patient_sex NOT IN ('M', 'F', 'O') THEN
    RAISE EXCEPTION
      'Patient sex is invalid for server-side reference selection';
  END IF;
  v_patient_age := date_part(
    'year',
    age(CURRENT_DATE, v_patient_birth_date)
  )::INTEGER;

  FOR v_input IN
    SELECT value FROM jsonb_array_elements(p_results)
  LOOP
    IF jsonb_typeof(v_input) <> 'object' THEN
      RAISE EXCEPTION 'Each lab result must be a JSON object';
    END IF;
    IF v_input ? 'company_id'
       AND NULLIF(v_input->>'company_id', '')::UUID IS DISTINCT FROM v_actor.company_id THEN
      RAISE EXCEPTION 'Lab result company does not match authenticated tenant';
    END IF;
    IF v_input ? 'cd_item_pedido'
       AND NULLIF(v_input->>'cd_item_pedido', '')::BIGINT IS DISTINCT FROM p_item_id THEN
      RAISE EXCEPTION 'Lab result item does not match function argument';
    END IF;

    v_result_id := NULLIF(v_input->>'id', '')::BIGINT;
    v_parameter := btrim(COALESCE(v_input->>'ds_parametro', ''));
    v_numeric := NULLIF(btrim(COALESCE(v_input->>'vl_resultado', '')), '')::NUMERIC(15,6);
    v_text := NULLIF(btrim(COALESCE(v_input->>'vl_resultado_texto', '')), '');

    IF char_length(v_parameter) < 1 OR char_length(v_parameter) > 100 THEN
      RAISE EXCEPTION 'Lab result parameter must have between 1 and 100 characters';
    END IF;
    IF v_numeric IS NULL AND v_text IS NULL THEN
      RAISE EXCEPTION 'Lab result requires numeric or textual value';
    END IF;

    SELECT array_agg(reference_row.id ORDER BY reference_row.id)
      INTO v_reference_ids
      FROM public.exames_lab_valor_referencia reference_row
     WHERE reference_row.company_id = v_actor.company_id
       AND reference_row.cd_exame = v_item.cd_exame
       AND reference_row.lg_ativo
       AND lower(btrim(reference_row.ds_parametro)) =
           lower(v_parameter)
       AND v_patient_age BETWEEN
           COALESCE(reference_row.nr_idade_min, 0)
           AND COALESCE(reference_row.nr_idade_max, 150)
       AND (
         COALESCE(reference_row.cd_sexo, 'A') = 'A'
         OR reference_row.cd_sexo = v_patient_sex
       );

    IF COALESCE(cardinality(v_reference_ids), 0) = 0 THEN
      RAISE EXCEPTION
        'No active tenant reference range matches parameter %, age % and sex %',
        v_parameter,
        v_patient_age,
        COALESCE(v_patient_sex, 'NAO_INFORMADO');
    END IF;
    IF cardinality(v_reference_ids) > 1 THEN
      RAISE EXCEPTION
        'Ambiguous tenant reference ranges for parameter %, age % and sex %',
        v_parameter,
        v_patient_age,
        COALESCE(v_patient_sex, 'NAO_INFORMADO');
    END IF;

    v_reference_id := v_reference_ids[1];
    SELECT reference_row.vl_minimo,
           reference_row.vl_maximo,
           reference_row.ds_unidade
      INTO v_minimum, v_maximum, v_unit
      FROM public.exames_lab_valor_referencia reference_row
     WHERE reference_row.id = v_reference_id
       AND reference_row.company_id = v_actor.company_id
       AND reference_row.cd_exame = v_item.cd_exame
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Tenant reference range changed during result recording';
    END IF;
    IF v_numeric IS NOT NULL
       AND v_minimum IS NULL
       AND v_maximum IS NULL THEN
      RAISE EXCEPTION
        'Numeric result requires a reference range with numeric bounds';
    END IF;

    v_type := COALESCE(
      public.classificar_resultado_lab(v_numeric, v_minimum, v_maximum),
      'INCONCLUSIVO'
    );

    SELECT result_row.id
      INTO v_existing_result_id
      FROM public.exames_lab_resultado result_row
     WHERE result_row.company_id = v_actor.company_id
       AND result_row.cd_item_pedido = p_item_id
       AND lower(btrim(result_row.ds_parametro)) = lower(v_parameter)
     FOR UPDATE;

    IF v_result_id IS NULL THEN
      v_result_id := v_existing_result_id;
    ELSIF v_existing_result_id IS NOT NULL
          AND v_existing_result_id IS DISTINCT FROM v_result_id THEN
      RAISE EXCEPTION
        'Result parameter already belongs to another row in item/tenant';
    ELSE
      PERFORM 1
        FROM public.exames_lab_resultado result_row
       WHERE result_row.id = v_result_id
         AND result_row.company_id = v_actor.company_id
         AND result_row.cd_item_pedido = p_item_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Lab result not found in item/tenant';
      END IF;
    END IF;

    IF v_result_id IS NULL THEN
      INSERT INTO public.exames_lab_resultado (
        company_id,
        cd_item_pedido,
        cd_valor_referencia,
        ds_parametro,
        vl_resultado,
        vl_resultado_texto,
        ds_unidade,
        vl_minimo_referencia,
        vl_maximo_referencia,
        tp_resultado,
        dt_resultado,
        cd_equipamento,
        cd_lote_reagente,
        cd_usuario_laboratorio,
        ds_observacao,
        ds_hl7_message
      ) VALUES (
        v_actor.company_id,
        p_item_id,
        v_reference_id,
        v_parameter,
        v_numeric,
        v_text,
        v_unit,
        v_minimum,
        v_maximum,
        v_type,
        COALESCE(NULLIF(v_input->>'dt_resultado', '')::TIMESTAMPTZ, NOW()),
        NULLIF(btrim(COALESCE(v_input->>'cd_equipamento', '')), ''),
        NULLIF(btrim(COALESCE(v_input->>'cd_lote_reagente', '')), ''),
        v_actor.user_id,
        NULLIF(btrim(COALESCE(v_input->>'ds_observacao', '')), ''),
        NULLIF(v_input->>'ds_hl7_message', '')
      )
      RETURNING * INTO v_row;
    ELSE
      UPDATE public.exames_lab_resultado
         SET cd_valor_referencia = v_reference_id,
              ds_parametro = v_parameter,
              vl_resultado = v_numeric,
              vl_resultado_texto = v_text,
              ds_unidade = v_unit,
             vl_minimo_referencia = v_minimum,
             vl_maximo_referencia = v_maximum,
             tp_resultado = v_type,
             dt_resultado = CASE WHEN v_input ? 'dt_resultado'
               THEN COALESCE(NULLIF(v_input->>'dt_resultado', '')::TIMESTAMPTZ, dt_resultado)
               ELSE dt_resultado END,
             cd_equipamento = CASE WHEN v_input ? 'cd_equipamento'
               THEN NULLIF(btrim(COALESCE(v_input->>'cd_equipamento', '')), '')
               ELSE cd_equipamento END,
             cd_lote_reagente = CASE WHEN v_input ? 'cd_lote_reagente'
               THEN NULLIF(btrim(COALESCE(v_input->>'cd_lote_reagente', '')), '')
               ELSE cd_lote_reagente END,
             cd_usuario_laboratorio = v_actor.user_id,
             ds_observacao = CASE WHEN v_input ? 'ds_observacao'
               THEN NULLIF(btrim(COALESCE(v_input->>'ds_observacao', '')), '')
               ELSE ds_observacao END,
             ds_hl7_message = CASE WHEN v_input ? 'ds_hl7_message'
               THEN NULLIF(v_input->>'ds_hl7_message', '')
               ELSE ds_hl7_message END
       WHERE id = v_result_id
         AND company_id = v_actor.company_id
         AND cd_item_pedido = p_item_id
      RETURNING * INTO v_row;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Lab result not found in item/tenant';
      END IF;
    END IF;
    v_rows := v_rows || jsonb_build_array(to_jsonb(v_row));
  END LOOP;

  UPDATE public.exames_lab_pedido_itens
     SET tp_status = 'EM_ANALISE'
   WHERE id = p_item_id
     AND company_id = v_actor.company_id
     AND tp_status IN ('COLETADO', 'EM_ANALISE');

  UPDATE public.exames_lab_pedido
     SET tp_status = 'EM_ANALISE'
   WHERE id = v_item.cd_pedido
     AND company_id = v_actor.company_id
     AND tp_status IN ('PENDENTE', 'COLETADO');

  INSERT INTO public.lab_result_operation_requests (
    company_id,
    operation_id,
    item_id,
    request_hash,
    request_payload,
    response_payload,
    actor_id
  ) VALUES (
    v_actor.company_id,
    p_operation_id,
    p_item_id,
    v_request_hash,
    v_request_payload,
    v_rows,
    v_actor.user_id
  );

  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.m23_validate_result_secure(
  p_item_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_item public.exames_lab_pedido_itens;
BEGIN
  SELECT * INTO v_actor
    FROM private.m23_require_actor(
      ARRAY['admin', 'laboratorio', 'medico']
    );
  SELECT *
    INTO v_item
    FROM public.exames_lab_pedido_itens
   WHERE id = p_item_id
     AND company_id = v_actor.company_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lab order item not found in authenticated tenant';
  END IF;
  IF v_item.tp_status = 'CANCELADO' THEN
    RAISE EXCEPTION 'Cancelled lab item cannot be validated';
  END IF;
  IF v_item.tp_status = 'LIBERADO' THEN
    RETURN to_jsonb(v_item);
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.exames_lab_resultado result_row
     WHERE result_row.company_id = v_actor.company_id
       AND result_row.cd_item_pedido = p_item_id
  ) THEN
    RAISE EXCEPTION 'At least one result is required before validation';
  END IF;

  UPDATE public.exames_lab_pedido_itens
     SET tp_status = 'LIBERADO',
         dt_liberacao = COALESCE(dt_liberacao, NOW())
   WHERE id = p_item_id
     AND company_id = v_actor.company_id
  RETURNING * INTO v_item;

  IF NOT EXISTS (
    SELECT 1
      FROM public.exames_lab_pedido_itens sibling
     WHERE sibling.company_id = v_actor.company_id
       AND sibling.cd_pedido = v_item.cd_pedido
       AND sibling.tp_status NOT IN ('LIBERADO', 'CANCELADO')
  ) THEN
    UPDATE public.exames_lab_pedido
       SET tp_status = 'LIBERADO',
           dt_liberacao = COALESCE(dt_liberacao, NOW())
     WHERE id = v_item.cd_pedido
       AND company_id = v_actor.company_id
       AND tp_status <> 'CANCELADO';
  END IF;

  RETURN to_jsonb(v_item);
END;
$function$;

CREATE OR REPLACE FUNCTION public.m23_acknowledge_critical_alert_secure(
  p_alert_id BIGINT,
  p_channel TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_row public.exames_lab_alerta_critico;
  v_channel TEXT := upper(btrim(COALESCE(p_channel, '')));
BEGIN
  SELECT * INTO v_actor
    FROM private.m23_require_actor(
      ARRAY['admin', 'laboratorio', 'medico', 'enfermagem']
    );
  IF v_channel NOT IN (
    'TELEFONE', 'SMS', 'PRESENCIAL', 'WHATSAPP', 'EMAIL'
  ) THEN
    RAISE EXCEPTION 'Invalid critical alert communication channel';
  END IF;

  SELECT *
    INTO v_row
    FROM public.exames_lab_alerta_critico
   WHERE id = p_alert_id
     AND company_id = v_actor.company_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Critical alert not found in authenticated tenant';
  END IF;
  IF v_row.tp_status = 'RESOLVIDO' THEN
    RAISE EXCEPTION 'Resolved critical alert cannot be acknowledged';
  END IF;
  IF v_row.lg_comunicado THEN
    RETURN to_jsonb(v_row);
  END IF;

  UPDATE public.exames_lab_alerta_critico
     SET lg_comunicado = TRUE,
         dt_comunicacao = NOW(),
         cd_usuario_comunicou = v_actor.user_id,
         ds_forma_comunicacao = v_channel,
         tp_status = 'COMUNICADO'
   WHERE id = p_alert_id
     AND company_id = v_actor.company_id
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.m23_deliver_order_secure(
  p_order_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_row public.exames_lab_pedido;
BEGIN
  SELECT * INTO v_actor
    FROM private.m23_require_actor(
      ARRAY['admin', 'laboratorio', 'medico', 'enfermagem']
    );
  SELECT *
    INTO v_row
    FROM public.exames_lab_pedido
   WHERE id = p_order_id
     AND company_id = v_actor.company_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lab order not found in authenticated tenant';
  END IF;
  IF v_row.tp_status = 'ENTREGUE' THEN
    RETURN to_jsonb(v_row);
  END IF;
  IF v_row.tp_status <> 'LIBERADO' THEN
    RAISE EXCEPTION 'Only a released lab order can be delivered';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.exames_lab_alerta_critico alert_row
      JOIN public.exames_lab_resultado result_row
        ON result_row.id = alert_row.cd_resultado
       AND result_row.company_id = alert_row.company_id
      JOIN public.exames_lab_pedido_itens item
        ON item.id = result_row.cd_item_pedido
       AND item.company_id = result_row.company_id
     WHERE alert_row.company_id = v_actor.company_id
       AND item.cd_pedido = p_order_id
       AND alert_row.tp_status <> 'RESOLVIDO'
       AND (
         alert_row.tp_status = 'PENDENTE'
         OR NOT COALESCE(alert_row.lg_comunicado, FALSE)
       )
  ) THEN
    RAISE EXCEPTION
      'Lab order has a pending or uncommunicated critical alert';
  END IF;

  UPDATE public.exames_lab_pedido
     SET tp_status = 'ENTREGUE'
   WHERE id = p_order_id
     AND company_id = v_actor.company_id
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$function$;

ALTER FUNCTION public.m23_upsert_exam_catalog_secure(JSONB)
  OWNER TO prontomedic_lis_rpc_owner;
ALTER FUNCTION public.m23_upsert_reference_range_secure(JSONB)
  OWNER TO prontomedic_lis_rpc_owner;
ALTER FUNCTION public.m23_create_lab_order_secure(UUID, JSONB, JSONB)
  OWNER TO prontomedic_lis_rpc_owner;
ALTER FUNCTION public.m23_collect_specimen_secure(BIGINT, TEXT)
  OWNER TO prontomedic_lis_rpc_owner;
ALTER FUNCTION public.m23_transition_specimen_secure(BIGINT, TEXT)
  OWNER TO prontomedic_lis_rpc_owner;
ALTER FUNCTION public.m23_record_results_secure(BIGINT, JSONB, UUID)
  OWNER TO prontomedic_lis_rpc_owner;
ALTER FUNCTION public.m23_validate_result_secure(BIGINT)
  OWNER TO prontomedic_lis_rpc_owner;
ALTER FUNCTION public.m23_acknowledge_critical_alert_secure(BIGINT, TEXT)
  OWNER TO prontomedic_lis_rpc_owner;
ALTER FUNCTION public.m23_deliver_order_secure(BIGINT)
  OWNER TO prontomedic_lis_rpc_owner;

REVOKE ALL ON FUNCTION public.is_lab_user(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_lab_user(UUID)
  TO authenticated, app_prontomedic, prontomedic_lis_rpc_owner;

REVOKE ALL ON FUNCTION private.m23_normalize_role(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.m23_require_actor(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.m23_normalize_role(TEXT)
  TO prontomedic_lis_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m23_require_actor(TEXT[])
  TO prontomedic_lis_rpc_owner;

REVOKE ALL ON FUNCTION public.m23_upsert_exam_catalog_secure(JSONB)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.m23_upsert_reference_range_secure(JSONB)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.m23_create_lab_order_secure(UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.m23_collect_specimen_secure(BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.m23_transition_specimen_secure(BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.m23_record_results_secure(BIGINT, JSONB, UUID)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.m23_validate_result_secure(BIGINT)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.m23_acknowledge_critical_alert_secure(BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.m23_deliver_order_secure(BIGINT)
  FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT EXECUTE ON FUNCTION public.m23_upsert_exam_catalog_secure(JSONB)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_upsert_reference_range_secure(JSONB)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_create_lab_order_secure(UUID, JSONB, JSONB)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_collect_specimen_secure(BIGINT, TEXT)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_transition_specimen_secure(BIGINT, TEXT)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_record_results_secure(BIGINT, JSONB, UUID)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_validate_result_secure(BIGINT)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_acknowledge_critical_alert_secure(BIGINT, TEXT)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_deliver_order_secure(BIGINT)
  TO authenticated, app_prontomedic;

COMMENT ON FUNCTION public.m23_upsert_exam_catalog_secure(JSONB)
  IS 'Module 23 tenant-bound catalog upsert. Returns the current row as JSONB.';
COMMENT ON FUNCTION public.m23_upsert_reference_range_secure(JSONB)
  IS 'Module 23 tenant-bound reference range upsert. Returns the current row as JSONB.';
COMMENT ON FUNCTION public.m23_create_lab_order_secure(UUID, JSONB, JSONB)
  IS 'Module 23 atomic/idempotent order creation. Returns pedido_id and itens_ids.';
COMMENT ON FUNCTION public.m23_record_results_secure(BIGINT, JSONB, UUID)
  IS 'Module 23 atomic and idempotent result upsert. Server-selects tenant reference ranges, returns a stable JSON array and moves the collected item to EM_ANALISE.';
COMMENT ON SCHEMA private
  IS 'Private helpers are not exposed through the Supabase Data API.';
COMMENT ON TABLE public.lab_order_operation_requests
  IS 'Internal idempotency ledger for Module 23 order creation; no client table access.';
COMMENT ON TABLE public.lab_result_operation_requests
  IS 'Internal tenant/payload-bound idempotency ledger for Module 23 result recording; no client table access.';

-- Deliberate non-capabilities:
-- public.m23_upsert_equipment_secure and public.m23_record_qc_run_secure
-- are not created because no real equipment/QC tables and contracts exist.

COMMIT;

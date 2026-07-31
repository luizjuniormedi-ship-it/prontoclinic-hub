-- Normalize legacy Reception insurance references to the canonical catalog.
-- The reception_* compatibility views are recreated in the same transaction
-- because PostgreSQL does not allow changing a referenced column type.

DROP FUNCTION IF EXISTS public.update_reception_authorization_secure(
  UUID, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, TEXT
);
DROP FUNCTION IF EXISTS public.update_reception_eligibility_secure(
  UUID, TEXT, TEXT, TEXT
);
DROP VIEW IF EXISTS public.reception_authorizations;
DROP VIEW IF EXISTS public.reception_eligibility_checks;

DO $migration$
DECLARE
  v_table TEXT;
  v_constraint TEXT;
  v_has_invalid BOOLEAN;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'insurance_authorizations',
    'insurance_eligibility_checks'
  ] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'Canonical insurance table is missing: public.%', v_table;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_attribute attribute
      WHERE attribute.attrelid = format('public.%I', v_table)::regclass
        AND attribute.attname = 'insurance_plan_id'
        AND NOT attribute.attisdropped
        AND format_type(attribute.atttypid, attribute.atttypmod) <> 'integer'
    ) THEN
      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1 FROM public.%I
           WHERE insurance_plan_id IS NOT NULL
             AND insurance_plan_id::TEXT !~ ''^[0-9]+$''
         )',
        v_table
      ) INTO v_has_invalid;

      IF v_has_invalid THEN
        RAISE EXCEPTION
          'Non-numeric insurance_plan_id values prevent canonicalization of public.%',
          v_table;
      END IF;

      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN insurance_plan_id TYPE INTEGER USING NULLIF(insurance_plan_id::TEXT, '''')::INTEGER',
        v_table
      );
    END IF;

    v_constraint := v_table || '_insurance_plan_id_fkey';
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint constraint_record
      WHERE constraint_record.conrelid = format('public.%I', v_table)::regclass
        AND constraint_record.contype = 'f'
        AND constraint_record.confrelid = 'public.insurance_plans'::regclass
        AND constraint_record.conkey = ARRAY[
          (
            SELECT attribute.attnum
            FROM pg_attribute attribute
            WHERE attribute.attrelid = format('public.%I', v_table)::regclass
              AND attribute.attname = 'insurance_plan_id'
              AND NOT attribute.attisdropped
          )
        ]::SMALLINT[]
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (insurance_plan_id) REFERENCES public.insurance_plans(id)',
        v_table,
        v_constraint
      );
    END IF;
  END LOOP;
END
$migration$;

CREATE VIEW public.reception_authorizations
WITH (security_invoker = TRUE)
AS
SELECT *
FROM public.insurance_authorizations;

CREATE VIEW public.reception_eligibility_checks
WITH (security_invoker = TRUE)
AS
SELECT *
FROM public.insurance_eligibility_checks;

REVOKE ALL ON public.reception_authorizations FROM PUBLIC, anon;
REVOKE ALL ON public.reception_eligibility_checks FROM PUBLIC, anon;
GRANT SELECT ON public.reception_authorizations TO authenticated;
GRANT SELECT ON public.reception_eligibility_checks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reception_authorizations
  TO app_prontomedic;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reception_eligibility_checks
  TO app_prontomedic;

CREATE FUNCTION public.update_reception_authorization_secure(
  p_authorization_id UUID,
  p_status TEXT,
  p_protocol_number TEXT DEFAULT NULL,
  p_authorization_number TEXT DEFAULT NULL,
  p_password_number TEXT DEFAULT NULL,
  p_valid_until DATE DEFAULT NULL,
  p_quantity_authorized INTEGER DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.insurance_authorizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_old public.insurance_authorizations%ROWTYPE;
  v_row public.insurance_authorizations%ROWTYPE;
BEGIN
  IF v_company_id IS NULL OR v_unit_id IS NULL OR NOT (
    public.can_access('recepcao', 'edit')
    OR public.can_access('faturamento', 'edit')
  ) THEN
    RAISE EXCEPTION 'Contexto AAL2, sessao, unidade ou permissao invalidos'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old
  FROM public.insurance_authorizations
  WHERE id = p_authorization_id
    AND company_id = v_company_id
    AND unit_id = v_unit_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Autorizacao nao encontrada no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_status NOT IN (
    'pendente', 'solicitada', 'em_analise', 'autorizada',
    'parcialmente_autorizada', 'negada', 'vencida', 'cancelada',
    'reenviada', 'liberada_excecao'
  ) THEN
    RAISE EXCEPTION 'Status de autorizacao invalido';
  END IF;
  IF p_status IN ('autorizada', 'parcialmente_autorizada')
     AND NULLIF(trim(COALESCE(p_authorization_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Numero da autorizacao e obrigatorio';
  END IF;
  IF p_status = 'negada'
     AND NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo da negativa e obrigatorio';
  END IF;
  IF p_status = 'liberada_excecao' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_access_context context_record
      JOIN public.roles role_record
        ON role_record.id = context_record.role_id
       AND role_record.lg_ativo = TRUE
      WHERE context_record.user_id = auth.uid()
        AND context_record.session_id =
          NULLIF(auth.jwt()->>'session_id', '')::UUID
        AND lower(role_record.name) IN (
          'admin', 'administrador', 'gestor', 'supervisor',
          'supervisor_recepcao', 'diretoria'
        )
    ) THEN
      RAISE EXCEPTION 'Perfil sem permissao para liberar excecao'
        USING ERRCODE = '42501';
    END IF;
    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Justificativa da excecao e obrigatoria';
    END IF;
  END IF;

  UPDATE public.insurance_authorizations
  SET status = p_status,
      protocol_number = COALESCE(
        NULLIF(trim(COALESCE(p_protocol_number, '')), ''),
        protocol_number
      ),
      authorization_number = COALESCE(
        NULLIF(trim(COALESCE(p_authorization_number, '')), ''),
        authorization_number
      ),
      password_number = COALESCE(
        NULLIF(trim(COALESCE(p_password_number, '')), ''),
        password_number
      ),
      valid_until = COALESCE(p_valid_until, valid_until),
      quantity_authorized = COALESCE(
        p_quantity_authorized,
        quantity_authorized
      ),
      authorized_at = CASE
        WHEN p_status IN (
          'autorizada', 'parcialmente_autorizada', 'liberada_excecao'
        ) THEN now()
        ELSE authorized_at
      END,
      denied_at = CASE WHEN p_status = 'negada' THEN now() ELSE denied_at END,
      denial_reason = CASE
        WHEN p_status = 'negada' THEN p_reason
        ELSE denial_reason
      END,
      notes = concat_ws(
        E'\n',
        notes,
        NULLIF(trim(COALESCE(p_reason, '')), '')
      ),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_authorization_id
    AND company_id = v_company_id
    AND unit_id = v_unit_id
  RETURNING * INTO v_row;

  IF v_row.appointment_id IS NOT NULL
     AND p_status IN ('autorizada', 'parcialmente_autorizada') THEN
    UPDATE public.appointments
    SET cd_autorizacao = v_row.authorization_number,
        updated_at = now()
    WHERE id = v_row.appointment_id
      AND company_id = v_company_id
      AND unit_id = v_unit_id;
  END IF;

  INSERT INTO public.reception_admin_history(
    company_id, entity_type, entity_id, appointment_id, from_status,
    to_status, reason, details, actor_user_id
  ) VALUES (
    v_row.company_id,
    'authorization',
    v_row.id::TEXT,
    v_row.appointment_id,
    v_old.status,
    v_row.status,
    p_reason,
    jsonb_build_object(
      'protocol', v_row.protocol_number,
      'authorization_number', v_row.authorization_number,
      'valid_until', v_row.valid_until
    ),
    auth.uid()
  );
  RETURN v_row;
END;
$function$;

CREATE FUNCTION public.update_reception_eligibility_secure(
  p_eligibility_id UUID,
  p_status TEXT,
  p_protocol_number TEXT DEFAULT NULL,
  p_result_detail TEXT DEFAULT NULL
)
RETURNS public.insurance_eligibility_checks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_old public.insurance_eligibility_checks%ROWTYPE;
  v_row public.insurance_eligibility_checks%ROWTYPE;
BEGIN
  IF v_company_id IS NULL OR v_unit_id IS NULL OR NOT (
    public.can_access('recepcao', 'edit')
    OR public.can_access('faturamento', 'edit')
  ) THEN
    RAISE EXCEPTION 'Contexto AAL2, sessao, unidade ou permissao invalidos'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old
  FROM public.insurance_eligibility_checks
  WHERE id = p_eligibility_id
    AND company_id = v_company_id
    AND unit_id = v_unit_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Elegibilidade nao encontrada no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_status NOT IN (
    'elegivel', 'nao_elegivel', 'pendente', 'em_analise',
    'portal_indisponivel', 'nao_obrigatoria', 'liberado_excecao'
  ) THEN
    RAISE EXCEPTION 'Status de elegibilidade invalido';
  END IF;
  IF p_status IN ('nao_elegivel', 'portal_indisponivel')
     AND NULLIF(trim(COALESCE(p_result_detail, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Detalhe do resultado e obrigatorio';
  END IF;
  IF p_status = 'liberado_excecao' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_access_context context_record
      JOIN public.roles role_record
        ON role_record.id = context_record.role_id
       AND role_record.lg_ativo = TRUE
      WHERE context_record.user_id = auth.uid()
        AND context_record.session_id =
          NULLIF(auth.jwt()->>'session_id', '')::UUID
        AND lower(role_record.name) IN (
          'admin', 'administrador', 'gestor', 'supervisor',
          'supervisor_recepcao', 'diretoria'
        )
    ) THEN
      RAISE EXCEPTION 'Perfil sem permissao para liberar excecao'
        USING ERRCODE = '42501';
    END IF;
    IF NULLIF(trim(COALESCE(p_result_detail, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Justificativa da excecao e obrigatoria';
    END IF;
  END IF;

  UPDATE public.insurance_eligibility_checks
  SET status = p_status,
      protocol_number = COALESCE(
        NULLIF(trim(COALESCE(p_protocol_number, '')), ''),
        protocol_number
      ),
      result_detail = COALESCE(
        NULLIF(trim(COALESCE(p_result_detail, '')), ''),
        result_detail
      ),
      checked_at = CASE
        WHEN p_status NOT IN ('pendente', 'em_analise') THEN now()
        ELSE checked_at
      END,
      checked_by = auth.uid(),
      updated_at = now()
  WHERE id = p_eligibility_id
    AND company_id = v_company_id
    AND unit_id = v_unit_id
  RETURNING * INTO v_row;

  INSERT INTO public.reception_admin_history(
    company_id, entity_type, entity_id, appointment_id, from_status,
    to_status, reason, details, actor_user_id
  ) VALUES (
    v_row.company_id,
    'eligibility',
    v_row.id::TEXT,
    v_row.appointment_id,
    v_old.status,
    v_row.status,
    p_result_detail,
    jsonb_build_object('protocol', v_row.protocol_number),
    auth.uid()
  );
  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_reception_authorization_secure(
  UUID, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.update_reception_eligibility_secure(
  UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260731003000_reception_insurance_plan_canonicalization.sql')
ON CONFLICT (filename) DO NOTHING;

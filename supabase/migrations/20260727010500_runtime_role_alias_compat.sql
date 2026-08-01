-- Preserve canonical role identifiers while accepting localized profile labels.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_user_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role public.roles%ROWTYPE;
  v_role_name TEXT;
BEGIN
  IF NEW.role_name IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.role_name IS DISTINCT FROM OLD.role_name) THEN
    v_role_name := CASE lower(btrim(NEW.role_name))
      WHEN 'médico' THEN 'medico'
      WHEN 'recepção' THEN 'recepcao'
      WHEN 'enfermeiro' THEN 'enfermagem'
      WHEN 'laboratório' THEN 'laboratorio'
      WHEN 'farmácia' THEN 'farmacia'
      ELSE lower(btrim(NEW.role_name))
    END;

    SELECT * INTO v_role
      FROM public.roles
     WHERE name = v_role_name
       AND lg_ativo = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Perfil de acesso inválido: %', NEW.role_name;
    END IF;

    NEW.role_id := v_role.id;
    NEW.role_name := v_role.name;
  ELSIF NEW.role_id IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id) THEN
    SELECT * INTO v_role
      FROM public.roles
     WHERE id = NEW.role_id
       AND lg_ativo = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Perfil de acesso inválido: %', NEW.role_id;
    END IF;

    NEW.role_name := v_role.name;
  END IF;

  NEW.user_id := NEW.id;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_user_profile_role() FROM PUBLIC;

COMMIT;

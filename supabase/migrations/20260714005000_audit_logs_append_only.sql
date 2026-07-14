-- Trilha de auditoria append-only para usuarios e operacoes normais.
-- A purga de retencao usa um marcador transacional interno e continua
-- limitada por EXECUTE privilege a service_role (migration 000012).

CREATE OR REPLACE FUNCTION public.guard_audit_logs_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('prontomedic.audit_retention_purge', true) = '1' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_logs e append-only; % nao permitido', TG_OP
    USING ERRCODE = '55006';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON public.audit_logs;

CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_audit_logs_append_only();

CREATE OR REPLACE FUNCTION public.purge_expired_audit_logs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  PERFORM set_config('prontomedic.audit_retention_purge', '1', true);

  DELETE FROM public.audit_logs
   WHERE dt_retencao < CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM set_config('prontomedic.audit_retention_purge', '0', true);
  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('prontomedic.audit_retention_purge', '0', true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_audit_logs_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_audit_logs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_audit_logs() TO service_role;

COMMENT ON FUNCTION public.guard_audit_logs_append_only() IS
  'Impede UPDATE/DELETE na trilha de auditoria; somente a purga de retencao '
  'autorizada pode remover registros expirados.';

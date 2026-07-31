-- Compare queue tickets against the clinic's operational date. PostgreSQL runs
-- in UTC, while Reception ticket issuance uses America/Sao_Paulo.

CREATE OR REPLACE FUNCTION public.transition_reception_queue_ticket_secure(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.reception_queue_tickets ticket
    WHERE ticket.id = p_ticket_id
      AND ticket.ticket_date = (
        CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'
      )::DATE
  ) THEN
    RAISE EXCEPTION 'Senha de recepcao nao pertence ao dia operacional atual';
  END IF;

  RETURN private.transition_reception_queue_ticket(
    p_ticket_id,
    p_to_status,
    p_reason,
    NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.transition_reception_queue_ticket_secure(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT,
  p_destination_unit_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.reception_queue_tickets ticket
    WHERE ticket.id = p_ticket_id
      AND ticket.ticket_date = (
        CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'
      )::DATE
  ) THEN
    RAISE EXCEPTION 'Senha de recepcao nao pertence ao dia operacional atual';
  END IF;

  RETURN private.transition_reception_queue_ticket(
    p_ticket_id,
    p_to_status,
    p_reason,
    p_destination_unit_id
  );
END;
$function$;

ALTER FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT, INTEGER
) OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.transition_reception_queue_ticket_secure(
  BIGINT, TEXT, TEXT, INTEGER
) TO authenticated, app_prontomedic;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260730235500_reception_queue_operational_date.sql')
ON CONFLICT (filename) DO NOTHING;

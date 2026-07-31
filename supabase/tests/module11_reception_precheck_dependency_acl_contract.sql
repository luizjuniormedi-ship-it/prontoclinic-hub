DO $$
BEGIN
  IF NOT has_function_privilege(
    'prontomedic_reception_rpc_owner',
    'public.get_reception_precheckin_context(bigint)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'Reception ACL contract failed: exception capability owner cannot execute pre-check dependency';
  END IF;
END
$$;

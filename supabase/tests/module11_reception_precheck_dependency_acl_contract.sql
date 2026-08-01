DO $$
BEGIN
  IF to_regprocedure(
    'public.get_reception_precheckin_context(bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Reception ACL contract failed: pre-check dependency is missing';
  END IF;

  IF NOT has_function_privilege(
    'prontomedic_reception_rpc_owner',
    'public.get_reception_precheckin_context(bigint)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'Reception ACL contract failed: exception capability owner cannot execute pre-check dependency';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_reception_precheckin_context(bigint)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'Reception ACL contract failed: anonymous execution is allowed';
  END IF;
END
$$;


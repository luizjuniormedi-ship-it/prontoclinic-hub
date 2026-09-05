-- preserve_schema: retain series audit data and fail closed for new creation.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.create_appointment_series_with_requirements_secure(
  UUID, BIGINT, BIGINT, DATE, TIME, TIME, UUID, INTEGER, INTEGER,
  BIGINT, BIGINT, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER
) FROM authenticated, app_prontomedic;
REVOKE SELECT ON public.insurance_plans FROM prontomedic_schedule_rpc_owner;
REVOKE SELECT ON public.units FROM prontomedic_schedule_rpc_owner;
REVOKE SELECT, INSERT ON public.patient_insurances FROM prontomedic_schedule_rpc_owner;
REVOKE USAGE, SELECT ON SEQUENCE public.patient_insurances_id_seq
  FROM prontomedic_schedule_rpc_owner;
REVOKE EXECUTE ON FUNCTION public.get_scheduling_requirements(
  BIGINT, BIGINT, BIGINT, INTEGER, TEXT
) FROM prontomedic_schedule_rpc_owner;
COMMIT;

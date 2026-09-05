BEGIN;

REVOKE EXECUTE ON FUNCTION public.create_imaging_order_from_attendance(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM authenticated;
ALTER FUNCTION public.create_imaging_order_from_attendance(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) SECURITY INVOKER;
ALTER FUNCTION public.create_imaging_order_from_attendance(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) OWNER TO postgres;

DROP POLICY IF EXISTS imaging_order_items_attendance_rpc_insert ON public.imaging_order_items;
DROP POLICY IF EXISTS imaging_orders_attendance_rpc_insert ON public.imaging_orders;
DROP POLICY IF EXISTS professionals_attendance_rpc_select ON public.professionals;
DROP POLICY IF EXISTS units_attendance_rpc_select ON public.units;
REVOKE INSERT ON public.imaging_orders, public.imaging_order_items
  FROM prontomedic_worklist_rpc_owner;
REVOKE SELECT ON public.units, public.professionals FROM prontomedic_worklist_rpc_owner;
REVOKE EXECUTE ON FUNCTION auth.uid() FROM prontomedic_worklist_rpc_owner;
REVOKE USAGE ON SCHEMA auth FROM prontomedic_worklist_rpc_owner;

GRANT EXECUTE ON FUNCTION public.create_imaging_order_from_attendance(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO authenticated;

COMMIT;

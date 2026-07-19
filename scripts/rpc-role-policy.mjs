export function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

const clinicalOrderRoles = Object.freeze([
  'doctor', 'medico', 'médico',
  'admin', 'administrador',
  'master', 'admin_master', 'master_admin', 'adm_master',
]);

export const IMAGING_RPC_ROLE_POLICY = Object.freeze({
  create_imaging_order_from_attendance: clinicalOrderRoles,
  sign_and_release_radiology_report: Object.freeze([
    ...clinicalOrderRoles,
    'radiologist', 'radiologista', 'radiologia',
  ]),
  deliver_radiology_report: Object.freeze([
    ...clinicalOrderRoles,
    'radiologist', 'radiologista', 'radiologia',
  ]),
  rectify_radiology_report: Object.freeze([
    ...clinicalOrderRoles,
    'radiologist', 'radiologista', 'radiologia',
  ]),
});

export function isRpcRoleAllowed(allowedRoles, role) {
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) return false;
  const normalizedRole = normalizeRole(role);
  return allowedRoles.some((allowed) => normalizeRole(allowed) === normalizedRole);
}

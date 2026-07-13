/**
 * Tenant-scope guards shared by the local auth REST proxy and its tests.
 * The authenticated tenant is authoritative; clients cannot choose it.
 */
function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function assertTenantMatch(body, companyId) {
  if (hasOwn(body, 'company_id') && body.company_id !== companyId) {
    const error = new Error('company_id nao pertence ao perfil autenticado');
    error.statusCode = 403;
    throw error;
  }
}

export function scopeInsertBody(body, companyId) {
  const scoped = { ...body };
  if (!companyId) return scoped;
  assertTenantMatch(scoped, companyId);
  scoped.company_id = companyId;
  return scoped;
}

export function scopePatchBody(body, companyId) {
  const scoped = { ...body };
  if (!companyId) return scoped;
  assertTenantMatch(scoped, companyId);
  // company_id is immutable through the generic REST proxy. The WHERE clause
  // still scopes the target row, and this removes the column from SET.
  delete scoped.company_id;
  return scoped;
}

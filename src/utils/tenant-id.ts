/**
 * Seam kanonis validasi identitas tenant.
 *
 * Tenant id dipakai sebagai komponen path filesystem, kunci cache, dan filter
 * query. Nilai dari header/query/DB tidak boleh dipercaya sebelum lolos pola ini.
 */
export const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function isValidTenantId(value: unknown): value is string {
  return typeof value === 'string' && TENANT_ID_PATTERN.test(value);
}

export function assertValidTenantId(value: unknown): string {
  if (!isValidTenantId(value)) {
    const err = new Error('tenantId tidak valid') as any;
    err.statusCode = 400;
    err.code = 'INVALID_TENANT_ID';
    throw err;
  }
  return value;
}

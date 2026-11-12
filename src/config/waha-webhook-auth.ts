import crypto from 'crypto';

/**
 * waha-webhook-auth.ts — kunci webhook WAHA PER TENANT (S-015).
 *
 * Sebelumnya satu `WAHA_WEBHOOK_SECRET` global dipasang sebagai custom header
 * di konfigurasi WAHA **setiap tenant**. Bocornya config satu session berarti
 * seluruh tenant lain bisa dipalsukan.
 *
 * Kontrak baru:
 * - Header yang dikirim WAHA per session:
 *   1. `X-Webhook-Secret` = HMAC-SHA256(globalSecret, `waha-webhook:<tenantId>`)
 *   2. `X-Tenant-Id`      = tenantId (hanya penanda verifikasi, BUKAN sumber
 *      kebenaran tenant — tenant pesan tetap di-resolve dari session id).
 * - Verifikasi menerima secret turunan tenant tersebut ATAU global secret
 *   (kompatibilitas session lama yang belum di-sync ulang). Secret turunan
 *   tenant A TIDAK berlaku untuk tenant B.
 */

export const WAHA_TENANT_HEADER = 'X-Tenant-Id';
export const WAHA_SECRET_HEADER = 'X-Webhook-Secret';

export function deriveTenantWebhookSecret(globalSecret: string, tenantId: string): string {
  return crypto
    .createHmac('sha256', globalSecret)
    .update(`waha-webhook:${tenantId}`)
    .digest('hex');
}

export function buildWahaWebhookHeaders(
  globalSecret: string | undefined,
  tenantId: string
): Array<{ name: string; value: string }> {
  const secret = (globalSecret || '').trim();
  const tenant = (tenantId || '').trim();
  if (!secret || !tenant) return [];
  return [
    { name: WAHA_SECRET_HEADER, value: deriveTenantWebhookSecret(secret, tenant) },
    { name: WAHA_TENANT_HEADER, value: tenant },
  ];
}

/**
 * Daftar secret yang sah untuk request ini.
 * Urutan: secret turunan tenant (bila header tenant ada) lalu global (legacy).
 */
export function resolveExpectedWebhookSecrets(
  globalSecret: string | undefined,
  tenantIdHeader: string | undefined
): string[] {
  const secret = (globalSecret || '').trim();
  if (!secret) return [];
  const expected = [secret];
  const tenant = (tenantIdHeader || '').trim();
  if (tenant) expected.push(deriveTenantWebhookSecret(secret, tenant));
  return expected;
}

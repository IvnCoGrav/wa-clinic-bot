/**
 * tenant-scope.ts — Gerbang isolasi tenant kanonis untuk pembacaan baris.
 *
 * Satu sumber kebenaran untuk aturan: baris hanya boleh dikembalikan bila
 * `tenant_id`-nya cocok dengan tenant pemanggil (atau guard tenant tidak aktif).
 * Dipakai oleh repository (Postgres & in-memory) dan fallback cache layanan agar
 * tidak ada salinan aturan isolasi tenant yang bisa menyimpang satu sama lain.
 */

export interface TenantScopedRow {
  tenant_id?: string | null;
}

/**
 * Kembalikan baris hanya jika lolos isolasi tenant.
 *
 * - `row` null/undefined → null.
 * - `tenantId` kosong → guard nonaktif, baris dikembalikan apa adanya
 *   (perilaku lama dipertahankan untuk pemanggil yang belum tenant-aware).
 * - `tenant_id` baris kosong → tidak dapat dibuktikan milik tenant lain,
 *   baris dikembalikan (data lama tanpa tenant).
 * - `tenant_id` baris berbeda → null (anti-bocor lintas tenant).
 */
export function tenantScopedRow<T extends TenantScopedRow>(
  row: T | null | undefined,
  tenantId: string
): T | null {
  if (!row) return null;
  if (tenantId && row.tenant_id && row.tenant_id !== tenantId) return null;
  return row;
}

/**
 * src/utils/prisma-errors.ts
 * Deteksi error skema-lama terpusat (Plan 6 FASE 4, Issue #30).
 * Lingkungan dengan database belum termigrasi penuh melempar:
 * - P2022 (Prisma typed query: "The column X does not exist in the current database")
 * - 42703 / P2010 (raw query Postgres: column does not exist)
 * Pemanggil yang membaca kolom opsional (mis. tenants.settings) memakai helper
 * ini untuk kembali ke default senyap alih-alih membanjiri log.
 */
export function isMissingColumnError(error: any, columnName?: string): boolean {
  const msg = String((error as Error)?.message || error || '');
  const code = String((error as any)?.code || '');
  if (/P2022/i.test(code) || /42703|P2010/i.test(code) || /42703|P2010|P2022/i.test(msg)) {
    if (!columnName) return true;
    return new RegExp(columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(msg);
  }
  if (columnName) {
    const re = new RegExp(
      `${columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]{0,40}does not exist|does not exist[\\s\\S]{0,40}${columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      'i'
    );
    return re.test(msg);
  }
  return /column .* does not exist/i.test(msg);
}

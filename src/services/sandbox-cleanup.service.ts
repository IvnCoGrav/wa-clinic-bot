import { prisma } from '../db/client';

/**
 * K-009: pekerjaan pembersihan data sandbox dijadikan fungsi domain tunggal
 * agar route manual (`POST /api/admin/sandbox/cleanup`) dan cron harian
 * memakai kontrak yang sama (tidak ada duplikasi logika).
 *
 * Cakupan sengaja global (semua tenant): data sandbox/QA adalah artefak uji
 * sistem, bukan data bisnis tenant.
 */
export function sandboxCleanupWhere() {
  return {
    OR: [{ is_sandbox_test: true }, { phone: { startsWith: '6289999' } }],
  };
}

export interface SandboxCleanupResult {
  deletedCount: number;
}

export async function cleanupSandboxCustomers(): Promise<SandboxCleanupResult> {
  const deleted = await prisma.customer.deleteMany({ where: sandboxCleanupWhere() });
  return { deletedCount: deleted.count ?? 0 };
}

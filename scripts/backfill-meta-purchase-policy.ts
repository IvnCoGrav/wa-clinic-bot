/**
 * Backfill kebijakan Meta CAPI Purchase untuk tenant yang masih menyimpan
 * nilai eksplisit `SUPPRESS_REPEAT` di `Tenant.settings.metaPurchasePolicy`.
 *
 * Latar belakang: default kode sudah berubah ke `DUAL_EVENT` (2026-10-22), tetapi
 * tenant yang punya nilai eksplisit tetap memakai nilai lamanya. Script ini HANYA
 * mengubah nilai eksplisit `SUPPRESS_REPEAT`; tenant tanpa nilai, `DUAL_EVENT`,
 * atau `ALL_WITH_TAG` tidak disentuh.
 *
 * Idempotent. Dry-run secara default.
 *
 * Usage:
 *   npx tsx scripts/backfill-meta-purchase-policy.ts           # lihat rencana
 *   npx tsx scripts/backfill-meta-purchase-policy.ts --apply   # eksekusi
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log('=== BACKFILL: metaPurchasePolicy SUPPRESS_REPEAT -> DUAL_EVENT ===');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, settings: true } });

  let toUpdate = 0;
  for (const tenant of tenants) {
    const settings = (tenant.settings as Record<string, any>) || {};
    const current = settings.metaPurchasePolicy;

    if (current === undefined || current === null) {
      console.log(`[SKIP] ${tenant.id} — tanpa nilai eksplisit (default kode DUAL_EVENT berlaku).`);
      continue;
    }
    if (current !== 'SUPPRESS_REPEAT') {
      console.log(`[SKIP] ${tenant.id} — nilai eksplisit ${current}.`);
      continue;
    }

    toUpdate += 1;
    console.log(`[UPDATE] ${tenant.id} — SUPPRESS_REPEAT -> DUAL_EVENT`);

    if (APPLY) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { settings: { ...settings, metaPurchasePolicy: 'DUAL_EVENT' } },
      });
    }
  }

  console.log(`\nSelesai. Tenant yang perlu diubah: ${toUpdate}.`);
  if (!APPLY && toUpdate > 0) {
    console.log('Jalankan ulang dengan --apply untuk mengeksekusi.');
  }
}

main()
  .catch((err) => {
    console.error('Backfill gagal:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

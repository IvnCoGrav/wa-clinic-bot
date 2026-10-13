/**
 * backfill-reminder-no-time-templates.ts — Pembaruan template DB REMINDER_H0 & REMINDER_H1
 * Fondasional: Menghapus penyebutan jam/waktu dari template pengingat pasien (Opsi A),
 * per tenant_id, idempoten, dry-run by default.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-reminder-no-time-templates.ts [--dry-run] [--tenant=default-tenant]
 *   npx tsx src/scripts/backfill-reminder-no-time-templates.ts --commit [--tenant=default-tenant]
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { followUpService } from '../services/follow-up.service';
import { getBrandIdentity } from '../config/brand';

const isCommit = process.argv.includes('--commit');
const isDryRun = !isCommit || process.argv.includes('--dry-run');
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const tenantFilter: string | null = tenantArg ? tenantArg.split('=')[1]!.trim() : null;

// Teks baru tanpa jam (3 varian untuk H0 dan 3 varian untuk H1)
const NEW_TEMPLATES: Record<string, string[]> = {
  REMINDER_H0: [
    `Selamat pagi Bunda {name}! ✨ Reminder untuk jadwal treatment homecare ${getBrandIdentity().businessName} hari ini ya bund. Tim bidan kami akan datang berkunjung sesuai jadwal. Sampai jumpa Bunda! 🥰`,
    `Halo Bunda {name}, selamat pagi! 🌸 Mengingatkan kembali jadwal treatment ${getBrandIdentity().businessName} hari ini ya. Mohon disiapkan tempat yang nyaman ya bund. Terimakasih! ✨`,
    `Pagi Bunda {name}! 🥰 Hari ini tim bidan ${getBrandIdentity().businessName} akan menuju ke rumah Bunda untuk treatment. Sampai ketemu nanti ya bund! ✨`,
  ],
  REMINDER_H1: [
    `Selamat malam Bunda {name}! ✨ Mengingatkan kembali untuk jadwal treatment homecare ${getBrandIdentity().businessName} besok ya bund. Tim bidan kami akan datang berkunjung sesuai jadwal. Sampai jumpa besok Bunda! 🥰`,
    `Halo Bunda {name}, selamat malam! 🌸 Mengingatkan kembali jadwal treatment ${getBrandIdentity().businessName} besok ya. Mohon disiapkan tempat yang nyaman ya bund. Terimakasih! ✨`,
    `Malam Bunda {name}! 🥰 Besok tim bidan ${getBrandIdentity().businessName} akan menuju ke rumah Bunda untuk treatment. Sampai ketemu besok ya bund! ✨`,
  ],
};

async function getTenantIds(): Promise<string[]> {
  if (tenantFilter) return [tenantFilter];
  try {
    const { getAllTenantIds } = await import('../services/media.service');
    const ids = await getAllTenantIds();
    return ids.length > 0 ? ids : [DEFAULT_TENANT_ID];
  } catch {
    return [DEFAULT_TENANT_ID];
  }
}

async function run() {
  console.log(`[Backfill Reminder No-Time] Mode: ${isDryRun ? 'DRY-RUN (simulasi)' : 'COMMIT (menulis ke DB)'}`);
  try {
    const tenantIds = await getTenantIds();
    console.log(`[Backfill Reminder No-Time] Memeriksa ${tenantIds.length} tenant: ${tenantIds.join(', ')}`);

    let totalUpdated = 0;

    for (const tenantId of tenantIds) {
      const existing = await prisma.followUpTemplate.findMany({
        where: {
          tenant_id: tenantId,
          type: { in: ['REMINDER_H0', 'REMINDER_H1'] },
        },
      });

      console.log(`[Tenant ${tenantId}] Ditemukan ${existing.length} template custom REMINDER_H0/H1 di DB.`);

      for (const row of existing) {
        const hasTimePlaceholder = /\{time\}|\bjam\b|\bpukul\b/i.test(row.text);
        if (hasTimePlaceholder) {
          const variants = NEW_TEMPLATES[row.type];
          const newText = variants && variants[row.variant - 1] ? variants[row.variant - 1] : row.text.replace(/\s*(jam|pukul)\s*\{time\}/gi, '').trim();

          console.log(`[Tenant ${tenantId}] Target update ${row.type} Varian #${row.variant}:`);
          console.log(`  Lama: "${row.text}"`);
          console.log(`  Baru: "${newText}"`);

          if (!isDryRun) {
            await followUpService.saveTemplate(row.type, row.variant, newText, tenantId);
            totalUpdated++;
          }
        }
      }
    }

    if (isDryRun) {
      console.log(`[Backfill Reminder No-Time] Selesai simulasi. Jalankan dengan --commit untuk menerapkan perubahan.`);
    } else {
      console.log(`[Backfill Reminder No-Time] Sukses memperbarui ${totalUpdated} template di DB.`);
    }
  } catch (err: any) {
    console.error(`[Backfill Reminder No-Time] Gagal: ${err?.message || err}`);
  } finally {
    try {
      await prisma.$disconnect();
    } catch {}
  }
}

if (process.argv[1]?.includes('backfill-reminder-no-time-templates')) {
  run();
}

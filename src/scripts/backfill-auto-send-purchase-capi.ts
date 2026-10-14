/**
 * backfill-auto-send-purchase-capi.ts — Migrasi data tenant ke kebijakan Queue-First.
 * Menonaktifkan auto_send_purchase_capi=false pada seluruh tenant untuk mencegah
 * pengiriman event Purchase CAPI di luar antrean moderasi.
 *
 * Idempoten, aman, dry-run default.
 * Usage: npx tsx src/scripts/backfill-auto-send-purchase-capi.ts [--dry-run] [--execute]
 */
import { prisma } from '../db/client';

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--execute');

async function main() {
  console.log(`[BACKFILL CAPI] Mode: ${DRY_RUN ? 'DRY-RUN (read-only)' : 'EXECUTE (writing to DB)'}`);

  try {
    const tenants = await prisma.tenant.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        auto_send_purchase_capi: true,
      },
    });

    console.log(`[BACKFILL CAPI] Total tenant terdeteksi: ${tenants.length}`);

    let updatedCount = 0;
    let alreadyFalseCount = 0;

    for (const t of tenants) {
      const isAutoSend = (t as any).auto_send_purchase_capi === true;
      if (isAutoSend) {
        console.log(`[TARGET] Tenant ${t.id} (${t.slug} / ${t.name}) memiliki auto_send_purchase_capi = true -> ubah ke false`);
        if (!DRY_RUN) {
          await prisma.tenant.update({
            where: { id: t.id },
            data: { auto_send_purchase_capi: false },
          });
        }
        updatedCount++;
      } else {
        alreadyFalseCount++;
      }
    }

    console.log(`[BACKFILL CAPI SUMMARY]`);
    console.log(`- Akan/telah diupdate ke false: ${updatedCount}`);
    console.log(`- Sudah false: ${alreadyFalseCount}`);
    console.log(`- Status: ${DRY_RUN ? 'DRY-RUN selesai. Gunakan flag --execute untuk menjalankan perubahan.' : 'EXECUTE selesai dengan sukses.'}`);
  } catch (err: any) {
    console.error(`[BACKFILL CAPI ERROR]:`, err.message);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main();

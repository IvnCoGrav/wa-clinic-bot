import { prisma } from '../src/db/client';
import { wahaClient } from '../src/integrations/waha/client';
import { customerService } from '../src/services/customer.service';

/**
 * Script One-Time Backfill Label Customer (Opsi A)
 * Memproses seluruh customer lama yang memiliki `labels_synced_at === null`
 * untuk dicocokkan status label-nya langsung dari WAHA.
 */
export async function runBackfillCustomerLabels(options?: { batchSize?: number }) {
  const batchSize = options?.batchSize || 50;
  console.log(`[BACKFILL LABELS] Starting backfill process (batch size: ${batchSize})...`);

  let totalProcessed = 0;
  let totalUpdated = 0;
  let hasMore = true;

  while (hasMore) {
    let unsyncedCustomers: Array<{ id: string; phone: string }> = [];
    try {
      unsyncedCustomers = await prisma.customer.findMany({
        where: { labels_synced_at: null },
        select: { id: true, phone: true },
        take: batchSize,
      });
    } catch (err: any) {
      console.warn('[BACKFILL LABELS] DB offline or query failed, attempting in-memory fallback:', err.message);
      // Fallback untuk test environment (saat DB offline / Prisma ter-mock)
      const memoryStore = customerService.getMemoryCustomers();
      unsyncedCustomers = Array.from(memoryStore.values())
        .filter((c: any) => c.labels_synced_at === null)
        .map((c: any) => ({ id: c.id, phone: c.phone }))
        .slice(0, batchSize);

    }

    if (!unsyncedCustomers || unsyncedCustomers.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`[BACKFILL LABELS] Processing batch of ${unsyncedCustomers.length} customers...`);

    for (const cust of unsyncedCustomers) {
      const chatId = `${cust.phone}@c.us`;
      try {
        const labels = await wahaClient.getChatLabels(chatId);
        const isAdmin = labels.some((l) => l.toLowerCase() === 'admin');
        const isHold = labels.some((l) => l.toLowerCase() === 'hold');

        await customerService.setLabelFlags(cust.phone, {
          isAdminLabeled: isAdmin,
          isHoldLabeled: isHold,
        });

        totalUpdated++;
      } catch (err: any) {
        console.warn(`[BACKFILL LABELS] Failed to fetch labels for ${chatId}:`, err.message);
        // Tetap set labels_synced_at agar tidak ter-stuck di loop jika WAHA error permanen untuk 1 nomor
        await customerService.setLabelFlags(cust.phone, { isAdminLabeled: false, isHoldLabeled: false }).catch(() => {});
      }
      totalProcessed++;
    }
  }

  console.log(`[BACKFILL LABELS] Backfill complete. Total processed: ${totalProcessed}, Total updated: ${totalUpdated}.`);
  return { totalProcessed, totalUpdated };
}

if (require.main === module) {
  runBackfillCustomerLabels()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[BACKFILL LABELS CRITICAL ERROR]', err);
      process.exit(1);
    });
}

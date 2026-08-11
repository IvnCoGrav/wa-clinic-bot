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
  const processedIds = new Set<string>();

  while (hasMore) {
    let unsyncedCustomers: Array<{ id: string; phone: string }> = [];
    try {
      unsyncedCustomers = await prisma.customer.findMany({
        where: {
          labels_synced_at: null,
          id: { notIn: Array.from(processedIds) },
        },
        select: { id: true, phone: true },
        take: batchSize,
      });
    } catch (err: any) {
      console.warn('[BACKFILL LABELS] DB offline or query failed, attempting in-memory fallback:', err.message);
      // Fallback untuk test environment (saat DB offline / Prisma ter-mock)
      const memoryStore = customerService.getMemoryCustomers();
      unsyncedCustomers = Array.from(memoryStore.values())
        .filter((c: any) => c.labels_synced_at === null && !processedIds.has(c.id))
        .map((c: any) => ({ id: c.id, phone: c.phone }))
        .slice(0, batchSize);
    }

    if (!unsyncedCustomers || unsyncedCustomers.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`[BACKFILL LABELS] Processing batch of ${unsyncedCustomers.length} customers...`);

    for (const cust of unsyncedCustomers) {
      processedIds.add(cust.id);
      totalProcessed++;
      const chatId = `${cust.phone}@c.us`;
      try {
        const labels = await wahaClient.getChatLabelsOrNull(chatId);
        if (labels === null) {
          console.warn(`[BACKFILL LABELS] WAHA fetch returned null for ${chatId} (WAHA down/timeout). Leaving labels_synced_at = null.`);
          continue; // Jangan set labels_synced_at agar di-retry di run berikutnya
        }

        const isAdmin = labels.some((l) => l.toLowerCase() === 'admin');
        const isHold = labels.some((l) => l.toLowerCase() === 'hold');

        await customerService.setLabelFlags(cust.phone, {
          isAdminLabeled: isAdmin,
          isHoldLabeled: isHold,
        });

        totalUpdated++;
      } catch (err: any) {
        console.warn(`[BACKFILL LABELS] Error processing ${chatId}:`, err.message);
      }
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

import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';

/**
 * LabelReconciliationService (Task 7) — re-sync label WA vs status DB.
 *
 * Label lifecycle yang benar:
 * - customer punya reservasi pending TANPA riwayat confirmed → label 'pending payment'
 * - customer punya riwayat confirmed + reservasi pending baru → label 'repeat' (bukan 'pending payment')
 * - 'new customer' dihapus saat reservasi pertama dibuat
 * - 'legacy' tidak pernah disentuh
 *
 * Cron ini membandingkan label yang terpasang di WAHA dengan status DB dan
 * memperbaiki drift (label hilang / salah). Sekaligus berperan sebagai safety-net
 * untuk kolom Customer.is_admin_labeled / is_hold_labeled (Task: event-driven
 * label sync) — meng-copy event webhook label yang mungkin terlewat.
 * Best-effort penuh; tidak pernah melempar error ke pemanggil.
 */
export class LabelReconciliationService {
  public async reconcileLabels(tenantId: string): Promise<{ driftsFound: number; driftsFixed: number }> {
    let driftsFound = 0;
    let driftsFixed = 0;

    try {
      // 1. Customer dengan ≥1 reservasi pending (label 'pending payment' / 'repeat')
      const pendingCustomers = await prisma.customer.findMany({
        where: { tenant_id: tenantId, reservations: { some: { status: 'pending' } } },
        select: { id: true, phone: true },
      });

      // 2. Customer dengan ≥1 reservasi confirmed (riwayat pembelian)
      const confirmedCustomers = await prisma.customer.findMany({
        where: { tenant_id: tenantId, reservations: { some: { status: 'confirmed' } } },
        select: { id: true, phone: true },
      });
      const confirmedPhoneSet = new Set(confirmedCustomers.map((c) => c.phone));

      for (const customer of pendingCustomers) {
        const chatId = `${customer.phone}@c.us`;
        const hasConfirmedHistory = confirmedPhoneSet.has(customer.phone);

        let currentLabels: string[] | null = null;
        try {
          currentLabels = await wahaClient.getChatLabelsOrNull(chatId);
          if (currentLabels === null) {
            console.warn(`[LABEL RECONCILIATION] getChatLabelsOrNull returned null for ${chatId} (WAHA offline/timeout). Skipping.`);
            continue;
          }
        } catch (err: any) {
          console.warn(`[LABEL RECONCILIATION] getChatLabelsOrNull failed for ${chatId}:`, err.message);
          continue;
        }

        // Safety-net kolom flag label (Task: event-driven label sync) — sync dari
        // label yang sudah di-fetch, tanpa HTTP tambahan. Meng-copy event webhook
        // label.chat.added/deleted yang mungkin terlewat.
        try {
          const isAdmin = currentLabels.some((l) => l.toLowerCase() === 'admin');
          const isHold = currentLabels.some((l) => l.toLowerCase() === 'hold');
          await prisma.customer.updateMany({
            where: { phone: customer.phone },
            data: { is_admin_labeled: isAdmin, is_hold_labeled: isHold },
          });
        } catch (err: any) {
          // DB offline — kolom flag tidak bisa di-sync; label WAHA tetap disinkronkan di path lain
        }

        const hasPendingPayment = currentLabels.some((l) => l.toLowerCase() === 'pending payment');
        const hasRepeat = currentLabels.some((l) => l.toLowerCase() === 'repeat');

        if (hasConfirmedHistory) {
          // Harus punya 'repeat', dan TIDAK boleh 'pending payment'
          if (!hasRepeat) {
            driftsFound++;
            try {
              await wahaClient.addLabel(chatId, 'repeat');
              driftsFixed++;
              console.log(`[LABEL RECONCILIATION] Added missing 'repeat' to ${chatId} (confirmed history + pending).`);
            } catch (err: any) {
              console.warn(`[LABEL RECONCILIATION] addLabel 'repeat' failed for ${chatId}:`, err.message);
            }
          }
          if (hasPendingPayment) {
            driftsFound++;
            try {
              await wahaClient.removeLabel(chatId, 'pending payment');
              driftsFixed++;
              console.log(`[LABEL RECONCILIATION] Removed stale 'pending payment' from ${chatId} (repeat order).`);
            } catch (err: any) {
              console.warn(`[LABEL RECONCILIATION] removeLabel 'pending payment' failed for ${chatId}:`, err.message);
            }
          }
        } else {
          // Customer baru (belum ada riwayat confirmed) → harus punya 'pending payment'
          if (!hasPendingPayment) {
            driftsFound++;
            try {
              await wahaClient.addLabel(chatId, 'pending payment');
              driftsFixed++;
              console.log(`[LABEL RECONCILIATION] Added missing 'pending payment' to ${chatId}.`);
            } catch (err: any) {
              console.warn(`[LABEL RECONCILIATION] addLabel 'pending payment' failed for ${chatId}:`, err.message);
            }
          }
        }
      }

      console.log(`[LABEL RECONCILIATION] Done. Drifts found: ${driftsFound}, fixed: ${driftsFixed}.`);
    } catch (err: any) {
      console.warn('[LABEL RECONCILIATION] Run failed (DB offline?):', err.message);
    }

    return { driftsFound, driftsFixed };
  }
}

export const labelReconciliationService = new LabelReconciliationService();
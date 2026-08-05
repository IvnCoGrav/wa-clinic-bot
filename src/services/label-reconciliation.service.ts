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
 * memperbaiki drift (label hilang / salah). Best-effort penuh; tidak pernah
 * melempar error ke pemanggil.
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

        let currentLabels: string[] = [];
        try {
          currentLabels = await wahaClient.getChatLabels(chatId);
        } catch (err: any) {
          console.warn(`[LABEL RECONCILIATION] getChatLabels failed for ${chatId}:`, err.message);
          continue;
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
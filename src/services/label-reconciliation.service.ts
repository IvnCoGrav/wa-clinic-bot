import { prisma } from '../db/client';

/**
 * LabelReconciliationService — re-sync internal DB flags vs status reservasi.
 *
 * Mandat Anti-Label WAHA: seluruh penandaan label HANYA di level database internal
 * (tabel Customer.labels, is_admin_labeled, is_hold_labeled). TIDAK ada pemanggilan
 * wahaClient.addLabel/removeLabel/getChatLabels.
 *
 * Cron ini membandingkan flag internal DB dengan status reservasi dan memperbaiki drift.
 * Best-effort penuh; tidak pernah melempar error ke pemanggil.
 */
export class LabelReconciliationService {
  public async reconcileLabels(tenantId: string): Promise<{ driftsFound: number; driftsFixed: number }> {
    let driftsFound = 0;
    let driftsFixed = 0;

    try {
      // 1. Customer dengan ≥1 reservasi hold → pastikan is_hold_labeled = true
      const pendingCustomers = await prisma.customer.findMany({
        where: { tenant_id: tenantId, reservations: { some: { status: 'hold' } } },
        select: { id: true, phone: true, is_hold_labeled: true },
      });

      for (const customer of pendingCustomers) {
        if (!customer.is_hold_labeled) {
          driftsFound++;
          try {
            await prisma.customer.update({ where: { id: customer.id }, data: { is_hold_labeled: true } });
            driftsFixed++;
            console.log(`[LABEL RECONCILIATION] Set is_hold_labeled=true for ${customer.phone} (has hold reservation).`);
          } catch (err: any) {
            console.warn(`[LABEL RECONCILIATION] DB update failed for ${customer.phone}:`, err.message);
          }
        }
      }

      // 2. Customer TANPA reservasi hold → pastikan is_hold_labeled = false
      const nonHoldCustomers = await prisma.customer.findMany({
        where: { tenant_id: tenantId, is_hold_labeled: true, reservations: { none: { status: 'hold' } } },
        select: { id: true, phone: true },
      });

      for (const customer of nonHoldCustomers) {
        driftsFound++;
        try {
          await prisma.customer.update({ where: { id: customer.id }, data: { is_hold_labeled: false } });
          driftsFixed++;
          console.log(`[LABEL RECONCILIATION] Cleared is_hold_labeled for ${customer.phone} (no hold reservation).`);
        } catch (err: any) {
          console.warn(`[LABEL RECONCILIATION] DB update failed for ${customer.phone}:`, err.message);
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

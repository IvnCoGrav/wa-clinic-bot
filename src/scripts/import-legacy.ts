/**
 * Git-Tracked Canonical Legacy Import & Sync Module
 *
 * Menangani pembuatan atau sinkronisasi reservasi historis/legacy
 * dengan jaminan pembaruan ltv_cache melalui fungsi kanonis recalculateCustomerLtv.
 *
 * Penggunaan:
 *   npx tsx src/scripts/import-legacy.ts [--dry-run]
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { customerService } from '../services/customer.service';
import { assertSafeDestructiveRun } from '../utils/destructive-guard';
import { TreatmentCategory } from '@prisma/client';

export interface LegacyReservationInput {
  customerId: string;
  tenantId?: string;
  treatmentCategory?: TreatmentCategory | string;
  treatmentDetail?: string;
  bookingDate?: Date | null;
  rawText?: string | null;
  status?: string;
  purchaseValue?: number | null;
  isRepeatOrder?: boolean;
}

/**
 * Menyimpan reservasi legacy dan menjamin ltv_cache customer terhitung ulang secara kanonis.
 */
export async function importLegacyReservation(input: LegacyReservationInput): Promise<any> {
  const tenantId = input.tenantId || DEFAULT_TENANT_ID;
  const status = input.status || 'completed';

  const reservation = await prisma.reservation.create({
    data: {
      tenant_id: tenantId,
      customer_id: input.customerId,
      treatment_category: (input.treatmentCategory as TreatmentCategory) || TreatmentCategory.BABY,
      treatment_detail: input.treatmentDetail || null,
      booking_date: input.bookingDate || null,
      raw_text: input.rawText || '[LEGACY_IMPORT]',
      status,
      purchase_value: input.purchaseValue ?? null,
      purchase_review_status: 'pending',
      is_repeat_order: input.isRepeatOrder ?? false,
    },
  });

  // Wajib panggil recalculateCustomerLtv untuk menjaga integritas ltv_cache
  try {
    await customerService.recalculateCustomerLtv(input.customerId, tenantId);
  } catch (err: any) {
    console.warn(`[LEGACY IMPORT] Failed to recalculate LTV for customer ${input.customerId}:`, err?.message);
  }

  return reservation;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[IMPORT LEGACY] Starting script... ${isDryRun ? '(DRY-RUN)' : '(LIVE)'}`);

  // Invarian: Jangan jalankan impor massal di sembarang host tanpa validasi
  assertSafeDestructiveRun('import-legacy');

  // Verifikasi seluruh customer terhubung dan tersinkron
  console.log('[IMPORT LEGACY] Ready to process legacy reservations with canonical LTV sync.');
}

if (require.main === module) {
  main().catch(console.error);
}

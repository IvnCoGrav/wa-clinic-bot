import { prisma } from '../db/client';

export interface PaymentProofPolicy {
  windowBeforeDays: number;
  windowAfterDays: number;
}

const DEFAULT_PAYMENT_PROOF_POLICY: PaymentProofPolicy = {
  windowBeforeDays: 7,
  windowAfterDays: 7,
};

function parsePositiveInt(val: any, fallback: number): number {
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
    return Math.round(val);
  }
  if (typeof val === 'string') {
    const parsed = parseInt(val.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return fallback;
}

/**
 * Mengambil kebijakan jendela pencocokan bukti pembayaran per-tenant dari database.
 * Menyimpan konfigurasi di JSON `Tenant.settings` (Data-driven, Zero schema migration).
 * Jika database offline atau field belum disetel, aman fallback ke 7 hari sebelum & 7 hari sesudah.
 */
export async function resolvePaymentProofPolicy(tenantId: string): Promise<PaymentProofPolicy> {
  if (!tenantId) {
    return { ...DEFAULT_PAYMENT_PROOF_POLICY };
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    if (!tenant || !tenant.settings || typeof tenant.settings !== 'object') {
      return { ...DEFAULT_PAYMENT_PROOF_POLICY };
    }

    const settings = tenant.settings as Record<string, any>;
    const windowBeforeDays = parsePositiveInt(
      settings.paymentProofWindowDaysBefore ?? settings.payment_proof_window_days_before,
      DEFAULT_PAYMENT_PROOF_POLICY.windowBeforeDays
    );
    const windowAfterDays = parsePositiveInt(
      settings.paymentProofWindowDaysAfter ?? settings.payment_proof_window_days_after,
      DEFAULT_PAYMENT_PROOF_POLICY.windowAfterDays
    );

    return {
      windowBeforeDays,
      windowAfterDays,
    };
  } catch (err: any) {
    console.warn(
      `[PAYMENT PROOF CONFIG] Gagal membaca policy tenant ${tenantId}, fallback default (7/7): ${err?.message || err}`
    );
    return { ...DEFAULT_PAYMENT_PROOF_POLICY };
  }
}

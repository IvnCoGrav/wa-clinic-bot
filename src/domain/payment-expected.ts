/**
 * domain/payment-expected.ts
 *
 * Otoritas tunggal perhitungan tagihan reservasi dan evaluasi pembayaran.
 * Menggantikan duplikasi rumus di customer-payment-proof.service dan
 * packages/admin-dashboard/src/utils/paymentProof.ts (A-002, A-014).
 *
 * expected = max(0, purchase_value - discount_amount) + delivery_fee
 */

export type PaymentStatus = 'UNVERIFIED' | 'EXACT' | 'UNDERPAID' | 'OVERPAID';

export interface ExpectedPayment {
  gross: number;
  discount: number;
  net: number;
  deliveryFee: number;
  expected: number;
  receiptAmount: number | null;
  difference: number;
  tolerance: number;
  status: PaymentStatus;
  isMismatch: boolean;
  isUnderpaid: boolean;
  isOverpaid: boolean;
}

export interface ExpectedPaymentInput {
  purchaseValue?: number | null;
  discountAmount?: number | null;
  deliveryFee?: number | null;
  receiptAmount?: number | null;
}

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Otoritas tunggal tagihan reservasi.
 * expected = max(0, purchase_value - discount_amount) + delivery_fee
 * Toleransi eksplisit untuk kode unik/pembulatan; default 0 = perilaku lama.
 */
export function resolveExpectedPayment(
  input: ExpectedPaymentInput,
  options: { tolerance?: number } = {}
): ExpectedPayment {
  const gross = money(input.purchaseValue);
  const discount = Math.min(gross, money(input.discountAmount));
  const net = Math.max(0, gross - discount);
  const deliveryFee = money(input.deliveryFee);
  const expected = net + deliveryFee;
  const receiptAmount = money(input.receiptAmount) || null;
  const tolerance = Math.max(0, Math.round(Number(options.tolerance) || 0));
  const difference = receiptAmount === null ? 0 : receiptAmount - expected;

  let status: PaymentStatus = 'UNVERIFIED';
  // Harga layanan 0 = belum diketahui → jangan menuduh kurang/lebih bayar.
  // (Perilaku lama juga tidak menandai mismatch saat purchase_value = 0.)
  if (receiptAmount !== null && gross > 0 && expected > 0) {
    if (Math.abs(difference) <= tolerance) status = 'EXACT';
    else status = difference < 0 ? 'UNDERPAID' : 'OVERPAID';
  }

  return {
    gross,
    discount,
    net,
    deliveryFee,
    expected,
    receiptAmount,
    difference,
    tolerance,
    status,
    isMismatch: status === 'UNDERPAID' || status === 'OVERPAID',
    isUnderpaid: status === 'UNDERPAID',
    isOverpaid: status === 'OVERPAID',
  };
}

/**
 * KB-6: resolver ongkir per-reservasi — utamakan snapshot `delivery_fee`,
 * fallback ke `Customer.ongkir` untuk baris lama (pra-migrasi).
 */
export function resolveDeliveryFeeSnapshot(reservation: any): number {
  const snap = (reservation as any)?.delivery_fee;
  if (typeof snap === 'number' && snap >= 0) return snap;
  const legacy = (reservation as any)?.customer?.ongkir ?? (reservation as any)?.ongkir;
  if (typeof legacy === 'number' && legacy >= 0) return legacy;
  return 0;
}

/**
 * Evaluasi tagihan kanonis untuk payload API (dipakai list, detail, livechat).
 * Murni: hanya membaca field reservasi, tanpa I/O atau state global.
 */
export function resolveReservationPaymentEvaluation(
  reservation: any,
  tolerance = 0
): ExpectedPayment {
  return resolveExpectedPayment(
    {
      purchaseValue: reservation?.purchase_value,
      discountAmount: reservation?.discount_amount,
      deliveryFee: resolveDeliveryFeeSnapshot(reservation),
      receiptAmount: reservation?.receipt_amount,
    },
    { tolerance }
  );
}


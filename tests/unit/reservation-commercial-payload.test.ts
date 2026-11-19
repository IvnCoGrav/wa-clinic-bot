import { describe, it, expect } from 'vitest';
import { buildReservationCommercialPayload } from '../../packages/admin-dashboard/src/utils/reservationCommercialPayload';
import {
  generateSeriesInvoiceText,
  seriesInvoiceParamsFromApi,
} from '../../packages/admin-dashboard/src/utils/paymentInvoiceFormatter';

/**
 * D4 (keputusan 2026-11-19): nilai yang dikirim ke Meta = GROSS.
 * Diskon TIDAK dikurangkan dari `purchaseValue`; ia dikirim terpisah sebagai
 * `discountAmount`. Regresi lama: jalur multi-sesi mengirim NET + discountAmount
 * sehingga invoice mengurangi diskon dua kali.
 */
describe('reservationCommercialPayload — kontrak GROSS + diskon terpisah', () => {
  it('mengirim GROSS apa adanya dan diskon terpisah (bukan NET)', () => {
    expect(buildReservationCommercialPayload(700000, 30000)).toEqual({
      purchaseValue: 700000,
      discountAmount: 30000,
    });
  });

  it('tanpa diskon tetap mengirim GROSS penuh', () => {
    expect(buildReservationCommercialPayload(150000, 0)).toEqual({
      purchaseValue: 150000,
      discountAmount: 0,
    });
  });

  it('diskon dijepit ke 0..gross (tidak pernah negatif / melebihi harga)', () => {
    expect(buildReservationCommercialPayload(100000, -25000)).toEqual({
      purchaseValue: 100000,
      discountAmount: 0,
    });
    expect(buildReservationCommercialPayload(100000, 250000)).toEqual({
      purchaseValue: 100000,
      discountAmount: 100000,
    });
  });

  it('input string / NaN / null aman dan tidak menghasilkan nilai negatif', () => {
    expect(buildReservationCommercialPayload('250000', '10000')).toEqual({
      purchaseValue: 250000,
      discountAmount: 10000,
    });
    expect(buildReservationCommercialPayload('bukan-angka', 'bukan-angka')).toEqual({
      purchaseValue: 0,
      discountAmount: 0,
    });
    expect(buildReservationCommercialPayload(null, null)).toEqual({
      purchaseValue: 0,
      discountAmount: 0,
    });
    expect(buildReservationCommercialPayload(-50000, 10000)).toEqual({
      purchaseValue: 0,
      discountAmount: 0,
    });
  });

  it('paket multi-sesi: invoice mengurangi diskon TEPAT SEKALI', () => {
    const commercial = buildReservationCommercialPayload(700000, 30000);
    const params = seriesInvoiceParamsFromApi(
      {
        id: 'series_1',
        treatment_name: 'Paket Newborn 7 Hari',
        total_sessions: 2,
        purchase_value: commercial.purchaseValue,
        delivery_fee: 15000,
        discount_amount: commercial.discountAmount,
        reservations: [
          { session_number: 1, booking_date: '2026-12-01T02:00:00.000Z' },
          { session_number: 2, booking_date: '2026-12-03T02:00:00.000Z' },
        ],
      },
      { name: 'Bunda Sinta', phone: '081938252933', address: 'Jl. Melati 1' }
    );

    const text = generateSeriesInvoiceText(params as any);
    // 700.000 + (2 x 15.000) - 30.000 = 700.000
    expect(text).toContain('Paket (2 Sesi) = 700.000');
    expect(text).toContain('Ongkir (2 kunjungan @ 15.000) = 30.000');
    expect(text).toContain('Diskon = - 30.000');
    expect(text).toContain('Total = 700.000');
  });

  it('jika payload keliru mengirim NET + diskon, invoice menunjukkan selisih ganda (dokumentasi regresi)', () => {
    const params = seriesInvoiceParamsFromApi({
      id: 'series_legacy',
      treatment_name: 'Paket Newborn 7 Hari',
      total_sessions: 2,
      purchase_value: 670000, // NET (bug lama)
      delivery_fee: 0,
      discount_amount: 30000,
      reservations: [{ session_number: 1, booking_date: '2026-12-01T02:00:00.000Z' }],
    });

    const text = generateSeriesInvoiceText(params as any);
    // 670.000 - 30.000 = 640.000, padahal tagihan sebenarnya 670.000.
    expect(text).toContain('Total = 640.000');
  });
});

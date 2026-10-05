import { describe, it, expect } from 'vitest';
import { executeCalculateDelivery } from '../../../src/v3/tools/calculate-delivery.tool';

/**
 * Insiden Rizky 6285236127747 — pin lokasi WhatsApp native.
 * Teks pin yang MENGALIR ke V3 = "[Shared Location: lat, lng]" (machine.ts:613).
 * Sebelumnya tool jatuh ke geocoding nama-daerah → minta kelurahan padahal
 * koordinat sudah di tangan. Offline: reverseGeocode gazetteer (no network).
 */
describe('Calculate Delivery — Pin lokasi WhatsApp native', () => {
  const PIN = '[Shared Location: -7.33108377456665, 112.68679809570312]';

  it('teks pin [Shared Location: lat, lng] → isPrecise + ongkir (bukan minta kelurahan)', async () => {
    const out = await executeCalculateDelivery({ locationText: PIN, asksDeliveryFee: true });
    expect(out.success).toBe(true);
    expect(out.isPrecise).toBe(true);
    expect(typeof out.distanceKm).toBe('number');
    expect(out.kelurahan).toBe('Balas Klumprik');
    expect(out.message).toMatch(/jangkauan|berhasil diidentifikasi/);
    expect(out.message).not.toMatch(/tanyakan nama kelurahan|belum dapat ditemukan/i);
  });

  it('format kanonis [LOCATION: Lat ..., Lng ...] juga terselesaikan', async () => {
    const out = await executeCalculateDelivery({
      locationText: '[LOCATION: Lat -7.33108377456665, Lng 112.68679809570312]',
      asksDeliveryFee: true,
    });
    expect(out.success).toBe(true);
    expect(out.isPrecise).toBe(true);
    expect(out.kelurahan).toBe('Balas Klumprik');
  });

  it('[LIVE_LOCATION: Lat ..., Lng ...] terselesaikan', async () => {
    const out = await executeCalculateDelivery({
      locationText: '[LIVE_LOCATION: Lat -7.33108377456665, Lng 112.68679809570312]',
      asksDeliveryFee: true,
    });
    expect(out.success).toBe(true);
    expect(out.isPrecise).toBe(true);
  });

  it('pin di luar jangkauan → success + isOutOfCoverage (bukan minta kelurahan)', async () => {
    const out = await executeCalculateDelivery({ locationText: '[Shared Location: -6.2, 106.816666]' });
    expect(out.success).toBe(true);
    expect(out.isOutOfCoverage).toBe(true);
  });

  it('teks pasangan harga titik-koma BUKAN diperlakukan sebagai pin koordinat', async () => {
    const out = await executeCalculateDelivery({ locationText: 'harga 75.000, 100.000 ya kak' });
    expect(out.isPrecise).not.toBe(true);
  });
});

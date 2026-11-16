import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeCalculateDelivery, hasSpecificAddressDetail } from '../../src/v3/tools/calculate-delivery.tool';

/**
 * Perbaikan fondasional kebocoran substring wilayah (kasus "tertarik" → Kecamatan Tarik).
 * Matcher geocoding DILARANG mencocokkan kata berimbuhan Indonesia sebagai nama daerah.
 * Data-driven (gazetteer), tanpa daftar hafalan kalimat.
 */
describe('calculate_delivery — anti-false-positive substring wilayah', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('"saya tertarik" TIDAK dianggap Kecamatan Tarik (kata berimbuhan)', async () => {
    const res = await executeCalculateDelivery({ locationText: 'saya tertarik' });
    expect(String(res.message || '')).not.toMatch(/Tarik/);
    expect(res.isOutOfCoverage).toBe(false);
  });

  it('"kembali" TIDAK dianggap kota luar Bali', async () => {
    const res = await executeCalculateDelivery({ locationText: 'saya kembali ke sini' });
    expect(res.isOutOfCoverage).toBe(false);
  });

  it('"daerah tarik" tetap dikenali sebagai Kecamatan Tarik (kata utuh)', async () => {
    const res = await executeCalculateDelivery({ locationText: 'daerah tarik' });
    expect(String(res.message || '')).toMatch(/Tarik/);
  });

  it('hasSpecificAddressDetail: "warung" tidak dianggap detail alamat Waru', () => {
    expect(hasSpecificAddressDetail('rumah saya di waru')).toBe(false);
    expect(hasSpecificAddressDetail('Jambangan Persada')).toBe(true);
  });

  it('hasSpecificAddressDetail: typo 1-huruf nama kecamatan bukan detail alamat (paritas isTypoAtMostOne)', () => {
    // Substitusi, sisipan, dan penghapusan 1 huruf atas nama kecamatan kanonis.
    expect(hasSpecificAddressDetail('menganti memganti')).toBe(false);
    expect(hasSpecificAddressDetail('menganti mengantii')).toBe(false);
    expect(hasSpecificAddressDetail('menganti mengant')).toBe(false);
    // Detail alamat sah di samping nama kecamatan tetap terdeteksi.
    expect(hasSpecificAddressDetail('menganti persada')).toBe(true);
  });

  it('"di tenggilis mejoyo" tetap ter-resolve (frasa multi-kata)', async () => {
    const res = await executeCalculateDelivery({ locationText: 'di tenggilis mejoyo' });
    expect(String(res.message || '').toLowerCase()).toMatch(/tenggilis/i);
  });
});

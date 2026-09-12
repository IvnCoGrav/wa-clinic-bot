import { describe, it, expect } from 'vitest';
import { executeCalculateDelivery } from '../../../src/v3/tools/calculate-delivery.tool';

/**
 * Audit 694493 — Anti-premature invoicing di calculate_delivery:
 * priceDiscussed=false (konsultasi) HANYA jarak + ongkir, tanpa nota.
 * priceDiscussed=true (transaksional) memuat rekap + grand total.
 * Offline-safe: URL koordinat langsung ter-resolve tanpa network.
 */
describe('calculate_delivery priceDiscussed gate (audit 694493)', () => {
  const cart = [
    { name: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)', price: 95000, promoPrice: 75000 },
  ];
  const loc = 'https://www.google.com/maps/@-7.340000,112.720000,17z';

  it('mode konsultasi (false) -> tanpa rincian nota / grand total', async () => {
    const out = await executeCalculateDelivery({
      locationText: loc,
      cartSnapshot: cart,
      priceDiscussed: false,
    });
    expect(out.success).toBe(true);
    expect(out.suggestedTemplateReply || '').not.toMatch(/Rincian layanan yang Bunda pilih/i);
    expect(out.suggestedTemplateReply || '').not.toMatch(/Total keseluruhan/i);
    expect(out.message).not.toMatch(/Hitungkan total biaya/i);
  });

  it('mode transaksional (true) -> rekap + grand total muncul', async () => {
    const out = await executeCalculateDelivery({
      locationText: loc,
      cartSnapshot: cart,
      priceDiscussed: true,
    });
    expect(out.success).toBe(true);
    expect(out.suggestedTemplateReply || '').toMatch(/Rincian layanan yang Bunda pilih/i);
    expect(out.suggestedTemplateReply || '').toMatch(/Total keseluruhan/i);
  });
});

import { describe, it, expect } from 'vitest';
import {
  buildOngkirQuickReplies,
  DEFAULT_QUICK_REPLIES,
  buildDefaultQuickRepliesForTenant,
} from '../../src/routes/admin/quick-replies.subroute';

/** Cfg-007: template ongkir & jam/alamat harus data-driven, bukan hardcode. */
describe('Quick Reply data-driven (Cfg-007)', () => {
  it('membangun ongkir dari tier tenant (bukan nominal hafalan)', () => {
    const items = buildOngkirQuickReplies([
      { maxDist: 5, fee: 0, promoDiscount: 0 },
      { maxDist: 10, fee: 20000, promoDiscount: 5000 },
    ]);
    const km3 = items.find((i) => i.shortcut === 'ongkir3')!;
    const km8 = items.find((i) => i.shortcut === 'ongkir8')!;
    expect(km3.title).toContain('Gratis');
    expect(km8.title).toContain('15.000');
    expect(km8.content).toContain('20.000');
  });

  it('tier kosong → tidak menghasilkan template ongkir (fail-safe)', () => {
    expect(buildOngkirQuickReplies([])).toEqual([]);
  });

  it('template default bebas hardcode jam & tarif per-km', () => {
    const blob = JSON.stringify(DEFAULT_QUICK_REPLIES);
    expect(blob).not.toContain('08.00 - 17.00');
    expect(blob).not.toContain('Rp 3.000/km');
    expect(blob).toContain('{operational_hours}');
    expect(blob).toContain('{delivery_summary}');
  });

  it('seed per tenant memakai tier tenant (mock DB fallback file tetap jalan)', async () => {
    const items = await buildDefaultQuickRepliesForTenant('tenant-qr');
    expect(items.some((i) => i.shortcut === 'ongkir1')).toBe(true);
    expect(items.some((i) => i.shortcut === 'qris')).toBe(true);
  });
});

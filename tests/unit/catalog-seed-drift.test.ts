import { describe, it, expect } from 'vitest';
import { DEFAULT_CLINIC_SERVICES } from '../../src/services/treatment-catalog.service';
import { DEFAULT_CLINIC_SERVICES_FALLBACK } from '../../packages/admin-dashboard/src/utils/treatmentParser';

/**
 * #128-FaseA (A2) — Guard anti-drift katalog.
 *
 * Dashboard `DEFAULT_CLINIC_SERVICES_FALLBACK` WAJIB berasal dari SATU sumber
 * (JSON hasil `npm run catalog:seed` yang di-generate dari backend
 * `DEFAULT_CLINIC_SERVICES`). Test ini gagal bila salinan drift lagi — paksa
 * regenerate (`npm run catalog:seed`) daripada menyunting manual.
 */
describe('#128-FaseA — anti-drift katalog backend vs fallback dashboard', () => {
  const activeBackend = DEFAULT_CLINIC_SERVICES.filter((s) => s.isActive);

  it('jumlah item = jumlah layanan AKTIF backend (single source)', () => {
    expect(DEFAULT_CLINIC_SERVICES_FALLBACK.length).toBe(activeBackend.length);
  });

  it('setiap id layanan aktif backend ada di fallback dashboard', () => {
    const feIds = new Set(DEFAULT_CLINIC_SERVICES_FALLBACK.map((s) => s.id));
    const missing = activeBackend.filter((s) => !feIds.has(s.id)).map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it('tidak ada id fallback yang tidak dikenal backend', () => {
    const beIds = new Set(DEFAULT_CLINIC_SERVICES.map((s) => s.id));
    const extra = DEFAULT_CLINIC_SERVICES_FALLBACK.filter((s) => !beIds.has(s.id)).map((s) => s.id);
    expect(extra).toEqual([]);
  });

  it('fallback TIDAK memuat layanan nonaktif (anti-normalisasi ke item mati)', () => {
    const inactiveIds = new Set(DEFAULT_CLINIC_SERVICES.filter((s) => !s.isActive).map((s) => s.id));
    const leaked = DEFAULT_CLINIC_SERVICES_FALLBACK.filter((s) => inactiveIds.has(s.id)).map((s) => s.id);
    expect(leaked).toEqual([]);
  });

  it('field kritis (nama, harga, durasi, kategori) identik per id', () => {
    const beById = new Map(DEFAULT_CLINIC_SERVICES.map((s) => [s.id, s]));
    for (const fe of DEFAULT_CLINIC_SERVICES_FALLBACK) {
      const be = beById.get(fe.id);
      expect(be, `id ${fe.id} hilang di backend`).toBeDefined();
      expect(fe.name).toBe(be!.name);
      expect(fe.originalPrice).toBe(be!.originalPrice);
      expect(fe.promoPrice).toBe(be!.promoPrice);
      expect(fe.durationMinutes).toBe(be!.durationMinutes);
      expect(fe.category).toBe(be!.category);
    }
  });
});

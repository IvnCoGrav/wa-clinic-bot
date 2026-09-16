import { describe, it, expect } from 'vitest';
import { shouldExcludeFromCapiQueue } from '../../src/utils/dummy-filter';

/**
 * Fase 1' — Isolasi total sandbox dari antrean Meta CAPI Queue.
 * Kebijakan presentasi GET /api/admin/capi-queue: baris milik customer
 * QA test (is_sandbox_test) ATAU nomor dummy TIDAK BOLEH tampil di antrean
 * kerja Advertiser. Pengiriman aktual ke Meta tetap dijaga CAPI GUARD di
 * capi.service.ts — ini menutup kebocoran di lapis daftar.
 */
describe('CAPI queue sandbox isolation (Fase 1)', () => {
  it('mengecualikan customer dengan is_sandbox_test=true', () => {
    expect(shouldExcludeFromCapiQueue('6281234567890', 'Bunda Asli', true)).toBe(true);
  });

  it('mengecualikan nomor simulator 6289999* walau flag belum ter-set', () => {
    expect(shouldExcludeFromCapiQueue('628999985269', 'Bunda', false)).toBe(true);
    expect(shouldExcludeFromCapiQueue('628999985269', 'Bunda', undefined)).toBe(true);
  });

  it('mengecualikan varian dummy simulator lain (628129999*, 08571111*)', () => {
    expect(shouldExcludeFromCapiQueue('6281299991234', 'Bunda', false)).toBe(true);
    expect(shouldExcludeFromCapiQueue('08571111222', 'Bunda', false)).toBe(true);
  });

  it('MELOLOSKAN customer asli (nomor valid + flag false)', () => {
    expect(shouldExcludeFromCapiQueue('6282229353440', 'Bunda Lutfia', false)).toBe(false);
    expect(shouldExcludeFromCapiQueue('6281234567891', 'Bunda Asli', undefined)).toBe(false);
  });

  it('defensif terhadap nilai kosong ( Funktor tidak melempar )', () => {
    expect(() => shouldExcludeFromCapiQueue(undefined, undefined, undefined)).not.toThrow();
    // Tanpa identitas yang valid → dianggap dummy (fail-closed).
    expect(shouldExcludeFromCapiQueue(undefined, undefined, undefined)).toBe(true);
  });
});

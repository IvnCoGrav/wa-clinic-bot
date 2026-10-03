import { describe, it, expect } from 'vitest';
import { resolveTreatmentValue } from '../../src/services/capi.service';

/**
 * D.2 (audit #199) — nilai transaksi CAPI DILARANG memakai angka baku hardcode.
 * Bila kategori tak ketemu di katalog → undefined (event Meta tanpa nilai),
 * BUKAN nominal karangan (mis. 100000/70000/60000).
 */
describe('D.2 — resolveTreatmentValue anti hardcode', () => {
  it('teks MOMS tak ada di katalog → TIDAK mengembalikan 100000 baku', async () => {
    const v = await resolveTreatmentValue('moms sesuatu yang tidak ada di katalog xyz', 'default-tenant');
    expect(v).not.toBe(100000);
  });

  it('teks KIDS tak ada di katalog → TIDAK mengembalikan 70000 baku', async () => {
    const v = await resolveTreatmentValue('anak xyz tidak dikenal', 'default-tenant');
    expect(v).not.toBe(70000);
  });

  it('teks BABY tak ada di katalog → TIDAK mengembalikan 60000 baku', async () => {
    const v = await resolveTreatmentValue('bayi xyz tidak dikenal', 'default-tenant');
    expect(v).not.toBe(60000);
  });
});

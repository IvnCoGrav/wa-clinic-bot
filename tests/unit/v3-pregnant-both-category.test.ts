import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../src/v3/tools/get-catalog.tool';

/**
 * Fase 1 lanjutan — gerbang keselamatan bumil harus berlaku LINTAS KATEGORI
 * (MOMS / BOTH / kosong) dan memakai minggu kehamilan dari sesi walau konteks
 * turn sepi. Bukan tambal-kalimat: gerbang pada state.
 */
const ids = (res: any): string[] => (res.treatments || []).map((t: any) => t.id);

describe('v3 PREGNANT safety lintas kategori', () => {
  it('category BOTH + minggu 28 + kontraksi → induksi TIDAK bocor', async () => {
    const res = await executeGetCatalog(
      { category: 'BOTH', momStage: 'PREGNANT', symptoms: ['kontraksi', 'kencang'] } as any,
      'default-tenant',
      { momStage: 'PREGNANT', gestationalWeeks: 28 }
    );
    expect(ids(res)).not.toContain('moms-induksi-massage');
    expect(ids(res)).not.toContain('moms-induksi-fullbody');
  });

  it('category kosong + PREGNANT + minggu 28 → induksi TIDAK bocor', async () => {
    const res = await executeGetCatalog(
      { momStage: 'PREGNANT', symptoms: ['kontraksi'] } as any,
      'default-tenant',
      { momStage: 'PREGNANT', gestationalWeeks: 28 }
    );
    expect(ids(res)).not.toContain('moms-induksi-fullbody');
    expect(ids(res)).not.toContain('moms-induksi-massage');
  });

  it('minggu kehamilan dari SESI dipakai walau argumen tool kosong', async () => {
    // Aterm (38) via sesi → induksi diizinkan untuk keluhan kontraksi.
    const late = await executeGetCatalog(
      { category: 'MOMS', momStage: 'PREGNANT', symptoms: ['kontraksi'] } as any,
      'default-tenant',
      { momStage: 'PREGNANT', gestationalWeeks: 38 }
    );
    expect(ids(late).some((id) => id.startsWith('moms-induksi'))).toBe(true);

    // Pre-term (28) via sesi → induksi DIBLOK walau keluhan sama.
    const early = await executeGetCatalog(
      { category: 'MOMS', momStage: 'PREGNANT', symptoms: ['kontraksi'] } as any,
      'default-tenant',
      { momStage: 'PREGNANT', gestationalWeeks: 28 }
    );
    expect(ids(early).some((id) => id.startsWith('moms-induksi'))).toBe(false);
  });

  it('BOTH + hamil umum (tanpa minggu) → Pregnant Massage ada, induksi tidak', async () => {
    const res = await executeGetCatalog(
      { category: 'BOTH', momStage: 'PREGNANT', symptoms: ['pegal', 'kaki bengkak'] } as any,
      'default-tenant',
      { momStage: 'PREGNANT' }
    );
    expect(ids(res)).toContain('moms-prenatal-massage');
    expect(ids(res)).not.toContain('moms-induksi-massage');
    expect(ids(res)).not.toContain('moms-induksi-fullbody');
  });
});

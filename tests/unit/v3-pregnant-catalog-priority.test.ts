import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../src/v3/tools/get-catalog.tool';

/**
 * Fase 1 (Clinical Safety): ibu hamil umum DILARANG ditawari layanan induksi
 * persalinan (merangsang kontraksi) kecuali sudah aterm (>=37 minggu) atau
 * customer eksplisit memintanya. Gerbang = STATE (minggu kehamilan + pemahaman
 * semantik specificTreatmentName), bukan hafalan kalimat user.
 */
const ids = (res: any): string[] => (res.treatments || []).map((t: any) => t.id);

describe('v3 PREGNANT catalog clinical priority', () => {
  it('ibu hamil umum (tanpa minggu) → Pregnant Massage peringkat #1', async () => {
    const res = await executeGetCatalog(
      { category: 'MOMS', momStage: 'PREGNANT', symptoms: ['pegal', 'kaki bengkak'] } as any,
      'default-tenant'
    );
    expect(res.success).toBe(true);
    expect(res.treatments?.[0]?.id).toBe('moms-prenatal-massage');
  });

  it('keluhan capek/pegal tanpa minggu → induksi TIDAK masuk pool', async () => {
    const res = await executeGetCatalog(
      { category: 'MOMS', momStage: 'PREGNANT', symptoms: ['capek', 'pegal pinggang'] } as any,
      'default-tenant'
    );
    expect(ids(res)).not.toContain('moms-induksi-massage');
    expect(ids(res)).not.toContain('moms-induksi-fullbody');
  });

  it('minggu 38 (aterm) dari sesi → induksi DIIZINKAN', async () => {
    const res = await executeGetCatalog(
      { category: 'MOMS', momStage: 'PREGNANT', symptoms: ['kontraksi'] } as any,
      'default-tenant',
      { momStage: 'PREGNANT', gestationalWeeks: 38 }
    );
    expect(ids(res).some((id) => id.startsWith('moms-induksi'))).toBe(true);
  });

  it('minggu 28 dari sesi + kontraksi → induksi TIDAK bocor (pre-term)', async () => {
    const res = await executeGetCatalog(
      { category: 'MOMS', momStage: 'PREGNANT', symptoms: ['kontraksi', 'kencang'] } as any,
      'default-tenant',
      { momStage: 'PREGNANT', gestationalWeeks: 28 }
    );
    expect(ids(res)).not.toContain('moms-induksi-massage');
    expect(ids(res)).not.toContain('moms-induksi-fullbody');
  });

  it('eksplisit minta "induksi massage" (tanpa minggu) → diizinkan', async () => {
    const res = await executeGetCatalog(
      { category: 'MOMS', momStage: 'PREGNANT', specificTreatmentName: 'induksi massage' } as any,
      'default-tenant'
    );
    expect(ids(res).some((id) => id.startsWith('moms-induksi'))).toBe(true);
  });

  it('perineum: minggu 20 → tidak bocor; minggu 36 → boleh', async () => {
    const early = await executeGetCatalog(
      { category: 'MOMS', momStage: 'PREGNANT', symptoms: ['perineum', 'robekan'] } as any,
      'default-tenant',
      { momStage: 'PREGNANT', gestationalWeeks: 20 }
    );
    expect(ids(early)).not.toContain('moms-perineum-massage');

    const late = await executeGetCatalog(
      { category: 'MOMS', momStage: 'PREGNANT', symptoms: ['perineum', 'robekan'] } as any,
      'default-tenant',
      { momStage: 'PREGNANT', gestationalWeeks: 36 }
    );
    expect(ids(late)).toContain('moms-perineum-massage');
  });

  it('adversarial multi-frasa: 5 ragam keluhan bumil umum → semua tanpa induksi', async () => {
    const frasa = [
      ['ngilu', 'punggung'],
      ['badan pegel', 'lelah'],
      ['kaki bengkak', 'susah tidur'],
      ['kram', 'pinggang'],
      ['mual', 'capek'],
    ];
    for (const symptoms of frasa) {
      const res = await executeGetCatalog(
        { category: 'MOMS', momStage: 'PREGNANT', symptoms } as any,
        'default-tenant'
      );
      expect(ids(res), `symptoms=${symptoms.join(',')}`).not.toContain('moms-induksi-fullbody');
      expect(ids(res), `symptoms=${symptoms.join(',')}`).not.toContain('moms-induksi-massage');
    }
  });
});

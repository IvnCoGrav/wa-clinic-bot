import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';

/**
 * Fase 4' — Anti-kaset rusak skrining keluhan (Turn 8).
 * Bila keluhan SUDAH diketahui sesi ("Biasa kembung") namun LLM lupa mengisi
 * args.symptoms, tool tetap DILARANG menanyakan ulang skrining dan WAJIB
 * mengarahkan penjelasan manfaat untuk keluhan tersebut.
 * Offline: katalog in-memory, tanpa DB/network.
 */
describe('get_catalog knownSymptoms anti-kaset rusak (Fase 4)', () => {
  it('Turn 8: keluhan sesi "kembung" → tidak tanya ulang skrining', async () => {
    const out = await executeGetCatalog(
      { category: 'KIDS' as any },
      'default-tenant',
      { knownSymptoms: ['kembung'] }
    );
    expect(out.success).toBe(true);
    expect(out.message).not.toMatch(/apakah saat ini si kecil sedang ada keluhan/i);
    expect(out.message).not.toMatch(/pijat sehat relaksasi saja/i);
    expect(out.message).toMatch(/kembung/i);
    expect(out.suggestedConsultationReply).toBeUndefined();
  });

  it('kontrol: tanpa keluhan → pemantik klinis tetap ditanya', async () => {
    const out = await executeGetCatalog({ category: 'KIDS' as any });
    expect(out.success).toBe(true);
    expect(out.message).toMatch(/keluhan sakit/i);
  });

  it('kontrol: args.symptoms eksplisit tetap menekan skrining ulang', async () => {
    const out = await executeGetCatalog({ symptoms: ['batuk'] });
    expect(out.success).toBe(true);
    expect(out.message).not.toMatch(/apakah saat ini si kecil sedang ada keluhan/i);
  });
});

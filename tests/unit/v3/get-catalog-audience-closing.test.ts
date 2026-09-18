import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';

/**
 * Plan regresi Fase 5 — panduan penutup audience-aware (anti kaset rusak).
 * Layanan/konteks ibu DILARANG ditutup skrining batuk/pilek bayi; kebutuhan
 * yang sudah dibahas DILARANG ditanya ulang. Kontrak closingIntent
 * dipertahankan (nama intent tak berubah — state-gated pruning lestari).
 */
describe('get_catalog_and_price — audience-aware closing (Fase 5)', () => {
  it('konteks MOMS → CLINICAL_PROBE versi Bunda, tanpa skrining bayi', async () => {
    const out = await executeGetCatalog({ category: 'MOMS' }, 'default-tenant', undefined);
    expect(out.success).toBe(true);
    expect(out.closingIntent).toBe('CLINICAL_PROBE');
    expect(out.message).toMatch(/Bunda/i);
    // Kata "batuk/pilek" boleh muncul HANYA di kalimat LARANGAN meta-instruksi
    // ("DILARANG membawa topik ..."), bukan sebagai ajakan skrining bayi.
    expect(out.message).not.toMatch(/tanyakan apakah.*si kecil/i);
    expect(out.message).not.toMatch(/si kecil.*keluhan|keluhan.*si kecil/i);
    expect(out.message).not.toMatch(/pijat sehat relaksasi saja Bunda\? 🤗/);
  });

  it('momStage eksplisit → CLINICAL_PROBE versi Bunda', async () => {
    const out = await executeGetCatalog({ momStage: 'POSTPARTUM' }, 'default-tenant', undefined);
    expect(out.success).toBe(true);
    expect(out.closingIntent).toBe('CLINICAL_PROBE');
    expect(out.message).not.toMatch(/si kecil/i);
  });

  it('REGRESI GUARD: konteks anak default → CLINICAL_PROBE versi si kecil lestari', async () => {
    const out = await executeGetCatalog({}, 'default-tenant', undefined);
    expect(out.success).toBe(true);
    expect(out.closingIntent).toBe('CLINICAL_PROBE');
    expect(out.message).toMatch(/si kecil/i);
  });

  it('discussedTreatments terisi → DILARANG skrining ulang, ada penanda SUDAH dibahas', async () => {
    const out = await executeGetCatalog(
      {},
      'default-tenant',
      { discussedTreatments: ['Breast + Oksitosin Fullbody Massage'] }
    );
    expect(out.success).toBe(true);
    expect(out.closingIntent).toBe('CLINICAL_PROBE');
    expect(out.message).toMatch(/SUDAH dibahas/i);
    expect(out.message).not.toMatch(/batuk\/pilek|batuk, pilek/i);
  });

  it('suggestedConsultationReply konteks MOMS tanpa "si kecil"', async () => {
    const out = await executeGetCatalog({ category: 'MOMS' }, 'default-tenant', undefined);
    expect(out.success).toBe(true);
    // Mode konsultasi (tanpa harga): template panduan ada di message.
    expect(out.message).toMatch(/Panduan sistem/i);
    expect(out.message).not.toMatch(/kondisi si kecil/i);
  });
});

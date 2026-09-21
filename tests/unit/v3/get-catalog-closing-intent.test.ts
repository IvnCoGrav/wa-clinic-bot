import { describe, it, expect } from 'vitest';
import {
  executeGetCatalog,
  type CatalogClosingIntent,
} from '../../../src/v3/tools/get-catalog.tool';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';

/**
 * Kontrak data closingIntent (pengganti prose closingGuide):
 * SATU intent deterministik per pemanggilan tool, diturunkan dari state
 * (kecocokan klinis × asksDuration × lokasi sesi × nominal) — BUKAN dari
 * kalimat user. State-gated pruning: hanya direktif intent terpilih yang
 * dikirim ke LLM; cabang kontradiktif disembunyikan di level kode.
 */
describe('get_catalog_and_price — closingIntent data contract', () => {
  const expectIntent = async (
    input: Parameters<typeof executeGetCatalog>[0],
    sessionCtx: Parameters<typeof executeGetCatalog>[2],
    intent: CatalogClosingIntent
  ) => {
    const out = await executeGetCatalog(input, 'default-tenant', sessionCtx);
    expect(out.success).toBe(true);
    expect(out.closingIntent).toBe(intent);
    return out;
  };

  it('gejala tanpa cocok klinis (sawan) → SAFETY_NO_MATCH, tanpa ajakan jadwal', async () => {
    const out = await expectIntent({ symptoms: ['sawan'] }, undefined, 'SAFETY_NO_MATCH');
    expect(out.closingSymptoms).toContain('sawan');
    // Klarifikasi ruang lingkup komplementer + rujukan medis, bukan klaim sembuh.
    expect(out.message).toMatch(/komplementer/i);
    expect(out.message).toMatch(/dokter|faskes/i);
    // Larangan keras mengajak jadwal saat tak ada jawaban klinis.
    expect(out.message).not.toMatch(/konfirmasi jadwal|hari kunjungan/i);
  });

  it('keselamatan menang atas durasi: sawan + asksDuration → SAFETY_NO_MATCH', async () => {
    await expectIntent({ symptoms: ['sawan'], asksDuration: true }, undefined, 'SAFETY_NO_MATCH');
  });

  it('tanya durasi (ada cocok klinis) → STATEMENT_ONLY_DURATION, tanpa todong hari', async () => {
    const out = await expectIntent(
      { symptoms: ['batuk', 'pilek'], asksDuration: true },
      undefined,
      'STATEMENT_ONLY_DURATION'
    );
    expect(out.message).not.toMatch(/konfirmasi jadwal|hari kunjungan|hari apa/i);
  });

  it('lokasi belum diketahui + usia single-tier (sudah diketahui 3 bln) → ASK_DOMICILE, DILARANG todong hari', async () => {
    const out = await expectIntent(
      { symptoms: ['batuk', 'pilek'], childAgeMonths: 3 },
      undefined,
      'ASK_DOMICILE'
    );
    expect(out.message).toMatch(/domisili|daerah|kecamatan/i);
    expect(out.message).not.toMatch(/konfirmasi jadwal|hari kunjungan|hari apa/i);
  });

  it('lokasi sudah diketahui (kelurahan) + usia single-tier → ASK_SCHEDULE', async () => {
    const out = await expectIntent(
      { symptoms: ['batuk', 'pilek'], childAgeMonths: 3 },
      { kelurahan: 'Kutisari', ongkirStatus: 'OK' },
      'ASK_SCHEDULE'
    );
    expect(out.message).toMatch(/hari/i);
  });

  it('SESI 783810: keluhan multi-tier TANPA usia → CLINICAL_PROBE usia (di atas tanya domisili/jadwal)', async () => {
    const out = await expectIntent({ symptoms: ['batuk', 'pilek'] }, undefined, 'CLINICAL_PROBE');
    // Usia adalah penentu paket (Bayi vs Anak); domisili/jadwal menyusul.
    expect(out.message).toMatch(/usia|umur|berbulan-bulan|bertahun-tahun/i);
    expect(out.closingSymptoms).toContain('batuk');
  });

  it('nominal cocok tanpa gejala → PRICE_SUBJECT_CLARIFY (nominal dari katalog runtime)', async () => {
    const sample = treatmentCatalogService
      .getAllServices(true)
      .filter((s) => !s.isAddon)
      .find((s) => typeof s.promoPrice === 'number');
    expect(sample).toBeDefined();
    const out = await expectIntent({ targetPrice: sample!.promoPrice } as any, undefined, 'PRICE_SUBJECT_CLARIFY');
    expect(out.message).toMatch(/Bunda atau si kecil/i);
  });

  it('tanpa gejala & tanpa nominal → CLINICAL_PROBE generik', async () => {
    const out = await expectIntent({ childAgeMonths: 6 }, undefined, 'CLINICAL_PROBE');
    expect(out.message).toMatch(/keluhan|relaksasi/i);
  });
});

import { describe, it, expect } from 'vitest';
import { executeGetCatalog, GET_CATALOG_TOOL_SCHEMA } from '../../../src/v3/tools/get-catalog.tool';
import { buildScheduleHierarchyBlock } from '../../../src/v3/agent/prompt/phases/router-direct-reply.layer';
import { buildScheduleNegConstraintsHead } from '../../../src/v3/agent/prompt/phases/scheduling.phase';
import { OutputSanitizer } from '../../../src/v3/guardrails/sanitizer';

/**
 * Audit sesi 993955 — penegakan mandat anti-overfitting & anti-hafalan-pola.
 *
 * BAGIAN A (DETERMINISTIK — dieksekusi di gate offline):
 *   A1. Otoritas klinis DB & anti-pembajakan parameter (get_catalog_and_price)
 *   A2. State-gated prompt pruning (lokasi diketahui → 5a dicabut)
 *   A3. Kuota sapaan deterministik
 *
 * BAGIAN B (LLM-DEPENDEN — di-skip; DAFTAR UNTUK DIJALANKAN MANUAL):
 *   B1. Atomic tool routing
 *   B2. Amnesia lokasi via balasan LLM nyata
 *   Jalankan manual: hapus `.skip` + set LLM API key, atau via `npm run chat`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// BAGIAN A — DETERMINISTIK
// ─────────────────────────────────────────────────────────────────────────────

describe('A1. Otoritas klinis DB — kembung DILARANG dibajak specificTreatmentName (993955)', () => {
  const KNOWN_BAHAYA = 'Pijat Lahap Juara';

  it('keluhan KEMBUNG + specificTreatmentName bajakan → isRecommendedForSymptoms di index 0, bukan Lahap', async () => {
    const out = await executeGetCatalog({
      category: 'KIDS',
      childAgeMonths: 36,
      symptoms: ['kembung'],
      specificTreatmentName: KNOWN_BAHAYA,
      inquirePrice: false,
    });
    expect(out.success).toBe(true);
    // Layanan medis resmi teratas harus ada & tertandai rekomendasi gejala.
    expect(out.treatments.length).toBeGreaterThan(0);
    expect(out.treatments[0].isRecommendedForSymptoms).toBe(true);
    expect(out.treatments[0].name.toLowerCase()).not.toContain('lahap');
    // "Pijat Lahap Juara" DILARANG memimpin untuk kembung.
    const top = out.treatments[0].name.toLowerCase();
    expect(top).not.toContain('nafsu makan');
  });

  it('variasi parafrase keluhan kembung tetap mengembalikan terapi, bukan penambah nafsu makan', async () => {
    for (const phrase of ['perut si kecil kembung dan begah', 'bisa buat anak yg kembung gak?']) {
      const out = await executeGetCatalog({
        category: 'KIDS',
        childAgeMonths: 36,
        symptoms: [phrase],
        inquirePrice: false,
      });
      const rec = out.treatments.find((t) => t.isRecommendedForSymptoms);
      expect(rec, `frasa "${phrase}" tidak menghasilkan rekomendasi`).toBeTruthy();
      expect(rec!.name.toLowerCase()).not.toContain('lahap');
    }
  });

  it('tanpa keluhan: filter nama spesifik eksplisit TETAP berlaku (intent sempit menang)', async () => {
    // Tahan rebrand Kala: token legacy 'juara' tak ada di katalog kini (hanya 'Lahap') — debt alias legacy di KNOWN_ISSUES.
    const out = await executeGetCatalog({
      category: 'KIDS',
      childAgeMonths: 36,
      specificTreatmentName: 'Pijat Lahap',
      inquirePrice: false,
    });
    expect(out.success).toBe(true);
    // Semua hasil harus keluarga Lahap (nama dipertahankan saat tak ada gejala).
    expect(out.treatments.length).toBeGreaterThan(0);
    for (const t of out.treatments) {
      expect(t.name.toLowerCase()).toContain('lahap');
    }
  });

  it('schema specificTreatmentName: larangan isi dari riwayat turn sebelumnya', () => {
    const desc: string = GET_CATALOG_TOOL_SCHEMA.function.parameters.properties.specificTreatmentName.description;
    expect(desc).toMatch(/SAAT INI/i);
    expect(desc).toMatch(/symptoms saja|keluhan fisik/i);
  });
});

describe('A2. State-gated prompt pruning — lokasi diketahui mencabut 5a (993955)', () => {
  const knownSession = {
    location: { rawText: 'Dupak Pasar Turi', kecamatan: 'Pabean Cantian', kota: 'Surabaya' },
  };

  it('Call 1 hierarchy: lokasi diketahui → TIDAK memuat cabang "LOKASI BELUM DIKETAHUI"', () => {
    const block = buildScheduleHierarchyBlock(knownSession);
    expect(block).not.toContain('LOKASI BELUM DIKETAHUI');
    expect(block).toContain('LOKASI SUDAH DIKETAHUI: Dupak Pasar Turi');
    expect(block).toMatch(/DILARANG KERAS menanyakan lokasi\/daerah rumah lagi/i);
  });

  it('Call 1 hierarchy: lokasi belum diketahui → cabang 5a aktif, aturan jadwal lokasi-diketahui TIDAK muncul', () => {
    const block = buildScheduleHierarchyBlock({ location: undefined });
    expect(block).toContain('5a. (PRIORITAS 1 — LOKASI BELUM DIKETAHUI)');
    expect(block).toMatch(/DILARANG berjanji mengecek jadwal sebelum domisili diketahui/i);
    // Cabang ter-gate lokasi-diketahui tidak boleh hadir.
    expect(block).not.toContain('ATURAN JADWAL (LOKASI SUDAH DIKETAHUI');
  });

  it('Call 2 neg-constraints: lokasi diketahui → 5a dicabut, penegasan status tersimpan ada', () => {
    const head = buildScheduleNegConstraintsHead(knownSession);
    expect(head).not.toContain('LOKASI BELUM DIKETAHUI');
    expect(head).toMatch(/SUDAH TERSIMPAN di sistem/i);
    expect(head).toMatch(/DILARANG KERAS menanyakan lokasi/i);
  });

  it('Call 2 neg-constraints: lokasi belum diketahui → alur 5a utuh', () => {
    const head = buildScheduleNegConstraintsHead({ location: undefined });
    expect(head).toContain('LOKASI BELUM DIKETAHUI');
    expect(head).toMatch(/menanyakan daerah rumah/i);
  });

  it('tanpa argumen sesi → render kanonis (kompatibilitas, memuat 5a)', () => {
    const head = buildScheduleNegConstraintsHead();
    expect(head).toContain('LOKASI BELUM DIKETAHUI');
  });
});

describe('A3. Kuota sapaan deterministik (993955 Turn 9)', () => {
  it('3x Bunda di chat lanjutan → maksimal 1, kalimat tetap utuh', () => {
    const out = OutputSanitizer.sanitizeFollowUpGreetingRepetition(
      'Baik Bunda, kami catat ya Bunda, nanti kami infokan Bunda',
      true
    );
    expect((out.match(/\bBunda\b/gi) || []).length).toBeLessThanOrEqual(1);
    expect(out).toContain('nanti kami infokan');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BAGIAN B — LLM-DEPENDEN (SKIP; jalankan manual)
// ─────────────────────────────────────────────────────────────────────────────

describe.skip('B1. Atomic tool routing (manual — butuh LLM live)', () => {
  it('"Kalau balita 2 tahun kena biaya berapa?" → HANYA get_catalog_and_price, tanpa get_clinic_policy_faq', () => {
    // Verifikasi via log llm-*.jsonl: toolsCalled pada V3_ROUTING turn tsb
    // harus tepat 1 tool (get_catalog_and_price). Balasan TIDAK memuat
    // metode pembayaran (Transfer/QRIS/Tunai) yang tidak ditanya.
    expect(true).toBe(true);
  });
});

describe.skip('B2. Anti-amnesia lokasi via balasan LLM (manual — butuh LLM live)', () => {
  it('lokasi "Dupak Pasar Turi" sudah ada → "masih ada kuota?" TIDAK menanyakan alamat lagi', () => {
    // Jalankan skenario sesi 993955 lewat `npm run chat`; assertion:
    // balasan tidak memuat frasa tanya domisili ("rumah Bunda di daerah mana").
    expect(true).toBe(true);
  });

  it('variasi parafrase jadwal (kuota/free/nanti sore) semuanya bebas amnesia', () => {
    // Input: "Mau tanya hari ini masih ada kuota?", "sore ini ada bidan yang free?",
    //        "jadwal nanti sore jam 3 bisa?" — dengan sesi ber-lokasi Dupak Pasar Turi.
    expect(true).toBe(true);
  });
});

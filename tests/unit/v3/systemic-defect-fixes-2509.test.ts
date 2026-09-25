import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../../src/v3/guardrails/sanitizer';
import {
  validateFactualClaims,
  stripAmnesiaQuestions,
} from '../../../src/v3/guardrails/factual-claim-validator';

/**
 * Regresi adversarial audit 25-09 (4 defect sistemik):
 *  Isu 1 — kebocoran string teknis RAG + tag HTML.
 *  Isu 2 — false-positive deflection D3 pada perbandingan layanan.
 *  Isu 3 — kaset rusak tanya ulang keluhan pasca-reprompt.
 *  Isu 4 — bug trimmer (pushEnd non-monotonic) → pelanggaran 3 kalimat.
 */

describe('Isu 4 — trimmer kalimat (pushEnd non-monotonic)', () => {
  it('batas emoji paragraf 1 + tanda baca paragraf 2 tetap dihitung → pangkas ke 3 kalimat', () => {
    const text =
      'Halo Bunda 😊\n\nKami sarankan pijat bayi. Sangat bagus untuk kembung. Bisa kami jadwalkan besok.';
    const out = OutputSanitizer.trimToMaxSentences(text, 3);
    const sentences = out.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(out).toContain('Halo Bunda');
    expect(out).toContain('kembung');
    expect(out).not.toContain('jadwalkan besok');
  });

  it('emoji akhir kalimat di paragraf awal tidak dibuang walau tanda baca muncul lebih dulu', () => {
    // Emoji di idx kecil; titik-titik di idx besar → dulu emoji ditolak guard monotonik.
    const text = 'Pagi Bunda 🌸\n\nKami bantu cek ya. Semoga harimu menyenangkan. Terima kasih.';
    const out = OutputSanitizer.trimToMaxSentences(text, 3);
    const sentences = out.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(out).toContain('Pagi Bunda');
  });

  it('teks ≤3 kalimat tetap tidak disentuh (anti over-trim)', () => {
    const text = 'Halo Bunda 😊 Ada yang bisa kami bantu?';
    expect(OutputSanitizer.trimToMaxSentences(text, 3)).toBe(text);
  });
});

describe('Isu 1 — kebocoran string teknis RAG & artefak instruksi internal', () => {
  it('balasan yang MURNI deferral teknis → string kosong (bukan teks mentah)', () => {
    const out = OutputSanitizer.stripVagueTeamDeferral(
      'Karena data FAQ belum tersedia, kami cekkan dulu ya.'
    );
    expect(out).toBe('');
  });

  it('deferral + kalimat valid → kalimat valid dipertahankan', () => {
    const out = OutputSanitizer.stripVagueTeamDeferral(
      'Baik Bunda, usia 6 bulan aman untuk dipijat. Informasinya akan kami cek dulu ke tim kami ya.'
    );
    expect(out).toMatch(/aman untuk dipijat/i);
    expect(out).not.toMatch(/cek dulu ke tim/i);
  });

  it('pesan instruksi tool RAG yang disalin verbatim → dibuang level kalimat', () => {
    const raw =
      'Tidak ditemukan artikel FAQ spesifik untuk query "gtm". Panduan Bidan: jawab ramah. DILARANG MENAMBAHKAN PERTANYAAN JADWAL (Aturan Emas 6).';
    const out = OutputSanitizer.stripInternalInstructionArtifacts(raw);
    expect(out).toBe('');
  });

  it('instruksi internal bocor bersama substansi → substansi tetap', () => {
    const raw =
      'Baik Bunda, pijat bayi aman untuk si kecil. Tidak ditemukan artikel FAQ spesifik untuk query "gtm".';
    const out = OutputSanitizer.stripInternalInstructionArtifacts(raw);
    expect(out).toMatch(/pijat bayi aman/i);
    expect(out).not.toMatch(/tidak ditemukan artikel/i);
  });

  it('cleanOutboundReply tidak meloloskan leak RAG + <br><br><br>', () => {
    const raw = 'Tidak ditemukan artikel FAQ spesifik untuk query "gtm".<br><br><br>';
    const out = OutputSanitizer.cleanOutboundReply(raw);
    expect(out.toLowerCase()).not.toContain('tidak ditemukan artikel');
    expect(out).not.toMatch(/<br/i);
  });

  it('kalimat customer sah tanpa artefak tidak disentuh (anti-mutilasi)', () => {
    const raw = 'Kami cekkan ketersediaan jadwal hari Sabtu ya Bunda.';
    expect(OutputSanitizer.stripInternalInstructionArtifacts(raw)).toBe(raw);
  });
});

describe('Isu 3 — gerbang deterministik anti-amnesia pasca-reprompt (D9/D10)', () => {
  it('D10: kalimat tanya keluhan dibuang bila keluhan sudah diketahui', () => {
    const out = stripAmnesiaQuestions(
      'Baik Bunda, keluhan si kecil sudah kami catat ya. Boleh dibagikan keluhan atau kondisi si kecil?',
      { symptomsKnown: true }
    );
    expect(out).toMatch(/sudah kami catat/i);
    expect(out).not.toMatch(/bagikan keluhan/i);
  });

  it('D9: kalimat tanya domisili dibuang bila lokasi sudah diketahui', () => {
    const out = stripAmnesiaQuestions(
      'Baik Bunda, lokasinya sudah kami terima. Rumahnya di daerah mana ya Bunda?',
      { locationKnown: true }
    );
    expect(out).toMatch(/sudah kami terima/i);
    expect(out).not.toMatch(/daerah mana/i);
  });

  it('semua kalimat amnesia → string kosong (fallback hilir mengambil alih)', () => {
    const out = stripAmnesiaQuestions('Boleh dibagikan keluhan atau kondisi si kecil?', {
      symptomsKnown: true,
    });
    expect(out).toBe('');
  });

  it('tanpa data diketahui → tidak ada yang dibuang (state-gated)', () => {
    const raw = 'Boleh dibagikan keluhan atau kondisi si kecil?';
    expect(stripAmnesiaQuestions(raw, {})).toBe(raw);
  });

  it('variasi parafrase tanya keluhan tetap tertangkap', () => {
    const out = stripAmnesiaQuestions(
      'Baik ya Bunda. Apakah ada keluhan tertentu pada si kecil saat ini?',
      { symptomsKnown: true }
    );
    expect(out).not.toMatch(/keluhan tertentu/i);
  });
});

describe('Isu 2 — D3 perbandingan/pemilihan layanan (nama pokok tanpa prefix brand)', () => {
  const catalog = (names: string[]) => [
    {
      name: 'get_catalog_and_price',
      args: {},
      result: { success: true, treatments: names.map((n) => ({ name: n, durationMinutes: 60 })) },
    },
  ];

  it('nama pokok tanpa prefix brand diakui sebagai grounding katalog (tidak D3)', () => {
    const tools = catalog(['Kala Baby - Pijat Pulih Ceria']);
    const reply =
      'Untuk si kecil yang rewel, sebaiknya pilih perawatan Pijat Pulih Ceria ya Bunda, karena perawatan ini sangat membantu meredakan keluhan dan membuat tidurnya lebih nyenyak.';
    const r = validateFactualClaims(reply, tools);
    expect(r.isValid).toBe(true);
  });

  it('nama pokok varian token (Pijat Bayi Pulih Ceria) juga diakui', () => {
    const tools = catalog(['Kala Baby - Pijat Pulih Ceria']);
    const reply =
      'Sebaiknya ambil Pijat Bayi Pulih Ceria ya Bunda agar tidurnya nyenyak, karena perawatan ini memang difokuskan untuk membantu meredakan keluhan si kecil.';
    const r = validateFactualClaims(reply, tools);
    expect(r.isValid).toBe(true);
  });

  it('nama fiktif tetap ditolak (anti false-negative)', () => {
    const tools = catalog(['Kala Baby - Pijat Pulih Ceria']);
    const reply =
      'Sebaiknya pilih perawatan Pijat Quantum Super ya Bunda, karena perawatan ini sangat cocok untuk membantu meredakan keluhan si kecil.';
    const r = validateFactualClaims(reply, tools);
    expect(r.isValid).toBe(false);
  });

  it('anjuran SOP generik tanpa nama katalog tetap ditolak', () => {
    const tools = catalog(['Kala Baby - Pijat Pulih Ceria']);
    const reply =
      'Sebaiknya bayi dimandikan dengan air hangat setiap hari agar tidak rewel ya Bunda, supaya tidurnya juga lebih nyenyak sepanjang malam.';
    const r = validateFactualClaims(reply, tools);
    expect(r.isValid).toBe(false);
  });

  it('tanpa tool katalog (calledTools kosong) → D3 tetap menyalak', () => {
    const reply =
      'Sebaiknya pilih perawatan Pijat Pulih Ceria ya Bunda, karena perawatan ini sangat cocok untuk membantu meredakan keluhan si kecil.';
    const r = validateFactualClaims(reply, []);
    expect(r.isValid).toBe(false);
  });
});

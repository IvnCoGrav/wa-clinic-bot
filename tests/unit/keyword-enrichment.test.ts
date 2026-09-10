import { describe, it, expect } from 'vitest';
import {
  resolveChunkKeywords,
  resolveExemplarTags,
  KB_KEYWORD_RULES,
  EXEMPLAR_TAG_RULES,
} from '../../src/services/keyword-enrichment.service';
import { DEFAULT_FEW_SHOT_EXEMPLARS } from '../../src/v3/agent/few-shot-exemplars';
import { GOLD_FEW_SHOT_EXEMPLARS } from '../../src/v3/agent/gold-few-shot-exemplars';

/**
 * Kontrak Keyword Enrichment KB & Bank Chat.
 * - Seluruh judul seed-faq.ts WAJIB ter-resolve (nol baris tak cocok).
 * - Query alami pelanggan (akar kata/imbuhan/slang) tercakup keywords.
 * - In-memory bank (7 default + 25 gold) sinkron dengan tabel kurasi:
 *   setiap exemplar yang cocok aturan harus memuat tags hasil resolusi.
 * - Larangan kata generik sebagai tag (kak/bun/bunda/ya/bisa/boleh).
 */
const SEED_QUESTIONS = [
  'Dimana lokasi Kala Moms and Baby Spa?',
  'Apakah yang melakukan pijat adalah bidan bersertifikat?',
  'Berapa lama durasi treatment?',
  'Anak saya sedang pilek/batuk pilek / bapil, apakah masih bisa dipijat?',
  'Apa itu treatment sinar moksa, dan apa bedanya dengan pijat biasa?',
  'Apa saja yang perlu disiapkan sebelum treatment?',
  'Metode pembayaran apa saja yang bisa dipakai?',
  'Apa saja pilihan treatment untuk bayi/anak?',
  'Apa saja pilihan treatment untuk ibu (moms)?',
  'Bagaimana kalau saya mau reschedule atau membatalkan jadwal?',
  'Apakah saya akan diingatkan sebelum jadwal treatment?',
  'Bagaimana cara booking treatment?',
  'Apakah bisa booking untuk anak usia berapa saja?',
  'Apakah bisa booking lebih dari satu anak dalam satu jadwal?',
  'Apakah bayi sedang flu, batuk, atau pilek (bapil) boleh dipijat?',
  'Apakah bayi perlu mandi sebelum dipijat?',
  'Jika bayi sedang tidur saat Bidan Yusi datang, apakah perlu dibangunkan?',
  'Berapa lama durasi treatment pijat bayi?',
  'Apakah treatment dikerjakan langsung oleh Bidan?',
  'Di mana lokasi fisik/alamat kantor Kala Moms and Baby Spa?',
  'Bagaimana metode pembayaran yang tersedia?',
  'Bagaimana ketentuan biaya transport (ongkir) untuk wilayah Surabaya & Sidoarjo?',
  'Anak saya sedang menjalani fisioterapi, apakah aman dipijat agar tidak kaku?',
  'Apa perbedaan antara treatment Pijat Ceria (Rileksasi) dan Pijat Pulih Ceria (Terapi)?',
  'Bagaimana jika anak rewel atau menangis saat latihan tengkurap (tummy time)?',
  'Apa itu treatment Sinar Moksa / Inframerah hangat?',
  'Apakah ada terapi untuk membantu mengeluarkan dahak bayi?',
  'Kapan ibu pasca melahirkan boleh mulai dipijat?',
  'Apa manfaat dari Oksitosin Massage untuk ibu menyusui?',
  'Bagaimana penanganan lubang tindikan telinga bayi yang posisinya tidak pas (ketinggian)?',
  'Apakah bayi yang baru saja divaksin / imunisasi (seperti BCG, Polio, DPT) boleh langsung dipijat?',
  'Panduan Usia Kehamilan untuk Pijat Induksi Alami (Induksi Massage)',
  'Apakah terapis/bidan yang memijat si kecil dan Bunda sama atau berbeda orangnya?',
  'Apakah bayi yang baru jatuh atau terbentur boleh langsung dipijat?',
];

describe('resolveChunkKeywords', () => {
  it('seluruh judul seed ter-resolve (tidak ada yang null)', () => {
    for (const q of SEED_QUESTIONS) {
      expect(resolveChunkKeywords(q, null)).not.toBeNull();
    }
  });

  it('morfologi & sinonim tercakup: persiapan ↔ disiapkan/menyiapkan/perlengkapan', () => {
    const kw = resolveChunkKeywords('Apa saja yang perlu disiapkan sebelum treatment?', null) || '';
    for (const w of ['persiapan', 'disiapkan', 'menyiapkan', 'perlengkapan', 'kabel olor']) {
      expect(kw).toContain(w);
    }
  });

  it('slang klinis & pembayaran tercakup', () => {
    const bapil = resolveChunkKeywords('Anak saya sedang pilek, apakah masih bisa dipijat?', null) || '';
    expect(bapil).toContain('bapil');
    const pay = resolveChunkKeywords('Metode pembayaran apa saja yang bisa dipakai?', null) || '';
    for (const w of ['tf', 'qris', 'cash', 'tunai']) expect(pay).toContain(w);
  });

  it('keywords lama di-merge (tidak hilang)', () => {
    const kw = resolveChunkKeywords(
      'Panduan Usia Kehamilan untuk Pijat Induksi Alami (Induksi Massage)',
      '38 weeks, induksi'
    ) || '';
    expect(kw).toContain('38 weeks');
    expect(kw).toContain('aterm');
  });

  it('judul tak dikenal → null (dilaporkan, tidak diubah)', () => {
    expect(resolveChunkKeywords('xyzqwerty tidak jelas 999', null)).toBeNull();
  });
});

describe('resolveExemplarTags', () => {
  it('skenario jadwal/bayar/laktasi ter-resolve dengan variasi alami', () => {
    const sched = resolveExemplarTags('Pasien menanyakan ketersediaan jadwal di hari tertentu (Anti-Afirmasi Jadwal)', []);
    expect(sched).not.toBeNull();
    expect(sched!.tags).toContain('kapan');
    const pay = resolveExemplarTags('Pasien menanyakan metode pembayaran (Transfer / QRIS / Cash)', []);
    expect(pay!.tags).toContain('bayar pake apa');
    const lakt = resolveExemplarTags('Pasien menanyakan pijat laktasi / oksitosin untuk Ibu Menyusui', []);
    expect(lakt!.tags).toContain('menyusui');
  });

  it('tags lama di-merge (tidak hilang)', () => {
    const r = resolveExemplarTags('Customer menanyakan khasiat atau cara kerja terapi Sinar Moksa', ['sinar_moksa'])!;
    expect(r.tags).toContain('sinar_moksa');
    expect(r.tags).toContain('gimana');
  });

  it('TIDAK ada tag generik (kak/bun/bunda/ya/bisa/boleh) di tabel kurasi', () => {
    const banned = ['kak', 'bun', 'bunda', 'ya', 'bisa', 'boleh'];
    for (const rule of EXEMPLAR_TAG_RULES) {
      for (const t of rule.tags) {
        expect(banned).not.toContain(t);
      }
    }
    expect(KB_KEYWORD_RULES.length).toBeGreaterThan(20);
  });
});

describe('sinkronisasi in-memory bank ↔ tabel kurasi', () => {
  it('setiap exemplar in-memory yang cocok aturan memuat tags kurasi', () => {
    // DEFAULT sudah memuat spread GOLD — dedup berdasarkan id.
    const byId = new Map<string, (typeof GOLD_FEW_SHOT_EXEMPLARS)[0]>();
    for (const ex of [...DEFAULT_FEW_SHOT_EXEMPLARS, ...GOLD_FEW_SHOT_EXEMPLARS]) {
      if (!byId.has(ex.id)) byId.set(ex.id, ex);
    }
    const all = [...byId.values()];
    expect(all.length).toBeGreaterThan(25);
    let synced = 0;
    for (const ex of all) {
      const resolved = resolveExemplarTags(ex.scenario, []);
      if (!resolved) continue;
      synced++;
      for (const t of resolved.tags) {
        expect(ex.tags.map((x) => x.toLowerCase())).toContain(t);
      }
    }
    expect(synced).toBeGreaterThan(25);
  });

  it('respons exemplar jadwal bebas "Admin CS" dan todongan jam', () => {
    const all = [...DEFAULT_FEW_SHOT_EXEMPLARS];
    for (const ex of all) {
      expect(ex.idealResponse).not.toContain('Admin CS');
      expect(ex.idealResponse).not.toContain('perkiraan jamnya');
    }
  });
});

import { DEFAULT_TENANT_ID } from '../config/tenant';
import { isMissingKeywordsColumnError } from './knowledge.service';

/**
 * keyword-enrichment.service.ts — Single Source of Truth kata kunci retrieval.
 *
 * Latar belakang: PostgreSQL FTS proyek memakai kamus 'simple' TANPA stemming
 * bahasa Indonesia, sehingga `persiapan` ≠ `disiapkan`/`menyiapkan` dan query
 * alami pelanggan gagal cocok walau artikelnya ada. Solusi fondasionalnya adalah
 * memperkaya kolom `knowledge_chunks.keywords` (ikut diindeks FTS) dengan bentuk
 * dasar, imbuhan, sinonim, slang, dan variasi query alami — BUKAN menambah
 * regex/prompt khusus per kasus.
 *
 * Kolom `few_shot_exemplars.tags` memakai word-boundary matching
 * (isWordTagMatch), sehingga tag HARUS berupa kata/frasa yang benar-benar
 * dipakai pelanggan di chat (tanpa kata generik seperti "kak"/"bun"/"ya").
 *
 * Dipakai oleh:
 * - scripts/enrich-kb-and-bank-chat-keywords.ts (migrasi data live per tenant)
 * - src/cli/seed-faq.ts (keywords saat seed ulang)
 * - tests/unit/keyword-enrichment.test.ts (kontrak sinkronisasi in-memory)
 */

export interface KeywordRule {
  /** Fragmen judul (lowercase, includes) yang memicu aturan ini. */
  keys: string[];
  /** Daftar kata kunci komprehensif (dipisah koma saat disimpan). */
  keywords: string[];
}

const K = (s: string): string[] => s.split(',').map((t) => t.trim()).filter(Boolean);

/**
 * Aturan keywords per topik — mencakup 48 chunk FAQ live (default-tenant).
 * Semua judul seed-faq.ts WAJIB cocok minimal satu aturan (dijaga unit test).
 */
export const KB_KEYWORD_RULES: KeywordRule[] = [
  { keys: ['lokasi kala', 'lokasi fisik', 'alamat kantor', 'memiliki klinik'],
    keywords: K('lokasi, homebase, waru, sidoarjo, surabaya, homecare, alamat klinik, basecamp, domisili, datang ke rumah, area layanan, kantor, cabang, dimana') },
  { keys: ['bidan bersertifikat', 'dikerjakan langsung oleh bidan'],
    keywords: K('bidan, bersertifikat, str, terapis, kualifikasi, asli, legalitas, berpengalaman, terlatih, aman, siapa yang mijat, tenaga medis, mijat') },
  { keys: ['berapa lama durasi', 'berapa lama', 'pijet bayi ceria berapa lama'],
    keywords: K('durasi, lama, menit, 40 menit, 60 menit, jam, waktu treatment, berapa lama, lama pijat, estimasi') },
  { keys: ['bapil', 'batuk', 'pilek', 'flu'],
    keywords: K('bapil, batuk, pilek, flu, grok, hidung mampet, bersin, lendir, sesak, boleh dipijat, sakit, demam, ngorok') },
  { keys: ['moksa', 'inframerah'],
    keywords: K('moksa, sinar moksa, inframerah, terapi hangat, lampu merah, khasiat, fungsi, cara kerja, gimana, gmn, guna, manfaat, tambahan, add on, hangat') },
  { keys: ['disiapkan', 'perlengkapan', 'perlu disiapkan'],
    keywords: K('siap, persiapan, disiapkan, menyiapkan, sedia, menyediakan, perlengkapan, alat, alas tidur, perlak, kabel olor, roll kabel, colokan listrik, bawa apa saja, bawa apa, sebelum treatment, perlu bawa') },
  { keys: ['pembayaran', 'transfer', 'bayar'],
    keywords: K('bayar, pembayaran, transfer, tf, rekening, bca, mandiri, bri, qris, shopeepay, dana, gopay, ovo, cash, tunai, metode bayar, bayar pake apa, pake apa, bisa transfer') },
  { keys: ['pilihan treatment untuk bayi', 'pilihan treatment untuk anak'],
    keywords: K('treatment, pilihan, paket, pijat bayi, ceria, pulih ceria, terapi, relaksasi, kids, rekomendasi, pilih, daftar, pricelist, jenis treatment') },
  { keys: ['pilihan treatment untuk ibu', 'treatment komplit untuk ibu'],
    keywords: K('moms, ibu, hamil, bumil, pijat hamil, prenatal, oksitosin, laktasi, induksi, nifas, menyusui, pasca melahirkan, caesar, sesar, perineum, yoga, relaksasi ibu, paket ibu') },
  { keys: ['reschedule', 'membatalkan', 'diingatkan', 'reminder', 'cara booking', 'booking untuk anak', 'lebih dari satu anak', 'slot kosong'],
    keywords: K('jadwal, booking, reservasi, cara booking, reschedule, batal, cancel, ubah jadwal, reminder, diingatkan, slot, kosong, hari ini, besok, kapan, cek jadwal, keep, daftar, jadwalkan') },
  { keys: ['mandi'],
    keywords: K('mandi, sebelum mandi, sesudah mandi, setelah pijat, habis pijat, minyak, berendam, kapan mandi, boleh mandi') },
  { keys: ['tidur saat', 'sedang tidur'],
    keywords: K('tidur, bangun, dibangunkan, datang, rewel, kaget, bobo') },
  { keys: ['fisioterapi'],
    keywords: K('fisioterapi, fisio, kaku, kram, terapi, otot, tangan, kaki, tumbuh kembang, saraf') },
  { keys: ['tengkurap', 'tummy', 'rewel'],
    keywords: K('rewel, tummy time, tengkurap, menangis, nangis, latihan, cengeng, susah tidur') },
  { keys: ['dahak', 'nebulizer'],
    keywords: K('dahak, lendir, uap, nebulizer, moksa, encer, sesak, batuk berdahak, paket, harga paket, terapi uap, obat') },
  { keys: ['pasca melahirkan', 'nifas'],
    keywords: K('nifas, pasca melahirkan, paska, kapan boleh, caesar, sesar, oksitosin, pemulihan, pijat setelah lahiran') },
  { keys: ['oksitosin'],
    keywords: K('oksitosin, asi, laktasi, menyusui, lancar, payudara, breast, pijat, bengkak, sumbatan') },
  { keys: ['tindik'],
    keywords: K('tindik, telinga, anting, lubang, infeksi, posisi, ketinggian, miring, bengkak, tindik bayi') },
  { keys: ['vaksin', 'imunisasi'],
    keywords: K('vaksin, imunisasi, suntik, bcg, polio, dpt, demam, panas, jeda, tunggu, berapa hari, boleh, kipi, suntikan') },
  { keys: ['induksi'],
    keywords: K('induksi, induksi alami, pijat induksi, 37 minggu, 38 minggu, weeks, aterm, cukup bulan, hpl, oksitosin, capek, hamil trimester 3, kontraksi, pembukaan, pegal') },
  { keys: ['cukur'],
    keywords: K('cukur, gundul, cepak, rambut, selapan, model, potong, tipis, rapi, cukur bayi, harus gundul') },
  { keys: ['minyak'],
    keywords: K('minyak, telon, balsem, lotion, kulit sensitif, alergi, aman, merk, baby oil, minyak pijat') },
  { keys: ['susu'],
    keywords: K('susu, asi, formula, minum, sebelum pijat, muntah, gumoh, jeda, kenyang, boleh minum') },
  { keys: ['perbedaan', 'ceria'],
    keywords: K('ceria, pulih ceria, terapi, relaksasi, perbedaan, beda, banding, pilih, mana, jenis pijat') },
  { keys: ['ongkir', 'transport'],
    keywords: K('ongkir, ongkos, transport, jarak, biaya, promo, gratis, wilayah, surabaya, sidoarjo, antar, kirim, berapa ongkir') },
  { keys: ['60rb', '60 rb'],
    keywords: K('60rb, 60000, harga, promo, pricelist, paket, berapa, tarif') },
  { keys: ['tumbuh gigi'],
    keywords: K('tumbuh gigi, gigi, gusi, rewel, demam, boleh dipijat, gusinya bengkak') },
  { keys: ['pilihan tambahan'],
    keywords: K('tambahan, paket, kombinasi, moksa, nebulizer, add on, plus') },
  // Baris non-informatif (basa-basi) — keywords minimal khas agar tidak mencemari FTS.
  { keys: ['info lagi', 'tanya tanya', 'tanyakan suami'],
    keywords: K('basa basi, nanti, pending, mikir dulu, kabari lagi') },
];

/**
 * Selesaikan keywords untuk sebuah judul chunk: gabungan (union, dedup) semua
 * aturan yang cocok + keywords yang sudah ada (dipertahankan). Null bila tidak
 * ada aturan yang cocok (baris dilaporkan, tidak diubah).
 */
export function resolveChunkKeywords(title: string, existing?: string | null): string | null {
  const lower = (title || '').toLowerCase();
  if (!lower) return null;
  const collected: string[] = [];
  const seen = new Set<string>();
  const push = (kw: string): void => {
    const t = kw.trim().toLowerCase();
    if (t && !seen.has(t)) { seen.add(t); collected.push(t); }
  };
  for (const rule of KB_KEYWORD_RULES) {
    if (rule.keys.some((k) => lower.includes(k))) {
      for (const kw of rule.keywords) push(kw);
    }
  }
  if (collected.length === 0) return null;
  for (const part of String(existing || '').split(',')) push(part);
  return collected.join(', ');
}

export interface ExemplarTagRule {
  /** Fragmen scenario (lowercase, includes) yang memicu aturan ini. */
  keys: string[];
  /** Tag lengkap hasil pengayaan (union dengan existing saat diterapkan). */
  tags: string[];
  /** Ganti scenario lama → baru (mis. hapus istilah internal). Opsional. */
  scenarioReplace?: { from: string; to: string };
}

/**
 * Aturan tag per skenario bank chat — kata/frasa alami pelanggan
 * (word-boundary matching; DILARANG kata generik: kak/bun/bunda/ya/bisa/boleh).
 */
export const EXEMPLAR_TAG_RULES: ExemplarTagRule[] = [
  { keys: ['batuk / pilek / flu / grok'],
    tags: ['consult_symptom', 'flu', 'batuk', 'pilek', 'grok', 'gejala', 'bapil', 'hidung', 'mampet', 'bersin', 'ngorok', 'lendir hidung', 'sesak'] },
  { keys: ['ketersediaan jadwal di hari tertentu'],
    tags: ['ask_schedule', 'schedule', 'jadwal', 'sabtu', 'minggu', 'besok', 'tanggal', 'kapan', 'lusa', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'slot kosong'] },
  { keys: ['metode pembayaran (transfer / qris / cash)', 'metode pembayaran (qris / transfer / tunai)'],
    tags: ['payment', 'qris', 'transfer', 'cash', 'tunai', 'bayar', 'bca', 'mandiri', 'bri', 'tf', 'rekening', 'metode', 'pake', 'pakai', 'shopeepay', 'dana', 'gopay', 'ovo', 'bayar pake apa'] },
  { keys: ['pijat laktasi / oksitosin', 'ibu menyusui agar asi lancar'],
    tags: ['laktasi', 'oksitosin', 'ibu', 'moms', 'asi', 'menyusui', 'nifas', 'payudara', 'breast', 'bengkak', 'sumbatan', 'lancar', 'ibu menyusui', 'perawatan_ibu'] },
  { keys: ['jam layanan'],
    tags: ['jam_operasional', 'jam', 'operasional', 'buka', 'tutup', 'batas', 'malam', 'pukul', 'siang', 'sore', 'pagi', 'malam hari'] },
  { keys: ['lokasi/basecamp'],
    tags: ['lokasi', 'homecare', 'basecamp', 'domisili', 'alamat', 'waru', 'kec', 'kel', 'desa', 'perum', 'sidoarjo', 'surabaya', 'jarak', 'dimana', 'mana', 'daerah', 'kota', 'datang', 'rumah', 'kantor', 'cabang'] },
  { keys: ['asal klinik'],
    tags: ['ask_clinic_origin', 'asal', 'homebase', 'posisi', 'sus', 'bidan', 'lokasi_klinik', 'lokasi', 'dimana', 'mana', 'daerah', 'kota', 'datang', 'rumah', 'kantor', 'cabang'] },
  { keys: ['ketersediaan slot/jadwal terdekat'],
    tags: ['ask_schedule', 'jadwal', 'slot', 'ketersediaan', 'hari', 'cek', 'kosong', 'kapan', 'terdekat', 'tanggal', 'lusa'],
    scenarioReplace: { from: 'Customer menanyakan ketersediaan slot/jadwal terdekat (cek dulu ke Admin CS)', to: 'Customer menanyakan ketersediaan slot/jadwal terdekat (cekkan tim Bidan dulu)' } },
  { keys: ['penuh — tawarkan alternatif'],
    tags: ['ask_schedule', 'jadwal', 'penuh', 'full', 'ganti_hari', 'reschedule', 'habis', 'jadwal lain', 'ganti hari'] },
  { keys: ['tarif/harga'],
    tags: ['ask_price', 'harga', 'tarif', 'biaya', 'pricelist', 'rp', 'ribu', 'rb', 'ongkos', 'total'] },
  { keys: ['kebersihan/sterilisasi', 'higienis'],
    tags: ['higienis', 'steril', 'bersih', 'alat', 'aman', 'kebersihan', 'sterilisasi', 'infeksi', 'kuman', 'alat steril'] },
  { keys: ['kualifikasi/kelegalan', 'bidan & terapis'],
    tags: ['bidan', 'str', 'sertifikat', 'terapis', 'kualifikasi', 'resmi', 'legalitas', 'mijat', 'terlatih', 'pengalaman', 'bidan asli'] },
  { keys: ['setelah imunisasi/vaksin', 'imunisasi/vaksin'],
    tags: ['vaksin', 'imunisasi', 'pasca_vaksin', 'konsultasi', 'demam', 'kia', 'suntik', 'bcg', 'polio', 'dpt', 'panas', 'jeda', 'tunggu'] },
  { keys: ['rewel / sulit tidur'],
    tags: ['rewel', 'susah_tidur', 'tidur', 'konsultasi', 'tenang', 'adaptasi', 'nangis', 'menangis', 'begadang', 'cengeng'] },
  { keys: ['usia minimal'],
    tags: ['usia', 'newborn', 'umur', 'minimal', 'aman', 'usia_minimal', '3_minggu', 'bulan', 'baru lahir', 'lahir', 'tahun', 'bayi baru lahir'] },
  { keys: ['balita / anak usia', 'kids'],
    tags: ['kids', 'balita', 'anak', 'kids_spa', 'usia', 'perawatan_anak', 'tahun', 'umur', 'tk', 'paud'] },
  { keys: ['belum tersedia', 'tolak santun'],
    tags: ['tidak_tersedia', 'belum_ada', 'cuci_hidung', 'layanan_luar', 'tolak', 'eskalasi', 'nasal', 'nebulizer', 'uap', 'tidak bisa'] },
  { keys: ['membatalkan/menunda'],
    tags: ['batal', 'cancel', 'menunda', 'tidak_papa', 'follow_up', 'penundaan', 'batalin', 'undur', 'tunda', 'lain kali', 'acara', 'halangan'] },
  { keys: ['meminta dikonfirmasi (keep jadwal)', 'keep jadwal'],
    tags: ['afirmasi', 'konfirmasi', 'keep', 'setuju', 'booking', 'follow_up', 'deal', 'fix', 'ambil jadwal'] },
  { keys: ['mengubah pilihan treatment'],
    tags: ['ubah', 'ganti', 'treatment', 'konfirmasi', 'follow_up', 'pilihan', 'tukar', 'tambah', 'kurang'] },
  { keys: ['bingung memilih treatment'],
    tags: ['rekomendasi', 'pilih', 'bingung', 'treatment', 'saran', 'cocok', 'bagus', 'mending'] },
  { keys: ['feedback positif', 'kabar/feedback'],
    tags: ['feedback', 'testimoni', 'terima_kasih', 'follow_up', 'senang', 'alhamdulillah', 'nyenyak'] },
  { keys: ['terima kasih / menutup'],
    tags: ['terima_kasih', 'makasih', 'tutup', 'sopan', 'salam', 'thank', 'thanks', 'suwun'] },
  { keys: ['sinar moksa'],
    tags: ['sinar_moksa', 'moksa', 'inframerah', 'terapi_hangat', 'hangat', 'khasiat', 'fungsi', 'gimana', 'gmn', 'cara kerja', 'guna', 'manfaat'] },
];

export interface ResolvedExemplarTags {
  tags: string[];
  scenario?: string;
}

/**
 * Selesaikan tags untuk sebuah scenario: union aturan yang cocok + existing.
 * Null bila tidak ada aturan yang cocok (baris dilaporkan, tidak diubah).
 */
export function resolveExemplarTags(scenario: string, existing?: string[]): ResolvedExemplarTags | null {
  const lower = (scenario || '').toLowerCase();
  if (!lower) return null;
  const collected: string[] = [];
  const seen = new Set<string>();
  const push = (t: string): void => {
    const v = String(t || '').trim().toLowerCase();
    if (v && !seen.has(v)) { seen.add(v); collected.push(v); }
  };
  let scenarioOut: string | undefined;
  let matched = false;
  for (const rule of EXEMPLAR_TAG_RULES) {
    if (rule.keys.some((k) => lower.includes(k.toLowerCase()))) {
      matched = true;
      for (const t of rule.tags) push(t);
      if (rule.scenarioReplace && lower.includes(rule.scenarioReplace.from.toLowerCase())) {
        scenarioOut = rule.scenarioReplace.to;
      }
    }
  }
  if (!matched) return null;
  for (const t of existing || []) push(t);
  const out: ResolvedExemplarTags = { tags: collected };
  if (scenarioOut) out.scenario = scenarioOut;
  return out;
}

export interface EnrichStats {
  chunksScanned: number;
  chunksUpdated: number;
  chunksUnmatched: string[];
  exemplarsScanned: number;
  exemplarsUpdated: number;
  exemplarsUnmatched: string[];
}

/**
 * Terapkan enrichment ke satu tenant (dipakai skrip CLI; dryRun = laporkan saja).
 */
export async function enrichTenantKeywords(
  tenantId: string = DEFAULT_TENANT_ID,
  opts?: { dryRun?: boolean }
): Promise<EnrichStats> {
  const stats: EnrichStats = {
    chunksScanned: 0, chunksUpdated: 0, chunksUnmatched: [],
    exemplarsScanned: 0, exemplarsUpdated: 0, exemplarsUnmatched: [],
  };
  const dryRun = Boolean(opts?.dryRun);
  const { prisma } = await import('../db/client');

  const chunks = await (prisma as any).knowledgeChunk.findMany({
    where: { tenant_id: tenantId },
    select: { id: true, title: true, keywords: true },
  });
  let keywordsColumnOk = true;
  for (const c of chunks) {
    stats.chunksScanned++;
    const resolved = resolveChunkKeywords(c.title, c.keywords);
    if (!resolved) {
      stats.chunksUnmatched.push(c.title);
      continue;
    }
    if ((c.keywords || '') === resolved) continue;
    if (dryRun) {
      stats.chunksUpdated++;
      continue;
    }
    if (!keywordsColumnOk) continue;
    try {
      await (prisma as any).knowledgeChunk.update({
        where: { id: c.id },
        data: { keywords: resolved },
      });
      stats.chunksUpdated++;
    } catch (err: any) {
      if (isMissingKeywordsColumnError(err)) {
        keywordsColumnOk = false;
        console.warn('[ENRICH] Kolom knowledge_chunks.keywords belum ada di DB ini — lewati sisa update keywords (jalankan migrasi 20260907000000).');
      } else {
        throw err;
      }
    }
  }

  const exemplars = await (prisma as any).fewShotExemplar.findMany({
    where: { tenant_id: tenantId },
    select: { id: true, scenario: true, tags: true },
  });
  for (const e of exemplars) {
    stats.exemplarsScanned++;
    const resolved = resolveExemplarTags(e.scenario, e.tags || []);
    if (!resolved) {
      stats.exemplarsUnmatched.push(e.scenario);
      continue;
    }
    const sameTags = JSON.stringify([...(e.tags || [])].sort()) === JSON.stringify([...resolved.tags].sort());
    const sameScenario = !resolved.scenario || resolved.scenario === e.scenario;
    if (sameTags && sameScenario) continue;
    if (dryRun) {
      stats.exemplarsUpdated++;
      continue;
    }
    await (prisma as any).fewShotExemplar.update({
      where: { id: e.id },
      data: {
        tags: resolved.tags,
        ...(resolved.scenario ? { scenario: resolved.scenario } : {}),
      },
    });
    stats.exemplarsUpdated++;
  }
  return stats;
}

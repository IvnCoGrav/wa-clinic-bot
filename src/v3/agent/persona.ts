import type { CustomerGoalSession } from '../state/goal-tracker';
import { getGazetteerAreas } from '../../utils/gazetteer';
import {
  composeRouterPrompt,
  composeRouterPromptAsync,
  composeSystemPrompt,
  composeSystemPromptAsync,
  STABLE_PREFIX_MARKER,
} from './prompt/prompt-composer';
import type {
  DynamicPromptExemplar,
  DynamicPromptResult,
  RouterPromptOpts,
  SystemPromptOpts,
} from './prompt/prompt-composer';

/**
 * Fast rule-based intent extractor (0 token) untuk Bank Chat & summarizer V3.
 * Berbasis keyword/gazetteer data-driven (tanpa daftar regex intent yang rapuh).
 * BUKAN gatekeeper perilaku LLM — hanya sinyal seleksi exemplar & ringkasan konteks.
 */
export function extractFastIntents(text: string): string[] {
  const lower = (text || '').toLowerCase();
  if (!lower.trim()) return [];
  const intents: string[] = [];
  const hasAnyWord = (words: string[]) => words.some((w) => lower.includes(w));

  // Harga / biaya — disambiguasi dari pertanyaan ukuran/durasi/kuantitas umum.
  // "berapa minggu / berapa bulan / berapa lama" BUKAN sinyal harga.
  // ask_price hanya terpicu oleh token nominal/rupiah eksplisit ATAU kata
  // "berapa/brp" yang didampingi kata biaya/harga dalam pesan yang sama.
  // Catatan mandat regex: 'rp' dicek via token kata utuh (split spasi), bukan /\brp\b/.
  // Kata "cukur" saja BUKAN sinyal harga — lihat cost-words di bawah.
  const asksDuration = hasAnyWord(['menit', 'durasi', 'berapa lama', 'brp lama', 'brp menit', 'lama pijat', 'lama perawatan']);
  const stripEdge = (t: string): string => {
    let s = t;
    while (s.length > 0) {
      const c = s.charCodeAt(0);
      const isAlnum = (c >= 48 && c <= 57) || (c >= 97 && c <= 122);
      if (isAlnum) break;
      s = s.slice(1);
    }
    while (s.length > 0) {
      const c = s.charCodeAt(s.length - 1);
      const isAlnum = (c >= 48 && c <= 57) || (c >= 97 && c <= 122);
      if (isAlnum) break;
      s = s.slice(0, -1);
    }
    return s;
  };
  const tokens = lower.split(' ').map(stripEdge).filter((t) => t.length > 0);
  const hasRpToken = tokens.includes('rp');
  const hasNominalToken = tokens.some((t) => {
    if (t === 'rp' || t === 'ribu' || t === 'rb' || t === 'juta' || t === 'jt') return true;
    const hasDigit = t.includes('0') || t.includes('1') || t.includes('2') || t.includes('3') || t.includes('4') || t.includes('5') || t.includes('6') || t.includes('7') || t.includes('8') || t.includes('9');
    if (!hasDigit) return false;
    // Token nominal WAJIB diawali angka (mis. "50rb", "75k", "900k"). Token
    // alfanumerik yang diawali huruf (mis. kode alamat "K5", "B2", "RT3")
    // BUKAN nominal — anti false-positive pada pesan lokasi/alamat.
    const firstChar = t.charCodeAt(0);
    const startsWithDigit = firstChar >= 48 && firstChar <= 57;
    if (!startsWithDigit) return false;
    return t.includes('rb') || t.includes('ribu') || t.includes('juta') || t.includes('jt') || t.includes('rp') || t.includes('k');
  });
  const hasExplicitCostWord = hasAnyWord(['biaya', 'hrga', 'harga', 'tarif', 'ongkir', 'pricelist', 'ribu', 'bayar', 'promo', 'diskon', 'total', 'totalnya']);
  const mentionsBerapa = lower.includes('berapa') || tokens.includes('brp');
  // Semantik interogatif Indonesia: kata tanya "berapa" secara default adalah
  // pertanyaan NOMINAL/harga. Ia BUKAN harga HANYA bila terikat satuan
  // non-moneter (durasi/usia/kuantitas/jarak) yang mengikutinya.
  //
  // Catatan mandat (Anti-Overfitting): daftar `NON_MONETARY_FOLLOWERS` di bawah
  // adalah pengecualian berbatas yang diakui sebagai tech debt — idealnya
  // satuan dideteksi via taksonomi unit terpusat (lihat KNOWN_ISSUES). Namun
  // arah logika ini FONDASIONAL: dari "butuh kata biaya" (whitelist rapuh) ke
  // "berapa = harga by-default", sehingga varian tanpa kata biaya eksplisit
  // ("ke kenjeran berapa") tetap dikenali sebagai pertanyaan harga.
  const NON_MONETARY_FOLLOWERS = [
    'menit', 'jam', 'lama', 'bln', 'bulan', 'mgg', 'minggu', 'hari', 'thn', 'tahun',
    'usia', 'umur', 'anak', 'org', 'orang', 'pasien', 'bidan', 'terapis', 'sesi',
    'kali', 'km', 'kilo', 'meter', 'jauh', 'jarak'
  ];
  // Satuan non-moneter boleh dipisahkan oleh filler ringan ("berapa SIH lama...").
  const FILLERS = new Set(['sih', 'ya', 'kah', 'dong', 'deh', 'itu', 'nih', 'sih?', 'ya?']);
  // Satuan non-moneter juga boleh MENDAPAHUI berapa (urutan alami "usia berapa",
  // "umur brp") — bukan hanya membuntuti ("berapa usia"). "usia berapa minimal
  // boleh dipijat" adalah pertanyaan usia, BUKAN harga.
  const isNonMonetaryBerapa = mentionsBerapa && tokens.some((tok, idx) => {
    if (tok !== 'berapa' && tok !== 'brp') return false;
    let k = idx + 1;
    // lewati filler
    while (k < tokens.length && FILLERS.has(tokens[k])) k++;
    const nextTok = tokens[k] || '';
    const prevTok = idx > 0 ? tokens[idx - 1] : '';
    return NON_MONETARY_FOLLOWERS.includes(nextTok) || NON_MONETARY_FOLLOWERS.includes(prevTok);
  });
  // "berapa" telanjang/umum (bukan durasi & bukan satuan non-moneter) = harga.
  const isGeneralPriceBerapa = mentionsBerapa && !asksDuration && !isNonMonetaryBerapa;
  if (!asksDuration && (hasExplicitCostWord || hasRpToken || hasNominalToken || isGeneralPriceBerapa)) {
    intents.push('ask_price');
  }
  // Durasi / spesifikasi layanan (misal "pijat bayi biasanya brp menit")
  if (asksDuration) {
    intents.push('ask_duration');
  }
  // Jadwal (audit 315036: + sinyal waktu-sekarang/hari-ini/jam — "kalau
  // sekarang apakah bisa" adalah tanya slot, bukan basa-basi).
  if (hasAnyWord(['jadwal', 'besok', 'lusa', 'minggu depan', 'bisa hari apa', 'masih kosong', 'kapan', 'hari apa', 'tanggal', 'slot', 'sekarang', 'hari ini', 'bisa sekarang', 'jam berapa', 'ready jam', 'bisa jam'])) {
    intents.push('ask_schedule');
  }
  // Gejala klinis (catatan: "moksa" BUKAN gejala — itu pertanyaan treatment)
  if (hasAnyWord(['batuk', 'pilek', 'bapil', 'grok', 'demam', 'kembung', 'kolik', 'rewel', 'gtm', 'diare', 'makan', 'lahap', 'sulit makan', 'doyan makan'])) {
    intents.push('consult_symptom');
  }
  // Lokasi via gazetteer resmi (data-driven, mencakup desa perbatasan baru)
  try {
    const gazetteer = getGazetteerAreas();
    for (const [areaLower] of gazetteer.entries()) {
      if (areaLower.length >= 4 && lower.includes(areaLower)) {
        intents.push('provide_location');
        break;
      }
    }
  } catch (_) {}
  // Cukur + kata biaya = pertanyaan TARIF cukur (disambiguasi konteks biaya).
  // Bare "cukur" tanpa kata biaya/berapa BUKAN tarif (mis. "cukurnya gimana" = tanya model).
  if (lower.includes('cukur') && (hasAnyWord(['biaya', 'hrga', 'harga', 'total', 'ribu', 'termasuk', 'bayar', 'tarif', 'ongkir']) || hasRpToken || hasNominalToken || isGeneralPriceBerapa)) {
    if (!intents.includes('ask_price')) intents.push('ask_price');
  }

  return [...new Set(intents)];
}

export type { DynamicPromptExemplar, DynamicPromptResult, RouterPromptOpts, SystemPromptOpts };

/** Mengekspor penanda agar generation-stage dapat memisah prefix stabil. */
export const PERSONA_STABLE_PREFIX_MARKER = STABLE_PREFIX_MARKER;

/**
 * Fasad kompatibilitas (Fase 3.4) — seluruh isi prompt kini dirakit modular
 * di `src/v3/agent/prompt/` (Global Safety Layer, Core Persona Layer,
 * direktif fase operasional). Antarmuka publik dipertahankan 100% agar
 * pemanggil eksisting (agent-runner, generation-stage, simulator, tests)
 * tidak berubah.
 */
export class PersonaPromptBuilder {
  /**
   * Router Prompt untuk Call 1 (~800 - 1.200 token).
   * Khusus untuk evaluasi apakah perlu memanggil Tools atau langsung respon ramah singkat.
   * Menghilangkan 90% bloat (hierarki 18k char, negative constraints 9k char, few-shots 7k char).
   */
  public static buildRouterPrompt(
    session: CustomerGoalSession,
    isFollowUp: boolean = false,
    opts?: RouterPromptOpts
  ): string {
    return composeRouterPrompt(session, isFollowUp, opts);
  }

  /**
   * Varian async tenant-aware (Plan 4): Call 1 Router Prompt menyerap konfigurasi
   * persona dinamis dari DB (`TenantPromptConfigService`) + identitas brand
   * per-tenant (`getBrandIdentityAsync`).
   *
   * Fondasi: base = prompt statis `buildRouterPrompt` (fallback penuh bila DB
   * offline — perilaku Call 1 eksisting terpin). Bila tenant punya konfigurasi
   * aktif, section dashboard disuntik sebagai blok overlay; bila brand tenant
   * di-override, nama bisnis default diganti. Tanpa baris DB → output identik
   * dengan varian sinkron.
   */
  public static async buildRouterPromptAsync(
    session: CustomerGoalSession,
    isFollowUp: boolean = false,
    opts?: RouterPromptOpts & { tenantId?: string }
  ): Promise<string> {
    return composeRouterPromptAsync(session, isFollowUp, opts);
  }

  /**
   * Membangun System Prompt Bidan Yusi yang hangat, manusiawi, luwes,
   * dan kontekstual selayaknya Bidan asli di WhatsApp tanpa celah pelanggaran SOP.
   */
  public static buildSystemPrompt(
    session: CustomerGoalSession,
    isFollowUp: boolean = false,
    opts?: SystemPromptOpts
  ): string {
    return composeSystemPrompt(session, isFollowUp, opts);
  }

  /**
   * Varian async: memuat contoh chat DINAMIS dari bank few_shot_exemplars
   * (DB Koleksi Emas, fallback in-memory) yang paling relevan dengan pesan
   * masuk, lalu MENGGANTIKAN blok contoh statis di prompt. Fallback aman ke
   * prompt statis bila bank kosong / DB tidak terjangkau.
   */
  public static async buildSystemPromptAsync(
    session: CustomerGoalSession,
    isFollowUp: boolean = false,
    opts?: SystemPromptOpts & { tenantId?: string; incomingText?: string }
  ): Promise<DynamicPromptResult> {
    return composeSystemPromptAsync(session, isFollowUp, opts);
  }
}

import { splitWilayahComposite } from './wilayah-normalizer';
import { TreatmentCategory } from '@prisma/client';
import { parsePaymentSection } from './conversation-transaction-extractor';
import { treatmentCatalogService } from '../services/treatment-catalog.service';
import { isGestationalText } from './age-calculator';
import { isValidChildName } from './name-sanitizer';

export interface BabyDetail {
  name: string;
  age: string;
}

/** Klasifikasi entitas pasien: anak, Moms (hamil/nifas), atau ambigu. */
export type PatientEntityKind = 'CHILD' | 'MOM' | 'AMBIGUOUS';

/**
 * Satu gerbang kanonis pemisah entitas Anak vs Moms (deep module).
 * Deterministik pada STATE/KONTRAK DATA — bukan pencocokan kalimat intent:
 *  - kategori treatment MOMS / teks usia gestasional → MOM
 *  - kategori BABY/KIDS / usia anak non-gestasional → CHILD
 *  - kategori BOTH tanpa penanda jelas → AMBIGUOUS (jangan asal masuk tabel anak)
 */
export function classifyPatientEntity(params: {
  name?: string | null;
  ageText?: string | null;
  treatmentCategory?: string | null;
}): PatientEntityKind {
  const { name, ageText, treatmentCategory } = params;
  const cat = String(treatmentCategory || '').toUpperCase();
  const hasName = Boolean(name && name.trim() && name.trim() !== '-');
  const gest = isGestationalText(ageText);

  if (cat === 'MOMS') return 'MOM';
  if (gest) return 'MOM';
  if (cat === 'BABY' || cat === 'KIDS') return hasName || Boolean(ageText && String(ageText).trim()) ? 'CHILD' : 'AMBIGUOUS';
  if (cat === 'BOTH' || cat === 'BUNDLE') return hasName ? 'CHILD' : 'AMBIGUOUS';
  return hasName ? 'CHILD' : 'AMBIGUOUS';
}

export interface ParsedReservation {
  name: string;
  phone: string;
  address: string;
  kec: string;
  kota: string;
  kelurahan?: string;
  treatmentCategory: TreatmentCategory;
  treatmentDetail: string;
  /** Durasi resmi katalog (menit) agar auto-capture tidak menyimpan NULL. */
  durationMinutes?: number;
  bookingDate: Date | null;
  rawText: string;
  babies: BabyDetail[];
  momProfile?: { gestationalWeeks?: string; stage?: string; notes?: string } | null;
  /** Jam tanggal ditulis eksplisit oleh customer di form (bukan fallback 09:00 WIB). */
  hasExplicitTime: boolean;
  /**
   * 152c — True bila nama hari tertulis BERTENTANGAN (≥2 hari) dengan tanggal
   * numerik hasil parse (mis. "jumat 28 Juli" padahal 28 Juli = Selasa). Slip
   * ±1 hari (typo umum) sudah diselaraskan parser → TIDAK dianggap mismatch.
   * Dipakai untuk memberi CATATAN PERINGATAN ke staf (bukan memblokir).
   */
  dateMismatch?: boolean;
  /** Nama hari yang tertulis customer (bila ada) — untuk catatan staf. */
  writtenDay?: string;
  /** Nama hari sebenarnya dari tanggal hasil parse — untuk catatan staf. */
  actualDay?: string;
  payment?: {
    treatmentPrice: number;
    ongkir: number;
    promo: number;
    totalPrice: number;
  };
}

export interface ParseResult {
  success: boolean;
  reservation?: ParsedReservation;
  error?: string;
  missingFields?: string[];
}

export interface ReservationFormOptions {
  customHeaders?: string[];
  tenantId?: string;
}

export const DEFAULT_FORM_HEADER_SIGNALS: readonly string[] = [
  'list untuk reservasi',
  'berikut list untuk reservasi',
  'format reservasi',
  'form reservasi',
  'form booking',
  'format booking',
  'list reservasi',
  'pilihan treatment :',
  'pilihan treatment (',
  'pilihan paket :',
  'jadwal treatment :',
  'jadwal reservasi :',
];

const tenantFormHeadersCache = new Map<string, { headers: string[]; expiresAt: number }>();

/**
 * Mendaftarkan header template form dinamis per-tenant ke dalam cache in-memory (SM-02).
 */
export function registerTenantFormHeaders(tenantId: string, headers: string[]): void {
  if (!tenantId || !Array.isArray(headers)) return;
  tenantFormHeadersCache.set(tenantId, {
    headers: headers.map((h) => h.toLowerCase().trim()).filter(Boolean),
    expiresAt: Date.now() + 300_000,
  });
}

/**
 * Helper pembersih cache form headers untuk unit test.
 */
export function clearTenantFormHeadersCacheForTest(tenantId?: string): void {
  if (tenantId) {
    tenantFormHeadersCache.delete(tenantId);
  } else {
    tenantFormHeadersCache.clear();
  }
}

/**
 * Mengambil daftar header template form yang aktif untuk tenant secara asinkron dari DB (Tenant.settings.formHeaders).
 * Dilengkapi in-memory cache dengan TTL 5 menit (SM-02).
 */
export async function getTenantFormHeadersAsync(tenantId?: string): Promise<string[]> {
  if (!tenantId) return [...DEFAULT_FORM_HEADER_SIGNALS];
  const cached = tenantFormHeadersCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return [...DEFAULT_FORM_HEADER_SIGNALS, ...cached.headers];
  }

  let dbHeaders: string[] = [];
  try {
    const { prisma } = await import('../db/client');
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const custom = (tenant?.settings as any)?.formHeaders;
    if (Array.isArray(custom)) {
      dbHeaders = custom.map((h: unknown) => String(h).toLowerCase().trim()).filter(Boolean);
    }
  } catch {}

  tenantFormHeadersCache.set(tenantId, {
    headers: dbHeaders,
    expiresAt: Date.now() + 300_000,
  });

  return [...DEFAULT_FORM_HEADER_SIGNALS, ...dbHeaders];
}

/**
 * Mengambil daftar header template form yang aktif untuk tenant (SM-02).
 */
export function getTenantFormHeaders(tenantId?: string): string[] {
  if (!tenantId) return [...DEFAULT_FORM_HEADER_SIGNALS];
  const cached = tenantFormHeadersCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return [...DEFAULT_FORM_HEADER_SIGNALS, ...cached.headers];
  }
  return [...DEFAULT_FORM_HEADER_SIGNALS];
}

/**
 * Mengecek apakah sebuah pesan WhatsApp merupakan form reservasi / booking layanan
 * secara toleran terhadap berbagai variasi penulisan tanpa false-positive pada chat biasa.
 */
export function isPotentialReservationForm(rawText: string, options?: ReservationFormOptions | string): boolean {
  return isReservationFormMessage(rawText, options);
}

export function isReservationFormMessage(rawText: string, options?: ReservationFormOptions | string): boolean {
  if (!rawText || typeof rawText !== 'string') return false;
  const opts: ReservationFormOptions = typeof options === 'string' ? { tenantId: options } : (options || {});
  const lower = rawText.toLowerCase().replace(/\s+/g, ' ');

  // 1. Explicit Form Header Signals (Data-driven: default + tenant-configured headers, SM-02)
  const formHeaders = [
    ...getTenantFormHeaders(opts.tenantId),
    ...(opts.customHeaders || []).map((h) => h.toLowerCase().trim()),
  ];

  const hasExplicitFormHeader = formHeaders.some((header) => lower.includes(header));
  if (hasExplicitFormHeader) return true;

  // 2. Structured Colon-Based Field Signals (minimal 2 explicit structured form field keys with colons)
  const hasNameField = /nama\s*(bunda|ibu|pasien|anak|bayi)?\s*[:]/i.test(lower) || /atas\s*nama\s*[:]/i.test(lower);
  const hasAddressField = /alamat(\s*&\s*shareloc)?\s*[:]/i.test(lower) || /kec\s*[:]/i.test(lower) || /kota\s*[:]/i.test(lower) || /shareloc\s*[:]/i.test(lower);
  const hasTreatmentField = /treatment\s*[:]/i.test(lower) || /pilihan\s*treatment/i.test(lower) || /paket\s*[:]/i.test(lower);
  const hasScheduleField = /hari\s*(dan|\&)?\s*tanggal\s*[:]/i.test(lower) || /tgl\s*[:]/i.test(lower) || /jadwal\s*[:]/i.test(lower);
  const hasBabyField = /nama\s*(bayi|anak)\s*[:]/i.test(lower) || /usia\s*(bayi|anak)\s*[:]/i.test(lower);
  const hasPhoneField = /no\.?\s*(hp|wa|telepon)\s*[:]/i.test(lower);

  const structuredMatchCount =
    (hasNameField ? 1 : 0) +
    (hasAddressField ? 1 : 0) +
    (hasTreatmentField ? 1 : 0) +
    (hasScheduleField ? 1 : 0) +
    (hasBabyField ? 1 : 0) +
    (hasPhoneField ? 1 : 0);

  if (structuredMatchCount >= 2) return true;

  // 3. Explicit Free-Form Paragraph Booking Pattern (e.g. "Mau booking buat anak saya ... alamat ...")
  // Wajib memiliki kata aksi booking + penunjuk alamat spesifik + info pasien anak
  const hasBookingAction = /\b(mau|ingin|tolong|bisa)?\s*(booking|pesan\s+paket|reservasi)\b/i.test(lower);
  const hasExplicitAddressWord = /\b(alamat\s*(di|:)?|jalan|jl\.|gang|blok|komplek|perumahan)\b/i.test(lower);
  const hasChildPatientWord = /\b(anak\s+saya|bayi\s+saya|usia\s+\d+|newborn)\b/i.test(lower);

  if (hasBookingAction && hasExplicitAddressWord && hasChildPatientWord) {
    return true;
  }

  return false;
}

/**
 * Parser toleran untuk mengekstrak entitas reservasi layanan klinik/spa dari format teks pengguna.
 * Menggunakan pendekatan baris-per-baris untuk keamanan parsing dan keandalan tinggi.
 */

/**
 * Preprocessing: bersihkan formatting markdown, sambungkan label terpotong,
 * dan pecah label inline agar baris-per-baris mudah diproses.
 */
export function preprocessReservationText(rawText: string): string {
  if (!rawText) return '';

  // Bersihkan formatting markdown WhatsApp (*, _, ~, `)
  let cleaned = rawText.replace(/[*_~`]/g, '').replace(/\r\n/g, '\n');

  // 1. Sambungkan label yang terpotong di tengah baris (mid-word wrap)
  // Hanya untuk kata-kata label yang DIKETAHUI, supaya tidak salah gabung
  // kata biasa (misal "Hari dan\ntanggal" harus tetap terpisah).
  const LABEL_WORDS = ['Bunda', 'Kehamilan', 'Shareloc', 'Anak', 'Bayi', 'Alamat', 'Pilihan', 'Treatment', 'Keham', 'No', 'Hp', 'tanggal'];
  for (const word of LABEL_WORDS) {
    for (let i = 1; i < word.length; i++) {
      const part1 = word.slice(0, i);
      const part2 = word.slice(i);
      if (part1.length >= 2 && part2.length >= 1) {
        const re = new RegExp('(' + part1 + ')\\n(' + part2 + ')', 'gi');
        cleaned = cleaned.replace(re, '$1$2');
      }
    }
  }

  // 2. Gabungkan label yang terpotong ke baris baru (misal Usia Kehamilan (Jika\n hamil): -> Usia Kehamilan (Jika hamil):)
  cleaned = cleaned.replace(/(usia\s+kehamilan[^\n:]*)\n\s*([^:\n]+:)/gi, '$1 $2');

  // 3. Pisahkan label yang berada di satu baris yang sama setelah nilai field lain
  const inlineLabelRegex = /(\s+)(Nama Bunda\s*:|Alamat Lengkap & Patokan\s*:|Alamat & Shareloc\s*:|Alamat Lengkap\s*:|Alamat\s*:|Kec\s*&\s*Kota\s*:|\bKec\s*:|\bKota\s*:|No\.?\s*Hp\s*:|Nama Bayi\s*:|Usia Bayi\/Anak\s*:|Usia Bayi\s*:|Usia Kehamilan[^\n:]*:|Treatment\s*:|Pilihan treatment)/gi;
  cleaned = cleaned.replace(inlineLabelRegex, '\n$2');

  return cleaned;
}

/**
 * Memeriksa apakah suatu teks adalah placeholder / instruksi template form reservasi yang belum diisi.
 * Contoh: "(Mohon bisa diisi Bunda 😊)", "(Jika hamil)", "-", "tidak ada", "none", dsb.
 */
export function isPlaceholderText(val: string | null | undefined): boolean {
  if (!val) return true;
  const clean = val.trim().toLowerCase().replace(/[()\[\]*~_`]/g, '').trim();
  if (!clean || clean.length < 2) return true;

  if (
    clean.includes('mohon bisa diisi') ||
    clean.includes('bisa diisi bunda') ||
    clean.includes('diisi bunda') ||
    clean.includes('jika hamil') ||
    clean.includes('jika ada') ||
    clean.includes('bila ada') ||
    clean.includes('opsional') ||
    clean.includes('optional')
  ) {
    return true;
  }

  if (
    /^(tidak\s*ada|tdk\s*ada|belum\s*ada|belum|ga\s*ada|gak\s*ada|none|kosong|skip|-|\.|\/|\?)+$/i.test(clean)
  ) {
    return true;
  }

  return false;
}

/**
 * Cek apakah sebuah teks adalah nama layanan valid atau keluhan/catatan bebas.
 * Otoritas tertinggi adalah pencocokan katalog (clinical dominance).
 * Bila tidak cocok katalog, evaluasi apakah teks merupakan kalimat percakapan/keluhan.
 */
function resolveTreatmentOrNote(
  value: string,
  tenantId?: string
): { isTreatment: boolean; treatmentName?: string; note?: string } {
  if (!value || isPlaceholderText(value)) return { isTreatment: false };
  const trimmed = value.trim();

  // 1. Otoritas Katalog: cocok langsung atau melalui gabungan layanan
  const hasDirectMatch = Boolean(treatmentCatalogService.matchCatalogItem(trimmed, tenantId));
  const hasPartMatch = !hasDirectMatch && trimmed.split(/\s*(?:\+|,|&|\bdan\b)\s*/i).some((p) =>
    Boolean(treatmentCatalogService.matchCatalogItem(p.trim(), tenantId))
  );

  if (hasDirectMatch || hasPartMatch) {
    return { isTreatment: true, treatmentName: trimmed };
  }

  // 2. Evaluasi kalimat bebas / keluhan medis:
  // Frasa ringkas (<= 4 kata) tanpa tanda baca klausa/tanya dipertahankan sebagai nama layanan custom.
  // Kalimat panjang (> 4 kata) atau memuat koma/tanya tanpa kecocokan katalog adalah keluhan/catatan.
  const words = trimmed.split(/\s+/).filter(Boolean);
  const isSentenceOrNote = words.length > 4 || trimmed.includes(',') || trimmed.includes('?');

  if (isSentenceOrNote) {
    return { isTreatment: false, note: trimmed };
  }

  // 3. Frasa ringkas tanpa kecocokan katalog (misal layanan kustom pendek "Pijat Tradisional")
  return { isTreatment: true, treatmentName: trimmed };
}

export function parseReservationText(rawText: string): ParseResult {
  if (!rawText) {
    return { success: false, error: 'Teks reservasi kosong.', missingFields: ['rawText'] };
  }

  const cleaned = preprocessReservationText(rawText);

  const lines = cleaned.split('\n');

  let name = '';
  let phone = '';
  let address = '';
  let dateStr = '';
  let timeStr = '';
  let kec = '';
  let kota = '';
  let kelurahan = '';

  let babyName = '';
  let babyAge = '';
  let babyTreatment = '';
  const babyNameLines: string[] = [];
  const babyAgeLines: string[] = [];
  const pendingBabyNotes: string[] = [];

  let momsPregnancyAge = '';
  let momsTreatment = '';
  const pendingMomNotes: string[] = [];

  let currentSection: 'GENERAL' | 'BABY' | 'MOMS' = 'GENERAL';
  let pendingField: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();
    const lowerNorm = lower.replace(/\s+/g, ' ');

    // Transisi Section berdasarkan header
    if (
      /pilihan\s+treatment\s*\(?\s*(baby|bayi|anak|kids)/i.test(lowerNorm) ||
      /treatment\s*\(?\s*(baby|bayi|anak|kids)/i.test(lowerNorm) ||
      lowerNorm.includes('baby & kids') ||
      lowerNorm.includes('baby and kids')
    ) {
      currentSection = 'BABY';
      pendingField = null;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const val = trimmed.substring(colonIdx + 1).trim();
        if (val && !isPlaceholderText(val)) {
          const resolved = resolveTreatmentOrNote(val);
          if (resolved.isTreatment && resolved.treatmentName) babyTreatment = resolved.treatmentName;
          if (resolved.note) pendingBabyNotes.push(resolved.note);
        }
      }
      continue;
    }
    if (
      /pilihan\s+treatment\s*\(?\s*(moms|mom|ibu|hamil|nifas)/i.test(lowerNorm) ||
      /treatment\s*\(?\s*(moms|mom|ibu|hamil|nifas)/i.test(lowerNorm) ||
      lowerNorm.includes('moms & nifas') ||
      lowerNorm.includes('moms and nifas')
    ) {
      currentSection = 'MOMS';
      pendingField = null;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const val = trimmed.substring(colonIdx + 1).trim();
        if (val && !isPlaceholderText(val)) {
          const resolved = resolveTreatmentOrNote(val);
          if (resolved.isTreatment && resolved.treatmentName) momsTreatment = resolved.treatmentName;
          if (resolved.note) pendingMomNotes.push(resolved.note);
        }
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      // Jika baris ini tidak punya titik dua `:`, tapi baris sebelumnya punya label dengan nilai kosong
      if (pendingField) {
        const value = trimmed;
        if (!isPlaceholderText(value)) {
          if (pendingField === 'name') name = value;
          else if (pendingField === 'phone') phone = value;
          else if (pendingField === 'address') address = value;
          else if (pendingField === 'date') dateStr = value;
          else if (pendingField === 'time') timeStr = value;
          else if (pendingField === 'kec') kec = value;
          else if (pendingField === 'kota') kota = value;
          else if (pendingField === 'babyName') { babyName = value; babyNameLines.push(value); }
          else if (pendingField === 'babyAge') { babyAge = value; babyAgeLines.push(value); }
          else if (pendingField === 'babyTreatment') babyTreatment = value;
          else if (pendingField === 'momsPregnancyAge') momsPregnancyAge = value;
          else if (pendingField === 'momsTreatment') momsTreatment = value;
        }
        pendingField = null;
      }
      continue;
    }

    pendingField = null;
    const label = trimmed.substring(0, colonIdx).trim().toLowerCase().replace(/\s+/g, ' ');
    const value = trimmed.substring(colonIdx + 1).trim();

    const setOrPending = (val: string, fieldName: string, setter: (v: string) => void) => {
      if (val) {
        if (!isPlaceholderText(val)) {
          setter(val);
        }
      } else {
        pendingField = fieldName;
      }
    };

    if (currentSection === 'GENERAL') {
      if (label.includes('nama bunda') || label.includes('nama ibu') || label === 'nama') {
        setOrPending(value, 'name', (v) => (name = v));
      } else if (label.includes('no') && (label.includes('hp') || label.includes('wa') || label.includes('telp') || label.includes('telepon'))) {
        setOrPending(value, 'phone', (v) => (phone = v));
      } else if (label.includes('alamat')) {
        setOrPending(value, 'address', (v) => (address = v));
      } else if (label.includes('hari') || label.includes('tanggal') || label === 'tgl') {
        setOrPending(value, 'date', (v) => (dateStr = v));
      } else if (label === 'jam' || label === 'pukul' || label === 'waktu' || label.includes('jam ') || label.includes('waktu ')) {
        setOrPending(value, 'time', (v) => (timeStr = v));
      } else if ((label.includes('kec') && label.includes('kel')) || label === 'kec' || label.includes('kecamatan')) {
        setOrPending(value, 'kec', (v) => {
          if (v && /[,/;]/.test(v)) {
            const split = splitWilayahComposite(v);
            if (split.kecamatan) kec = split.kecamatan;
            if (!kelurahan && split.kelurahan) kelurahan = split.kelurahan;
            if (!kota && split.kota) kota = split.kota;
          } else {
            kec = v;
          }
        });
      } else if (label.includes('kel') || label.includes('desa') || label.includes('kelurahan')) {
        setOrPending(value, 'kelurahan', (v) => (kelurahan = v));
      } else if (label === 'kota' || label.includes('kabupaten') || label.includes('kab')) {
        setOrPending(value, 'kota', (v) => (kota = v));
      } else if (label.includes('kec') && label.includes('kota')) {
        const parts = value.split(/[,\/]/);
        const k1 = parts[0]?.trim() || '';
        const k2 = parts[1]?.trim() || '';
        if (k1 && !isPlaceholderText(k1)) kec = k1;
        if (k2 && !isPlaceholderText(k2)) kota = k2;
      } else if (label.includes('nama bayi') || label.includes('nama anak') || label.includes('nama baby') || label.includes('nama pasien')) {
        currentSection = 'BABY';
        setOrPending(value, 'babyName', (v) => { babyName = v; babyNameLines.push(v); });
      } else if ((label.includes('usia') || label.includes('umur')) && !label.includes('kehamilan') && !label.includes('bunda')) {
        currentSection = 'BABY';
        setOrPending(value, 'babyAge', (v) => { babyAge = v; babyAgeLines.push(v); });
      } else if (label.includes('usia kehamilan') || label.includes('usia hamil') || /\buk\b/i.test(label)) {
        currentSection = 'MOMS';
        setOrPending(value, 'momsPregnancyAge', (v) => (momsPregnancyAge = v));
      } else if (label.includes('treatment') || label.includes('layanan') || label.includes('paket')) {
        setOrPending(value, 'babyTreatment', (v) => {
          const resolved = resolveTreatmentOrNote(v);
          if (resolved.isTreatment && resolved.treatmentName) babyTreatment = resolved.treatmentName;
          if (resolved.note) pendingBabyNotes.push(resolved.note);
        });
      }
    } else if (currentSection === 'BABY') {
      if (label.includes('nama bayi') || label.includes('nama anak') || label.includes('nama baby') || label.includes('nama pasien')) {
        setOrPending(value, 'babyName', (v) => { babyName = v; babyNameLines.push(v); });
      } else if (label.includes('usia') || label.includes('umur')) {
        setOrPending(value, 'babyAge', (v) => { babyAge = v; babyAgeLines.push(v); });
      } else if (label.includes('treatment') || label.includes('layanan') || label.includes('paket')) {
        setOrPending(value, 'babyTreatment', (v) => {
          const resolved = resolveTreatmentOrNote(v);
          if (resolved.isTreatment && resolved.treatmentName) babyTreatment = resolved.treatmentName;
          if (resolved.note) pendingBabyNotes.push(resolved.note);
        });
      }
    } else if (currentSection === 'MOMS') {
      if (label.includes('usia kehamilan') || label.includes('usia hamil') || /\buk\b/i.test(label)) {
        setOrPending(value, 'momsPregnancyAge', (v) => (momsPregnancyAge = v));
      } else if (label.includes('treatment') || label.includes('layanan') || label.includes('paket')) {
        setOrPending(value, 'momsTreatment', (v) => {
          const resolved = resolveTreatmentOrNote(v);
          if (resolved.isTreatment && resolved.treatmentName) momsTreatment = resolved.treatmentName;
          if (resolved.note) pendingMomNotes.push(resolved.note);
        });
      }
    }
  }

  const babies = buildBabyDetails(babyNameLines, babyAgeLines);

  // Integritas Penamaan (Fase 2): Nama bayi DILARANG dijadikan nama pemesan.
  // Bila Nama Bunda kosong/placeholder, biarkan kosong agar nama master customer di DB
  // tidak tercemar menjadi "Bunda {NamaAnak}". Data anak hidup di array `babies`.

  // Validasi Field Krusial: Minimal Alamat & (Nama Bunda atau Nama Bayi)
  const missingFields: string[] = [];
  const hasName = (!!name && !isPlaceholderText(name)) || (!!babyName && !isPlaceholderText(babyName)) || babyNameLines.some(b => !isPlaceholderText(b));
  const hasAddress = !!address || !!kec || !!kota;

  if (!hasName) missingFields.push('Nama Bunda/Bayi');
  if (!hasAddress) missingFields.push('Alamat');

  if (missingFields.length > 0) {
    // Fallback: coba ekstraksi teks percakapan bebas (HANYA jika input BUKAN format form terstruktur)
    const lowerRaw = rawText.toLowerCase();
    const hasFormStructure =
      lowerRaw.includes('list untuk reservasi') ||
      lowerRaw.includes('format reservasi') ||
      lowerRaw.includes('form reservasi') ||
      lowerRaw.includes('pilihan treatment');

    if (!hasFormStructure) {
      const conversationalParsed = parseConversationalReservation(rawText);
      if (conversationalParsed) {
        console.log(`[CONVERSATIONAL RESERVATION PARSED] Successfully extracted reservation from free-form text for "${conversationalParsed.name}".`);
        return {
          success: true,
          reservation: conversationalParsed,
        };
      }
    }

    return {
      success: false,
      error: `Gagal memproses list reservasi. Field berikut tidak terbaca atau kosong: ${missingFields.join(', ')}`,
      missingFields,
    };
  }

  const hasBabyTreatment = (!!babyTreatment && !isPlaceholderText(babyTreatment)) || (!!babyName && !isPlaceholderText(babyName)) || babyNameLines.some(b => !isPlaceholderText(b)) || pendingBabyNotes.length > 0;
  const hasMomsTreatment = (!!momsTreatment && !isPlaceholderText(momsTreatment)) || (!!momsPregnancyAge && !isPlaceholderText(momsPregnancyAge)) || pendingMomNotes.length > 0;
  // Bersih: hanya nama treatment digabung dengan ' + ' (tanpa Bayi/Usia/Kehamilan — sudah di relasi Child/babies)
  const cleanParts: string[] = [];
  if (hasBabyTreatment && babyTreatment && !isPlaceholderText(babyTreatment)) {
    cleanParts.push(babyTreatment.trim());
  }
  if (hasMomsTreatment && momsTreatment && !isPlaceholderText(momsTreatment)) {
    cleanParts.push(momsTreatment.trim());
  }
  // Fallback jika treatment kosong tapi ada baby/moms context → pakai generic
  if (cleanParts.length === 0) {
    if (babyTreatment && !isPlaceholderText(babyTreatment)) cleanParts.push(babyTreatment.trim());
    else if (momsTreatment && !isPlaceholderText(momsTreatment)) cleanParts.push(momsTreatment.trim());
    else cleanParts.push('Layanan Homecare');
  }
  const treatmentDetail = cleanParts.join(' + ');

  // Tentukan Treatment Category
  let treatmentCategory: TreatmentCategory = TreatmentCategory.BABY;
  if (hasBabyTreatment && hasMomsTreatment) {
    treatmentCategory = TreatmentCategory.BOTH;
  } else if (hasMomsTreatment) {
    treatmentCategory = TreatmentCategory.MOMS;
  }

  // Parse Booking Date (toleran, non-blocking)
  let bookingDate: Date | null = null;
  const fullDateToParse = timeStr && dateStr && !dateStr.includes(timeStr) ? `${dateStr} jam ${timeStr}` : (dateStr || (timeStr ? `hari ini jam ${timeStr}` : ''));
  if (fullDateToParse) {
    bookingDate = tryParseIndonesianDate(fullDateToParse);
  }

  // Normalisasi Nomor HP tunggal (08xx/8xx/62xx -> 62xx).
  let normalizedPhone = phone.replace(/\D/g, '');
  if (normalizedPhone.startsWith('0')) {
    normalizedPhone = '62' + normalizedPhone.substring(1);
  } else if (/^8\d{7,13}$/.test(normalizedPhone)) {
    normalizedPhone = '62' + normalizedPhone;
  }

  // Ekstrak rincian pembayaran jika ada di dalam teks
  let payment: { treatmentPrice: number; ongkir: number; promo: number; totalPrice: number } | undefined;
  if (/payment|pembayaran|total\s*[:=]/i.test(rawText)) {
    payment = parsePaymentSection(rawText);
  }

  // Profil ibu: usia kehamilan WAJIB dipertahankan (tidak dibuang).
  // Tahap & catatan diisi defensif dari konteks MOMS yang tersedia.
  const momContextString = `${momsTreatment} ${momsPregnancyAge} ${pendingMomNotes.join(' ')}`.trim();
  const momStage = hasMomsTreatment
    ? (/nifas|paska|pasca|postpartum|menyusui|laktasi/i.test(momContextString) ? 'POSTPARTUM'
      : (/hamil|kehamilan|uk\b|weeks?|minggu|trimester|induksi|perineum|prenatal/i.test(momContextString) ? 'PREGNANT' : 'GENERAL'))
    : undefined;
  const combinedMomNotes = [
    ...pendingMomNotes,
    ...(momsTreatment && !isPlaceholderText(momsTreatment) && !cleanParts.includes(momsTreatment.trim()) ? [momsTreatment] : [])
  ].filter(Boolean);
  const momProfile = (momsPregnancyAge && !isPlaceholderText(momsPregnancyAge)) || momStage || combinedMomNotes.length > 0
    ? {
        gestationalWeeks: (momsPregnancyAge && !isPlaceholderText(momsPregnancyAge)) ? momsPregnancyAge : undefined,
        stage: momStage,
        notes: combinedMomNotes.length > 0 ? combinedMomNotes.join('; ') : (momsTreatment && !isPlaceholderText(momsTreatment) ? momsTreatment : undefined),
      }
    : undefined;

  // 152c — deteksi kontradiksi hari vs tanggal (setelah reconcile ±1 hari).
  const dateMismatchInfo = bookingDate ? detectDateMismatch(bookingDate, cleaned) : { mismatch: false };

  let durationMinutes: number | undefined;
  try {
    const breakdown = treatmentCatalogService.resolveDurationBreakdown(treatmentDetail);
    if (breakdown.confident) durationMinutes = breakdown.totalMinutes;
  } catch {}

  return {
    success: true,
    reservation: {
      name,
      phone: normalizedPhone,
      address,
      kec,
      kota,
      kelurahan: kelurahan || undefined,
      treatmentCategory,
      treatmentDetail,
      durationMinutes,
       bookingDate,
       rawText,
       babies,
       momProfile,
       payment,
       hasExplicitTime: !!timeStr,
       dateMismatch: dateMismatchInfo.mismatch,
       writtenDay: dateMismatchInfo.writtenDay,
       actualDay: dateMismatchInfo.actualDay,
     },
   };
 }

/**
 * Ekstrak daftar bayi/anak (nama + usia) dari teks list reservasi mentah.
 * Mendukung: satu bayi, beberapa bayi (dipisah koma/&/dan), blok berulang,
 * dan usia yang ditulis dalam kurung "Nama (usia)".
 * Dipakai untuk menampilkan info bayi di detail reservasi tanpa bergantung
 * pada keberhasilan parse penuh.
 */
export function extractBabyDetails(rawText: string | null | undefined): BabyDetail[] {
  if (!rawText) return [];
  const cleaned = preprocessReservationText(rawText);
  const lines = cleaned.split('\n');

  const nameLines: string[] = [];
  const ageLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const label = trimmed.substring(0, colonIdx).trim().toLowerCase().replace(/\s+/g, ' ');
    const value = trimmed.substring(colonIdx + 1).trim();

    if (
      label.includes('nama bayi') ||
      label.includes('nama anak') ||
      label.includes('nama baby') ||
      label.includes('nama pasien') ||
      label === 'anak' ||
      label === 'baby'
    ) {
      nameLines.push(value);
    } else if (
      (label.includes('usia') || label.includes('umur')) &&
      !label.includes('kehamilan') &&
      !label.includes('bunda')
    ) {
      ageLines.push(value);
    }
  }

  return buildBabyDetails(nameLines, ageLines);
}

/**
 * Gabungkan baris nama & usia bayi menjadi daftar terstruktur.
 */
export function buildBabyDetails(nameLines: string[], ageLines: string[]): BabyDetail[] {
  const result: BabyDetail[] = [];

  // Ekspansi tiap baris nama → entri (tangani "Rara, Riri" dan "Rara (6 bulan)")
  const nameEntries: { name: string; age: string | null }[] = [];
  for (const line of nameLines) {
    for (const part of splitMultiValue(line)) {
      const p = part.trim();
      if (!p) continue;
      const parenMatch = p.match(/^(.+?)\s*\((?:umur|usia)?\s*([^)]+)\)$/i);
      if (parenMatch) {
        const parsedName = parenMatch[1].trim();
        if (isValidChildName(parsedName)) {
          nameEntries.push({ name: parsedName, age: parenMatch[2].trim() });
        }
      } else {
        if (isValidChildName(p)) {
          nameEntries.push({ name: p, age: null });
        }
      }
    }
  }

  // Ekspansi tiap baris usia
  const ages: string[] = [];
  for (const line of ageLines) {
    for (const a of splitMultiValue(line)) {
      const t = a.trim();
      if (t) ages.push(t);
    }
  }

  // Jika nama tidak ada sama sekali tapi ada usia, baru gunakan fallback "Bayi 1", dst.
  // Jangan sekali-kali menciptakan "Bayi 2" jika nameEntries hanya punya 1 nama valid!
  if (nameEntries.length === 0 && ages.length > 0) {
    for (let i = 0; i < ages.length; i++) {
      const age = ages[i];
      if (isGestationalText(age)) continue;
      result.push({
        name: `Bayi ${i + 1}`,
        age,
      });
    }
    return result;
  }

  // Jika ada nameEntries, jumlah anak maksimal adalah nameEntries.length
  // (mencegah penambahan "Bayi 2" palsu jika baris usia salah format atau terpecah)
  for (let i = 0; i < nameEntries.length; i++) {
    const entry = nameEntries[i];
    const age = ages[i] ?? entry.age ?? '';
    if (isGestationalText(age)) continue;
    result.push({
      name: entry.name,
      age,
    });
  }

  return result;
}

/**
 * Pecah nilai multi-bayi (misal "Rara, Riri" / "Kanaya & Kenshin" / "6 bulan, 2 tahun").
 * Hanya pecah pada pemisah jelas (koma, &, "dan", ";") — bukan spasi.
 *
 * Kebal terhadap pemecahan salah angka desimal usia (misal "3,5 bulan", "1,5 thn", "2,4 tahun")
 * dan koma di dalam tanda kurung (misal "Ara (2,4 thn)").
 */
function splitMultiValue(value: string): string[] {
  if (!value) return [];

  // 1. Lindungi koma pada angka desimal usia (misal 3,5 atau 1,5)
  let s = value.replace(/(\d+),(\d+)/g, '$1__DEC_COMMA__$2');

  // 2. Lindungi koma dan ampersand di dalam tanda kurung (misal "Ara (2 thn, batuk)")
  s = s.replace(/\(([^)]+)\)/g, (match, inner) => {
    return '(' + inner.replace(/,/g, '__PAREN_COMMA__').replace(/&/g, '__PAREN_AMP__') + ')';
  });

  return s
    .replace(/\s+dan\s+/gi, ', ')
    .replace(/\s*&\s*/gi, ', ')
    .replace(/\s*;\s*/gi, ', ')
    .split(/\s*,\s*/)
    .map((part) =>
      part
        .replace(/__DEC_COMMA__/g, ',')
        .replace(/__PAREN_COMMA__/g, ',')
        .replace(/__PAREN_AMP__/g, '&')
        .trim()
    )
    .filter(Boolean);
}

export {
  getWibDayOfWeek,
  createWibDate,
  WRITTEN_DAY_NAMES,
  findWrittenDayOfWeek,
  ID_DAY_NAMES,
  detectDateMismatch,
  reconcileWrittenDayWithDate,
  tryParseIndonesianDate,
} from './reservation-date-parser';
import {
  detectDateMismatch,
  tryParseIndonesianDate,
} from './reservation-date-parser';

/**
 * Fallback parser untuk mengekstrak entitas reservasi dari teks paragraf / percakapan bebas (Free-form text).
 * Contoh input:
 * "Mau booking buat anak saya Raffa 1 th, Wisma Lidah Kulon no 12, besok rabu jam 10 ya bund"
 */
export function parseConversationalReservation(rawText: string): ParsedReservation | null {
  if (!rawText) return null;
  const lower = rawText.toLowerCase().replace(/\s+/g, ' ');

  // 1. Ekstrak Nama Bunda / Pasien / Bayi
  let name = '';
  let babyName = '';
  let babyAge = '';

  const babyMatch =
    rawText.match(/(?:anak(?:nya)?(?:\s+saya)?|bayi(?:nya)?(?:\s+saya)?|pasien|atas\s+nama\s+anak)\s+(?:nama(?:nya)?\s+)?([A-Za-z\s]{2,30}?)(?:\s+usia|\s+umur|\s+\d+|\s+di|\s+alamat|,|\.|\n|$)/i) ||
    rawText.match(/nama\s+(?:anak|bayi)\s*[:\-]?\s*([A-Za-z\s]{2,30}?)(?:\s+usia|\s+umur|\s+alamat|,|\.|\n|$)/i);

  if (babyMatch && babyMatch[1]) {
    const candidate = babyMatch[1].trim();
    if (!isPlaceholderText(candidate) && candidate.length >= 2 && isValidChildName(candidate)) {
      babyName = candidate;
    }
  }

  const momMatch =
    rawText.match(/(?:atas\s+nama|nama\s+bunda|nama\s+ibu|nama\s+pasien)\s*[:\-]?\s*([A-Za-z\s]{2,30}?)(?:\s+alamat|\s+di|\s+nomor|\s+no|,|\.|\n|$)/i) ||
    rawText.match(/nama\s*[:\-]\s*([A-Za-z\s]{2,30}?)(?:\s+alamat|\s+di|,|\.|\n|$)/i);

  if (momMatch && momMatch[1]) {
    const candidate = momMatch[1].trim();
    // Gerbang Fase 3: tolak pronomina closed-class + sapaan generik (bukan regex hafalan bisnis).
    const momWords = candidate.toLowerCase().split(/\s+/).filter(Boolean);
    const isPronounOnly = momWords.length > 0 && momWords.every((w) => ['saya', 'aku', 'kami', 'kita', 'sendiri', 'diri'].includes(w));
    const isGenericSingle = momWords.length === 1 && ['bunda', 'ibu', 'mama', 'ayah', 'moms', 'pasien'].includes(momWords[0]);
    if (!isPlaceholderText(candidate) && candidate.length >= 2 && !isPronounOnly && !isGenericSingle) {
      name = candidate;
    }
  }

  // Integritas Penamaan: Nama bayi tidak boleh disalin ke nama pemesan.

  // 2. Ekstrak Usia Bayi / Anak
  const ageMatch = rawText.match(/(\d+\s*(?:bulan|bln|tahun|thn|th|hari|hr|minggu|mg|mgg))/i);
  if (ageMatch) {
    babyAge = ageMatch[1].trim();
  }

  // 3. Ekstrak Alamat
  let address = '';
  const addressMatch =
    rawText.match(/(?:alamat(?:nya)?|shareloc(?:nya)?|lokasi(?:nya)?)\s*[:\-]?\s*([^,\n]+(?:,[^,\n]+){0,2})/i) ||
    rawText.match(/(?:di|ke)\s+([A-Za-z0-9\s.\-\/]{4,50}?)(?:\s+besok|\s+hari|\s+tanggal|\s+jam|\s+pukul|\s+no|\s+wa|,|\.|\n|$)/i);

  if (addressMatch && addressMatch[1]) {
    const candidate = addressMatch[1].trim();
    if (!isPlaceholderText(candidate) && candidate.length >= 3) {
      address = candidate;
    }
  }

  // 4. Ekstrak Tanggal & Jam
  let dateStr = '';
  const dateMatch = rawText.match(/(besok(?:\s+pagi|\s+siang|\s+sore)?|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu|tanggal\s+\d+[\/\-\s]\d+)/i);
  const timeMatch = rawText.match(/(?:jam|pukul)\s*(\d{1,2}(?:[.:]\d{2})?)/i);

  if (dateMatch) {
    dateStr = dateMatch[1].trim() + (timeMatch ? ` ${timeMatch[0]}` : '');
  }

  // 5. Ekstrak Treatment — data-driven: cocokkan katalog dinamis dulu, fallback generik
  let treatmentDetail = 'Pijat / Treatment Homecare';
  let catalogHit: string | null = null;
  try {
    const catalog = treatmentCatalogService.getAllServices();
    const lowerRaw = rawText.toLowerCase();
    const sorted = [...catalog].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));
    for (const svc of sorted) {
      const nameLower = (svc.name || '').toLowerCase();
      if (nameLower && nameLower.length >= 4 && lowerRaw.includes(nameLower)) {
        catalogHit = svc.name;
        break;
      }
      const tokens = nameLower.split(/[^a-z0-9]+/).filter(w => w.length >= 3);
      if (tokens.length >= 2 && tokens.every(t => lowerRaw.includes(t))) {
        catalogHit = svc.name;
        break;
      }
    }
  } catch {}
  if (catalogHit) {
    treatmentDetail = catalogHit;
  } else {
    const treatmentMatch = rawText.match(/(pijat\s+bayi|pijat\s+anak|baby\s+spa|newborn|pulih\s+ceria|mom\s+spa|pijat\s+hamil|pijat\s+laktasi|nebulizer|terapi\s+moksa|cukur\s+bayi|tindik\s+bayi)/i);
    if (treatmentMatch) {
      treatmentDetail = treatmentMatch[1].trim();
    }
  }

  // Validasi: harus ada Nama DAN Alamat
  if (!name || !address) {
    return null;
  }

  // Sinyal maternal multi-audience (tanpa regex baru): usia kehamilan milik ibu,
  // DILARANG jatuh ke babyAge/babies (anti bocor "38 weeks" → anak 9 bulan).
  const hasMaternalSignal = lower.includes('hamil') || lower.includes('kehamilan') || lower.includes('week')
    || lower.includes('bumil') || lower.includes('nifas') || lower.includes('menyusui') || lower.includes('laktasi')
    || lower.includes('induksi') || lower.includes('oksitosin') || lower.includes('perineum') || lower.includes('prenatal');
  const hasChildSignal = lower.includes('bayi') || lower.includes('baby') || lower.includes('anak saya')
    || lower.includes('adik') || lower.includes('kakak') || lower.includes('si kecil') || lower.includes('newborn');
  let momProfile: ParsedReservation['momProfile'];
  let effectiveBabyAge = babyAge;
  if (hasMaternalSignal && !hasChildSignal) {
    // Usia kehamilan mingguan → momProfile, bukan usia anak.
    effectiveBabyAge = '';
    const weekIdx = lower.indexOf('week') !== -1 ? lower.indexOf('week') : lower.indexOf('minggu');
    let gestPhrase: string | undefined;
    if (weekIdx !== -1) {
      const before = lower.slice(Math.max(0, weekIdx - 12), weekIdx);
      const numMatch = before.match(/(\d{1,2})\s*$/);
      if (numMatch) {
        gestPhrase = lower.includes('week') ? `${numMatch[1]} weeks` : `${numMatch[1]} minggu`;
      }
    }
    const stageText = `${treatmentDetail} ${rawText}`.toLowerCase();
    const stage = stageText.includes('nifas') || stageText.includes('paska') || stageText.includes('pasca') || stageText.includes('menyusui') || stageText.includes('laktasi')
      ? 'POSTPARTUM'
      : (stageText.includes('hamil') || stageText.includes('kehamilan') || gestPhrase ? 'PREGNANT' : 'GENERAL');
    momProfile = { gestationalWeeks: gestPhrase, stage, notes: undefined };
  }

  const babies: BabyDetail[] = babyName ? [{ name: babyName, age: effectiveBabyAge || '-' }] : [];
  const bookingDate = dateStr ? tryParseIndonesianDate(dateStr) : null;
  const treatmentCategory = momProfile && babies.length > 0 ? TreatmentCategory.BOTH : (momProfile ? TreatmentCategory.MOMS : TreatmentCategory.BABY);

  let convDuration: number | undefined;
  try {
    const breakdown = treatmentCatalogService.resolveDurationBreakdown(treatmentDetail);
    if (breakdown.confident) convDuration = breakdown.totalMinutes;
  } catch {}

  return {
    name,
    phone: '',
    address,
    kec: '',
    kota: '',
    treatmentCategory,
    treatmentDetail: treatmentDetail,
    durationMinutes: convDuration,
    bookingDate,
    rawText,
    babies,
    momProfile,
    hasExplicitTime: false,
  };
}

/**
 * Ekstraksi catatan manual admin dari raw_text.
 * Pola standar: "... \nCatatan: [isi catatan]"
 */
export function extractNotesFromRawText(rawText: string | null | undefined): string | null {
  if (!rawText) return null;
  const match = rawText.match(/(?:^|\n)Catatan:\s*([\s\S]*)$/i);
  return match && match[1].trim().length > 0 ? match[1].trim() : null;
}

/**
 * Menggabungkan atau memperbarui catatan ke dalam raw_text.
 * Jika notes kosong / null, blok Catatan: akan dihapus.
 * Jika rawText belum ada, dibuat dengan fallbackTitle.
 */
export function mergeNotesIntoRawText(
  rawText: string | null | undefined,
  notes: string | null | undefined,
  fallbackTitle: string = '[Admin Manual]'
): string {
  const cleanNotes = notes ? notes.trim() : '';
  const base = (rawText || fallbackTitle)
    .replace(/(?:^|\n)Catatan:[\s\S]*$/i, '')
    .trim();

  if (!cleanNotes) {
    return base;
  }
  return `${base}\nCatatan: ${cleanNotes}`;
}

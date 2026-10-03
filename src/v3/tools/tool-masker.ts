/**
 * tool-masker.ts — Dynamic Tool Masking Engine (FASE 2, SHADOW MODE).
 *
 * Menerapkan prinsip Information Hiding & Least Privilege pada skema tool Call 1.
 * Alih-alih membiarkan seluruh 6 tool selalu terbuka dan bergantung pada 63 instruksi
 * "DILARANG KERAS" di prompt teks, modul ini secara deterministik menyaring ketersediaan
 * tool berdasarkan state percakapan dan bukti persetujuan customer.
 *
 * Menggunakan SATU SUMBER KEBENARAN `isDateConfirmed` dari `src/utils/date-confirmation.ts`.
 * Modul ini murni tanpa I/O, deterministik, dan dapat diuji sepenuhnya secara offline.
 */

import { ALL_V3_TOOLS } from './tool-registry';
import { CustomerGoalSession } from '../domain/types';
import {
  isDateConfirmed,
  DAY_EVIDENCE_WORDS,
  SAME_DAY_EVIDENCE_ALIASES,
  isSameDayRequestText,
  hasBookingCommitSignal,
  isConsultativeUserText,
  isAvailabilityInquiryText,
} from '../../utils/date-confirmation';
import { getGazetteerAreas, getGazetteerKecamatanNames } from '../../utils/gazetteer';
import { findPopularLandmark, resolveArteryCorridor } from '../../config/landmarks';
import { getOutsideCities, getCoverageCities } from '../../config/coverage';
import { isTypoAtMostOne } from '../../utils/typo-match';
import { isPureLeadGreeting } from '../../utils/lead-greeting-detector';
import { treatmentCatalogService } from '../../services/treatment-catalog.service';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

/**
 * Detektor entitas lokasi baru (sesi 337880, Issue 2): true bila pesan
 * customer SAAT INI menyebut nama daerah/kelurahan/kecamatan, landmark
 * perumahan Tier-0, koridor arteri, penanda jalan (jl/gang/perum/komplek/
 * blok/patokan), kota luar cakupan (Tuban/Lamongan — butuh verdict tool!),
 * atau link Google Maps. Murni, data-driven (gazetteer/landmark/koridor/
 * coverage runtime + token kata utuh ala extractFastIntents — tanpa regex
 * semantik). Tanpa entitas → calculate_delivery di-mask fisik.
 */
// Resolved = ada bukti lokasi presisi di sesi (kelurahan/kecamatan/kota/jarak/ongkir atau verdict luar-jangkauan).
// Predikat field-riil LocationState (domain/types.ts:18-27) — tanpa field fiktif.
export function isLocationFullyResolved(session: { location?: { kelurahan?: string; kecamatan?: string; kota?: string; distanceKm?: number; ongkirNormal?: number; ongkirPromo?: number; isOutOfCoverage?: boolean; rawText?: string } } | null | undefined): boolean {
  const loc = session?.location as any;
  if (!loc) return false;
  if (loc.isOutOfCoverage === true) return true;
  if (loc.kelurahan || loc.kecamatan || loc.kota) return true;
  if (typeof loc.distanceKm === 'number' || typeof loc.ongkirPromo === 'number' || typeof loc.ongkirNormal === 'number') return true;
  return false;
}

/** Cache token inti kecamatan (lazy, data-driven dari gazetteer runtime). */
let kecamatanCoreTokensCache: Set<string> | null = null;
function getKecamatanCoreTokens(): Set<string> {
  if (kecamatanCoreTokensCache) return kecamatanCoreTokensCache;
  const set = new Set<string>();
  try {
    for (const n of getGazetteerKecamatanNames() || []) {
      for (const tok of String(n || '').toLowerCase().split(/[^a-z0-9]+/)) {
        if (tok.length >= 6) set.add(tok);
      }
    }
  } catch {}
  kecamatanCoreTokensCache = set;
  return set;
}

export function hasNewLocationEntity(text: string | undefined): boolean {
  const input = text || '';
  const lower = input.toLowerCase();
  if (!lower.trim()) return false;
  // Pencocokan KATA UTUH (word-boundary) — bukan substring mentah. Mencegah
  // kata berimbuhan bahasa Indonesia (tertarik→Tarik, batuk→Batu,
  // antarkan→?, sekarang→Karang, kembali→Bali) dihaluskan jadi nama daerah.
  // Normalisasi hanya spasi (regex tokenisasi teknis, non-semantik).
  const textNormalized = ' ' + lower.replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  const textWords = new Set(lower.split(/[^a-z0-9]+/).filter(Boolean));
  try {
    if (findPopularLandmark(input) || resolveArteryCorridor(input)) return true;
  } catch {}
  // 1. Gazetteer kelurahan/desa: kata utuh (single) / frasa berbatas (multi).
  try {
    for (const [areaLower] of getGazetteerAreas().entries()) {
      if (areaLower.length >= 4) {
        if (areaLower.includes(' ')) {
          if (textNormalized.includes(' ' + areaLower + ' ')) return true;
        } else if (textWords.has(areaLower)) {
          return true;
        }
      }
    }
  } catch {}
  // 2. Gazetteer kecamatan: kata utuh / frasa berbatas.
  try {
    const kecNames = getGazetteerKecamatanNames() || [];
    for (const n of kecNames) {
      if (n && n.length >= 4) {
        const nl = n.toLowerCase();
        if (nl.includes(' ')) {
          if (textNormalized.includes(' ' + nl + ' ')) return true;
        } else if (textWords.has(nl)) {
          return true;
        }
      }
    }
  } catch {}
  // 3. Typo-tolerant 1-huruf terpusat (shared utils/typo-match) — HANYA token
  // kata utuh mandiri, panjang selisih ≤1, agar "sedti"→"sedati" tertangani
  // tanpa membocorkan kata berimbuhan panjang (tertarik vs tarik).
  try {
    const toks = Array.from(textWords).filter((t) => t.length >= 5);
    if (toks.length > 0) {
      for (const [areaLower] of getGazetteerAreas().entries()) {
        if (areaLower.length >= 5 && !areaLower.includes(' ')) {
          if (toks.some((t) => Math.abs(t.length - areaLower.length) <= 1 && isTypoAtMostOne(t, areaLower))) return true;
        }
      }
      for (const n of getGazetteerKecamatanNames() || []) {
        const nl = String(n || '').toLowerCase();
        if (nl.length >= 5 && !nl.includes(' ')) {
          if (toks.some((t) => Math.abs(t.length - nl.length) <= 1 && isTypoAtMostOne(t, nl))) return true;
        }
      }
    }
  } catch {}
  // 4. Token inti kecamatan (kata utuh saja) — anti-amnesia domisili parsial.
  try {
    for (const tok of getKecamatanCoreTokens()) {
      if (textWords.has(tok)) return true;
    }
  } catch {}
  // 5. Kota luar cakupan (kata utuh: "bali" tidak cocok dengan "kembali").
  try {
    const outside = getOutsideCities() || [];
    for (const c of outside) {
      const name = String(c || '').toLowerCase();
      if (name.length >= 3) {
        if (name.includes(' ')) {
          if (textNormalized.includes(' ' + name + ' ')) return true;
        } else if (textWords.has(name)) {
          return true;
        }
      }
    }
  } catch {}
  // 6. Kota cakupan utama (kata utuh).
  try {
    const coverage = getCoverageCities() || [];
    for (const c of coverage) {
      const name = String(c || '').toLowerCase();
      if (name.length >= 3) {
        if (name.includes(' ')) {
          if (textNormalized.includes(' ' + name + ' ')) return true;
        } else if (textWords.has(name)) {
          return true;
        }
      }
    }
  } catch {}
  // 7. Link Google Maps.
  if (lower.includes('google.com/maps') || lower.includes('goo.gl') || lower.includes('share.google') || lower.includes('maps.app')) {
    return true;
  }
  // 8. Penanda jalan/perumahan (kata utuh).
  const STREET_MARKERS = new Set([
    'jl', 'jln', 'jalan', 'gang', 'gg', 'perum', 'perumahan',
    'komplek', 'kompleks', 'blok', 'cluster', 'ruko', 'patokan',
  ]);
  return Array.from(textWords).some((w) => STREET_MARKERS.has(w));
}

export interface ToolMaskingEvaluation {
  /** Daftar tool yang diizinkan untuk dikirim ke LLM jika dalam enforce mode */
  availableTools: any[];
  /** Nama-nama tool yang disembunyikan (di-mask) */
  maskedToolNames: string[];
  /** Status apakah save_reservation diizinkan */
  isSaveReservationAllowed: boolean;
  /** Alasan penolakan / pembukaan masking */
  reason: string;
  /**
   * Indikasi kecurigaan 'over-restrictive' (kebablasan menutup):
   * True bila ada indikasi kata waktu/jadwal dari customer tetapi belum
   * lolos date confirmation (misal bertanda tanya atau format belum pas).
   * Digunakan untuk audit trail manual review sebelum enforce mode.
   */
  suspectOverRestrictive: boolean;
}

/**
 * Merakit bukti teks (evidenceTexts) dari riwayat percakapan dan pesan masuk saat ini.
 * Mempertahankan urutan kronologis pesan user.
 */
export function buildEvidenceTexts(
  cleanIncomingText: string,
  session: CustomerGoalSession,
  conversationHistory?: Array<{ role: string; content: string }>
): string[] {
  const texts: string[] = [];
  if (conversationHistory && conversationHistory.length > 0) {
    for (const h of conversationHistory) {
      if (h.role === 'user' && typeof h.content === 'string' && h.content.trim()) {
        texts.push(h.content.trim());
      }
    }
  }
  if (cleanIncomingText && cleanIncomingText.trim()) {
    // Hindari duplikasi jika pesan terakhir di history identik dengan cleanIncomingText
    const last = texts[texts.length - 1];
    if (last !== cleanIncomingText.trim()) {
      texts.push(cleanIncomingText.trim());
    }
  }
  return texts;
}

/**
 * Mendeteksi target booking date kandidat dari session atau teks customer.
 */
export function resolveCandidateBookingDate(
  session: CustomerGoalSession,
  cleanIncomingText: string,
  evidenceTexts: string[]
): string | undefined {
  if (session.booking?.preferredDate?.trim()) {
    return session.booking.preferredDate.trim();
  }
  if (session.booking?.requestedTimeHint?.trim()) {
    return session.booking.requestedTimeHint.trim();
  }

  // Cari kemunculan kata waktu pertama dari pesan masuk terkini
  const incomingLower = (cleanIncomingText || '').toLowerCase();
  for (const word of DAY_EVIDENCE_WORDS) {
    if (incomingLower.includes(word)) {
      return word;
    }
  }

  // Jika tidak ada di pesan masuk, cari dari riwayat pesan user terbaru (mundur)
  for (let i = evidenceTexts.length - 1; i >= 0; i--) {
    const textLower = (evidenceTexts[i] || '').toLowerCase();
    for (const word of DAY_EVIDENCE_WORDS) {
      if (textLower.includes(word)) {
        return word;
      }
    }
  }

  return undefined;
}

/**
 * Resolusi kandidat treatment anaphoric (Fase 1 enforce-gap): customer
 * menyetujui paket TANPA mengulang nama lengkap ("Oke jadwalkan besok lusa
 * ya mbak") setelah asisten merekomendasikan/memberi harga suatu layanan.
 *
 * Rekonsiliasi dengan audit 973126 (hanya USER yang boleh menyetujui):
 * persetujuan TETAP harus datang dari sinyal komitmen di pesan user saat ini;
 * riwayat asisten HANYA mengidentifikasi paket mana yang dimaksud (bukan
 * dianggap persetujuan). Tanpa sinyal komitmen → undefined (tetap diblokir).
 *
 * Murni, deterministik; pola `*Nama*` adalah penanda format markdown teknis
 * (bukan hafalan semantik) — nama valid apa pun yang tertulis di-bold lolos.
 */
export function resolveCandidateTreatment(
  session: CustomerGoalSession,
  cleanIncomingText: string,
  conversationHistory?: Array<{ role: string; content: string }>
): string | undefined {
  if (session.selectedTreatment?.trim()) return session.selectedTreatment.trim();
  if (session.cartItems && session.cartItems.length > 0) return session.cartItems[0].name;
  const lower = (cleanIncomingText || '').toLowerCase();
  // Fondasional: pertanyaan konsultatif murni (nama + ?) bukan komitmen — DILARANG seed treatment
  if (isConsultativeUserText(cleanIncomingText, session as any)) return undefined;
  const hasCommitSignal = hasBookingCommitSignal(lower);
  if (!hasCommitSignal || !conversationHistory) return undefined;

  const tenantId = (session as any).tenantId || (session as any).tenant_id || DEFAULT_TENANT_ID;
  const allServices = treatmentCatalogService.getAllServices(true, tenantId) || [];
  if (allServices.length === 0) return undefined;

  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const msg = conversationHistory[i];
    if (msg.role === 'assistant') {
      const content = msg.content || '';

      // 1. Bold *Nama Layanan* — exact + normalized (toleransi varian usia/parenthesis katalog berevolusi)
      const boldMatches = content.matchAll(/\*([^*]+)\*/g);
      for (const m of boldMatches) {
        const candidate = m[1].trim();
        if (!candidate) continue;
        const matched = allServices.find((s) => s.name.toLowerCase() === candidate.toLowerCase());
        if (matched) return matched.name;
        // Toleransi varian: "Pijat Lahap Juara (Nafsu Makan)" vs "Pijat Lahap Juara (< 2 thn)" → norm tanpa () harus sama
        const normCand = candidate.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
        const normMatched = allServices.find((s) => {
          const norm = s.name.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
          return norm && norm === normCand;
        });
        if (normMatched) return candidate; // kembalikan teks bold asli agar test & histori konsisten, tetap sah karena norm katalog terverifikasi
      }

      // 2. Fallback substring tanpa bold — urut terpanjang dulu cegah partial
      const contentLower = content.toLowerCase();
      const sorted = [...allServices].sort((a, b) => b.name.length - a.name.length);
      for (const s of sorted) {
        if (s.name.length >= 5 && contentLower.includes(s.name.toLowerCase())) {
          return s.name;
        }
        // Fallback norm juga untuk varian tanpa () di content plain
        const norm = s.name.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (norm.length >= 5 && contentLower.includes(norm)) {
          return s.name;
        }
      }
    }
  }
  return undefined;
}

/**
 * Evaluasi penyaringan tool (Tool Masking) secara deterministik.
 *
 * Aturan untuk save_reservation:
 * 1. Keranjang layanan tidak boleh kosong — session.cartItems/selectedTreatment
 *    ATAU kandidat anaphoric sah (komitmen user + paket terakhir asisten).
 * 2. Lokasi tidak boleh kosong (minimal salah satu kelurahan/kecamatan/kota/rawText).
 * 3. Tanggal/hari wajib terkonfirmasi via isDateConfirmed(candidateDate, evidenceTexts).
 *    Jika tanggal hanya berasal dari kalimat tanya ("Bisa hari Sabtu?"), fail-closed menolak booking.
 */
export function evaluateToolMasking(
  allTools: any[] = ALL_V3_TOOLS,
  session: CustomerGoalSession,
  cleanIncomingText: string,
  conversationHistory?: Array<{ role: string; content: string }>
): ToolMaskingEvaluation {
  const evidenceTexts = buildEvidenceTexts(cleanIncomingText, session, conversationHistory);
  const candidateDate = resolveCandidateBookingDate(session, cleanIncomingText, evidenceTexts);

  // 1. Cek prasyarat layanan/treatment (termasuk resolusi anaphoric sah).
  const candidateTreatment = resolveCandidateTreatment(session, cleanIncomingText, conversationHistory);
  const hasTreatment =
    (session.cartItems && session.cartItems.length > 0) ||
    Boolean(session.selectedTreatment) ||
    Boolean(candidateTreatment);

  // 2. Cek prasyarat lokasi
  const hasLocation = Boolean(
    session.location?.kelurahan ||
    session.location?.kecamatan ||
    session.location?.kota ||
    session.location?.rawText
  );

  // 3. Panggil isDateConfirmed dengan signature ASLI: isDateConfirmed(bookingDate, evidence)
  const dateVerdict = isDateConfirmed(candidateDate, evidenceTexts);

  // Deteksi indikasi kata waktu dari customer untuk audit over-restrictive
  const allUserTextsCombined = evidenceTexts.join(' ').toLowerCase();
  const containsAnyTimeWord =
    DAY_EVIDENCE_WORDS.some((w) => allUserTextsCombined.includes(w)) ||
    SAME_DAY_EVIDENCE_ALIASES.some((a) => allUserTextsCombined.includes(a));

  let isSaveReservationAllowed = false;
  let reason = '';
  let suspectOverRestrictive = false;

  // Aturan 4 (Rule 5 — Active User Commitment Gate, sticky): hari/tanggal
  // terkonfirmasi saja TIDAK cukup. Customer yang baru menjawab preferensi
  // hari tentatif ("Besok, tpi bisanya siang diatas jam 1") atau menyebut
  // tanggal saat menjawab pertanyaan asisten BUKAN komitmen booking final.
  // Dua sumber komitmen (satu sumber kebenaran verba: hasBookingCommitSignal):
  // (a) flag lengket session.bookingCommitConfirmed (diset di lintas turn oleh
  //     ContextGrounder.applySessionLatches) — agar jawaban hari di turn
  //     terpisah TETAP membuka booking;
  // (b) verba komitmen pada pesan saat ini (komitmen + hari dalam satu turn).
  const hasCommitment = session.bookingCommitConfirmed === true
    || hasBookingCommitSignal(cleanIncomingText);

  // Fase 2.2/2.3: pertanyaan ketersediaan slot TANPA '?' bukan komitmen final.
  const availabilityInquiry = isAvailabilityInquiryText(cleanIncomingText);

  if (!hasTreatment) {
    isSaveReservationAllowed = false;
    reason = 'TREATMENT_EMPTY: Layanan/keranjang belum dipilih';
  } else if (!hasLocation) {
    isSaveReservationAllowed = false;
    reason = 'LOCATION_EMPTY: Lokasi/domisili customer belum diketahui';
  } else if (availabilityInquiry && !session.bookingCommitConfirmed) {
    // Customer menanyakan ketersediaan slot ("sabtu jam 10 kosong gak") tanpa
    // komitmen lengket lintas-turn → DILARANG buka save_reservation.
    isSaveReservationAllowed = false;
    reason = 'AVAILABILITY_INQUIRY: Customer menanyakan ketersediaan slot, belum menyetujui booking final';
    if (containsAnyTimeWord) suspectOverRestrictive = true;
  } else if (!dateVerdict.confirmed) {
    isSaveReservationAllowed = false;
    reason = `DATE_NOT_CONFIRMED: ${dateVerdict.rejectionReason || 'Hari/tanggal belum disepakati'}`;

    // Jika customer pernah menyebut kata waktu tetapi gate menolak (misal karena tanda tanya),
    // tandai sebagai suspectOverRestrictive untuk keperluan audit review.
    if (containsAnyTimeWord) {
      suspectOverRestrictive = true;
    }
  } else if (!hasCommitment) {
    // Hari/tanggal sudah disebut, tetapi customer belum memberi komitmen final
    // (baru memilih hari/jam tentatif sebagai respon pertanyaan asisten).
    isSaveReservationAllowed = false;
    reason = 'BOOKING_COMMIT_PENDING: Customer menyebut preferensi hari/jam tentatif, belum memberikan persetujuan final booking';
    if (containsAnyTimeWord) {
      suspectOverRestrictive = true;
    }
  } else {
    isSaveReservationAllowed = true;
    reason = 'ALL_PRECONDITIONS_MET: Layanan, lokasi, tanggal, dan komitmen booking terkonfirmasi';
  }

  const maskedToolNames: string[] = [];
  if (!isSaveReservationAllowed) {
    maskedToolNames.push('save_reservation');
  }
  // State-gate deterministik (anti-recycle 337880 "Waru Kepuh"):
  // - Bila ada entitas lokasi baru → BUKA (LLM/geocoding validasi)
  // - Bila respons pendek (≤4 kata) pasca-tanya-domisili walau typo → BUKA (Sesi 640820 "bngurasi berapa kak")
  // - Selain itu → TUTUP (jangan hitung ulang kota luas / jangan bocorkan calculate_delivery untuk pure "biayanya brp")
  const isAskedLocationRecentlyForMask = (() => {
    try {
      const recent = (conversationHistory || []).filter((h) => h.role === 'assistant').slice(-2);
      return recent.some((m) => {
        const c = (m.content || '').toLowerCase();
        return c.includes('daerah atau kelurahan') || c.includes('kelurahan mana') || c.includes('rumah bunda dimana') || c.includes('rumah bunda di mana') || c.includes('rumahnya dimana') || c.includes('rumahnya di mana') || c.includes('daerah mana') || c.includes('lokasi rumah') || c.includes('alamat rumah') || c.includes('tinggal dimana') || c.includes('tinggal di mana');
      });
    } catch { return false; }
  })();
  const customerWordsForMask = (cleanIncomingText || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  // Saringan murni-minat deterministik: jawaban pendek pasca-tanya-domisili yang
  // sejatinya sapaan/minat pembuka ("saya tertarik kak") DILARANG membuka
  // calculate_delivery — memakai detektor lead-greeting yang sudah ada (bukan
  // daftar hafalan baru). Jawaban lokasi/typo ("bngurasi berapa kak") tetap lolos.
  const isPureInterestOnly = (() => {
    try { return isPureLeadGreeting(cleanIncomingText).isLeadGreeting; } catch { return false; }
  })();
  const isShortCompositeResponse = isAskedLocationRecentlyForMask && !isLocationFullyResolved(session) && customerWordsForMask.length > 0 && customerWordsForMask.length <= 4 && !isPureInterestOnly;
  const hasLocationEntity = hasNewLocationEntity(cleanIncomingText) || isShortCompositeResponse;
  if (!hasLocationEntity) {
    maskedToolNames.push('calculate_delivery');
  }

  const availableTools = allTools.filter(
    (t: any) => !maskedToolNames.includes(t.function?.name || t.name)
  );

  return {
    availableTools,
    maskedToolNames,
    isSaveReservationAllowed,
    reason,
    suspectOverRestrictive,
  };
}

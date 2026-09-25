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
} from '../../utils/date-confirmation';
import { getGazetteerAreas, getGazetteerKecamatanNames } from '../../utils/gazetteer';
import { findPopularLandmark, resolveArteryCorridor } from '../../config/landmarks';
import { getOutsideCities, getCoverageCities } from '../../config/coverage';
import { isTypoAtMostOne } from '../../utils/typo-match';
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
  try {
    if (findPopularLandmark(input) || resolveArteryCorridor(input)) return true;
  } catch {}
  try {
    for (const [areaLower] of getGazetteerAreas().entries()) {
      if (areaLower.length >= 4 && lower.includes(areaLower)) return true;
    }
  } catch {}
  try {
    const kecNames = getGazetteerKecamatanNames() || [];
    for (const n of kecNames) {
      if (n && n.length >= 4 && lower.includes(n.toLowerCase())) return true;
    }
  } catch {}
  // Typo-tolerant 1-huruf terpusat (shared utils/typo-match): token ≥5 agar "sedti"(5)→"sedati"(6) tertangani, tetap aman vs "waru"(4)/"sby"(3) yang tertahan ≥5
  try {
    const toks = lower.split(/[^a-z0-9]+/).filter((t) => t.length >= 5);
    if (toks.length > 0) {
      for (const [areaLower] of getGazetteerAreas().entries()) {
        if (areaLower.length >= 5 && toks.some((t) => isTypoAtMostOne(t, areaLower))) return true;
      }
      for (const n of getGazetteerKecamatanNames() || []) {
        const nl = String(n || '').toLowerCase();
        if (nl.length >= 5 && toks.some((t) => isTypoAtMostOne(t, nl))) return true;
      }
    }
  } catch {}
  // Plan regresi Fase 6 (anti-amnesia jawaban domisili): nama kecamatan yang
  // disebut PARSIAL inti ("Di tenggilis kak" ⊂ "Tenggilis Mejoyo") TETAP
  // membuka calculate_delivery — presisi (kelurahan vs kecamatan luas)
  // diputuskan TOOL via jalur broad-region, bukan masker. Token inti ≥6
  // huruf dicocokkan KATA UTUH (bukan substring) agar "Waru" (basecamp,
  // 4 huruf) tetap tertutup anti-asumsi domisili. Fail-open di sini AMAN:
  // tool sendiri memvalidasi & meminta detail bila terlalu luas.
  try {
    for (const tok of getKecamatanCoreTokens()) {
      if (lower.split(/[^a-z0-9]+/).includes(tok)) return true;
    }
  } catch {}
  try {
    const outside = getOutsideCities() || [];
    for (const c of outside) {
      const name = String(c || '').toLowerCase();
      if (name.length >= 3 && lower.includes(name)) return true;
    }
  } catch {}
  try {
    const coverage = getCoverageCities() || [];
    for (const c of coverage) {
      const name = String(c || '').toLowerCase();
      if (name.length >= 3 && lower.includes(name)) return true;
    }
  } catch {}
  const l = lower;
  if (l.includes('google.com/maps') || l.includes('goo.gl') || l.includes('share.google') || l.includes('maps.app')) {
    return true;
  }
  // Token kata utuh (strip tepi non-alnum): presisi tanpa \b-regex.
  const stripEdge = (t: string): string => {
    let s = t;
    while (s.length > 0) {
      const c = s.charCodeAt(0);
      if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122)) break;
      s = s.slice(1);
    }
    while (s.length > 0) {
      const c = s.charCodeAt(s.length - 1);
      if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122)) break;
      s = s.slice(0, -1);
    }
    return s;
  };
  const STREET_MARKERS = new Set([
    'jl', 'jln', 'jalan', 'gang', 'gg', 'perum', 'perumahan',
    'komplek', 'kompleks', 'blok', 'cluster', 'ruko', 'patokan',
  ]);
  const toks = lower.split(' ').map(stripEdge).filter((t) => t.length > 0);
  return toks.some((t) => STREET_MARKERS.has(t));
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

  if (!hasTreatment) {
    isSaveReservationAllowed = false;
    reason = 'TREATMENT_EMPTY: Layanan/keranjang belum dipilih';
  } else if (!hasLocation) {
    isSaveReservationAllowed = false;
    reason = 'LOCATION_EMPTY: Lokasi/domisili customer belum diketahui';
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
  const isShortCompositeResponse = isAskedLocationRecentlyForMask && !isLocationFullyResolved(session) && customerWordsForMask.length > 0 && customerWordsForMask.length <= 4;
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

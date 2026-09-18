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
} from '../../utils/date-confirmation';
import { getGazetteerAreas, getGazetteerKecamatanNames } from '../../utils/gazetteer';
import { findPopularLandmark, resolveArteryCorridor } from '../../config/landmarks';
import { getOutsideCities } from '../../config/coverage';

/**
 * Detektor entitas lokasi baru (sesi 337880, Issue 2): true bila pesan
 * customer SAAT INI menyebut nama daerah/kelurahan/kecamatan, landmark
 * perumahan Tier-0, koridor arteri, penanda jalan (jl/gang/perum/komplek/
 * blok/patokan), kota luar cakupan (Tuban/Lamongan — butuh verdict tool!),
 * atau link Google Maps. Murni, data-driven (gazetteer/landmark/koridor/
 * coverage runtime + token kata utuh ala extractFastIntents — tanpa regex
 * semantik). Tanpa entitas → calculate_delivery di-mask fisik.
 */
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
  const hasCommitSignal = hasBookingCommitSignal(lower);
  if (!hasCommitSignal || !conversationHistory) return undefined;
  // Pindai mundur riwayat asisten: paket katalog terakhir yang ditawarkan
  // (bold *Nama*) adalah kandidat yang dimaksud customer.
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const msg = conversationHistory[i];
    if (msg.role === 'assistant') {
      const content = msg.content || '';
      const match = content.match(/\*(Pijat [^*]+|Oksitosin [^*]+|Cukur [^*]+|Paket [^*]+|Prenatal [^*]+|Sinar [^*]+)\*/i);
      if (match) return match[1].trim();
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
  // Sesi 337880 Issue 2: tanpa entitas lokasi baru di pesan SAAT INI,
  // calculate_delivery dicabut fisik (anti-recycle "Waru Kepuh" dari riwayat
  // saat customer hanya bertanya kuota/jadwal/harga/sapaan).
  if (!hasNewLocationEntity(cleanIncomingText)) {
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

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
} from '../../utils/date-confirmation';

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
 * Evaluasi penyaringan tool (Tool Masking) secara deterministik.
 *
 * Aturan untuk save_reservation:
 * 1. Keranjang layanan tidak boleh kosong (session.cartItems > 0 atau session.selectedTreatment).
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

  // 1. Cek prasyarat layanan/treatment
  const hasTreatment =
    (session.cartItems && session.cartItems.length > 0) ||
    Boolean(session.selectedTreatment);

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
  } else {
    isSaveReservationAllowed = true;
    reason = 'ALL_PRECONDITIONS_MET: Layanan, lokasi, dan tanggal terkonfirmasi';
  }

  const maskedToolNames: string[] = [];
  if (!isSaveReservationAllowed) {
    maskedToolNames.push('save_reservation');
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

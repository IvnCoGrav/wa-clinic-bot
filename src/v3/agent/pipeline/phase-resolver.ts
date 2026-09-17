/**
 * phase-resolver.ts (Fase 2 — dekomposisi context-grounder).
 *
 * Derivasi fase percakapan + direktif Call-1 dari session state (murni,
 * deterministik, 0 token). Diekstrak verbatim dari context-grounder.ts;
 * context-grounder.ts kini mendelegasikan ke sini.
 */
import type { CustomerGoalSession } from '../../state/goal-tracker';
import { ConversationState } from '@prisma/client';

/** Fase percakapan deterministik (derivasi dari session state, bukan keyword). */
export type ConversationPhase =
  | 'GREETING'
  | 'LOCATION_KNOWN'
  | 'ONGKIR_QUOTED'
  | 'TREATMENT_DISCUSSED'
  | 'SCHEDULING'
  | 'GENERAL';

/**
 * Derivasi fase percakapan dari session state (deterministik, 0 token).
 * Prioritas: SCHEDULING > TREATMENT_DISCUSSED > ONGKIR_QUOTED > LOCATION_KNOWN > GREETING > GENERAL.
 * Fase paling maju menang agar guidance Call 1 context-aware berdasar state,
 * bukan per-keyword — fix fondational Akar 2.
 */
export function deriveConversationPhase(session: CustomerGoalSession, isFollowUp = false): ConversationPhase {
  if (session.booking?.preferredDate != null || session.booking?.reservationId != null) {
    return 'SCHEDULING';
  }
  if (session.selectedTreatment != null || (session.cartItems && session.cartItems.length > 0)) {
    return 'TREATMENT_DISCUSSED';
  }
  if (session.ongkirStatus === 'QUOTED' || session.ongkirStatus === 'CONFIRMED') {
    return 'ONGKIR_QUOTED';
  }
  if (session.location?.kelurahan || session.location?.distanceKm != null) {
    return 'LOCATION_KNOWN';
  }
  if (!isFollowUp) {
    return 'GREETING';
  }
  return 'GENERAL';
}

/**
 * Template directive per fase — disisipkan ke system prompt sebelum Call 1.
 * Semua tool tetap dikirim di tools[] (tidak disembunyikan); LLM diarahkan
 * via instruksi eksplisit — lebih robust untuk model kecil daripada
 * dynamic tool filtering yang rapuh bila ada case tak terduga.
 * Directive tambahan di-stack berdasar session (mis. ongkir quoted +
 * treatment discussed sekaligus) agar tidak kehilangan guard fase lampau.
 */
export function buildPhaseDirective(phase: ConversationPhase, session: CustomerGoalSession): string {
  const lines: string[] = [`[FASE PERCAKAPAN: ${phase}]`];
  const kelurahan = session.location?.kelurahan || session.location?.kecamatan || '';
  const distanceKm = session.location?.distanceKm;
  const ongkirQuoted = session.ongkirStatus === 'QUOTED' || session.ongkirStatus === 'CONFIRMED';
  const hasTreatment = session.selectedTreatment != null || (session.cartItems && session.cartItems.length > 0);
  const hasBooking = session.booking?.preferredDate != null || session.booking?.reservationId != null;

  switch (phase) {
    case 'GREETING':
      lines.push('• Percakapan baru. Semua tool tersedia sesuai kebutuhan customer.');
      break;
    case 'LOCATION_KNOWN':
      lines.push('• Lokasi customer sudah diketahui. calculate_delivery masih boleh dipakai untuk menghitung ongkir alamat tersebut.');
      break;
    case 'ONGKIR_QUOTED':
      lines.push(
        `• Ongkir ke ${kelurahan || 'lokasi customer'}${distanceKm != null ? ` (${distanceKm} km)` : ''} sudah dihitung & disampaikan. JANGAN panggil calculate_delivery kecuali customer mengirim alamat BARU yang berbeda.`,
        '• Fokus: jawab pertanyaan customer saat ini. Jangan mengulang hitungan jarak/ongkir.'
      );
      break;
    case 'TREATMENT_DISCUSSED':
      lines.push(
        `• Treatment sudah dibahas${session.selectedTreatment ? `: ${session.selectedTreatment}` : ''}. get_catalog_and_price dipanggil bila customer menanyakan durasi (isi asksDuration:true), rincian harga/promo (isi inquirePrice:true), kesesuaian usia/kategori si kecil, atau treatment BARU/berbeda.`,
        '• Jangan menanyakan ulang "rencana mau treatment apa" dari awal.'
      );
      break;
    case 'SCHEDULING': {
      const awaitingSlot = session.booking?.pendingScheduleCheck === true && session.booking?.reservationId == null;
      if (awaitingSlot) {
        lines.push(
          `• Jadwal sedang dalam proses pengecekan ketersediaan slot${session.booking?.requestedTimeHint ? `: ${session.booking.requestedTimeHint}` : session.booking?.preferredDate ? `: ${session.booking.preferredDate} ${session.booking.preferredTime || ''}`.trimEnd() : ''}. save_reservation DILARANG DIPANGGIL sebelum customer menyetujui booking final.`,
          '• Jangan menanyakan ulang hari jadwal yang sudah disampaikan customer.'
        );
      } else {
        lines.push(
          `• Jadwal sudah dibahas${session.booking?.preferredDate ? `: ${session.booking.preferredDate} ${session.booking.preferredTime || ''}`.trimEnd() : ''}. save_reservation tersedia bila data reservasi lengkap.`,
          '• Jangan menanyakan ulang hari jadwal yang sudah disepakati.'
        );
      }
      break;
    }
    case 'GENERAL':
    default:
      lines.push('• Jawab pertanyaan customer saat ini berdasar konteks yang sudah diketahui.');
      lines.push('• Bila pertanyaan soal jadwal dan lokasi customer belum diketahui: dahulukan tanya domisili netral (aturan persona 5a) di atas pola "cekkan/infokan".');
      // Sesi 381894 (anti-requery wilayah luas): kota luas yang sudah ditagih
      // kelurahannya DILARANG dihitung ulang — JANGAN panggil calculate_delivery
      // kecuali customer menyebut kelurahan/perumahan/jalan baru.
      lines.push('• Wilayah luas yang sudah ditanyakan kelurahannya DILARANG dihitung ulang: JANGAN panggil calculate_delivery kecuali customer menyebutkan kelurahan/perumahan/jalan/patokan baru. Pertanyaan harga/paket ("berapa", "biaya", "treatment apa saja") dijawab dari katalog/konteks, bukan dari hitungan ulang kota luas.');
      break;
  }

  // Stacked guards: fase lampau yang tetap berlaku di fase maju.
  if (phase !== 'ONGKIR_QUOTED' && ongkirQuoted) {
    lines.push(
      `• (Konteks fase lampau) Ongkir ke ${kelurahan || 'lokasi customer'} sudah disampaikan. JANGAN panggil calculate_delivery kecuali ada alamat BARU.`
    );
  }
  if ((phase === 'SCHEDULING' || phase === 'ONGKIR_QUOTED' || phase === 'GENERAL') && hasTreatment) {
    lines.push(
      `• (Konteks fase lampau) Treatment sudah dibahas${session.selectedTreatment ? `: ${session.selectedTreatment}` : ''} — jangan tanya ulang dari awal.`
    );
  }
  if (phase !== 'SCHEDULING' && hasBooking) {
    lines.push('• (Konteks fase lampau) Jadwal sudah tercatat — jangan tawarkan ulang hari yang sudah final.');
  }
  return lines.join('\n');
}

/**
 * Turunan status state-machine dari session (reuse enum existing — tanpa migrasi):
 * lokasi terkonfirmasi → LOCATION_CONFIRMED; cart/treatment terisi → AWAITING_INTEREST;
 * jadwal ditanyakan → RESERVATION_SENT; reservasi tersimpan → COMPLETED.
 */
export function deriveConversationState(session: CustomerGoalSession, currentIntents: string[] = []): ConversationState {
  if (session.booking?.isConfirmed || session.booking?.reservationId) {
    return ConversationState.COMPLETED;
  }
  if (session.booking?.preferredDate || currentIntents.includes('ask_schedule')) {
    return ConversationState.RESERVATION_SENT;
  }
  if ((session.cartItems && session.cartItems.length > 0) || session.selectedTreatment) {
    return ConversationState.AWAITING_INTEREST;
  }
  if (session.location?.kelurahan || session.location?.distanceKm != null) {
    return ConversationState.LOCATION_CONFIRMED;
  }
  return ConversationState.INITIAL;
}

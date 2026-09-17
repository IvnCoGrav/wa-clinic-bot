/**
 * booking-commit-gate.ts (Fase 2 — dekomposisi context-grounder).
 *
 * Gerbang komitmen booking deterministik + deteksi layanan disepakati.
 * Diekstrak verbatim dari context-grounder.ts; context-grounder.ts kini
 * mendelegasikan ke sini. Dependensi rendah: date-confirmation kanonis
 * (utils, bukan tool) + tipe sesi — tanpa siklus impor.
 */
import type { CustomerGoalSession } from '../../state/goal-tracker';
import { DAY_EVIDENCE_WORDS, hasBookingCommitSignal } from '../../../utils/date-confirmation';

/**
 * Audit sesi 614425 (commit booking deterministik): true bila customer sudah
 * menyepakati treatment DAN menyebut hari/tanggal pada pesan saat ini atau
 * riwayat — sehingga save_reservation boleh/wajib dipaksa tanpa menyerahkan
 * keputusan ke judgment LLM. Reuse DAY_EVIDENCE_WORDS (data-driven includes,
 * tanpa regex baru). FALSE bila reservasi sudah tercatat (anti dobel-kunci).
 */
export function isBookingCommitReady(
  session: CustomerGoalSession,
  incomingText: string,
  history: Array<{ role: string; content: string }> = []
): boolean {
  const hasTreatment = session.selectedTreatment != null || (session.cartItems && session.cartItems.length > 0);
  if (!hasTreatment) return false;
  if (session.booking?.reservationId != null) return false;
  if (session.booking?.preferredDate != null) return false;

  // Prasyarat mutlak: Lokasi harus sudah diketahui (homecare klinik butuh rute terapis).
  // DILARANG memaksa save_reservation bila domisili/kelurahan/kecamatan belum ada!
  const hasLocation = Boolean(
    session.location?.kelurahan ||
    session.location?.kecamatan ||
    session.location?.kota ||
    session.location?.rawText
  );
  if (!hasLocation) return false;

  // Fail-closed pertanyaan slot (cermin Day Evidence Gate di kontrak tool):
  // giliran bertanda tanya BUKAN komitmen booking — DILARANG memaksa
  // save_reservation. Level tanda baca, bukan daftar hafalan baru.
  // Sesi 337880: pengecualian same-day DIHAPUS (koheren dengan day-gate).
  // Adopsi komitmen (sesi 180166 FM1, koheren dengan day-gate): verba
  // komitmen ("Ambil yang ... ya??") MENGADOPSI tanggal yang sudah terbukti
  // di evidence — '?' sopan DILARANG membatalkan komitmen transaksi.
  if ((incomingText || '').includes('?') && !hasBookingCommitSignal(incomingText)) return false;
  const haystack = [incomingText, ...history.filter((h) => h.role === 'user').map((h) => h.content)]
    .join(' ')
    .toLowerCase();
  return DAY_EVIDENCE_WORDS.some((w) => haystack.includes(w));
}

/**
 * Deteksi layanan katalog yang disepakati dari riwayat obrolan (data-driven:
 * pencocokan substring nama layanan katalog aktif, tanpa regex/daftar hardcode).
 * Dipindai dari pesan terbaru; nama terpanjang menang (paling spesifik).
 */
export function detectAgreedTreatment(
  history: Array<{ role: string; content: string }>,
  catalogNames: string[]
): string | null {
  if (!history || history.length === 0 || !catalogNames || catalogNames.length === 0) return null;
  const names = [...catalogNames]
    .filter((n) => n && n.trim().length >= 4)
    .sort((a, b) => b.length - a.length);
  for (let i = history.length - 1; i >= 0; i--) {
    // Fondasional sesi 973126: HANYA pesan customer (role === 'user') yang boleh
    // mengklaim persetujuan paket. Pesan asisten yang menyebut nama treatment
    // (rekomendasi/brosur) DILARANG dihitung sebagai customer setuju.
    if (history[i]?.role !== 'user') continue;
    const text = (history[i]?.content || '').toLowerCase();
    if (!text) continue;
    for (const name of names) {
      if (text.includes(name.toLowerCase())) return name;
    }
  }
  return null;
}

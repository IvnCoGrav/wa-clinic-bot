/**
 * dispatch-visit-context.ts — Kontrak domain murni deteksi kunjungan dispatch lapangan.
 *
 * Modul daun (zero import) untuk evaluasi indikator kunjungan Bidan/lapangan
 * tanpa reservasi aktif. Menghindari duplikasi logika dan menghentikan pembacaan
 * kata/nama file hafalan (anti-overfitting).
 */

export interface VisitMessageLike {
  direction?: string | null;
  sender_type?: string | null;
  content?: string | null;
  media?: any;
  location?: any;
  created_at?: string | Date | null;
  dispatchOrigin?: boolean | null;
  isFieldStaff?: boolean | null;
}

export interface VisitFieldState {
  hasTodayReservation: boolean;
  hasActiveTrip: boolean;
  hasOtwActive: boolean;
}

export const LOCATION_TAG_RE = /\[LOCATION[:\s]*Lat/i; // format mesin GPS — diizinkan

export function isWithinWibDay(createdAt: unknown, start: Date, end: Date): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt as any).getTime();
  if (isNaN(t)) return false;
  return t >= start.getTime() && t <= end.getTime();
}

export function hasFreshSharelocToday(msgs: VisitMessageLike[], s: Date, e: Date): boolean {
  return (msgs || []).some(
    (m) => isWithinWibDay(m.created_at, s, e) && Boolean((m as any).location || (m.content && LOCATION_TAG_RE.test(m.content)))
  );
}

// Media(segar, OUTBOUND, hari ini) + (asal-dispatch ATAU staf lapangan ATAU pesan terakhir) — tanpa baca nama file / caption.
export function hasFreshDispatchMediaToday(msgs: VisitMessageLike[], s: Date, e: Date): boolean {
  const fresh = (msgs || []).filter(
    (m) => (m.direction || '').toUpperCase() === 'OUTBOUND' && Boolean((m as any).media) && isWithinWibDay(m.created_at, s, e)
  );
  if (fresh.length === 0) return false;
  if (fresh.some((m) => m.dispatchOrigin === true || m.isFieldStaff === true)) return true;
  const last = (msgs || [])[(msgs || []).length - 1];
  return Boolean(
    last &&
      (last.direction || '').toUpperCase() === 'OUTBOUND' &&
      (last as any).media &&
      isWithinWibDay(last.created_at, s, e)
  );
}

export function shouldWarnUnregisteredVisit(args: {
  messages: VisitMessageLike[];
  dayStart: Date;
  dayEnd: Date;
  field: VisitFieldState;
}): boolean {
  if (args.field.hasTodayReservation || args.field.hasActiveTrip || args.field.hasOtwActive) return false;
  return (
    hasFreshSharelocToday(args.messages, args.dayStart, args.dayEnd) ||
    hasFreshDispatchMediaToday(args.messages, args.dayStart, args.dayEnd)
  );
}

/**
 * dispatchVisitContext.ts — Kontrak domain murni cermin untuk dashboard admin.
 *
 * Sinkron 1:1 dengan src/domain/dispatch-visit-context.ts (backend).
 * Nol impor pihak ketiga / nol dependensi framework.
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

// Gambar segar + OUTBOUND (pesan keluar) + hari WIB ini + ADA cap asal.
// Tanpa cap = bukan bukti lapangan (brosur, bukti bayar, katalog).
export function hasFreshDispatchMediaToday(msgs: VisitMessageLike[], s: Date, e: Date): boolean {
  const fresh = (msgs || []).filter(
    (m) => (m.direction || '').toUpperCase() === 'OUTBOUND' && Boolean((m as any).media) && isWithinWibDay(m.created_at, s, e)
  );
  if (fresh.length === 0) return false;
  return fresh.some((m) => m.dispatchOrigin === true || m.isFieldStaff === true);
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

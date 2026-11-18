/**
 * reservationOwnership.ts — Seam tunggal kepemilikan reservasi untuk UI Live Chat.
 * Invarian: reservasi hanya boleh tampil pada chat bila owner === customerId chat.
 */
import { isConfirmedFamilyStatus } from './reservationStatus';

const HOLD_STALE_TOLERANCE_MS = 2 * 60 * 60 * 1000;

export interface OwnedActiveReservations {
  activeHold: any | null;
  activeConfirmed: any | null;
  activePending: any | null;
  hasActiveHold: boolean;
  hasUpcomingBooking: boolean;
  hasPendingBooking: boolean;
}

export function resolveReservationOwnerId(reservation: any): string | null {
  if (!reservation || typeof reservation !== 'object') return null;
  const owner = reservation.customer_id ?? reservation.customerId ?? reservation.customer?.id ?? null;
  return owner ? String(owner) : null;
}

export function isReservationOwnedBy(reservation: any, customerId: string | null | undefined): boolean {
  if (!customerId) return false;
  return resolveReservationOwnerId(reservation) === String(customerId);
}

export function filterOwnedReservations(reservations: unknown, customerId: string | null | undefined): any[] {
  if (!Array.isArray(reservations) || !customerId) return [];
  return reservations.filter((r) => isReservationOwnedBy(r, customerId));
}

export function pickOwnedActiveReservations(
  reservations: unknown,
  customerId: string | null | undefined,
  now: Date = new Date()
): OwnedActiveReservations {
  const owned = filterOwnedReservations(reservations, customerId);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const nowMs = now.getTime();
  const activeHold = owned.find((r) => {
    if (!r || r.status !== 'hold' || !r.booking_date) return false;
    const bd = new Date(r.booking_date).getTime();
    return !Number.isNaN(bd) && bd >= nowMs - HOLD_STALE_TOLERANCE_MS;
  }) || null;
  const activeConfirmed = owned.find((r) => {
    if (!r || !isConfirmedFamilyStatus(r.status) || !r.booking_date) return false;
    const bd = new Date(r.booking_date).getTime();
    return !Number.isNaN(bd) && bd >= startOfToday.getTime();
  }) || null;
  const activePending = owned.find((r) => r?.status === 'pending') || null;
  return {
    activeHold,
    activeConfirmed,
    activePending,
    hasActiveHold: Boolean(activeHold),
    hasUpcomingBooking: Boolean(activeConfirmed),
    hasPendingBooking: Boolean(activePending),
  };
}

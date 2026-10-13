/**
 * sharelocCardStatus.ts — Logika murni penentuan status kartu peringatan shareloc di dashboard admin.
 *
 * Menerapkan prinsip modularity-first & anti-god-object:
 * Nol impor komponen React, nol efek samping DOM.
 * Konsisten dengan backend shareloc-signal.service.ts.
 */

import { resolveEffectiveLocationSource, isPreciseLocationSource } from './geoUtils';
import { getWibDateKey } from './dateWib';

export interface SharelocCardStatus {
  needed: boolean;
  urgent: boolean;
  label: string | null;
  badgeClass: string | null;
  borderClass: string | null;
  reason: string;
}

export function getSharelocCardStatus(chat: any, now: Date = new Date()): SharelocCardStatus {
  if (!chat) {
    return {
      needed: false,
      urgent: false,
      label: null,
      badgeClass: null,
      borderClass: null,
      reason: 'no_chat',
    };
  }

  // 1. Cek reservasi aktif (confirmed, en_route, atau hold)
  const activeRes = chat.activeConfirmedReservation || chat.activeHoldReservation || null;
  if (!activeRes) {
    return {
      needed: false,
      urgent: false,
      label: null,
      badgeClass: null,
      borderClass: null,
      reason: 'no_active_reservation',
    };
  }

  // 2. Cek apakah koordinat sudah presisi
  const rawLoc =
    chat.locationSource ||
    chat.customer?.location_source ||
    chat.location_source ||
    chat.effective_location_source;
  const effectiveSource = resolveEffectiveLocationSource(rawLoc);

  const isAlreadyPrecise =
    isPreciseLocationSource(effectiveSource) ||
    Boolean(chat.shareLocationSent || chat.customer?.share_location_sent);

  if (isAlreadyPrecise) {
    return {
      needed: false,
      urgent: false,
      label: null,
      badgeClass: null,
      borderClass: null,
      reason: 'already_precise',
    };
  }

  // 3. Cek cooldown 6 jam setelah terakhir kali diminta
  const requestedAt =
    chat.sharelocRequestedAt ||
    chat.shareloc_requested_at ||
    chat.customer?.preferences?.share_location_requested_at ||
    null;

  if (requestedAt) {
    const reqMs = new Date(requestedAt).getTime();
    if (!Number.isNaN(reqMs)) {
      const ageHours = (now.getTime() - reqMs) / 3_600_000;
      if (ageHours < 6) {
        return {
          needed: false,
          urgent: false,
          label: null,
          badgeClass: null,
          borderClass: null,
          reason: 'cooldown_6h',
        };
      }
    }
  }

  // 4. Hitung same-day vs advance booking berdasarkan tanggal WIB
  const resDateKey = getWibDateKey(activeRes.booking_date);
  const nowDateKey = getWibDateKey(now);
  const isSameDay = Boolean(resDateKey && nowDateKey && resDateKey === nowDateKey);

  if (isSameDay) {
    return {
      needed: true,
      urgent: true,
      label: '📍 Butuh Shareloc (Hari Ini)',
      badgeClass:
        'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800',
      borderClass: 'border-l-4 border-l-orange-500',
      reason: 'same_day',
    };
  }

  return {
    needed: true,
    urgent: false,
    label: '📍 Butuh Shareloc',
    badgeClass:
      'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
    borderClass: 'border-l-4 border-l-amber-500',
    reason: 'advance_due',
  };
}

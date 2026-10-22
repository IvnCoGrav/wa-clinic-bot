/**
 * taskAction.ts — Logika murni penentuan aksi kartu tugas Bidan di dashboard staff (StaffToday).
 *
 * Menerapkan prinsip modularity-first & anti-god-object:
 * Nol impor komponen React, nol efek samping DOM.
 * Konsisten dengan aturan gerbang OTW dan alur keberangkatan/kedatangan.
 */

import { getOtwGate, type OtwGateReason } from '../../utils/geoUtils';

export type TaskPrimaryAction = 'complete' | 'arrive' | 'otw' | 'map';
export type TaskSecondaryAction = 'otw' | null;

export interface TaskActionResolution {
  primary: TaskPrimaryAction;
  secondary: TaskSecondaryAction;
  showExtraNav?: boolean;
}

export interface TaskActionInput {
  status?: string | null;
  arrivedAt?: string | Date | null;
  otwSentAt?: string | Date | null;
  bookingDate?: string | Date | null;
  navUrl?: string | null;
  isScheduleOverdue?: boolean;
  timeForArrival?: boolean;
  terminal?: boolean;
  arrived?: boolean;
  otwSent?: boolean;
  gate?: { allowed: boolean; reason?: OtwGateReason; minutesUntil?: number | null };
  nowMs?: number;
}

/**
 * Menentukan aksi utama (primary) dan aksi kedua (secondary) untuk sebuah tugas.
 */
export function resolveTaskAction(input: TaskActionInput): TaskActionResolution {
  const isTerminal =
    input.terminal === true ||
    ['completed', 'cancelled', 'rejected'].includes(String(input.status || '').toLowerCase());

  if (isTerminal) {
    return { primary: 'complete', secondary: null, showExtraNav: false };
  }

  // Jika tugas eksplisit ditandai arrived
  if (input.arrived === true) {
    return { primary: 'arrive', secondary: null, showExtraNav: false };
  }

  // Jika tugas sudah tercatat arrivedAt atau overdue
  if (Boolean(input.arrivedAt) || input.isScheduleOverdue === true) {
    return { primary: 'complete', secondary: null, showExtraNav: false };
  }

  const hasNav = Boolean(input.navUrl);
  const nowMs = input.nowMs ?? Date.now();

  // Jika info OTW sudah pernah dikirim
  const isOtwSent = input.otwSent === true || Boolean(input.otwSentAt);
  if (isOtwSent) {
    return {
      primary: 'map',
      secondary: null,
      showExtraNav: hasNav,
    };
  }

  // Evaluasi gerbang OTW
  const gate = input.gate ?? getOtwGate(input.bookingDate, nowMs);

  // Jika sudah melewati batas toleransi OTW (misal H+20) dengan peta navigasi
  if (!gate.allowed && gate.reason === 'expired' && hasNav) {
    return { primary: 'map', secondary: null, showExtraNav: false };
  }

  // Evaluasi waktu tiba (H-10 s/d toleransi jadwal)
  let isTimeForArrival = input.timeForArrival === true;
  if (!isTimeForArrival && input.bookingDate) {
    const bookingMs = new Date(input.bookingDate).getTime();
    if (Number.isFinite(bookingMs)) {
      isTimeForArrival = nowMs >= bookingMs - 10 * 60 * 1000;
    }
  }

  if (isTimeForArrival) {
    return {
      primary: 'arrive',
      secondary: hasNav ? 'otw' : null,
      showExtraNav: hasNav,
    };
  }

  // Default: siap berangkat / penawaran OTW
  return {
    primary: 'otw',
    secondary: null,
    showExtraNav: false,
  };
}

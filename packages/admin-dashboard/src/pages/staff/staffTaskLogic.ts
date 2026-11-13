/**
 * Predikat murni untuk kartu tugas terapis. Semua fungsi hanya membaca data
 * tugas dan waktu sekarang, tanpa menyentuh state React.
 */
import { formatWibClock, getOtwGate } from '../../utils/geoUtils';
import { getTodayWibDateKey, getWibDateKey } from '../../utils/dateWib';
import { StaffTask } from './staffTaskTypes';

/**
 * Estimasi durasi treatment dari teks detail (mis. "Pijat Bayi 60 menit").
 * Buffer perjalanan dibuang lebih dulu agar durasi tidak membengkak. Default
 * 60 menit bila tidak ada angka yang bisa dibaca.
 */
export function extractTreatmentMinutes(treatmentDetail: string | null): number {
  if (!treatmentDetail) return 60;
  const sanitized = treatmentDetail
    .replace(/\[\s*total.*?buffer.*?\]/gi, '')
    .replace(/\[\s*total\s*bufer.*?\]/gi, '')
    .replace(/\[\s*total\s*\d+m\s*\+\s*buffer.*?\]/gi, '')
    .replace(/\[\s*buffer.*?\]/gi, '')
    .replace(/\[\s*bufer.*?\]/gi, '')
    .replace(/\[\s*total\s*=\s*\d+.*?\]/gi, '')
    .replace(/\(\+?\d+m\s*buffer\)/gi, '')
    .replace(/\(\+?\d+m\s*bufer\)/gi, '')
    .replace(/\+\s*buffer\s*\d+m/gi, '')
    .replace(/\+\s*bufer\s*\d+m/gi, '')
    .replace(/\b\d+m\s*buffer\b/gi, '')
    .replace(/\b\d+m\s*bufer\b/gi, '')
    .replace(/\btotal\s*bufer\s*=\s*\d+m?\b/gi, '')
    .replace(/\btotal\s*buffer\s*=\s*\d+m?\b/gi, '')
    .trim();

  if (!sanitized) return 60;
  const rawItems = sanitized.split(/\r?\n|,|;|\+|&/).map((s) => s.trim()).filter(Boolean);
  let totalMins = 0;
  for (const item of rawItems) {
    const itemLower = item.toLowerCase();
    if (itemLower.includes('buffer') || itemLower.includes('bufer') || itemLower.includes('total scheduled')) continue;
    const minMatch = item.match(/(\d+)\s*(?:menit|mins?|m\b)/i);
    const hourMatch = item.match(/(\d+(?:\.\d+)?)\s*(?:jam|hours?|h\b)/i);
    if (minMatch) {
      totalMins += parseInt(minMatch[1], 10);
    } else if (hourMatch) {
      totalMins += Math.round(parseFloat(hourMatch[1]) * 60);
    }
  }
  return totalMins > 0 ? totalMins : 60;
}

export function isTrulyCompleted(task: StaffTask): boolean {
  return (task.status || '').toLowerCase() === 'completed';
}

/** Tombol OTW hanya aktif maksimal 2 jam sebelum jadwal sampai toleransi 15 menit. */
export function isOtwAllowed(task: StaffTask): boolean {
  return getOtwGate(task.bookingDate).allowed;
}

/** Jam janji sudah tiba (H-10 menit), belum OTW, dan belum ditandai tiba. */
export function isTimeForArrival(task: StaffTask): boolean {
  if (!task.bookingDate || task.otwSentAt || task.arrivedAt) return false;
  const start = new Date(task.bookingDate).getTime();
  if (isNaN(start)) return false;
  return Date.now() >= start - 10 * 60 * 1000;
}

export function isScheduleOngoing(task: StaffTask): boolean {
  if (!task.bookingDate || isTrulyCompleted(task)) return false;
  const startTime = new Date(task.bookingDate).getTime();
  if (isNaN(startTime)) return false;
  const endTime = startTime + extractTreatmentMinutes(task.treatmentDetail) * 60 * 1000;
  const now = Date.now();
  if (task.arrivedAt) return now < endTime + 30 * 60 * 1000;
  return now >= startTime && now < endTime;
}

export function isScheduleOverdue(task: StaffTask): boolean {
  if (!task.bookingDate || isTrulyCompleted(task)) return false;
  if (isScheduleOngoing(task)) return false;
  const startTime = new Date(task.bookingDate).getTime();
  if (isNaN(startTime)) return false;
  const endTime = startTime + extractTreatmentMinutes(task.treatmentDetail) * 60 * 1000;
  return Date.now() >= endTime;
}

/** Jendela akses chat: server-driven, dengan fallback aman bila field belum ada. */
export function isChatWindowOpen(task: StaffTask): boolean {
  if (task.chatWindow) return task.chatWindow.open;
  if (!task.bookingDate) return false;
  return getWibDateKey(task.bookingDate) >= getTodayWibDateKey();
}

/** Alasan tombol chat nonaktif, dipakai sebagai tooltip. */
export function chatLockedTitle(task: StaffTask): string {
  switch (task.chatWindow?.reason) {
    case 'NOT_YET_OPEN':
      return `Chat aktif H-3 jam sebelum jadwal (${formatTaskTime(task.bookingDate)})`;
    case 'CLOSED_AFTER_COMPLETE':
      return 'Chat sudah ditutup (1 jam setelah treatment selesai)';
    case 'PREVIOUS_DAY':
      return 'Chat riwayat kunjungan lampau tidak dapat dibuka';
    case 'NO_ACTIVE_BOOKING':
      return 'Tidak ada jadwal aktif untuk chat ini';
    default:
      return 'Chat sedang tidak dapat dibuka';
  }
}

/** Jam booking dalam WIB, mis. "10:30 WIB". */
export function formatTaskTime(isoString: string | null): string {
  if (!isoString) return '-';
  try {
    return formatWibClock(new Date(isoString)) + ' WIB';
  } catch {
    return isoString;
  }
}

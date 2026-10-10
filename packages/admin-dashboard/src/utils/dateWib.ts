/**
 * WIB Date Utility — konsisten Asia/Jakarta untuk LiveChat.
 * Hindari Math.round & getFullYear lokal yang sebabkan off-by-one di batas tengah malam.
 */

const WIB_TZ = 'Asia/Jakarta';

/** Ambil YYYY-MM-DD di WIB dari ISO string / Date */
export function getWibDateKey(dateStr?: string | Date | null): string {
  if (dateStr == null || (typeof dateStr === 'string' && dateStr.trim() === '')) return '';
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString('en-CA', { timeZone: WIB_TZ });
  } catch {
    return '';
  }
}

/** Ambil jam menit WIB HH.mm */
export function formatWibTime(dateStr?: string | Date | null): string {
  if (dateStr == null || (typeof dateStr === 'string' && dateStr.trim() === '')) return '';
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  try {
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: WIB_TZ }).replace(':', '.');
  } catch {
    return '';
  }
}

/** Hitung selisih hari kalender WIB (floor, bukan round) */
export function diffCalendarDaysWib(from?: string | Date | null, to?: string | Date | null): number {
  if (!from) return 0;
  const toDate = to || new Date();
  const fromKey = getWibDateKey(from);
  const toKey = getWibDateKey(toDate);
  if (!fromKey || !toKey) return 0;
  const fromMid = new Date(fromKey + 'T00:00:00+07:00').getTime();
  const toMid = new Date(toKey + 'T00:00:00+07:00').getTime();
  if (isNaN(fromMid) || isNaN(toMid)) return 0;
  return Math.floor((toMid - fromMid) / (24 * 60 * 60 * 1000));
}

export function formatChatDateSeparatorWib(dateStr?: string | Date | null): string {
  if (!dateStr || (typeof dateStr === 'string' && dateStr.trim() === '')) return '';
  const msgDate = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (!(msgDate instanceof Date) || isNaN(msgDate.getTime())) return '';
  const diffDays = diffCalendarDaysWib(msgDate, new Date());
  if (diffDays === 0) return 'Hari ini';
  if (diffDays === 1) return 'Kemarin';
  try {
    if (diffDays >= 2 && diffDays < 7) {
      const dayName = msgDate.toLocaleDateString('id-ID', { weekday: 'long', timeZone: WIB_TZ });
      return dayName.charAt(0).toUpperCase() + dayName.slice(1);
    }
    // >=7 hari tampilkan tanggal + bulan + tahun jika beda tahun
    const msgYear = msgDate.toLocaleDateString('en-CA', { timeZone: WIB_TZ }).slice(0, 4);
    const nowYear = new Date().toLocaleDateString('en-CA', { timeZone: WIB_TZ }).slice(0, 4);
    if (msgYear !== nowYear) {
      return msgDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: WIB_TZ });
    }
    return msgDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', timeZone: WIB_TZ });
  } catch {
    return '';
  }
}

export function isDifferentDayWib(d1Str?: string | Date | null, d2Str?: string | Date | null): boolean {
  if (!d1Str) return false;
  if (!d2Str) return true;
  const k1 = getWibDateKey(d1Str);
  const k2 = getWibDateKey(d2Str);
  if (!k1) return false;
  if (!k2) return true;
  return k1 !== k2;
}

export function formatLastChatWib(dateStr?: string | Date | null): string {
  if (!dateStr || (typeof dateStr === 'string' && dateStr.trim() === '')) return '';
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Baru saja';
  if (diffMins < 60) return `${diffMins} menit lalu`;
  if (diffMins < 6 * 60) return `${Math.floor(diffMins / 60)} jam lalu`;
  if (diffMins < 24 * 60) return formatWibTime(date);
  const diffDays = diffCalendarDaysWib(date, now);
  if (diffDays < 7) return `${diffDays} hari yang lalu`;
  // >=7 hari tampilkan tanggal WIB
  try {
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: WIB_TZ });
  } catch {
    return '';
  }
}

/** Ambil jam dan menit dalam format WIB: { hours, minutes, timeFormatted: 'HH:mm' } */
export function getWibHoursAndMinutes(dateStr?: string | Date | null): { hours: number; minutes: number; timeFormatted: string } {
  if (!dateStr || (typeof dateStr === 'string' && dateStr.trim() === '')) {
    return { hours: 0, minutes: 0, timeFormatted: '00:00' };
  }
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (!(d instanceof Date) || isNaN(d.getTime())) {
    return { hours: 0, minutes: 0, timeFormatted: '00:00' };
  }
  try {
    const timeFormatted = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: WIB_TZ });
    const [hh, mm] = timeFormatted.split(':').map(Number);
    return { hours: isNaN(hh) ? 0 : hh, minutes: isNaN(mm) ? 0 : mm, timeFormatted };
  } catch {
    return { hours: 0, minutes: 0, timeFormatted: '00:00' };
  }
}
/** Ambil tanggal hari ini dalam format YYYY-MM-DD (WIB) */
export function getTodayWibDateKey(): string {
  return getWibDateKey(new Date());
}

/** Ambil Date object yang tepat merepresentasikan hari ini di WIB (pukul 12:00 siang WIB untuk cegah edge midnight) */
export function getTodayWibDate(): Date {
  const key = getTodayWibDateKey();
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/** Format tanggal dengan zona waktu Asia/Jakarta (WIB) */
export function formatWibDate(dateStr?: string | Date | null, options?: Intl.DateTimeFormatOptions): string {
  if (!dateStr || (typeof dateStr === 'string' && dateStr.trim() === '')) return '';
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString('id-ID', {
      timeZone: WIB_TZ,
      ...(options || { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    });
  } catch {
    return '';
  }
}

/** Rakit ISO WIB dari date-key + jam (tanpa zona browser). Murni. */
export function buildWibIso(dateKey?: string | null, timeHHMM?: string | null): string {
  const d = String(dateKey || '').trim();
  if (!d) return '';
  let t = String(timeHHMM || '09:00').trim().replace('.', ':');
  if (/^\d{1,2}:\d{2}$/.test(t)) t = t.padStart(5, '0');
  else t = '09:00';
  return `${d}T${t}:00+07:00`;
}

/**
 * Batas awal & akhir hari WIB (00:00:00 - 23:59:59.999) sebagai objek Date absolut.
 * Cermin matematis identik dari wibDayBoundsUtc(0) di backend.
 */
export function wibDayStartEnd(now: Date = new Date()): { start: Date; end: Date } {
  const validNow = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
  const key = getWibDateKey(validNow) || getTodayWibDateKey();
  const [y, m, d] = key.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - 7 * 3600 * 1000);
  const end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - 7 * 3600 * 1000);
  return { start, end };
}



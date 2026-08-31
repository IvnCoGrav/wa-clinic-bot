/**
 * WIB Date Utility — konsisten Asia/Jakarta untuk LiveChat.
 * Hindari Math.round & getFullYear lokal yang sebabkan off-by-one di batas tengah malam.
 */

const WIB_TZ = 'Asia/Jakarta';

/** Ambil YYYY-MM-DD di WIB dari ISO string / Date */
export function getWibDateKey(dateStr: string | Date): string {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  // en-CA gives YYYY-MM-DD
  return d.toLocaleDateString('en-CA', { timeZone: WIB_TZ });
}

/** Ambil jam menit WIB HH.mm */
export function formatWibTime(dateStr: string | Date): string {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: WIB_TZ }).replace(':', '.');
}

/** Hitung selisih hari kalender WIB (floor, bukan round) */
export function diffCalendarDaysWib(from: string | Date, to: string | Date = new Date()): number {
  const fromKey = getWibDateKey(from);
  const toKey = getWibDateKey(to);
  const fromMid = new Date(fromKey + 'T00:00:00+07:00').getTime();
  const toMid = new Date(toKey + 'T00:00:00+07:00').getTime();
  return Math.floor((toMid - fromMid) / (24 * 60 * 60 * 1000));
}

export function formatChatDateSeparatorWib(dateStr: string): string {
  if (!dateStr) return '';
  const diffDays = diffCalendarDaysWib(dateStr, new Date());
  const msgDate = new Date(dateStr);
  if (diffDays === 0) return 'Hari ini';
  if (diffDays === 1) return 'Kemarin';
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
}

export function isDifferentDayWib(d1Str: string, d2Str?: string | null): boolean {
  if (!d2Str) return true;
  return getWibDateKey(d1Str) !== getWibDateKey(d2Str);
}

export function formatLastChatWib(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
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
  return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: WIB_TZ });
}

/**
 * temporal-grounding.ts (sesi 180166 FM2) — jangkar kalender real-time WIB.
 *
 * Mengakhiri halusinasi kalender LLM ("Selasa depan jatuh pada 17 Oktober")
 * dengan menyuntikkan tanggal/hari sistem nyata ke prompt Call 1 & Call 2
 * (wilayah volatil, prefix cache lestari). Murni, 0 dependensi runtime baru
 * (Intl.DateTimeFormat bawaan Node.js), timezone default Asia/Jakarta.
 */

export interface TemporalGrounding {
  /** Baris "Hari ini: ..." + jam WIB saat pesan diproses. */
  todayLine: string;
  /** 7 baris ke depan: "Besok: ...", weekday, hingga H+7. */
  weekLines: string[];
  /** Blok prompt siap suntik (termasuk header marker). */
  block: string;
}

const DAY_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTH_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function partsInTZ(date: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value || '';
  // weekday short en: Sun/Mon/... → indeks 0-6.
  const wdEn = get('weekday').toLowerCase().slice(0, 3);
  const wdIdx = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(wdEn);
  return {
    wdIdx: wdIdx >= 0 ? wdIdx : date.getDay(),
    day: Number(get('day')) || date.getDate(),
    month: Number(get('month')) || date.getMonth() + 1,
    year: Number(get('year')) || date.getFullYear(),
    hm: `${get('hour').padStart(2, '0')}.${get('minute').padStart(2, '0')}`,
  };
}

function lineFor(offsetDays: number, base: { wdIdx: number; day: number; month: number; year: number }, label?: string): string {
  // Hitung tanggal kalender dengan aritmetika UTC-aman via konstruktor Date.
  const probe = new Date(Date.UTC(base.year, base.month - 1, base.day + offsetDays));
  const wd = DAY_ID[probe.getUTCDay()];
  const d = probe.getUTCDate();
  const m = MONTH_ID[probe.getUTCMonth()];
  const y = probe.getUTCFullYear();
  return `${label || wd}: ${wd}, ${d} ${m} ${y}`;
}

export function getRealTimeTemporalGrounding(
  refDate: Date = new Date(),
  timezone: string = 'Asia/Jakarta'
): TemporalGrounding {
  const now = partsInTZ(refDate, timezone);
  const todayLine = `Hari ini: ${DAY_ID[now.wdIdx]}, ${now.day} ${MONTH_ID[now.month - 1]} ${now.year}, pukul ${now.hm} WIB`;
  const labels = ['Besok', 'Lusa'];
  const weekLines: string[] = [];
  for (let i = 1; i <= 7; i++) {
    weekLines.push(lineFor(i, now, labels[i - 1]));
  }
  const block =
    `[WAKTU & KALENDER SISTEM SAAT INI (WIB)]\n` +
    `${todayLine}. Acuan kalender 7 hari ke depan (DILARANG mengarang tanggal di luar daftar ini):\n` +
    weekLines.map((l) => `- ${l}`).join('\n');
  return { todayLine, weekLines, block };
}

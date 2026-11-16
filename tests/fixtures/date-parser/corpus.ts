/**
 * Korpus uji nyata untuk Parser Tanggal Indonesia (Fase 4-4).
 * Memuat ≥ 30 variasi teks tanggal nyata dari transkrip chat & form booking.
 * Setiap kasus dilengkapi Golden Oracle (komponen tanggal yang diharapkan: Y, M (0-indexed), D, H, Min dalam WIB).
 */

export interface GoldenDateExpectation {
  year: number;
  month: number; // 0-indexed (0 = Jan, 11 = Des)
  day: number;
  hourWib: number;
  minuteWib: number;
}

export interface DateCorpusCase {
  id: string;
  input: string;
  description: string;
  // Ekspektasi untuk alur Booking Live ({ rollPastToFuture: true, allowRelative: true })
  expectedBooking: ((refDate: Date) => GoldenDateExpectation) | GoldenDateExpectation | null;
  // Ekspektasi untuk alur Backfill Historis ({ rollPastToFuture: false, allowRelative: false })
  expectedHistorical: ((refDate: Date) => GoldenDateExpectation) | GoldenDateExpectation | null;
}

export const DATE_TEST_CORPUS: DateCorpusCase[] = [
  // 1-5: Format teks tanggal + bulan + tahun + jam
  {
    id: 'case-01',
    input: 'Rabu, 12 agustus 26 jam 12.30',
    description: 'Format hari, tanggal, bulan ID, 2-digit tahun, jam dengan titik',
    expectedBooking: { year: 2026, month: 7, day: 12, hourWib: 12, minuteWib: 30 },
    expectedHistorical: { year: 2026, month: 7, day: 12, hourWib: 12, minuteWib: 30 },
  },
  {
    id: 'case-02',
    input: 'Selasa tgl 7 Juli 2026',
    description: 'Format hari, prefix tgl, bulan ID, 4-digit tahun tanpa jam (default 09:00 WIB)',
    // 7 Juli 2026 adalah 3 hari sebelum FIXED_REF_DATE (10 Juli 2026).
    // Pada alur booking, tanggal lampau digulir ke tahun berikutnya (2027), sedangkan historis tetap 2026.
    expectedBooking: (ref) => {
      const refYear = new Date(ref.getTime() + 7 * 3600000).getUTCFullYear();
      return { year: refYear + 1, month: 6, day: 7, hourWib: 9, minuteWib: 0 };
    },
    expectedHistorical: { year: 2026, month: 6, day: 7, hourWib: 9, minuteWib: 0 },
  },
  {
    id: 'case-03',
    input: '26 july 2026',
    description: 'Format tanggal dengan nama bulan bahasa Inggris (july)',
    expectedBooking: { year: 2026, month: 6, day: 26, hourWib: 9, minuteWib: 0 },
    expectedHistorical: { year: 2026, month: 6, day: 26, hourWib: 9, minuteWib: 0 },
  },
  {
    id: 'case-04',
    input: '15 Agustus 2026 pukul 14:00 WIB',
    description: 'Format lengkap dengan jam titik dua dan akhiran WIB',
    expectedBooking: { year: 2026, month: 7, day: 15, hourWib: 14, minuteWib: 0 },
    expectedHistorical: { year: 2026, month: 7, day: 15, hourWib: 14, minuteWib: 0 },
  },
  {
    id: 'case-05',
    input: 'jam 00.30 senin 5 oktober 2026',
    description: 'Jam di awal kalimat sebelum hari dan tanggal',
    expectedBooking: { year: 2026, month: 9, day: 5, hourWib: 0, minuteWib: 30 },
    expectedHistorical: { year: 2026, month: 9, day: 5, hourWib: 0, minuteWib: 30 },
  },

  // 6-10: Format numerik (DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD)
  {
    id: 'case-06',
    input: '7-07-2026',
    description: 'Format numerik strip DD-MM-YYYY',
    // 7 Juli 2026 sebelum 10 Juli 2026 -> booking roll ke 2027
    expectedBooking: (ref) => {
      const refYear = new Date(ref.getTime() + 7 * 3600000).getUTCFullYear();
      return { year: refYear + 1, month: 6, day: 7, hourWib: 9, minuteWib: 0 };
    },
    expectedHistorical: { year: 2026, month: 6, day: 7, hourWib: 9, minuteWib: 0 },
  },
  {
    id: 'case-07',
    input: '15/09/2026',
    description: 'Format numerik garis miring DD/MM/YYYY',
    expectedBooking: { year: 2026, month: 8, day: 15, hourWib: 9, minuteWib: 0 },
    expectedHistorical: { year: 2026, month: 8, day: 15, hourWib: 9, minuteWib: 0 },
  },
  {
    id: 'case-08',
    input: '2026-11-20',
    description: 'Format ISO YYYY-MM-DD',
    expectedBooking: { year: 2026, month: 10, day: 20, hourWib: 9, minuteWib: 0 },
    expectedHistorical: { year: 2026, month: 10, day: 20, hourWib: 9, minuteWib: 0 },
  },
  {
    id: 'case-09',
    input: '01/02/26 jam 10.15',
    description: 'Format numerik 2-digit tahun dengan jam',
    // 1 Feb 2026 sebelum 10 Juli 2026 -> booking roll ke 2027
    expectedBooking: (ref) => {
      const refYear = new Date(ref.getTime() + 7 * 3600000).getUTCFullYear();
      return { year: refYear + 1, month: 1, day: 1, hourWib: 10, minuteWib: 15 };
    },
    expectedHistorical: { year: 2026, month: 1, day: 1, hourWib: 10, minuteWib: 15 },
  },
  {
    id: 'case-10',
    input: '31-12-2026 23:59',
    description: 'Format akhir tahun numerik dengan jam menit',
    expectedBooking: { year: 2026, month: 11, day: 31, hourWib: 23, minuteWib: 59 },
    expectedHistorical: { year: 2026, month: 11, day: 31, hourWib: 23, minuteWib: 59 },
  },

  // 11-15: Perbedaan Kebijakan Masa Lalu (Past Date vs Roll to Future)
  {
    id: 'case-11',
    input: '12 Agustus 2023',
    description: 'Tahun lampau 2023: booking menggulir ke depan, historis tetap 2023',
    expectedBooking: (ref) => {
      const refYear = new Date(ref.getTime() + 7 * 3600000).getUTCFullYear();
      return { year: Math.max(refYear, 2026), month: 7, day: 12, hourWib: 9, minuteWib: 0 };
    },
    expectedHistorical: { year: 2023, month: 7, day: 12, hourWib: 9, minuteWib: 0 },
  },
  {
    id: 'case-12',
    input: '1 Januari 2024 jam 08.00',
    description: 'Tahun lampau 2024: historis tetap 2024',
    // 1 Januari sebelum 10 Juli -> di tahun referensi (2026) sudah lewat, booking roll ke 2027
    expectedBooking: (ref) => {
      const refYear = new Date(ref.getTime() + 7 * 3600000).getUTCFullYear();
      return { year: refYear + 1, month: 0, day: 1, hourWib: 8, minuteWib: 0 };
    },
    expectedHistorical: { year: 2024, month: 0, day: 1, hourWib: 8, minuteWib: 0 },
  },
  {
    id: 'case-13',
    input: '15/03/2025',
    description: 'Tahun lampau 2025: historis tetap 2025',
    // 15 Maret sebelum 10 Juli -> di tahun referensi (2026) sudah lewat, booking roll ke 2027
    expectedBooking: (ref) => {
      const refYear = new Date(ref.getTime() + 7 * 3600000).getUTCFullYear();
      return { year: refYear + 1, month: 2, day: 15, hourWib: 9, minuteWib: 0 };
    },
    expectedHistorical: { year: 2025, month: 2, day: 15, hourWib: 9, minuteWib: 0 },
  },
  {
    id: 'case-14',
    input: '2022-05-10 jam 11.00',
    description: 'ISO lampau 2022: historis tetap 2022',
    // 10 Mei sebelum 10 Juli -> di tahun referensi (2026) sudah lewat, booking roll ke 2027
    expectedBooking: (ref) => {
      const refYear = new Date(ref.getTime() + 7 * 3600000).getUTCFullYear();
      return { year: refYear + 1, month: 4, day: 10, hourWib: 11, minuteWib: 0 };
    },
    expectedHistorical: { year: 2022, month: 4, day: 10, hourWib: 11, minuteWib: 0 },
  },
  {
    id: 'case-15',
    input: '10 nov 24 jam 15.30',
    description: '2-digit tahun lampau: historis tetap 2024',
    expectedBooking: (ref) => {
      const refYear = new Date(ref.getTime() + 7 * 3600000).getUTCFullYear();
      return { year: Math.max(refYear, 2026), month: 10, day: 10, hourWib: 15, minuteWib: 30 };
    },
    expectedHistorical: { year: 2024, month: 10, day: 10, hourWib: 15, minuteWib: 30 },
  },

  // 16-20: Format Relatif (Besok, Lusa, Hari Ini — Diizinkan di booking, DITOLAK di backfill historis)
  {
    id: 'case-16',
    input: 'besok jam 10',
    description: 'Relatif "besok" dengan jam: valid di booking, null di backfill historis',
    expectedBooking: (ref) => {
      const wib = new Date(ref.getTime() + 7 * 3600000);
      wib.setUTCDate(wib.getUTCDate() + 1);
      return { year: wib.getUTCFullYear(), month: wib.getUTCMonth(), day: wib.getUTCDate(), hourWib: 10, minuteWib: 0 };
    },
    expectedHistorical: null,
  },
  {
    id: 'case-17',
    input: 'lusa sore jam 15.00',
    description: 'Relatif "lusa" dengan jam: valid di booking, null di backfill historis',
    expectedBooking: (ref) => {
      const wib = new Date(ref.getTime() + 7 * 3600000);
      wib.setUTCDate(wib.getUTCDate() + 2);
      return { year: wib.getUTCFullYear(), month: wib.getUTCMonth(), day: wib.getUTCDate(), hourWib: 15, minuteWib: 0 };
    },
    expectedHistorical: null,
  },
  {
    id: 'case-18',
    input: 'hari ini jam 13.00',
    description: 'Relatif "hari ini": valid di booking, null di backfill historis',
    expectedBooking: (ref) => {
      const wib = new Date(ref.getTime() + 7 * 3600000);
      return { year: wib.getUTCFullYear(), month: wib.getUTCMonth(), day: wib.getUTCDate(), hourWib: 13, minuteWib: 0 };
    },
    expectedHistorical: null,
  },
  {
    id: 'case-19',
    input: 'besok pagi',
    description: 'Relatif "besok" tanpa jam spesifik (default 09:00 WIB)',
    expectedBooking: (ref) => {
      const wib = new Date(ref.getTime() + 7 * 3600000);
      wib.setUTCDate(wib.getUTCDate() + 1);
      return { year: wib.getUTCFullYear(), month: wib.getUTCMonth(), day: wib.getUTCDate(), hourWib: 9, minuteWib: 0 };
    },
    expectedHistorical: null,
  },
  {
    id: 'case-20',
    input: 'lusa',
    description: 'Relatif "lusa" murni',
    expectedBooking: (ref) => {
      const wib = new Date(ref.getTime() + 7 * 3600000);
      wib.setUTCDate(wib.getUTCDate() + 2);
      return { year: wib.getUTCFullYear(), month: wib.getUTCMonth(), day: wib.getUTCDate(), hourWib: 9, minuteWib: 0 };
    },
    expectedHistorical: null,
  },

  // 21-25: Kasus Negatif Murni / UTL-01 (WAJIB NULL untuk kedua kebijakan)
  {
    id: 'case-21',
    input: 'tanpa tanggal',
    description: 'Teks acak tanpa indikator tanggal apa pun',
    expectedBooking: null,
    expectedHistorical: null,
  },
  {
    id: 'case-22',
    input: 'jam 10.00',
    description: 'Hanya jam tanpa tanggal/bulan (UTL-01 wajib null)',
    expectedBooking: null,
    expectedHistorical: null,
  },
  {
    id: 'case-23',
    input: 'jam 14:30 WIB',
    description: 'Hanya jam dengan zona waktu tanpa tanggal',
    expectedBooking: null,
    expectedHistorical: null,
  },
  {
    id: 'case-24',
    input: 'tgl 15',
    description: 'Hanya nomor tanggal tanpa nama bulan (UTL-01 dilarang juli fiktif)',
    expectedBooking: null,
    expectedHistorical: null,
  },
  {
    id: 'case-25',
    input: 'tanggal 20 jam 10',
    description: 'Nomor tanggal + jam tanpa bulan',
    expectedBooking: null,
    expectedHistorical: null,
  },

  // 26-32: Variasi Penulisan, Singkatan Bulan, dan Typo Ringan
  {
    id: 'case-26',
    input: 'tgl 5 okt 2026',
    description: 'Singkatan bulan okt dengan tahun',
    expectedBooking: { year: 2026, month: 9, day: 5, hourWib: 9, minuteWib: 0 },
    expectedHistorical: { year: 2026, month: 9, day: 5, hourWib: 9, minuteWib: 0 },
  },
  {
    id: 'case-27',
    input: '17 ags 2026 jam 08.00',
    description: 'Singkatan bulan ags dengan jam',
    expectedBooking: { year: 2026, month: 7, day: 17, hourWib: 8, minuteWib: 0 },
    expectedHistorical: { year: 2026, month: 7, day: 17, hourWib: 8, minuteWib: 0 },
  },
  {
    id: 'case-28',
    input: '10 Desember 2026 jam 14.00-15.30',
    description: 'Range jam: wajib mengambil jam mulai (14.00)',
    expectedBooking: { year: 2026, month: 11, day: 10, hourWib: 14, minuteWib: 0 },
    expectedHistorical: { year: 2026, month: 11, day: 10, hourWib: 14, minuteWib: 0 },
  },
  {
    id: 'case-29',
    input: '5 Mei jam 10.00',
    description: 'Tanggal dan bulan tanpa tahun (default tahun referensi)',
    // 5 Mei sebelum 10 Juli -> di tahun referensi (2026) sudah lewat, booking roll ke 2027
    expectedBooking: (ref) => {
      const refYear = new Date(ref.getTime() + 7 * 3600000).getUTCFullYear();
      return { year: refYear + 1, month: 4, day: 5, hourWib: 10, minuteWib: 0 };
    },
    expectedHistorical: (ref) => {
      const refYear = new Date(ref.getTime() + 7 * 3600000).getUTCFullYear();
      return { year: refYear, month: 4, day: 5, hourWib: 10, minuteWib: 0 };
    },
  },
  {
    id: 'case-30',
    input: '10 march 2026',
    description: 'Bulan bahasa Inggris "march"',
    // 10 Maret 2026 sebelum 10 Juli 2026 -> booking roll ke 2027
    expectedBooking: (ref) => {
      const refYear = new Date(ref.getTime() + 7 * 3600000).getUTCFullYear();
      return { year: refYear + 1, month: 2, day: 10, hourWib: 9, minuteWib: 0 };
    },
    expectedHistorical: { year: 2026, month: 2, day: 10, hourWib: 9, minuteWib: 0 },
  },
  {
    id: 'case-31',
    input: 'jum\'at 14 agustus 2026 jam 13.00',
    description: 'Hari dengan tanda petik "jum\'at", tanggal, bulan, tahun, jam',
    expectedBooking: { year: 2026, month: 7, day: 14, hourWib: 13, minuteWib: 0 },
    expectedHistorical: { year: 2026, month: 7, day: 14, hourWib: 13, minuteWib: 0 },
  },
  {
    id: 'case-32',
    input: '25 Des 26 jam 16:45',
    description: 'Singkatan des, 2-digit tahun, jam format titik dua',
    expectedBooking: { year: 2026, month: 11, day: 25, hourWib: 16, minuteWib: 45 },
    expectedHistorical: { year: 2026, month: 11, day: 25, hourWib: 16, minuteWib: 45 },
  },
];

/**
 * date-confirmation.ts — Otoritas tunggal verifikasi kesepakatan jadwal/hari (PLAN FASE 1 & FASE 2).
 *
 * Diekstrak dari `save-reservation.tool.ts` (audit 833178, 138207, 337101) agar menjadi
 * SATU SUMBER KEBENARAN BERSAMA untuk:
 *  1. State Machine: Mengatur flag `session.dateConfirmed` (dasar tool-masking di Call 1).
 *  2. Tool `save_reservation`: Memvalidasi input hari sebagai pertahanan lapis dua (defense-in-depth).
 *
 * Murni tanpa I/O, tanpa side-effect, deterministik & mudah di-unit test.
 */

/** Kata waktu yang mengikat hari/tanggal (data-driven includes, tanpa regex). */
export const DAY_EVIDENCE_WORDS = [
  'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu',
  'besok', 'lusa', 'sekarang', 'hari ini', 'minggu depan', 'weekend', 'akhir pekan',
  'januari', 'februari', 'maret', 'april', 'mei', 'juni',
  'juli', 'agustus', 'september', 'oktober', 'november', 'desember',
  'tanggal',
  // Varian waktu same-day (sesi 138207: "kalau siang ini bisa?" adalah jejak
  // hari INI — dipetakan via SAME_DAY_EVIDENCE_ALIASES di bawah).
  'siang ini', 'pagi ini', 'sore ini', 'malam ini', 'nanti siang', 'nanti sore', 'hari ini juga',
];

/**
 * Frasa same-day yang membuktikan booking "hari ini"/"sekarang" walau kata
 * "hari ini" tak disebut harfiah (sesi 138207: "kalau siang ini bisa?").
 * Data-driven includes atas teks evidence yang dinormalisasi.
 */
export const SAME_DAY_EVIDENCE_ALIASES = [
  'siang ini', 'pagi ini', 'sore ini', 'malam ini', 'nanti siang', 'nanti sore', 'hari ini juga',
];

/**
 * True bila teks adalah permintaan same-day ("hari ini"/"sekarang"/varian
 * waktu hari-ini). Reuse seam SAME_DAY_EVIDENCE_ALIASES — tanpa daftar baru.
 * Same-day dikecualikan dari fail-closed pertanyaan slot: catatannya sudah
 * ekspektasi-aman (status pending + tanpa janji kedatangan) agar staf tetap
 * menerima antrean cek rute (sesi 138207).
 */
export function isSameDayRequestText(text: string | undefined): boolean {
  const lower = (text || '').toLowerCase();
  if (lower.includes('hari ini') || lower.includes('sekarang')) return true;
  return SAME_DAY_EVIDENCE_ALIASES.some((a) => lower.includes(a));
}

/**
 * Audit 833178 — Day Evidence Gate (pure function, testable): pastikan
 * hari/tanggal pada bookingDate memiliki jejak di pesan user. Kembalikan null
 * bila terbukti disebut; pesan penolakan (tanpa tulis DB!) bila tidak.
 * Aturan: (a) kata-waktu di bookingDate wajib muncul di evidence; (b) bila
 * bookingDate tanpa kata-waktu (mis. ISO "2026-09-10"), angka tanggalnya
 * wajib muncul sebagai token di evidence. Tokenisasi alnum agar "10" tidak
 * cocok dengan "100".
 */
export function verifyDayMentioned(
  bookingDate: string | undefined,
  evidence: string[] | undefined
): string | null {
  if (!evidence || evidence.length === 0) return null; // kompatibilitas: tanpa evidence, gate lewat
  const bd = (bookingDate || '').toLowerCase();
  if (!bd.trim()) return 'Hari/tanggal belum ditentukan oleh customer. Tanyakan preferensi hari terlebih dahulu, DILARANG memanggil save_reservation!';
  const normJoin = (texts: string[]): string => {
    let out = '';
    for (const t of texts) {
      const l = (t || '').toLowerCase();
      for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        out += ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) ? ch : ' ';
      }
      out += ' ';
    }
    return out;
  };
  const evText = normJoin(evidence);
  const evTokenList = evText.split(' ').filter((t) => t.length > 0);
  const evTokens = new Set(evTokenList);
  const isDigitStart = (t: string): boolean => {
    if (!t) return false;
    const c = t.charCodeAt(0);
    return c >= 48 && c <= 57;
  };
  // Pencocokan lingkup SATU pesan (cermin aturan agregat di bawah — tanpa
  // daftar frasa tanya baru). Dipakai fail-closed rule pertanyaan slot.
  const messageSupportsDay = (msg: string): boolean => {
    const oneText = normJoin([msg]);
    const toks = oneText.split(' ').filter((t) => t.length > 0);
    const tokSet = new Set(toks);
    const words = DAY_EVIDENCE_WORDS.filter((w) => bd.includes(w));
    if (words.length > 0) {
      const proven = words.some((w) => {
        if (w.includes(' ')) return oneText.includes(w);
        if (w === 'minggu') {
          return toks.some((t, i) => t === 'minggu' && (i === 0 || !isDigitStart(toks[i - 1])));
        }
        return tokSet.has(w);
      });
      if (proven) return true;
      const bdIsSameDay = bd.includes('hari ini') || bd.includes('sekarang');
      if (bdIsSameDay && SAME_DAY_EVIDENCE_ALIASES.some((a) => oneText.includes(a))) return true;
      return false;
    }
    let digits = '';
    for (let i = 0; i < bd.length; i++) {
      const ch = bd[i];
      digits += (ch >= '0' && ch <= '9') ? ch : ' ';
    }
    const dayNums = digits.split(' ').filter((t) => t.length > 0).filter((n) => n.length <= 2);
    return dayNums.some((n) => tokSet.has(n) || tokSet.has(String(Number(n))));
  };
  // (a) kata waktu eksplisit di bookingDate
  const bdWords = DAY_EVIDENCE_WORDS.filter((w) => bd.includes(w));
  let aggregateProven = false;
  if (bdWords.length > 0) {
    const proven = bdWords.some((w) => {
      if (w.includes(' ')) return evText.includes(w);
      if (w === 'minggu') {
        // "3 minggu" = usia, bukan hari Minggu — butuh kemunculan
        // tanpa angka di depannya.
        return evTokenList.some((t, i) => t === 'minggu' && (i === 0 || !isDigitStart(evTokenList[i - 1])));
      }
      return evTokens.has(w);
    });
    if (proven) aggregateProven = true;
    // Alias same-day (sesi 138207): booking "hari ini"/"sekarang" terbukti
    // bila evidence memuat varian waktu hari-ini ("siang ini", "pagi ini",
    // "sore ini", "malam ini", "nanti siang/sore", "hari ini juga").
    const bdIsSameDay = bd.includes('hari ini') || bd.includes('sekarang');
    if (bdIsSameDay && SAME_DAY_EVIDENCE_ALIASES.some((a) => evText.includes(a))) aggregateProven = true;
  } else {
    // (b) tanpa kata waktu: angka tanggal bookingDate harus muncul di evidence
    let digits = '';
    for (let i = 0; i < bd.length; i++) {
      const ch = bd[i];
      digits += (ch >= '0' && ch <= '9') ? ch : ' ';
    }
    const nums = digits.split(' ').filter((t) => t.length > 0);
    // Ambil angka tanggal (abaikan tahun 4-digit agar "2026" tak jadi bukti)
    const dayNums = nums.filter((n) => n.length <= 2);
    if (dayNums.some((n) => evTokens.has(n) || evTokens.has(String(Number(n))))) aggregateProven = true;
  }
  // Fail-closed pertanyaan ketersediaan slot (lapis kontrak tool):
  // bukti hari yang SELURUHNYA berasal dari pesan bertanda tanya ("Bisa hari
  // Selasa?", "Tgl 18 bisa?") = customer baru menanyakan ketersediaan, BUKAN
  // menyetujui booking final. Tanda "?" adalah level tanda baca (bukan
  // gatekeeper semantik / daftar hafalan baru) + status evidence.
  // Pengecualian: permintaan same-day (sesi 138207) — catatannya berstatus
  // pending ekspektasi-aman sehingga staf tetap menerima antrean cek rute.
  if (aggregateProven) {
    if (!isSameDayRequestText(bd)) {
      const hasNonQuestionSupport = (evidence || []).some(
        (m) => !(m || '').includes('?') && messageSupportsDay(m)
      );
      if (!hasNonQuestionSupport) {
        return `Jadwal kunjungan ("${bookingDate}") masih dalam tahap pengecekan ketersediaan slot oleh tim Bidan — customer baru menanyakan ketersediaan (bukti hari hanya dari kalimat tanya) dan belum menyetujui booking final. Sampaikan dengan hangat bahwa tim sedang mengecekkan jadwal tersebut. DILARANG memanggil save_reservation sebelum customer menyetujui booking secara tegas tanpa tanda tanya!`;
      }
    }
    return null;
  }
  return `Hari/tanggal "${bookingDate}" belum punya jejak eksplisit di pesan customer. Ketersediaan jadwal masih dalam tahap pengecekan — sampaikan dengan hangat bahwa tim sedang mengecek ketersediaan jadwal, jangan memarahi customer atau meminta tanggal secara kaku. Tanyakan preferensi hari/tanggal kunjungan dengan santai terlebih dahulu, DILARANG memanggil save_reservation sebelum customer menyebut hari!`;
}

/**
 * Interface hasil konfirmasi jadwal untuk State Machine.
 */
export interface DateConfirmationVerdict {
  confirmed: boolean;
  rejectionReason?: string | null;
}

/**
 * Evaluasi apakah tanggal sudah disepakati (untuk gating tool save_reservation).
 */
export function isDateConfirmed(
  bookingDate: string | undefined,
  evidence: string[] | undefined
): DateConfirmationVerdict {
  const error = verifyDayMentioned(bookingDate, evidence);
  return {
    confirmed: error === null,
    rejectionReason: error,
  };
}

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
  // Ekspresi hari relatif pasca-vaksin (SOP jeda observasi: "hari ke-4",
  // "hari ke 3"). Token ganda ('hari ke' + 'hari ke-') menutup varian hubung.
  'hari ke', 'hari ke-',
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
 * Sinyal komitmen transaksi (sesi 180166 FM1, single source): verba pemesanan
 * eksplisit customer. Dipakai day-gate (adopsi tanggal ber-tanda-tanya),
 * booking-commit-gate, dan tool-masker — satu definisi, tanpa drift.
 * Daftar kata setingkat bahasa sapaan (seperti DAY_EVIDENCE_WORDS): HANYA
 * bermakna sebagai override '?', BUKAN gatekeeper intent umum. 'Oke/siap'
 * SENGAJA bukan verba komitmen (ack pasca-reservasi, sesi 462651).
 */
const BOOKING_COMMIT_SINGLE_TOKENS = [
  'jadwalkan', 'ambil', 'deal', 'fix', 'pesan', 'booking',
];

/**
 * Fase 4 — Kelas DEIKSIS (rujukan "yang tadi/itu/barusan") + verba afirmasi.
 * Menggantikan hafalan frasa literal (anti-overfitting): variasi slang/typo
 * ("yg td aja", "tdi", "barusan") tertangkap karena dipetakan ke token kanonis,
 * bukan dicocokkan sebagai substring kalimat. Verba afirmasi reusable dari
 * BOOKING_COMMIT_SINGLE_TOKENS.
 */
const DEIXIS_CANONICAL_TOKENS = new Set(['tadi', 'itu', 'barusan', 'td', 'tdi', 'tdy']);
const DEIXIS_VERB_TOKENS = new Set([...BOOKING_COMMIT_SINGLE_TOKENS, 'mau', 'boleh', 'ganti', 'jadi', 'ikut']);
const DEIXIS_PARTICLE_TOKENS = new Set(['aja', 'deh', 'saja', 'dong', 'ya', 'yah']);
const DEIXIS_MARKERS = new Set(['yang', 'yg']);
const DEIXIS_RECOMMEND_TOKENS = new Set([
  'rekomendasi', 'rekomendasikan', 'direkomendasikan', 'direkomendasi',
  'saran', 'sarankan', 'recommended',
]);
const DEIXIS_STOP = new Set(['tidak', 'nggak', 'ngga', 'gak', 'jangan', 'batal', 'nanti', 'pikir', 'dulu', 'belum', 'tunda']);

function tokenizeAlnum(text: string): string[] {
  let norm = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    norm += ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) ? ch : ' ';
  }
  return norm.split(' ').filter((t) => t.length > 0);
}

/**
 * Kata benda ketersediaan slot (data-driven, setingkat bahasa fungsional).
 * Dipakai untuk mengenali PERTANYAAN ketersediaan tanpa tanda '?' — masalah
 * WhatsApp Indonesia: "sabtu jam 10 kosong gak", "ada slot min".
 */
const AVAILABILITY_NOUNS = ['slot', 'jadwal', 'kosong', 'tersedia', 'available', 'lowong', 'kuota'];
/** Partikel/penanda interogatif fungsional (bukan hafalan kalimat). */
const INTERROGATIVE_PARTICLES = new Set([
  'gak', 'ga', 'nggak', 'ngga', 'engga', 'enggak', 'kah', 'kan', 'belum', 'kagak',
]);
/** Penanda pertanyaan ya/tidak eksplisit (closed-class) — selalu interogatif. */
const STRONG_INTERROGATIVES = new Set(['apakah']);
/** Verba/penanda yang bersama kata-benda ketersediaan membentuk pertanyaan. */
const AVAILABILITY_QUESTION_MARKERS = new Set([
  'ada', 'bisa', 'boleh', 'bs', 'bsa', 'ready', 'masih', 'apa', 'apakah',
  'gimana', 'gmn', 'kapan', 'berapa', 'minta', 'cek', 'tanya',
]);

/**
 * Pertanyaan KETERSEDIAAN jadwal tanpa '?' (Fase 2.2): konstruksi gramatikal
 * interogatif Indonesia — partikel tanya (…gak/kah/kan) ATAU kata-benda
 * ketersediaan disertai verba tanya ("ada slot", "bisa jadwal"). Level
 * konstruksi gramatikal, BUKAN daftar kalimat hafalan.
 *
 * Tujuan: kalimat seperti "mau booking sabtu jam 10 kosong gak" DILARANG
 * dianggap komitmen booking final.
 */
export function isAvailabilityInquiryText(text: string | undefined): boolean {
  const lower = (text || '').toLowerCase();
  if (!lower.trim()) return false;
  const tokens = tokenizeAlnum(lower);
  if (tokens.length === 0) return false;
  // Partikel tanya gramatikal (…gak/kah/kan) SELALU menandai pertanyaan —
  // "mau booking sabtu jam 10 kosong gak" tetap pertanyaan walau ada verba.
  if (tokens.some((t) => INTERROGATIVE_PARTICLES.has(t))) return true;
  // Penanda tanya ya/tidak eksplisit ("apakah ...") selalu interogatif.
  if (tokens.some((t) => STRONG_INTERROGATIVES.has(t))) return true;
  const hasNoun = AVAILABILITY_NOUNS.some((n) => lower.includes(n));
  if (hasNoun && tokens.some((t) => AVAILABILITY_QUESTION_MARKERS.has(t))) {
    // Tanpa partikel tanya, verba komitmen eksplisit ("bisa ambil jadwal sabtu")
    // dimenangkan sebagai komitmen — bukan pertanyaan ketersediaan.
    return !hasBookingCommitSignal(lower);
  }
  // '?' sopan pada pesan berverba komitmen ("Ambil ... ya??") BUKAN pertanyaan
  // ketersediaan — verba komitmen mengadopsi tanggal (sesi 180166 FM1).
  if (lower.includes('?') && !hasBookingCommitSignal(lower)) return true;
  return false;
}

/**
 * Sinyal customer MUNDUR / menunda dari komitmen booking (Fase 2.1): kata
 * penunda fungsional (batal/nanti/dulu/belum/tunda/pikir/jangan/tidak) ATAU
 * pertanyaan ketersediaan. Dipakai untuk melepas flag lengket
 * `bookingCommitConfirmed` agar tidak mengunci selamanya.
 */
export function hasBookingRetreatSignal(text: string | undefined): boolean {
  const lower = (text || '').toLowerCase();
  if (!lower.trim()) return false;
  if (tokenizeAlnum(lower).some((t) => DEIXIS_STOP.has(t))) return true;
  return isAvailabilityInquiryText(lower);
}


/** Kelas deiksis: ada penanda rujukan + (verba afirmasi ATAU partikel), tanpa kata penunda. */
function hasDeixisCommit(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  if (tokens.some((t) => DEIXIS_STOP.has(t))) return false;
  const hasMarker = tokens.some((t) => DEIXIS_MARKERS.has(t));
  const hasRecommend = tokens.some((t) => DEIXIS_RECOMMEND_TOKENS.has(t));
  const hasDeixis = tokens.some((t) => DEIXIS_CANONICAL_TOKENS.has(t));
  // Frasa rujukan-rekomendasi ("sesuai rekomendasi", "yang direkomendasikan
  // tadi") sah tanpa verba afirmasi eksplisit.
  if (hasRecommend) return true;
  if (!hasMarker || !hasDeixis) return false;
  return tokens.some((t) => DEIXIS_VERB_TOKENS.has(t) || DEIXIS_PARTICLE_TOKENS.has(t));
}

export function hasBookingCommitSignal(text: string | undefined): boolean {
  const lower = (text || '').toLowerCase();
  if (!lower) return false;
  // Fase 4: kelas deiksis (tahan slang/typo/parafrasa) — dievaluasi lebih dulu.
  if (hasDeixisCommit(tokenizeAlnum(lower))) return true;
  // Frasa multi-kata via includes (distinctive, tak ambigu, mencakup variasi partikel percakapan alami).
  if (
    lower.includes('mau yang itu') || lower.includes('boleh yang itu')
    || lower.includes('mau deh yang itu') || lower.includes('boleh deh yang itu')
    || lower.includes('mau dong yang itu') || lower.includes('boleh dong yang itu')
    || lower.includes('mau aja yang itu') || lower.includes('boleh aja yang itu')
    || lower.includes('yang itu aja') || lower.includes('yang itu deh')
    // Anaphora commitment patterns (F2: single source untuk anaphora "yang tadi/itu/barusan" + verba setuju)
    || lower.includes('mau yang tadi') || lower.includes('boleh yang tadi')
    || lower.includes('ambil yang tadi') || lower.includes('pesan yang tadi')
    || lower.includes('yang tadi aja') || lower.includes('yang tadi deh')
    || lower.includes('mau yang barusan') || lower.includes('boleh yang barusan')
    || lower.includes('ambil yang barusan') || lower.includes('pesan yang barusan')
    || lower.includes('yang barusan aja') || lower.includes('yang barusan deh')
    || lower.includes('sesuai rekomendasi') || lower.includes('sesuai saran')
    || lower.includes('ikut rekomendasi') || lower.includes('ikut saran')
  ) return true;
  // Kata tunggal via token-exact agar "fix" tak cocok di "prefix".
  const toks = lower.split(/[^a-z0-9]+/).filter((t) => t.length > 0);
  const tokSet = new Set(toks);
  return BOOKING_COMMIT_SINGLE_TOKENS.some((w) => tokSet.has(w));
}

/**
 * Akar interogatif gramatikal (closed-class function words bahasa Indonesia)
 * dengan toleransi ejaan WhatsApp: gimana/gmn/gmna/bgmn, apa/apakah, kapan,
 * berapa, kenapa/napa, mana/dimana/kemana, maksudnya, jelaskan, cara.
 * BUKAN hafalan kalimat bisnis — ini kata fungsi tanya, setingkat
 * INTERROGATIVE_PARTICLES/STRONG_INTERROGATIVES yang sudah ada. Dasar temuan
 * audit 6285743192813: customer menulis pertanyaan TANPA tanda '?' ("...itu
 * gmna ya") sehingga predikat '?'-only salah mengklasifikasikannya sebagai
 * komitmen dan mengunci keranjang sepihak.
 */
const INTERROGATIVE_ROOTS = new Set([
  'gimana', 'gmn', 'gmna', 'bgmn', 'bagaimana', 'bagaiman',
  'kenapa', 'napa', 'kapan', 'berapa', 'brp',
  'apa', 'apakah', 'apapun', 'apaan',
  'dimana', 'kemana', 'mengapa', 'mana',
  'maksudnya', 'jelaskan', 'cara', 'caranya',
]);
/** Akar panjang yang boleh cocok-prefiks (toleran typo imbuhan/akhiran). */
const INTERROGATIVE_ROOT_STEMS = [
  'gimana', 'bagaimana', 'mengapa', 'maksudnya', 'jelaskan',
];

/** True bila teks membawa niat interogatif/eksplorasi (tanpa wajib '?'). */
export function hasInterrogativeIntent(text: string | undefined): boolean {
  const lower = (text || '').toLowerCase();
  if (!lower.trim()) return false;
  if (lower.includes('?')) return true;
  const tokens = tokenizeAlnum(lower);
  if (tokens.length === 0) return false;
  return tokens.some((t) =>
    INTERROGATIVE_ROOTS.has(t) || INTERROGATIVE_ROOT_STEMS.some((r) => t.startsWith(r))
  );
}

/**
 * Pertanyaan KONSULTATIF murni (Sesi 783810 + audit 6285743192813, satu sumber
 * kebenaran bersama): true bila pesan USER membawa niat interogatif/eksplorasi
 * (DENGAN atau TANPA '?'), TANPA verba komitmen, TANPA jejak hari/waktu, dan
 * TANPA komitmen booking sticky sesi. Level tata bahasa + state (bukan daftar
 * frasa hafalan bisnis) — cermin fail-closed pertanyaan slot di day-gate.
 * Dipakai SELURUH seam kontrak transaksi (userConfirmedNames, cart sync,
 * detectAgreedTreatment, tool-masker) agar konsultasi eksplorasi DILARANG
 * mengunci layanan ke cart/selectedTreatment.
 */
export function isConsultativeUserText(
  text: string | undefined,
  session?: { bookingCommitConfirmed?: boolean }
): boolean {
  const lower = (text || '').toLowerCase();
  if (!lower.trim()) return false;
  // Verba komitmen eksplisit / jejak hari / commit sticky sesi selalu menang.
  if (hasBookingCommitSignal(lower)) return false;
  if (DAY_EVIDENCE_WORDS.some((w) => lower.includes(w))) return false;
  if (session?.bookingCommitConfirmed === true) return false;
  // Niat interogatif/eksplorasi (dengan ATAU tanpa '?') = KONSULTASI murni.
  return hasInterrogativeIntent(lower);
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
  // Ekspresi hari relatif (SOP pasca-vaksin "hari ke-4"): angka WAJIB sama —
  // "hari ke-4" tidak terbukti oleh "hari ke-5". Regex teknis atas teks yang
  // sudah dinormalisasi (tanda hubung menjadi spasi), bukan hafalan semantik.
  const relativeDayIn = (scopeText: string): boolean => {
    const bdRel = /hari\s*ke\s*0*(\d+)/.exec(bd);
    if (!bdRel) return false;
    const re = new RegExp(`hari\\s*ke\\s*0*${bdRel[1]}\\b`);
    return re.test(scopeText);
  };
  const isDigitStart = (t: string): boolean => {
    if (!t) return false;
    const c = t.charCodeAt(0);
    return c >= 48 && c <= 57;
  };
  // Pencocokan lingkup SATU pesan (cermin aturan agregat di bawah — tanpa
  // daftar frasa tanya baru). Dipakai fail-closed rule pertanyaan slot.
  const messageSupportsDay = (msg: string): boolean => {
    const oneText = normJoin([msg]);
    if (relativeDayIn(oneText)) return true;
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
  if (/hari\s*ke\s*0*(\d+)/.test(bd)) {
    // Ekspresi relatif: angka harus sama (lihat relativeDayIn di atas).
    aggregateProven = relativeDayIn(evText);
  } else if (bdWords.length > 0) {
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
  // Selasa?", "Tgl 18 bisa?", "ada jadwal kosong hari ini jam 3 sore?") =
  // customer baru menanyakan ketersediaan, BUKAN menyetujui booking final.
  // Tanda "?" adalah level tanda baca (bukan gatekeeper semantik / daftar
  // hafalan baru) + status evidence. Sesi 337880: pengecualian same-day
  // DIHAPUS — interogatif same-day adalah slot inquiry, BUKAN komitmen;
  // pencatatan pending MENUNGGU verba komitmen (lihat adopsi di bawah).
  // Adopsi komitmen (sesi 180166 FM1): pesan TERKINI berverba komitmen
  // ("Ambil yang ... ya??", "fix ambil ...?") MENGADOPSI tanggal yang sudah
  // terbukti di evidence — '?' sopan khas WhatsApp DILARANG membatalkan
  // komitmen transaksi. Tanpa verba komitmen, fail-closed tetap berlaku.
  if (aggregateProven) {
    const hasNonQuestionSupport = (evidence || []).some(
      (m) => !isAvailabilityInquiryText(m) && messageSupportsDay(m)
    );
    const currentMsg = (evidence || [])[(evidence || []).length - 1] || '';
    // Adopsi komitmen: verba komitmen yang BUKAN sekadar pertanyaan ketersediaan.
    // "mau booking sabtu jam 10 kosong gak" = tanya slot, DILARANG diadopsi.
    const hasCommitAdoption = hasBookingCommitSignal(currentMsg) && !isAvailabilityInquiryText(currentMsg);
    if (!hasNonQuestionSupport && !hasCommitAdoption) {
      return `Jadwal kunjungan ("${bookingDate}") masih dalam tahap pengecekan ketersediaan slot oleh tim Bidan — customer baru menanyakan ketersediaan (bukti hari hanya dari kalimat tanya) dan belum menyetujui booking final. Sampaikan dengan hangat bahwa tim sedang mengecekkan jadwal tersebut. DILARANG memanggil save_reservation sebelum customer menyetujui booking secara tegas tanpa tanda tanya!`;
    }
    return null;
  }
  return `Hari/tanggal "${bookingDate}" belum punya jejak eksplisit di pesan customer. Ketersediaan jadwal masih dalam tahap pengecekan — sampaikan dengan hangat bahwa tim sedang mengecek ketersediaan jadwal, jangan memarahi customer atau meminta tanggal secara kaku. Tanyakan preferensi hari/tanggal kunjungan dengan santai terlebih dahulu, DILARANG memanggil save_reservation sebelum customer menyebut hari!`;
}

const MONTH_INDEX: Record<string, number> = {
  januari: 0, jan: 0,
  februari: 1, feb: 1,
  maret: 2, mar: 2,
  april: 3, apr: 3,
  mei: 4,
  juni: 5, jun: 5,
  juli: 6, jul: 6,
  agustus: 7, agu: 7, ags: 7,
  september: 8, sep: 8, sept: 8,
  oktober: 9, okt: 9,
  november: 10, nov: 10,
  desember: 11, des: 11,
};

/**
 * Audit 310995 — deteksi tanggal MASA LALU eksplisit (pure, tanpa I/O).
 * Berbeda dari `parseIndonesianDate` yang menggulir masa lalu ke masa depan
 * secara senyap, fungsi ini mengembalikan true bila tanggal eksplisit
 * (nama bulan + tahun, atau ISO YYYY-MM-DD) jatuh SEBELUM hari ini.
 *
 * Sengaja KONSERVATIF: hanya menandai bila ada TAHUN eksplisit ATAU format ISO
 * lengkap — frasa relatif ("besok", "sabtu") tidak pernah dianggap lampau
 * (sudah ditangani parser). Tanggal tanpa tahun (mis. "18 agustus") digulir
 * ke tahun berjalan oleh parser — bukan kasus masa-lalu eksplisit.
 */
export function isPastBookingDateText(bookingDate: string | undefined, now: Date = new Date()): boolean {
  const bd = (bookingDate || '').toLowerCase().trim();
  if (!bd) return false;
  const startOfToday = new Date(now.getTime());
  startOfToday.setHours(0, 0, 0, 0);

  // (a) ISO YYYY-MM-DD
  const iso = bd.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const d = new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10), 9, 0, 0, 0);
    return d.getTime() < startOfToday.getTime();
  }

  // (b) "18 agustus 2026" / "18 agu 2026" — butuh TAHUN eksplisit agar tak
  //     menandai tanggal tanpa tahun (yang digulir ke tahun berjalan).
  const dm = bd.match(/\b(\d{1,2})\s+([a-z']+)(?:\s+(\d{4}))?\b/);
  if (dm && MONTH_INDEX[dm[2]] !== undefined && dm[3]) {
    const d = new Date(parseInt(dm[3], 10), MONTH_INDEX[dm[2]], parseInt(dm[1], 10), 9, 0, 0, 0);
    return d.getTime() < startOfToday.getTime();
  }
  return false;
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

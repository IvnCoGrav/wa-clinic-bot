/**
 * name-sanitizer.ts
 * Utility untuk membersihkan nama customer dan nama anak (babyName)
 * dari gelar ganda ("Bunda"), nama wilayah/kelurahan/kecamatan di buku kontak,
 * catatan admin (+ Alamat, status WA), simbol/emoji, serta menangani multiple babies (kembar / 2 anak).
 */

import { expandToponymAbbreviations } from './toponym-normalizer';

// Diekspor untuk dipakai ulang skrip healing data (sanitize-customer-names) —
// DILARANG menduplikasi daftar ini di modul lain (single source of truth).
export const COMMON_DISTRICTS = [
  // Multi-word districts / areas / clusters (Panjang dulu agar matching lebih spesifik)
  'tambak sari sby', 'sidotopo wetan', 'sekawan nyaman', 'citraland wiyung', 'medokan semampir',
  'gunung anyar tambak', 'gunung anyar', 'tenggilis mejoyo', 'pabean cantian', 'pabean cantikan', 'lidah kulon',
  'lidah wetan', 'karang pilang', 'karangpilang', 'wisata bukit mas', 'grand pakuwon', 'pakuwon city',
  'pakuwon indah', 'graha family', 'royal residence', 'puri surya jaya', 'medokan ayu', 'medokan asri',
  'tambak sumur', 'tambaksumur', 'tambak sawah', 'tambaksawah', 'tambak oso', 'tambakoso',
  'banyu urip', 'banyuurip', 'dukuh pakis', 'dukuh kupang', 'dukuh menanggal', 'sukomanunggal',
  'suko manunggal', 'rungkut kidul', 'rungkut tengah', 'rungkut menanggal', 'kalirungkut', 'kali rungkut',
  'manukan kulon', 'manukan wetan', 'bluru kidul', 'rangkah kidul', 'masangan kulon', 'masangan wetan',
  'grogol sby', 'delta sari', 'deltasari', 'balas klumprik', 'jajar tunggal', 'pradah kalikendal',
  'genting kalianak', 'morokrembangan', 'krembangan selatan', 'krembangan utara', 'alun-alun contong',
  'tembok dukuh', 'pacar kembang', 'pacar keling', 'dukuh setro', 'bulak banteng', 'tambak wedi',
  'kedung cowek', 'embong kaliasin', 'kupang krajan', 'putat jaya', 'babat jerawat', 'banjar sugihan',
  'perak barat', 'perak timur', 'gebang putih', 'ngagel rejo', 'ngagelrejo',

  // Single-word districts / kecamatan / kelurahan (Surabaya, Sidoarjo, Gresik)
  'semampir', 'sarirogo', 'wonokromo', 'sukolilo', 'gubeng', 'tandes', 'lakarsantri', 'bulak',
  'krembangan', 'asemrowo', 'benowo', 'pakal', 'sambikerep', 'sawahan', 'tegalsari', 'genteng',
  'bubutan', 'simokerto', 'tambaksari', 'kenjeran', 'mulyorejo', 'rungkut', 'tenggilis', 'jambangan',
  'gayungan', 'wonocolo', 'wiyung', 'pabean', 'ampel', 'pegirian', 'ujung', 'sidotopo', 'wonokusumo',
  'perak', 'darmo', 'dinoyo', 'keputran', 'ngagel', 'jagir', 'bratang', 'baratajaya', 'menur', 'manyar',
  'mojo', 'airlangga', 'kertajaya', 'keputih', 'klampis', 'kutisari', 'siwalankerto', 'jemursari',
  'kendangsari', 'prapen', 'margorejo', 'sidosermo', 'simomulyo', 'manukan', 'balongsari', 'kandangan',
  'sememi', 'dupak', 'kemayoran', 'gundih', 'jepara', 'kapasari', 'simolawang', 'sidodadi', 'ploso',
  'rangkah', 'gading', 'petemon', 'pakis', 'kebraon', 'kedurus', 'warugunung', 'pagesangan', 'kebonsari',
  'karah', 'ketintang', 'citraland', 'pakuwon', 'kodam', 'jojoran', 'petikan', 'petiken', 'buduran',
  'candi', 'sedati', 'gresik', 'gedangan', 'bungurasih', 'damarsih', 'gunungsari', 'sawotratap',
  'sukodono', 'waru', 'krian', 'babatan', 'kepuh', 'sidoarjo', 'surabaya', 'porong', 'krembung',
  'tulangan', 'tanggulangin', 'jabon', 'balongbendo', 'prambon', 'tarik', 'wonoayu', 'taman', 'lebo',
  'suko', 'cemengkalang', 'urangagung', 'bluru', 'sekardangan', 'magersari', 'pucang', 'sidokare',
  'bulusidokare', 'celep', 'lemahputro', 'gebang', 'kemiri', 'banjarbendo', 'sumokali', 'pepelegi',
  'berbek', 'wadungasri', 'tropodo', 'wedoro', 'aloha', 'betro', 'kalanganyar', 'pranti', 'pagerwojo',
  'entalsewu', 'sepande', 'sumorame', 'kalitengah', 'ngaban', 'boro', 'jumputrejo', 'panjunan', 'bangah',
  'wage', 'bohar', 'bebekan', 'trosobo', 'kletek', 'gilang', 'driyorejo', 'menganti', 'kebomas',
  'cerme', 'benjeng', 'bambe', 'tenaru'
].sort((a, b) => b.length - a.length);

const GENERIC_NAME_PLACEHOLDERS = new Set([
  'bunda', 'ibu', 'bu', 'mama', 'moms', 'momm', 'mbak', 'mas', 'kak', 'kakak', 'ny', 'ny.',
  'ayah', 'pak', 'bapak',
  'pasien', 'customer', 'pelanggan', 'lead', 'sandbox customer', 'test', 'tester', 'dummy',
  '-', '--', '...', 'null', 'undefined'
]);

/**
 * Memeriksa apakah sebuah nama customer berstatus generik/placeholder/belum definitif.
 * Nama generik diizinkan diperbarui saat customer memberikan nama asli di reservasi pertama.
 * Nama yang SUDAH DEFINITIF (nama orang asli yang sah) DILARANG ditimpa otomatis oleh transaksi berikutnya.
 */
export function isGenericCustomerName(
  name: string | null | undefined,
  opts?: { strictPushnameGate?: boolean }
): boolean {
  if (!name) return true;
  let trimmed = name.trim();
  trimmed = trimmed.normalize('NFKD').replace(/[\u0300-\u036F]/g, '');
  if (trimmed.length < 2) return true;
  const lower = trimmed.toLowerCase();

  // 1. Pola masking nomor, placeholder, atau simbol teknis
  if (lower.includes('*') || lower === 'null' || lower === 'undefined' || lower === '-') return true;

  // 2. Leksikon generic terdaftar
  if (GENERIC_NAME_PLACEHOLDERS.has(lower)) return true;

  // 3. Pola awalan label generik sistem (mis. "Pelanggan 6319", "Customer 0812")
  if (/^(?:pelanggan|customer|lead|pasien|sandbox customer)\b/i.test(lower)) return true;

  // 4. Pola non-manusia / handle teknis (username WhatsApp / kode / tag):
  //    - Mengandung underscore (_) atau simbol handle teknis
  if (/[_@#|\\\/=~+<>]/.test(trimmed)) return true;

  //    - Mengandung digit/angka (contoh: a_31, ay719, user123, Bunda (0812...))
  if (/\d/.test(trimmed)) return true;

  // 5. Nama yang HANYA terdiri dari kata sapaan saja tanpa nama orang (mis. "Bunda", "Ibu", "Ayah", "Pak", "Bu")
  const stripped = lower.replace(/^(?:bunda|ibu|bu|mama|moms|mbak|mas|kak|kakak|ny|ny\.|ayah|pak|bapak)\s*/i, '').trim();
  if (!stripped || stripped.length < 2) return true;

  // 6. Harus tersisa minimal 2 huruf alfabet asli (anti pure emoji/simbol: "😊", "⭐️", "~", ".")
  const lettersOnly = stripped.replace(/[^\p{L}]/gu, '');
  if (lettersOnly.length < 2) return true;

  if (opts?.strictPushnameGate) {
    // Hukum fonetik: tanpa vokal (a,i,u,e,o) & tanpa y -> inisial/handle/ketikan acak.
    const hasVowel = /[aeiou]/i.test(stripped);
    if (!hasVowel) return true;
  }

  return false;
}

// Leksikon toponimi tambahan yang DIINJEKSI saat boot (data-driven dari dataset
// gazetteer). DILARANG mengimpor gazetteer di sini (modul ini harus pure/ringan
// dan tidak menyeret I/O dataset ke hot-path). Pemanggil boot mengisi lewat setter.
let injectedDistrictLexicon: string[] = [];

/**
 * Injeksi leksikon toponimi data-driven (mis. kunci toponimi majemuk dari
 * gazetteer: "tambak oso", "pepe legi"). Idempoten & menggantikan nilai lama.
 */
export function setNameSanitizerDistrictLexicon(names: string[]): void {
  injectedDistrictLexicon = Array.from(
    new Set((names || []).map((n) => (n || '').trim().toLowerCase()).filter(Boolean))
  );
}

/** Leksikon distrik efektif: daftar statis + injeksi data-driven (panjang dulu). */
function getEffectiveDistrictLexicon(): string[] {
  const merged = new Set<string>(COMMON_DISTRICTS);
  for (const n of injectedDistrictLexicon) merged.add(n);
  return Array.from(merged).sort((a, b) => b.length - a.length);
}

/**
 * Runtuhkan pengulangan frasa lokasi beruntun akibat sinkronisasi kontak ganda
 * (Google Contact / WhatsApp webhook): "Tambak Os Tambak Os" -> "Tambak Os",
 * "Sedati Sedati" -> "Sedati". Deterministik, tanpa mutilasi tengah kalimat.
 *
 * Aturan aman:
 * - Frasa MAJEMUK (>= 2 kata) yang berulang beruntun selalu diciutkan.
 * - Kata TUNGGAL hanya diciutkan bila kata itu memang toponimi (ada di leksikon),
 *   sehingga nama orang asli yang berulang ("Dede Dede") tidak dirusak.
 */
function stripConsecutiveDuplicatePhrase(name: string): string {
  const lexicon = new Set(getEffectiveDistrictLexicon());
  const words = name.split(/\s+/).filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = Math.floor(words.length / 2); k >= 1; k--) {
      const tail = words.slice(words.length - k).join(' ').toLowerCase();
      const prev = words.slice(words.length - 2 * k, words.length - k).join(' ').toLowerCase();
      if (tail !== prev) continue;
      if (k === 1 && !lexicon.has(tail)) continue;
      words.splice(words.length - k, k);
      changed = true;
      break;
    }
  }
  return words.join(' ');
}

/**
 * Buang frasa toponimi yang terpotong di akhir (mis. "Tambak Os" -> "Tambakoso"
 * adalah prefiks "tambakoso" di leksikon). Data-driven, tanpa daftar hafalan.
 */
function stripTrailingDistrictFragment(name: string): string {
  const lexicon = getEffectiveDistrictLexicon();
  const noSpace = lexicon.map((d) => d.replace(/\s+/g, ''));
  let words = name.split(/\s+/).filter(Boolean);
  let changed = true;
  while (changed && words.length >= 2) {
    changed = false;
    for (let k = Math.min(3, words.length - 1); k >= 1; k--) {
      const tailWords = words.slice(words.length - k);
      if (!tailWords.every((w) => /^[a-zA-Z]+$/.test(w))) continue;
      const concatenated = tailWords.join('').toLowerCase();
      if (concatenated.length < 5) continue;
      const isFragment = noSpace.some((d) => d.length > concatenated.length && d.startsWith(concatenated));
      if (isFragment) {
        words = words.slice(0, words.length - k);
        changed = true;
        break;
      }
    }
  }
  return words.join(' ');
}


/** Escape literal untuk RegExp lokal (bebas dependency, dataset aman). */
function escapeLexiconToken(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Gerbang DETERMINISTIK wilayah — SATU sumber kebenaran untuk membuang noise
 * toponimi dari sebuah nama (dipakai jalur sapaan DAN jalur penyimpanan DB).
 *
 * Urutan (fondasional, data-driven dari leksikon dataset + normalizer linguistik):
 *  1. Ekspansi singkatan baku ("Kec." → "Kecamatan", "Kel." → "Kelurahan")
 *     via `expandToponymAbbreviations` — closed-class linguistik, BUKAN daftar
 *     hafalan geografis bisnis.
 *  2. Buang label administratif + entitas setelahnya ("Kecamatan Sawahan").
 *  3. Buang frasa penunjuk lokasi di ujung ("dari/di/area/daerah/lokasi X").
 *  4. Runtuhkan frasa toponimi ganda beruntun ("Sedati Sedati").
 *  5. Kelupas toponimi akhir berulang via leksikon efektif dataset.
 *  6. Kelupas fragmen toponimi terpotong ("Ifa Tambak Os" → "Ifa").
 *
 * Tanpa regex hafalan per-kasus; wilayah bersumber dari leksikon gazetteer.
 */
export function stripLocationNoise(rawName?: string | null): string {
  let name = (rawName || '').trim();
  if (!name) return '';

  // 1. Ekspansi singkatan baku toponimi (case-preserving).
  name = expandToponymAbbreviations(name);

  // 2. Buang label administratif generik + entitas setelahnya.
  name = name.replace(/\b(?:kecamatan|kelurahan|desa|kabupaten|kota)\s+[a-zA-Z0-9_.-]+/gi, '').trim();
  // Sisa label administratif yang menggantung tanpa entitas.
  name = name.replace(/\b(?:kecamatan|kelurahan|kabupaten|kota)\b\s*$/gi, '').trim();

  // 3. Buang frasa penunjuk lokasi seperti "dari Semampir", "area Rungkut".
  name = name.replace(/\s+(?:dari|di|area|daerah|lokasi)\s+[a-zA-Z0-9_\s-]+$/i, '').trim();

  // 4. Runtuhkan frasa toponimi ganda beruntun.
  name = stripConsecutiveDuplicatePhrase(name);

  // 5. Kelupas toponimi akhir (bisa berulang) via leksikon efektif dataset.
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of getEffectiveDistrictLexicon()) {
      if (!d) continue;
      const re = new RegExp(`\\s+${escapeLexiconToken(d)}$`, 'i');
      if (re.test(name)) {
        name = name.replace(re, '').trim();
        changed = true;
        break;
      }
    }
  }

  // 6. Kelupas fragmen toponimi terpotong di akhir.
  name = stripTrailingDistrictFragment(name);

  return name.replace(/\s+/g, ' ').trim();
}

/**
 * Kelupas HANYA tag wilayah di ujung nama dan kembalikan sebagai `areaTag`
 * (fondasional untuk impor komposit tanpa delimiter " - ", mis. Google People
 * API yang menyatukan given+family). Dipakai `splitImportedContactName`.
 *
 * Berbeda dari `stripLocationNoise`: fungsi ini mengembalikan entitas wilayah
 * yang terkelupas (bukan membuangnya) agar dapat diklasifikasi ke kolom
 * kecamatan/kelurahan oleh gazetteer — anti data-loss informasi alamat.
 */
export function stripTrailingLocationTag(rawName?: string | null): {
  cleanName: string;
  areaTag: string | null;
} {
  let name = expandToponymAbbreviations((rawName || '').trim());
  if (!name) return { cleanName: '', areaTag: null };

  const tags: string[] = [];
  let changed = true;
  while (changed && name) {
    changed = false;
    // Label administratif menggantung di ujung ("... Kecamatan").
    const labelMatch = name.match(/\s+(?:kecamatan|kelurahan|desa|kabupaten|kota)$/i);
    if (labelMatch && labelMatch.index !== undefined) {
      name = name.slice(0, labelMatch.index).trim();
      changed = true;
      continue;
    }
    for (const d of getEffectiveDistrictLexicon()) {
      if (!d) continue;
      const re = new RegExp(`\\s+${escapeLexiconToken(d)}$`, 'i');
      const m = name.match(re);
      if (m && m.index !== undefined) {
        tags.push(m[0].trim());
        name = name.slice(0, m.index).trim();
        changed = true;
        break;
      }
    }
  }

  const cleanName = name.replace(/\s+/g, ' ').trim();
  return { cleanName, areaTag: tags.length > 0 ? tags[tags.length - 1] : null };
}

/**
 * Membersihkan nama customer agar hanya berupa nama panggilan/nama asli orang.
 * Menghilangkan:
 * 1. Prefix: "Bunda", "Ibu", "Mama", "Moms", "~", "Suami Bunda"
 * 2. Suffix Alamat/Lokasi: ", Sidotopo Wetan", "Kecamatan Sukodono", "rungkut", "Sedati", "Semampir"
 * 3. Catatan/Status: "+ Alamat", "(Bunda Fatma)", "- Leave ur Chat-Busy"
 * 4. Emoji dan simbol karakter khusus
 */
export function sanitizeCustomerNameForGreeting(rawName?: string | null): string {
  if (!rawName) return '';

  let name = rawName.trim();

  // 1. Buang emoji
  name = name.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}]/gu, '').trim();

  // 2. Ekstrak nama dalam kurung jika ada (misal: "0812345 (Bunda Rina)" -> "Bunda Rina")
  if (name.includes('(') && name.includes(')')) {
    const pMatch = name.match(/\(([^)]+)\)/);
    if (pMatch && pMatch[1]) {
      const inside = pMatch[1].trim();
      if (inside && !inside.toLowerCase().includes('bulan') && !inside.toLowerCase().includes('tahun') && !/^\d+/.test(inside)) {
        name = inside;
      } else {
        name = name.replace(/\([^)]*\)/g, '').trim();
      }
    }
  }

  // 3. Buang bagian setelah tanda koma atau pipe (biasanya alamat/wilayah: "Bunda Balqis, Sidotopo Wetan")
  name = name.split(/[,|]/)[0].trim();

  // 4. Buang catatan status/tambahan seperti "- Leave ur Chat", "+ Alamat", "/ Alamat", "- Semampir"
  name = name.split(/\s+[-+/:]\s+|\s*\+\s*alamat/i)[0].trim();

  // 5. Buang awalan sapaan (Bunda, Ibu, Mama, Moms, Suami Bunda, Ny, Mrs, ~)
  name = name.replace(/^(?:suami\s+bunda|bunda|ibu|mama|moms|momm|mbak|mas|mrs|ny|ny\.|kakak|kak|~)\s+/i, '').trim();

  // 6. Gerbang deterministik wilayah (satu sumber: stripLocationNoise) —
  //    termasuk ekspansi singkatan "Kec."/"Kel." yang dulu bocor.
  name = stripLocationNoise(name);

  // 7. Bersihkan simbol aneh yang tersisa di awal/akhir
  name = name.replace(/^[\s~_.*\-#@!&|+=<>]+|[\s~_.*\-#@!&|+=<>]+$/g, '').trim();

  // 8. Cek apakah nama tersisa adalah placeholder atau generic (misal "Pelanggan 6319", "Sandbox Customer", "Bunda")
  const lower = name.toLowerCase();
  if (!name || GENERIC_NAME_PLACEHOLDERS.has(lower) || /^pelanggan\s*\d+/i.test(lower) || /^customer\s*\d+/i.test(lower)) {
    return '';
  }

  // 9. Jika nama terlalu panjang (misal > 2 kata), ambil 1-2 kata pertama saja untuk sapaan ramah
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 2) {
    name = words.slice(0, 2).join(' ');
  }

  return name.trim();
}

/**
 * Gerbang SEAM TULIS (fondasional): bersihkan nama SEBELUM dipersist ke
 * `Customer.name`. BEDA dari jalur sapaan:
 *  - Prefix "Bunda"/"Ibu" DIPERTAHANKAN (DB memang menyimpan "Bunda <nama>").
 *  - Nama TIDAK dipotong 2 kata (nama panjang asli tetap utuh untuk kontak).
 * Hanya noise toponimi/wilayah + penanda alamat/status yang dibuang, memakai
 * gerbang deterministik `stripLocationNoise` (data-driven, bukan regex hafalan).
 *
 * Mengembalikan '' bila hasil kosong/placeholder — pemanggil WAJIB memilih
 * untuk TIDAK menulis nilai (pertahankan nama lama) demi anti data-loss.
 */
export function sanitizeCustomerNameForStorage(rawName?: string | null): string {
  if (!rawName) return '';
  let name = rawName.trim();

  // NFKD: karakter estetis (ℍ𝕖𝕟𝕪) & superscript (²) → ASCII; buang combining mark.
  name = name.normalize('NFKD').replace(/[\u0300-\u036F]/g, '');

  // 1. Buang emoji (pictographic + flag + skin-tone + ZWJ/VS16/keycap residue)
  name = name
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/[\u200D\uFE0F\u20E3\u{1F3FB}-\u{1F3FF}]/gu, '')
    .trim();

  // 2. Ekstrak nama dalam kurung jika ada (misal: "0812345 (Bunda Rina)" -> "Bunda Rina")
  if (name.includes('(') && name.includes(')')) {
    const pMatch = name.match(/\(([^)]+)\)/);
    if (pMatch && pMatch[1]) {
      const inside = pMatch[1].trim();
      if (inside && !inside.toLowerCase().includes('bulan') && !inside.toLowerCase().includes('tahun') && !/^\d+/.test(inside)) {
        name = inside;
      } else {
        name = name.replace(/\([^)]*\)/g, '').trim();
      }
    }
  }

  // 3. Buang catatan alamat/status ("Bunda Balqis, Sidotopo Wetan", "- Leave ur Chat").
  name = name.split(/[,|]/)[0].trim();
  name = name.split(/\s+[-+/:]\s+|\s*\+\s*alamat/i)[0].trim();

  // 4. Gerbang wilayah deterministik (ekspansi "Kec." + leksikon dataset).
  name = stripLocationNoise(name);

  // 5. Rapikan simbol sisa.
  name = name.replace(/^[\s~_.*\-#@!&|+=<>]+|[\s~_.*\-#@!&|+=<>]+$/g, '').trim();

  // 6. Jika nama yang tersisa adalah generic / handle / non-manusia (misal "A_31", "ay719", "Pelanggan 6319", "Bunda") -> kosongkan
  if (!name || isGenericCustomerName(name)) return '';
  return name.replace(/\s+/g, ' ').trim();
}

/**
 * Format sapaan lengkap dengan kata "Bunda".
 * Contoh:
 * - "Rina" -> "Bunda Rina"
 * - "" (kosong/placeholder) -> "Bunda"
 */
export function formatGreetingBunda(cleanName: string): string {
  const trimmed = cleanName ? cleanName.trim() : '';
  if (!trimmed || trimmed.toLowerCase() === 'bunda') {
    return 'Bunda';
  }
  return `Bunda ${trimmed}`;
}

/**
 * Memvalidasi apakah sebuah string layak menjadi entitas nama anak/bayi.
 * Mencegah masuknya ghost error seperti kata keterangan ("belakangan ini"),
 * label formulir ("Usia Bayi/Anak :"), pecahan kurung usia ("5 tahun)"),
 * rujukan diri ("saya sendiri"), atau kata umum layanan ("pijat bayi").
 *
 * Murni deterministik (zero I/O, zero side-effects).
 */
export function isValidChildName(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const s = raw.trim();
  if (s.length < 2 || s.length > 40) return false;

  // Dilarang karakter rusak atau pemisah sistem yang tersisa
  if (/[:;*~_#@!&|+=<>\n\r]/.test(s)) return false;

  // Dilarang pecahan tanda kurung tak berpasangan (misal "5 tahun)", "Cio (3")
  const openParen = (s.match(/\(/g) || []).length;
  const closeParen = (s.match(/\)/g) || []).length;
  if (openParen !== closeParen) return false;
  if (s.startsWith(')') || s.endsWith('(')) return false;

  const lower = s.toLowerCase();

  // Dilarang placeholder umum
  if (lower === '-' || lower === '--' || lower === 'null' || lower === 'undefined' || lower === 'si kecil' || lower === 'bunda' || lower === 'ibu' || lower === 'mama' || lower === 'ayah') {
    return false;
  }

  // Dilarang angka usia telanjang (misal "5 bulan", "3 thn", "0 bulan", "1,5 tahun")
  if (/^\d+(?:[.,]\d+)?\s*(?:bulan|bln|thn|tahun|th|hari|hr|minggu|m)\b/i.test(lower)) {
    return false;
  }

  // Dilarang adverbia waktu / percakapan bahasa Indonesia
  if (/\b(belakangan\s+ini|saat\s+ini|sekarang|kemarin|tadi\s+pagi|tadi\s+malam|besok|lusa|nanti|dulu|hari\s+ini)\b/i.test(lower)) {
    return false;
  }

  // Dilarang rujukan diri / pihak ketiga
  if (/\b(saya\s+sendiri|anak\s+saya|bayi\s+saya|anak\s+tetangga|atas\s+nama\s+saya)\b/i.test(lower)) {
    return false;
  }

  // Dilarang kata umum domain/klinik yang tertelan
  if (/\b(treatment|homecare|reservasi|booking|pilihan\s+treatment|jadwal|slot|pijat)\b/i.test(lower)) {
    return false;
  }

  // Dilarang label form formulir
  if (/\b(nama\s+bayi|nama\s+anak|nama\s+bunda|usia\s+bayi|usia\s+anak|alamat)\b/i.test(lower)) {
    return false;
  }

  // Dilarang placeholder numerik/generik form formulir (misal "Bayi 1", "Bayi 2", "Bayi 3", "Anak 1", "Bayi", "Anak")
  if (/^(?:bayi|anak)\s*\d*$/i.test(lower)) {
    return false;
  }

  // Dilarang kata medis / kondisi klinis ibu / instruksi (misal "hamil", "nifas", "nebul", "pasca vaksin")
  if (/\b(hamil|nifas|nebul|pasca\s+vaksin)\b/i.test(lower)) {
    return false;
  }

  return true;
}

/**
 * Membersihkan satu nama anak
 */
export function cleanSingleBabyName(raw: string): string {
  if (!raw) return '';
  let n = raw.trim();
  // Buang awalan Adek, Dek, Baby, Bayi, Anak
  n = n.replace(/^(?:adek|dek|baby|bayi|anak)\s+/i, '').trim();
  // Buang keterangan umur dalam kurung: "(3 bulan)", "(6 bln)", "(1 th)"
  n = n.replace(/\([^)]*\)/g, '').trim();
  // Buang umur: "2 bulan", "3 bln", "1 tahun"
  n = n.replace(/\b\d+\s*(?:bulan|bln|thn|tahun|th|m)\b/gi, '').trim();
  // Buang karakter aneh
  n = n.replace(/^[\s~_.*\-#@!&|+=<>]+|[\s~_.*\-#@!&|+=<>]+$/g, '').trim();
  if (!isValidChildName(n)) {
    return '';
  }
  return n;
}

/**
 * Format nama bayi untuk sapaan pesan (Review H+1, Milestone, dll).
 * Menangani kasus:
 * 1. 0 Anak / Tidak diketahui -> "si kecil"
 * 2. 1 Anak (misal: "Kenzo") -> "dek Kenzo" (atau "Kenzo")
 * 3. 2 Anak / Kembar (misal: "Arka & Arki") -> "dek Arka & dek Arki"
 * 4. 3+ Anak (misal: "A, B & C") -> "dek A, dek B & dek C"
 */
export function formatBabyNamesForGreeting(
  children?: Array<{ name: string }> | null,
  rawText?: string | null,
  options: { prefixDek?: boolean } = { prefixDek: false }
): string {
  const names: string[] = [];

  if (children && children.length > 0) {
    for (const c of children) {
      if (!c || !c.name) continue;
      const cleaned = cleanSingleBabyName(c.name);
      if (cleaned && isValidChildName(cleaned) && !names.includes(cleaned) && cleaned.toLowerCase() !== 'si kecil') {
        names.push(cleaned);
      }
    }
  }

  // Jika children kosong tapi ada rawText (misal dari form reservasi "Nama Bayi : Kenzo & Kenzie")
  if (names.length === 0 && rawText) {
    const match = rawText.match(/Nama Bayi\s*:\s*([^\n]+)/i);
    if (match && match[1]) {
      // Split by &, dan, koma
      const parts = match[1].split(/&|\bdan\b|,/i).map(s => cleanSingleBabyName(s)).filter(Boolean);
      for (const p of parts) {
        if (p && isValidChildName(p) && !names.includes(p) && p.toLowerCase() !== 'si kecil') {
          names.push(p);
        }
      }
    }
  }

  if (names.length === 0) {
    return 'si kecil';
  }

  if (names.length === 1) {
    return options.prefixDek ? `dek ${names[0]}` : names[0];
  }

  if (names.length === 2) {
    return options.prefixDek
      ? `dek ${names[0]} & dek ${names[1]}`
      : `${names[0]} & ${names[1]}`;
  }

  // 3 atau lebih
  const allExceptLast = names.slice(0, -1);
  const last = names[names.length - 1];
  if (options.prefixDek) {
    return `${allExceptLast.map(n => `dek ${n}`).join(', ')} & dek ${last}`;
  }
  return `${allExceptLast.join(', ')} & ${last}`;
}

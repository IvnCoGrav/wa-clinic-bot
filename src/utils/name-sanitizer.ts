/**
 * name-sanitizer.ts
 * Utility untuk membersihkan nama customer dan nama anak (babyName)
 * dari gelar ganda ("Bunda"), nama wilayah/kelurahan/kecamatan di buku kontak,
 * catatan admin (+ Alamat, status WA), simbol/emoji, serta menangani multiple babies (kembar / 2 anak).
 */

const COMMON_DISTRICTS = [
  // Multi-word districts / areas / clusters (Panjang dulu agar matching lebih spesifik)
  'tambak sari sby', 'sidotopo wetan', 'sekawan nyaman', 'citraland wiyung', 'medokan semampir',
  'gunung anyar tambak', 'tenggilis mejoyo', 'pabean cantian', 'pabean cantikan', 'lidah kulon',
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
  'bunda', 'ibu', 'mama', 'moms', 'momm', 'mbak', 'mas', 'kak', 'kakak', 'ny', 'ny.',
  'pasien', 'customer', 'pelanggan', 'lead', 'sandbox customer', 'test', 'tester', 'dummy',
  '-', '--', '...', 'null', 'undefined'
]);

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

  // 6. Buang kata "Kecamatan ..." atau "Kelurahan ..." di tengah/belakang
  name = name.replace(/\b(?:kecamatan|kelurahan|desa|kabupaten|kota)\s+[a-zA-Z0-9_-]+/gi, '').trim();

  // 6b. Buang frasa penunjuk lokasi seperti "dari Semampir", "area Rungkut", "di Sedati"
  name = name.replace(/\s+(?:dari|di|area|daerah|lokasi)\s+[a-zA-Z0-9_\s-]+$/i, '').trim();

  // 7. Buang nama-nama kecamatan/kelurahan umum Surabaya/Sidoarjo di akhir string (bisa berulang misal "Semampir Sidoarjo")
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of COMMON_DISTRICTS) {
      const re = new RegExp(`\\s+${d}$`, 'i');
      if (re.test(name)) {
        name = name.replace(re, '').trim();
        changed = true;
        break;
      }
    }
  }

  // 8. Bersihkan simbol aneh yang tersisa di awal/akhir
  name = name.replace(/^[\s~_.*\-#@!&|+=<>]+|[\s~_.*\-#@!&|+=<>]+$/g, '').trim();

  // 9. Cek apakah nama tersisa adalah placeholder atau generic (misal "Pelanggan 6319", "Sandbox Customer", "Bunda")
  const lower = name.toLowerCase();
  if (!name || GENERIC_NAME_PLACEHOLDERS.has(lower) || /^pelanggan\s*\d+/i.test(lower) || /^customer\s*\d+/i.test(lower)) {
    return '';
  }

  // 10. Jika nama terlalu panjang (misal > 2 kata), ambil 1-2 kata pertama saja untuk sapaan ramah
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 2) {
    name = words.slice(0, 2).join(' ');
  }

  return name.trim();
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
      const cleaned = cleanSingleBabyName(c.name);
      if (cleaned && !names.includes(cleaned) && cleaned.toLowerCase() !== 'si kecil') {
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
        if (p && !names.includes(p) && p.toLowerCase() !== 'si kecil') {
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

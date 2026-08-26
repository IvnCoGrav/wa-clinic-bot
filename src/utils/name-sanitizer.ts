/**
 * name-sanitizer.ts
 * Utility untuk membersihkan nama customer dan nama anak (babyName)
 * dari gelar ganda ("Bunda"), nama wilayah/kelurahan/kecamatan di buku kontak,
 * catatan admin (+ Alamat, status WA), simbol/emoji, serta menangani multiple babies (kembar / 2 anak).
 */

const COMMON_DISTRICTS = [
  'jambangan', 'bubutan', 'petikan', 'petiken', 'karang pilang', 'karangpilang', 'ngagel',
  'kalijudan', 'buduran', 'simomulyo', 'candi', 'sedati', 'gresik', 'kemayoran', 'manukan',
  'siwalankerto', 'tambaksari', 'tambak sari sby', 'sidotopo wetan', 'sidotopo', 'sekawan nyaman',
  'banyuurip', 'banyu urip', 'kodam', 'rungkut', 'pepelegi', 'taman', 'mulyorejo',
  'tenggilis', 'tanggulangin', 'kandangan', 'dukuh pakis', 'sukomanunggal', 'lidah kulon', 'lidah wetan',
  'gedangan', 'bungurasih', 'wonocolo', 'tegalsari', 'bratang', 'bulusidokare', 'citraland wiyung',
  'citraland', 'damarsih', 'kenjeran', 'klampis', 'sambikerep', 'gunungsari', 'sawotratap',
  'simokerto', 'tambak oso', 'kutisari', 'kertajaya', 'wonosari', 'sukodono', 'pabean',
  'gunung anyar', 'tambak wedi', 'semolowaru', 'pakuwon city', 'jojoran', 'waru', 'krian',
  'medokan ayu', 'medokan', 'grogol sby', 'grogol', 'babatan', 'kepuh', 'sidoarjo', 'surabaya',
  'wiyung', 'gayungan', 'benowo', 'pakal', 'asemrowo', 'krembangan', 'genteng', 'sawahan'
];

const GENERIC_NAME_PLACEHOLDERS = new Set([
  'bunda', 'ibu', 'mama', 'moms', 'momm', 'mbak', 'mas', 'kak', 'kakak', 'ny', 'ny.',
  'pasien', 'customer', 'pelanggan', 'lead', 'sandbox customer', 'test', 'tester', 'dummy',
  '-', '--', '...', 'null', 'undefined'
]);

/**
 * Membersihkan nama customer agar hanya berupa nama panggilan/nama asli orang.
 * Menghilangkan:
 * 1. Prefix: "Bunda", "Ibu", "Mama", "Moms", "~", "Suami Bunda"
 * 2. Suffix Alamat/Lokasi: ", Sidotopo Wetan", "Kecamatan Sukodono", "rungkut", "Sedati"
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

  // 3. Buang bagian setelah tanda koma (biasanya alamat: "Bunda Balqis, Sidotopo Wetan")
  name = name.split(',')[0].trim();

  // 4. Buang catatan status/tambahan seperti "- Leave ur Chat", "+ Alamat", "/ Alamat"
  name = name.split(/\s+[-+/]\s+|\s*\+\s*alamat/i)[0].trim();

  // 5. Buang awalan sapaan (Bunda, Ibu, Mama, Moms, Suami Bunda, Ny, Mrs, ~)
  name = name.replace(/^(?:suami\s+bunda|bunda|ibu|mama|moms|momm|mbak|mas|mrs|ny|ny\.|kakak|kak|~)\s+/i, '').trim();

  // 6. Buang kata "Kecamatan ..." atau "Kelurahan ..." di tengah/belakang
  name = name.replace(/\b(?:kecamatan|kelurahan|desa|kabupaten|kota)\s+[a-zA-Z0-9_-]+/gi, '').trim();

  // 7. Buang nama-nama kecamatan/kelurahan umum Surabaya/Sidoarjo di akhir string
  for (const d of COMMON_DISTRICTS) {
    const re = new RegExp(`\\s+${d}$`, 'i');
    if (re.test(name)) {
      name = name.replace(re, '').trim();
      break;
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

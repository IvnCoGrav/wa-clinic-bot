import { getGazetteerData } from './gazetteer';

/**
 * Gazetteer Zipcode Resolver
 * Thin wrapper delegating dataset loading to src/utils/gazetteer.ts (Single Source of Truth).
 * Resolusi kode pos instan berbasis in-memory index dari
 * src/config/surabaya_sidoarjo_subdistricts.json
 *
 * 3 layer pencarian:
 * 1) Kelurahan + Kecamatan exact → 100% presisi
 * 2) Kecamatan fallback → kode pos representatif (most-common / override)
 * 3) Free-text entity match → ekstrak kecamatan/kelurahan dari nama/alamat
 */

export interface ResolveZipcodeInput {
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  text?: string | null; // free-text gabungan name + address
}

interface GazetteerRow {
  Kabupaten_Kota: string;
  Kecamatan: string;
  Kelurahan_Desa: string;
  Kode_Pos: string;
}

type Normalized = string; // lower trimmed

let initialized = false;
let kelKecToZip = new Map<string, string>(); // "kelurahan|kecamatan" -> zip
let kecToZip = new Map<string, string>(); // kecamatanLower -> representative zip
let kelToZip = new Map<string, string>(); // kelurahanLower -> zip (jika unik, simpan first)
let kelurahanList: { lower: string; raw: string; zip: string; kecLower: string }[] = [];
let kecamatanList: { lower: string; raw: string; zip: string }[] = [];
let kecamatanSet = new Set<string>();

// Override representatif eksplisit sesuai spec (mengatasi tie-break & preferensi bisnis)
const KECAMATAN_REPRESENTATIVE_OVERRIDE: Record<string, string> = {
  'gedangan': '61254',
  'sedati': '61253',
  'waru': '61256',
  'wonokromo': '60243',
  'rungkut': '60293',
  'lakarsantri': '60213',
};

function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\(kota\)/g, '').trim();
  // "Sidoarjo (Kota)" -> "sidoarjo"
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadGazetteer(): GazetteerRow[] {
  // Delegate to central gazetteer service — single file I/O, cached
  try {
    const data = getGazetteerData() as GazetteerRow[];
    if (data && data.length > 0) return data as unknown as GazetteerRow[];
  } catch (_) {}
  return [];
}

function ensureInit(): void {
  if (initialized) return;
  const data = loadGazetteer();
  // Temporary aggregator untuk menentukan representative zip per kecamatan (most-common)
  const kecCounter = new Map<string, Map<string, number>>();
  const kecRawName = new Map<string, string>();

  for (const row of data) {
    const kecLower = normalize(row.Kecamatan);
    const kelLower = normalize(row.Kelurahan_Desa);
    const zip = (row.Kode_Pos || '').trim();
    if (!zip) continue;
    // kelKec map
    if (kelLower && kecLower) {
      const key = `${kelLower}|${kecLower}`;
      if (!kelKecToZip.has(key)) kelKecToZip.set(key, zip);
    }
    // kec counter
    if (kecLower) {
      if (!kecCounter.has(kecLower)) kecCounter.set(kecLower, new Map());
      const m = kecCounter.get(kecLower)!;
      m.set(zip, (m.get(zip) || 0) + 1);
      if (!kecRawName.has(kecLower)) kecRawName.set(kecLower, row.Kecamatan.trim());
    }
    // kelurahan list (for free-text)
    if (kelLower) {
      kelurahanList.push({ lower: kelLower, raw: row.Kelurahan_Desa.trim(), zip, kecLower });
      if (!kelToZip.has(kelLower)) kelToZip.set(kelLower, zip);
    }
  }

  // Bangun kecToZip representatif
  for (const [kecLower, counter] of kecCounter.entries()) {
    const override = KECAMATAN_REPRESENTATIVE_OVERRIDE[kecLower];
    if (override) {
      kecToZip.set(kecLower, override);
      kecamatanSet.add(kecLower);
      kecamatanList.push({ lower: kecLower, raw: kecRawName.get(kecLower) || kecLower, zip: override });
      continue;
    }
    // most-common
    let bestZip = '';
    let bestCount = -1;
    for (const [zip, cnt] of counter.entries()) {
      if (cnt > bestCount) { bestCount = cnt; bestZip = zip; }
    }
    kecToZip.set(kecLower, bestZip);
    kecamatanSet.add(kecLower);
    kecamatanList.push({ lower: kecLower, raw: kecRawName.get(kecLower) || kecLower, zip: bestZip });
  }

  // Urutkan untuk free-text: longest first agar match "sawotratap" sebelum "waru" dll, dan multi-word lebih dulu
  kecamatanList.sort((a, b) => b.lower.length - a.lower.length);
  kelurahanList.sort((a, b) => b.lower.length - a.lower.length);

  // Deduplicate kelurahanList untuk lookup cepat — keep first occurrence per lower (unique kel names)
  // but retain sorted for free-text scanning where we need precise raw

  initialized = true;
}

export function resolveZipcode(input: ResolveZipcodeInput): string | null {
  ensureInit();
  const kel = normalize(input.kelurahan || '');
  const kec = normalize(input.kecamatan || '');
  const rawText = (input.text || '').trim();

  // Layer 1: Kelurahan + Kecamatan exact (presisi 100%)
  if (kel && kec) {
    const key = `${kel}|${kec}`;
    const zip = kelKecToZip.get(key);
    if (zip) return zip;
    // Juga coba kelurahan alone jika kecamatan fallback belum ketemu — kelurahan biasanya unik
    const kelDirect = kelToZip.get(kel);
    if (kelDirect) return kelDirect;
    // Fallback ke kecamatan representatif
    const kecZip = kecToZip.get(kec);
    if (kecZip) return kecZip;
  }

  // Layer 2: Kecamatan-only fallback
  if (kec) {
    const kecZip = kecToZip.get(kec);
    if (kecZip) return kecZip;
  }

  // Kelurahan-only tanpa kecamatan (jika kelurahan unik)
  if (kel) {
    const kelDirect = kelToZip.get(kel);
    if (kelDirect) return kelDirect;
  }

  // Layer 3: Free-text entity match — ekstraksi kecamatan/kelurahan dari text (nama/alamat)
  if (rawText) {
    const lowerText = rawText.toLowerCase();

    // 3a. Coba kelurahan + kecamatan combo muncul bersamaan di text (paling presisi)
    // Scan kelurahan list: jika both kelurahan dan kecamatannya muncul di text, return zip combo
    for (const entry of kelurahanList) {
      // Word-boundary check untuk kelurahan
      const kelPattern = new RegExp(`\\b${escapeRegex(entry.lower)}\\b`, 'i');
      if (!kelPattern.test(lowerText)) continue;
      // Jika kecamatannya juga terdeteksi di text, pastikan combo valid
      const kecPattern = new RegExp(`\\b${escapeRegex(entry.kecLower)}\\b`, 'i');
      if (kecPattern.test(lowerText)) {
        const comboKey = `${entry.lower}|${entry.kecLower}`;
        const comboZip = kelKecToZip.get(comboKey);
        if (comboZip) return comboZip;
      }
      // Kelurahan saja match (tanpa kecamatan di text) — return zip kelurahan tersebut
      // Tapi hanya jika kelurahan cukup distinctive (length >=4 untuk hindari false positive)
      if (entry.lower.length >= 3) {
        // Return first matching longest kelurahan
        return entry.zip;
      }
    }

    // 3b. Kecamatan-only scan di free-text (sorted longest first)
    for (const entry of kecamatanList) {
      // Minimal 3 huruf
      if (entry.lower.length < 3) continue;
      const pat = new RegExp(`\\b${escapeRegex(entry.lower)}\\b`, 'i');
      if (pat.test(lowerText)) {
        return entry.zip;
      }
    }
  }

  return null;
}

/**
 * Helper untuk mereset cache saat testing (memungkinkan reload dataset mock)
 */
export function __resetGazetteerResolverCache(): void {
  initialized = false;
  kelKecToZip = new Map();
  kecToZip = new Map();
  kelToZip = new Map();
  kelurahanList = [];
  kecamatanList = [];
  kecamatanSet = new Set();
}

/** Expose representative map untuk observability / testing */
export function getKecamatanRepresentativeMap(): Map<string, string> {
  ensureInit();
  return new Map(kecToZip);
}

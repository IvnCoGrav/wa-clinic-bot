export interface BabyDetail {
  name: string;
  age: string;
}

/**
 * Ekstrak daftar bayi/anak (nama + usia) dari teks list reservasi mentah atau treatment_detail.
 * Fleksibel terhadap variasi penulisan:
 * - Label Nama: "Nama Bayi", "Nama Anak", "Nama Baby", "Nama Pasien", "Anak", "Baby"
 * - Label Usia: "Usia Bayi/Anak", "Usia Bayi", "Usia Anak", "Usia", "Umur Bayi", "Umur Anak", "Umur"
 * - Fallback: jika rawText tidak punya label, parse dari string treatment_detail
 */
export function extractBabiesFromRawText(
  rawText: string | null | undefined,
  treatmentDetail?: string | null
): BabyDetail[] {
  if (!rawText && !treatmentDetail) return [];

  if (rawText) {
    const cleaned = rawText.replace(/[*_~`]/g, '').replace(/\r\n/g, '\n');

    // Pecah label inline
    const inlineRe = /(\s+)(Nama (?:Bayi|Anak|Baby|Pasien)\s*:|Usia (?:Bayi\/Anak|Bayi|Anak)\s*:|Umur (?:Bayi|Anak)?\s*:|Usia Kehamilan[^\n:]*:|Treatment\s*:)/gi;
    const text = cleaned.replace(inlineRe, '\n$2');

    const nameLines: string[] = [];
    const ageLines: string[] = [];

    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const idx = t.indexOf(':');
      if (idx === -1) continue;
      const label = t.slice(0, idx).trim().toLowerCase().replace(/\s+/g, ' ');
      const value = t.slice(idx + 1).trim();

      // Tangkap variasi label nama bayi/anak
      if (
        label.includes('nama bayi') ||
        label.includes('nama anak') ||
        label.includes('nama baby') ||
        label.includes('nama pasien') ||
        label === 'anak' ||
        label === 'baby'
      ) {
        nameLines.push(value);
      }
      // Tangkap variasi label usia/umur (selain kehamilan)
      else if (
        (label.includes('usia') || label.includes('umur')) &&
        !label.includes('kehamilan') &&
        !label.includes('bunda')
      ) {
        ageLines.push(value);
      }
    }

    const babies = buildBabies(nameLines, ageLines);
    if (babies.length > 0) return babies;
  }

  // Fallback: parse dari string treatment_detail (misal: "Baby: Pijat (Bayi: Kanaya, Usia: 6 bulan)")
  if (treatmentDetail) {
    const babyMatch = treatmentDetail.match(/\(Bayi:\s*([^,)]+)(?:,\s*Usia:\s*([^)]+))?\)/i);
    if (babyMatch) {
      const name = babyMatch[1].trim();
      const age = babyMatch[2]?.trim() || '';
      if (name && name !== '-') {
        return [{ name, age }];
      }
    }
  }

  return [];
}

function splitMulti(value: string): string[] {
  if (!value) return [];
  return value
    .replace(/\s+dan\s+/gi, ', ')
    .replace(/\s*&\s*/gi, ', ')
    .replace(/\s*;\s*/gi, ', ')
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildBabies(nameLines: string[], ageLines: string[]): BabyDetail[] {
  const entries: { name: string; age: string | null }[] = [];
  for (const line of nameLines) {
    for (const part of splitMulti(line)) {
      if (!part) continue;
      const m = part.match(/^(.+?)\s*\((?:umur|usia)?\s*([^)]+)\)$/i);
      if (m) entries.push({ name: m[1].trim(), age: m[2].trim() });
      else entries.push({ name: part, age: null });
    }
  }

  const ages: string[] = [];
  for (const line of ageLines) {
    for (const a of splitMulti(line)) {
      const t = a.trim();
      if (t) ages.push(t);
    }
  }

  const count = Math.max(entries.length, ages.length);
  const result: BabyDetail[] = [];
  for (let i = 0; i < count; i++) {
    const e = entries[i];
    result.push({ name: e?.name || `Bayi ${i + 1}`, age: ages[i] ?? e?.age ?? '' });
  }
  return result;
}

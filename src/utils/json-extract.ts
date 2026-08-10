/**
 * json-extract.ts — Ekstraksi & perbaikan JSON dari output LLM.
 *
 * Masalah: model reasoning (DeepSeek, MiniMax M2, dst.) sering mengembalikan
 * JSON yang dibungkus teks, code fence, ATAU terpotong di tengah karena
 * max_tokens habis saat berpikir. Util ini berusaha memulihkan JSON dari
 * kondisi tersebut: seluruh teks → blok {..} balanced → perbaikan terpotong.
 */

function containsPreferredKey(slice: string, preferredKey?: string | string[]): boolean {
  if (!preferredKey) return true;
  const keys = Array.isArray(preferredKey) ? preferredKey : [preferredKey];
  return keys.some((k) => slice.includes(`"${k}"`));
}

/**
 * Ambil blok JSON terbesar yang BALANCED (pasangan {} lengkap, string-aware)
 * dan bisa di-parse. Jika preferredKey diberikan, blok yang mengandung kunci
 * tersebut diutamakan (mis. "intents" untuk hasil klasifikasi NLU).
 */
export function extractBalancedJson(raw: string, preferredKey?: string | string[]): string | null {
  const s = (raw || '').trim();
  let candidate = s.indexOf('{');
  let validFallback: string | null = null;

  while (candidate !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let j = candidate; j < s.length; j++) {
      const ch = s[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else {
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            const slice = s.slice(candidate, j + 1);
            try {
              JSON.parse(slice);
              if (containsPreferredKey(slice, preferredKey)) return slice;
              validFallback = validFallback || slice;
            } catch {
              /* malformed, coba titik mulai berikutnya */
            }
            break;
          }
        }
      }
    }
    candidate = s.indexOf('{', candidate + 1);
  }

  return validFallback;
}

/**
 * Perbaiki JSON yang TERPOTONG (depth brace > 0 sampai akhir string):
 * 1. Ambil region mulai dari '{' pertama (abaikan prefiks teks non-JSON).
 * 2. Tutup brace yang kurang (depth) lalu coba parse.
 * 3. Jika masih gagal, potong dari ujung ke batas ',' atau '}' terakhir yang
 *    menghasilkan JSON valid (kondisi umum: reasoning terpotong di tengah value).
 */
export function repairTruncatedJson(raw: string, preferredKey?: string | string[]): string | null {
  const s = (raw || '').trim();
  const braceStart = s.indexOf('{');
  if (braceStart === -1) return null;
  const region = s.slice(braceStart).trim();

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < region.length; i++) {
    const ch = region[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else {
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
  }

  if (depth <= 0) return null;

  const tryParse = (candidate: string): string | null => {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && containsPreferredKey(candidate, preferredKey)) {
        return candidate;
      }
    } catch {
      /* lanjut strategi berikutnya */
    }
    return null;
  };

  // 1. Tutup brace yang kurang
  const closed = region + '}'.repeat(depth);
  const parsed = tryParse(closed);
  if (parsed) return parsed;

  // 2. Potong progresif dari ujung di batas yang masuk akal
  for (let cut = region.length - 1; cut > 0; cut--) {
    const ch = region[cut];
    if (ch !== ',' && ch !== '}') continue;
    const prefix = region.slice(0, cut + 1).trim();
    const closedPrefix = prefix + '}'.repeat(Math.max(1, depth));
    const ok = tryParse(closedPrefix);
    if (ok) return ok;
  }

  return null;
}

/**
 * Pipeline lengkap: strip code fence → parse seluruh teks → blok balanced →
 * perbaikan terpotong → slice {..} naive. Mengembalikan JSON string valid
 * atau null bila tidak ada yang bisa dipulihkan.
 */
export function extractJsonContent(raw: string, preferredKey?: string | string[]): string | null {
  let clean = (raw || '').trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
  }

  try {
    const parsed = JSON.parse(clean);
    if (parsed && typeof parsed === 'object' && containsPreferredKey(clean, preferredKey)) {
      return clean;
    }
  } catch {
    /* lanjut strategi berikutnya */
  }

  const balanced = extractBalancedJson(clean, preferredKey);
  if (balanced) {
    // Hasil balanced sudah memuat preferredKey → langsung pakai.
    if (containsPreferredKey(balanced, preferredKey)) return balanced;
    // Hasil balanced TANPA preferredKey (mis. blok terdalam yang keburu tertutup
    // padahal objek luar terpotong) — repair bisa menghasilkan blob luar berisi
    // preferredKey. Repair menang, kalau gagal baru pakai balanced.
    const repaired = repairTruncatedJson(clean, preferredKey);
    if (repaired) return repaired;
    return balanced;
  }

  const repaired = repairTruncatedJson(clean, preferredKey);
  if (repaired) return repaired;

  const braceStart = clean.indexOf('{');
  const braceEnd = clean.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    const slice = clean.slice(braceStart, braceEnd + 1).trim();
    try {
      const parsed = JSON.parse(slice);
      if (parsed && typeof parsed === 'object' && containsPreferredKey(slice, preferredKey)) {
        return slice;
      }
    } catch {
      /* tidak valid — biarkan null */
    }
  }

  return null;
}
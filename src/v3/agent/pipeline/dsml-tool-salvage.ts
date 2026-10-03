/**
 * Deterministic DSML tool-call salvage (defense-in-depth).
 *
 * Latar: model OpenAI-compatible via gateway (DeepSeek netra) kadang tidak
 * mengembalikan `tool_calls` terstruktur, melainkan memuntahkan sintaks
 * tool-call native (DSML/XML) ke properti teks `content`. Bila output mentah
 * ini terpotong (mis. `finish_reason: length` akibat looping), parser OpenAI
 * gagal mengekstrak tool → `executedTools` kosong → guardrail jatuh ke
 * fallback buntu. Insiden: percakapan Bunda Lyaa "Wonokusumo" (2026-10-03).
 *
 * Modul ini murni (pure, tanpa I/O) dan hanya MEREKONSTRUKSI nama fungsi +
 * argumen dari artefak teks. Keamanan anti-halusinasi TIDAK di sini — gerbang
 * deterministik eksisting (`tool-pipeline.ts` verbatim gate) tetap otoritas
 * utama yang memvalidasi/mengganti `locationText` terhadap teks customer asli.
 * Salvage DILARANG mengarang; bila tak ada invoke yang bisa dibaca → array kosong.
 */

export interface SalvagedToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Deteksi artefak DSML apa pun (control-char C1, pipe fullwidth, dll). */
const DSML_RE = /<[^\w\s]{0,4}\/?[^\w\s]{0,4}DSML[^\w\s]{0,4}/i;

/**
 * Cari pasangan kurung kurawal pertama yang seimbang mulai dari indeks `start`.
 * Mengembalikan substring JSON mentah atau null bila tidak seimbang (terpotong).
 * Menghormati string literal (tanda kutip + escape) agar `{`/`}` di dalam nilai
 * tidak salah dihitung.
 */
function extractBalancedJson(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Batas aman partial salvage agar stream looping raksasa tak meledak. */
const PARTIAL_MAX_PAIRS = 40;
const PARTIAL_MAX_SCAN = 8192;

/**
 * Salvage PARSIAL untuk stream yang TERPOTONG (`finish_reason: length`):
 * `extractBalancedJson` mustahil berhasil karena kurung tak pernah ditutup,
 * padahal pasangan awal (mis. `"locationText": "Waru"`) sudah lengkap. Fungsi
 * ini memungut HANYA pasangan `"key": value` yang benar-benar utuh (string
 * bertutup + escape-aware, angka, boolean, null), lalu BERHENTI di titik rusak.
 * DILARANG merekonstruksi nilai yang hilang/terpotong. Mengembalikan null bila
 * tak ada satu pun pasangan lengkap.
 *
 * Insiden Waru (6281390541340, 2026-10-03).
 */
export function salvagePartialDsmlArgs(bodyText: string): Record<string, unknown> | null {
  if (!bodyText || typeof bodyText !== 'string') return null;
  const text = bodyText.slice(0, PARTIAL_MAX_SCAN);
  const out: Record<string, unknown> = {};
  let i = 0;
  let pairs = 0;

  const skipWs = (): void => {
    // Lewati whitespace, pemisah koma, dan kurung pembuka (kita mulai dari `{`).
    while (i < text.length && /[\s,{]/.test(text[i])) i++;
  };
  // Baca string literal mulai di `text[i]` (harus `"`). Memajukan `i` melewati
  // penutup kutip. Mengembalikan null bila tak tertutup (terpotong).
  const readString = (): string | null => {
    if (text[i] !== '"') return null;
    let j = i + 1;
    let raw = '';
    let escaped = false;
    while (j < text.length) {
      const ch = text[j];
      if (escaped) { raw += ch; escaped = false; j++; continue; }
      if (ch === '\\') { raw += ch; escaped = true; j++; continue; }
      if (ch === '"') {
        i = j + 1;
        try { return JSON.parse(`"${raw}"`); } catch { return null; }
      }
      raw += ch;
      j++;
    }
    return null; // tak tertutup → terpotong
  };

  while (i < text.length && pairs < PARTIAL_MAX_PAIRS) {
    skipWs();
    const key = readString();
    if (key === null) break; // key terpotong / bukan string
    skipWs();
    if (text[i] !== ':') break;
    i++;
    skipWs();

    if (text[i] === '"') {
      const val = readString();
      if (val === null) break; // nilai string terpotong
      if (!(key in out)) out[key] = val;
    } else {
      const m = /^(true|false|null|-?\d+(?:\.\d+)?)/.exec(text.slice(i));
      if (!m) break; // nilai rusak/terpotong
      const raw = m[1];
      if (!(key in out)) {
        out[key] = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : Number(raw);
      }
      i += raw.length;
    }
    pairs++;
  }

  return pairs > 0 ? out : null;
}

/**
 * Ekstrak pemanggilan tool dari teks mentah berisi DSML.
 *
 * Mendukung dua bentuk argumen yang lazim muncul di log produksi:
 *   1. JSON langsung setelah `invoke name="..."` (pola riil netra).
 *   2. Blok `<parameter name="x">nilai</parameter>`.
 *
 * Argumen yang tidak bisa diparse sebagai JSON → dibuang (fail-safe), bukan
 * ditebak. Nama fungsi wajib non-kosong.
 */
export function salvageToolCallsFromDsml(content: string): SalvagedToolCall[] {
  if (!content || typeof content !== 'string') return [];
  if (!DSML_RE.test(content)) return [];

  const calls: SalvagedToolCall[] = [];
  const invokeRe = /invoke\s+name\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = invokeRe.exec(content)) !== null) {
    const name = (m[1] || '').trim();
    if (!name) continue;
    const after = content.slice(invokeRe.lastIndex);

    let args: Record<string, unknown> | null = null;

    // Bentuk 1: JSON langsung (utuh, balanced).
    const braceIdx = after.indexOf('{');
    if (braceIdx !== -1) {
      const rawJson = extractBalancedJson(after, braceIdx);
      if (rawJson) {
        try {
          const parsed = JSON.parse(rawJson);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
          }
        } catch { args = null; }
      }
      // Bentuk 1b (insiden Waru): JSON terpotong `finish_reason=length` —
      // kurung tak pernah ditutup, tetapi pasangan awal lengkap. Pungut
      // pasangan utuh saja (fail-safe, tanpa rekonstruksi).
      if (!args) {
        args = salvagePartialDsmlArgs(after.slice(braceIdx));
      }
    }

    // Bentuk 2: blok <parameter name="x">nilai</parameter>.
    if (!args) {
      const paramRe = /parameter\s+name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/[^>]*parameter/gi;
      const collected: Record<string, unknown> = {};
      let p: RegExpExecArray | null;
      let found = false;
      while ((p = paramRe.exec(after)) !== null) {
        const key = (p[1] || '').trim();
        if (!key) continue;
        const val = (p[2] || '').trim();
        collected[key] = val;
        found = true;
      }
      if (found) args = collected;
    }

    if (!args) continue;
    calls.push({
      id: `salvaged_${calls.length}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    });
  }

  return calls;
}

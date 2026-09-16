/**
 * prompt-cache.ts — Seam prompt caching untuk LLM (PLAN 9 FASE 9.1).
 *
 * Masalah: prompt generation ~42.000 char/balasan, tetapi hanya sebagian kecil
 * yang byte-stabil antar-turn — sehingga provider tidak bisa meng-cache prefix
 * secara efektif (biaya token & latensi tinggi).
 *
 * Solusi (fondasional, bukan tambal):
 *  - Pisahkan system prompt menjadi PREFIX STABIL (byte-identik antar-turn) dan
 *    SUFFIX VOLATIL (berubah per-turn).
 *  - Prefix stabil dijadikan `messages[0]` dengan anotasi `cache_control` bila
 *    provider mendukung; suffix volatil diletakkan setelahnya.
 *  - Untuk provider yang tidak mendukung, hasilnya setara menggabungkan kembali
 *    prefix+suffix menjadi satu system message (perilaku identik seperti kini).
 *
 * Zero new dependency.
 */

export interface CacheableSystemPrompt {
  /** Prefix yang diharapkan byte-stabil antar-turn. */
  stablePrefix: string;
  /** Sisa prompt yang berubah per-turn (status, ringkasan, fase, few-shot). */
  volatileSuffix: string;
}

/**
 * Memisahkan prompt menjadi prefix stabil + suffix volatil berdasarkan marker.
 * Bila marker tidak ditemukan, seluruh prompt dianggap volatil (stablePrefix kosong)
 * — aman: tidak ada yang di-cache, perilaku tetap benar.
 */
export function buildCacheableSystemPrompt(full: string, stableSuffixMarker: string): CacheableSystemPrompt {
  if (!full) return { stablePrefix: '', volatileSuffix: '' };
  const idx = full.indexOf(stableSuffixMarker);
  if (idx <= 0) return { stablePrefix: '', volatileSuffix: full };
  return {
    stablePrefix: full.slice(0, idx),
    volatileSuffix: full.slice(idx),
  };
}

/** Provider yang mengenal anotasi `cache_control` eksplisit (Anthropic-compatible). */
function supportsExplicitCacheControl(baseUrl: string): boolean {
  const url = (baseUrl || '').toLowerCase();
  return url.includes('anthropic') || url.includes('claude');
}

/**
 * Menyusun array `messages` untuk chat completion dengan caching prefix bila didukung.
 *
 * - Provider pendukung `cache_control`: prefix menjadi system message ber-anotasi
 *   `cache_control: { type: 'ephemeral' }`, suffix system message terpisah.
 * - Provider lain: KEDUA bagian digabung kembali menjadi satu system message,
 *   byte-identik dengan perilaku tanpa caching (zero behavior change).
 *
 * @returns array messages siap pakai (system message pertama, diikuti `rest`).
 */
export function buildCachedMessages(
  parts: CacheableSystemPrompt,
  baseUrl: string,
  rest: any[] = []
): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];

  if (!parts.stablePrefix) {
    // Tidak ada prefix stabil — jadikan satu system message biasa.
    messages.push({ role: 'system', content: parts.volatileSuffix });
    return [...messages, ...rest];
  }

  if (supportsExplicitCacheControl(baseUrl)) {
    messages.push({
      role: 'system',
      content: [
        { type: 'text', text: parts.stablePrefix, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: parts.volatileSuffix },
      ],
    });
  } else {
    // Gabung kembali — perilaku identik dengan tanpa caching.
    messages.push({ role: 'system', content: parts.stablePrefix + parts.volatileSuffix });
  }

  return [...messages, ...rest];
}

/**
 * Cache in-memory TTL untuk label chat & resolusi LID (WAHA).
 *
 * Tujuan: mengurangi HTTP call blocking ke WAHA di jalur webhook — satu pesan
 * masuk tidak boleh memicu request /labels/chats/* atau /lids/* berulang kali
 * dalam window TTL yang pendek (default 15 detik).
 *
 * Best-effort murni: cache tidak pernah melempar error, dan selalu bisa
 * di-invalidate setelah mutasi label (addLabel/removeLabel/batchUpdateLabels).
 */

interface CacheEntry {
  labels: string[];
  expiresAt: number;
}

interface LidEntry {
  pn: string;
  expiresAt: number;
}

const CACHE_TTL_MS = parseInt(process.env.WAHA_LABEL_CACHE_TTL_MS || '15000', 10);
const cache = new Map<string, CacheEntry>();
const lidCache = new Map<string, LidEntry>();

export function getCachedLabels(chatId: string): string[] | null {
  const entry = cache.get(chatId);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.labels;
}

export function setCachedLabels(chatId: string, labels: string[]): void {
  cache.set(chatId, { labels, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateCachedLabels(chatId: string): void {
  cache.delete(chatId);
}

export function getCachedLidPhone(lid: string): string | null {
  const entry = lidCache.get(lid);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.pn;
}

export function setCachedLidPhone(lid: string, pn: string): void {
  lidCache.set(lid, { pn, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Bersihkan seluruh cache (dipakai test & saat perlu reset deterministik). */
export function clearLabelCache(): void {
  cache.clear();
  lidCache.clear();
}
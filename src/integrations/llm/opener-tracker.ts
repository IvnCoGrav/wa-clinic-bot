/**
 * opener-tracker.ts
 * Tracking ringan in-memory per conversationId untuk menyimpan pola pembuka (opener)
 * dari N pesan bot terakhir demi mencegah repetisi di Phrasing Service.
 */

interface TrackedEntry {
  openers: string[];
  lastUpdated: number;
}

const store = new Map<string, TrackedEntry>();
const MAX_OPENERS = 3;
const TTL_MS = 2 * 60 * 60 * 1000; // 2 Jam
const MAX_CONVERSATIONS = 500; // size cap — hindari unbounded growth (mirip faq-cache)

function cleanupExpired() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.lastUpdated > TTL_MS) {
      store.delete(key);
    }
  }
}

function evictIfOverCapacity() {
  if (store.size < MAX_CONVERSATIONS) return;
  // Evict entri paling lama (lastUpdated terkecil) satu per satu sampai di bawah cap.
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [key, entry] of store.entries()) {
    if (entry.lastUpdated < oldestTs) {
      oldestTs = entry.lastUpdated;
      oldestKey = key;
    }
  }
  if (oldestKey) store.delete(oldestKey);
}

export const openerTracker = {
  /**
   * Ekstrak 3-5 kata pertama dari kalimat balasan bot sebagai 'opener'.
   */
  record(conversationId: string, replyText: string): void {
    if (!conversationId || !replyText) return;
    cleanupExpired();
    evictIfOverCapacity();

    const cleanText = replyText.trim().replace(/^[*_~`#\s]+/g, '');
    const words = cleanText.split(/\s+/).slice(0, 4).join(' ');
    if (!words) return;

    const entry = store.get(conversationId) || { openers: [], lastUpdated: Date.now() };
    
    // Tambahkan opener baru (hindari duplikat berturut-turut)
    if (entry.openers[entry.openers.length - 1] !== words) {
      entry.openers.push(words);
      if (entry.openers.length > MAX_OPENERS) {
        entry.openers.shift();
      }
    }
    entry.lastUpdated = Date.now();
    store.set(conversationId, entry);
  },

  /**
   * Ambil daftar opener terakhir per conversationId.
   */
  getOpeners(conversationId: string): string[] {
    if (!conversationId) return [];
    cleanupExpired();
    const entry = store.get(conversationId);
    return entry ? [...entry.openers] : [];
  },

  /**
   * Reset store (khusus testing).
   */
  clear(): void {
    store.clear();
  }
};

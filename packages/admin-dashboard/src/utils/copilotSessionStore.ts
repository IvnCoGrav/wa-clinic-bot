/**
 * copilotSessionStore.ts — Penyimpanan sesi AI Copilot lokal (48 jam sliding).
 *
 * Murni, tanpa DB, terisolasi per tenant & admin.
 * Memastikan sesi bertahan 48 jam di browser admin, dipangkas otomatis
 * agar tidak melebihi kuota localStorage, dan memotong konteks percakapan
 * saat berganti pasien tanpa mereset tampilan admin.
 */

export interface CopilotSessionMessage {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  grounded?: boolean;
  summaryMeta?: { elapsedSec: number; toolsCount: number; rowsTotal: number };
  /** true = placeholder yang tidak pernah selesai (browser ditutup di tengah turn). */
  interrupted?: boolean;
  /** Konteks customer saat pesan dikirim (untuk pemotongan konteks LLM). */
  contextCustomerId?: string | null;
}

export interface CopilotSessionV1 {
  version: 1;
  savedAt: number;
  expiresAt: number; // savedAt + TTL (sliding)
  contextCustomerId: string | null;
  messages: CopilotSessionMessage[];
}

export const COPILOT_SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48 jam = maks 2 hari
export const COPILOT_MAX_MESSAGES = 60; // 30 turn
export const COPILOT_MAX_CHARS_PER_MESSAGE = 4000;

export interface KVAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Kunci localStorage terisolasi per tenant dan email admin. */
export function copilotSessionKey(tenantId: string, adminEmail: string): string {
  const t = (tenantId || 'default-tenant').trim().toLowerCase();
  const e = (adminEmail || 'anon').trim().toLowerCase();
  return `copilot:session:${t}:${e}`;
}

/** Pangkas pesan maksimal 60 buah dan panjang teks maksimal 4.000 karakter per pesan. */
export function pruneMessages(messages: CopilotSessionMessage[]): CopilotSessionMessage[] {
  if (!Array.isArray(messages)) return [];
  const slice = messages.slice(-COPILOT_MAX_MESSAGES);
  return slice.map((m) => {
    let content = typeof m.content === 'string' ? m.content : '';
    if (content.length > COPILOT_MAX_CHARS_PER_MESSAGE) {
      content = content.slice(0, COPILOT_MAX_CHARS_PER_MESSAGE - 1) + '…';
    }
    const pruned: CopilotSessionMessage = {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content,
    };
    if (Array.isArray(m.toolsUsed)) pruned.toolsUsed = [...m.toolsUsed];
    if (typeof m.grounded === 'boolean') pruned.grounded = m.grounded;
    if (m.summaryMeta && typeof m.summaryMeta === 'object') {
      pruned.summaryMeta = {
        elapsedSec: Number(m.summaryMeta.elapsedSec) || 0,
        toolsCount: Number(m.summaryMeta.toolsCount) || 0,
        rowsTotal: Number(m.summaryMeta.rowsTotal) || 0,
      };
    }
    if (m.interrupted) pruned.interrupted = true;
    if (m.contextCustomerId !== undefined) pruned.contextCustomerId = m.contextCustomerId;
    return pruned;
  });
}

/** Tandai placeholder assistant yang kosong (tergantung saat browser ditutup) sebagai interrupted. */
export function markInterrupted(messages: CopilotSessionMessage[]): CopilotSessionMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => {
    if (m.role === 'assistant' && (!m.content || m.content.trim() === '')) {
      return {
        ...m,
        content: 'Jawaban terputus sebelum selesai. Silakan tanya ulang.',
        interrupted: true,
      };
    }
    return m;
  });
}

/** Buat sesi Copilot baru. */
export function createCopilotSession(contextCustomerId: string | null = null, now: number = Date.now()): CopilotSessionV1 {
  return {
    version: 1,
    savedAt: now,
    expiresAt: now + COPILOT_SESSION_TTL_MS,
    contextCustomerId,
    messages: [],
  };
}

/** Baca sesi dari storage dengan validasi TTL dan skema. */
export function readCopilotSession(store: KVAdapter, key: string, now: number = Date.now()): CopilotSessionV1 | null {
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== 1 || !Array.isArray(parsed.messages)) return null;

    if (typeof parsed.expiresAt !== 'number' || now > parsed.expiresAt) {
      try {
        store.removeItem(key);
      } catch {
        // Abaikan kegagalan storage
      }
      return null;
    }

    return {
      version: 1,
      savedAt: Number(parsed.savedAt) || now,
      expiresAt: Number(parsed.expiresAt) || now + COPILOT_SESSION_TTL_MS,
      contextCustomerId: parsed.contextCustomerId ?? null,
      messages: markInterrupted(pruneMessages(parsed.messages)),
    };
  } catch {
    return null;
  }
}

/** Simpan sesi ke storage dengan sliding TTL dan penanganan kuota storage. */
export function writeCopilotSession(
  store: KVAdapter,
  key: string,
  session: CopilotSessionV1,
  now: number = Date.now()
): boolean {
  try {
    const slidingSession: CopilotSessionV1 = {
      version: 1,
      savedAt: now,
      expiresAt: now + COPILOT_SESSION_TTL_MS,
      contextCustomerId: session.contextCustomerId ?? null,
      messages: pruneMessages(session.messages || []),
    };
    const payload = JSON.stringify(slidingSession);
    try {
      store.setItem(key, payload);
      return true;
    } catch {
      // Kuota penuh atau error storage: coba hapus lalu tulis ulang sekali
      try {
        store.removeItem(key);
        store.setItem(key, payload);
        return true;
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }
}

/**
 * Riwayat yang dikirim ke LLM: hanya pesan sejak konteks pasien terakhir berubah.
 * Memastikan LLM tidak mencampuradukkan riwayat pasien A saat admin sedang membuka pasien B.
 */
export function sliceHistoryForContext<T extends { contextCustomerId?: string | null }>(
  messages: T[],
  currentCustomerId: string | null
): T[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const targetId = currentCustomerId ?? null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const itemCtx = messages[i]?.contextCustomerId ?? null;
    if (itemCtx !== targetId) {
      return messages.slice(i + 1);
    }
  }
  return messages.slice();
}

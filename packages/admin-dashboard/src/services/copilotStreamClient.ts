/**
 * copilotStreamClient.ts — Klien SSE streaming untuk AI Copilot.
 *
 * Murni transport & parser event SSE.
 * Mendukung pembatalan turn (AbortSignal) dan event terstruktur:
 * `stage` | `tool_start` | `tool_result` | `chunk` | `done`.
 */

export interface CopilotStreamHandlers {
  onStage?(payload: { label?: string; step?: number; maxSteps?: number }): void;
  onToolStart?(payload: { tool?: string }): void;
  onToolResult?(payload: { tool?: string; count?: number }): void;
  onChunk?(payload: { text?: string }): void;
  onDone?(payload: { answer?: string; toolsUsed?: string[]; grounded?: boolean }): void;
}

export interface StreamTurnResult {
  answer: string;
  toolsUsed: string[];
  grounded?: boolean;
  rowsTotal: number;
}

/**
 * Uraikan buffer SSE mentah menjadi event-event berpasangan (event + data JSON)
 * dan simpan sisa potongan buffer yang belum lengkap (sebelum `\n\n`).
 */
export function parseSseFrames(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  if (!buffer || typeof buffer !== 'string') {
    return { events: [], rest: '' };
  }

  const events: Array<{ event: string; data: string }> = [];
  let remaining = buffer;
  let sep: number;

  while ((sep = remaining.indexOf('\n\n')) !== -1) {
    const raw = remaining.slice(0, sep);
    remaining = remaining.slice(sep + 2);

    let ev = 'message';
    let dataStr = '';

    for (const rawLine of raw.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) {
        // Abaikan baris kosong dan komentar / keepalive SSE
        continue;
      }
      if (line.startsWith('event:')) {
        ev = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataStr += line.slice(5).trim();
      }
    }

    if (dataStr) {
      events.push({ event: ev, data: dataStr });
    }
  }

  return { events, rest: remaining };
}

/**
 * Streaming pemanggilan turn AI Copilot via SSE (`/api/admin/copilot/stream`).
 */
export async function streamCopilotTurn(args: {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  conversationId?: string | null;
  customerId?: string | null;
  signal?: AbortSignal;
  handlers?: CopilotStreamHandlers;
  fetchFn?: typeof fetch;
}): Promise<StreamTurnResult> {
  const { message, history, conversationId, customerId, signal, handlers, fetchFn = fetch } = args;

  try {
    const res = await fetchFn('/api/admin/copilot/stream', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      signal,
      body: JSON.stringify({
        message,
        history,
        conversationId: conversationId || undefined,
        customerId: customerId || undefined,
      }),
    });

    if (!res.ok || !res.body) {
      const e: any = new Error(
        res.status === 403
          ? 'Fitur Copilot tidak tersedia.'
          : res.status === 429
          ? 'Copilot sedang memproses giliran lain.'
          : 'stream tidak tersedia'
      );
      e.status = res.status;
      throw e;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let acc = '';
    let toolsUsed: string[] = [];
    let grounded: boolean | undefined;
    let rowsTotal = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseFrames(buffer);
      buffer = parsed.rest;

      for (const item of parsed.events) {
        let payload: any = {};
        try {
          payload = JSON.parse(item.data);
        } catch {
          continue;
        }

        if (item.event === 'stage') {
          handlers?.onStage?.(payload);
        } else if (item.event === 'tool_start') {
          const toolName = String(payload?.tool || '');
          if (toolName && !toolsUsed.includes(toolName)) {
            toolsUsed.push(toolName);
          }
          handlers?.onToolStart?.(payload);
        } else if (item.event === 'tool_result') {
          const count = Number(payload?.count) || 0;
          rowsTotal += count;
          handlers?.onToolResult?.(payload);
        } else if (item.event === 'chunk') {
          acc = payload?.text || acc;
          handlers?.onChunk?.(payload);
        } else if (item.event === 'done') {
          if (typeof payload?.grounded === 'boolean') grounded = payload.grounded;
          if (Array.isArray(payload?.toolsUsed) && payload.toolsUsed.length) {
            toolsUsed = payload.toolsUsed;
          }
          if (payload?.answer && !acc) {
            acc = payload.answer;
          }
          handlers?.onDone?.(payload);
        }
      }
    }

    if (!acc) acc = 'Tidak ada jawaban.';

    return {
      answer: acc,
      toolsUsed,
      grounded,
      rowsTotal,
    };
  } catch (err: any) {
    if (signal?.aborted || err?.name === 'AbortError') {
      const abortErr = new Error('Pencarian dibatalkan oleh pengguna.');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    throw err;
  }
}

import { useState, useRef, useEffect, useCallback } from 'react';
import { apiRequest } from '../../services/api';
import { streamCopilotTurn } from '../../services/copilotStreamClient';
import {
  copilotSessionKey,
  readCopilotSession,
  writeCopilotSession,
  sliceHistoryForContext,
  COPILOT_SESSION_TTL_MS,
  COPILOT_MAX_MESSAGES,
  type CopilotSessionMessage,
} from '../../utils/copilotSessionStore';

export interface CopilotSessionState {
  messages: CopilotSessionMessage[];
  status: 'idle' | 'running' | 'done' | 'error';
  hasUnread: boolean;
  error: string | null;
  /** Timestamp saat turn dimulai (ms). Bernilai null saat idle/selesai.
   * Komponen penyaji detik (CopilotStatusPill & AdminCopilotPanel) memakai nilai ini untuk
   * ticker lokal sendiri sehingga tidak memicu re-render halaman induk setiap 500ms. */
  startedAt: number | null;
  stage: string | null;
  step: { step: number; maxSteps: number } | null;
  rowsFound: number;
  contextCustomerId: string | null; // Pasien saat pesan terakhir dikirim
}

export function useCopilotSession(args: {
  tenantId: string;
  adminEmail: string;
  getPanelVisible: () => boolean; // open && document.visibilityState === 'visible'
}): CopilotSessionState & {
  send(text: string, ctx?: { conversationId?: string | null; customerId?: string | null }): Promise<void>;
  cancel(): void;
  reset(): void;
  markRead(): void;
} {
  const { tenantId, adminEmail, getPanelVisible } = args;
  const key = copilotSessionKey(tenantId, adminEmail);

  const [messages, setMessages] = useState<CopilotSessionMessage[]>(() => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
    try {
      const s = readCopilotSession(localStorage, key);
      return s ? s.messages : [];
    } catch {
      return [];
    }
  });

  const [contextCustomerId, setContextCustomerId] = useState<string | null>(() => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
    try {
      const s = readCopilotSession(localStorage, key);
      return s ? s.contextCustomerId : null;
    } catch {
      return null;
    }
  });

  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [hasUnread, setHasUnread] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [step, setStep] = useState<{ step: number; maxSteps: number } | null>(null);
  const [rowsFound, setRowsFound] = useState<number>(0);

  const abortControllerRef = useRef<AbortController | null>(null);
  /** Penanda generasi turn untuk membatalkan proses basi (anti-zombie response). */
  const runIdRef = useRef<number>(0);
  /** Ref pesan terkini untuk akses bebas efek samping di callback */
  const messagesRef = useRef<CopilotSessionMessage[]>(messages);
  messagesRef.current = messages;

  // Rehidrasi reaktif saat kunci storage berubah (mis. login akun baru / ganti tenant)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    if (status === 'running') return; // Jangan timpa sesi yang sedang aktif berjalan
    try {
      const s = readCopilotSession(localStorage, key);
      if (s) {
        setMessages(s.messages);
        setContextCustomerId(s.contextCustomerId);
      } else {
        setMessages([]);
        setContextCustomerId(null);
      }
    } catch {
      // Abaikan
    }
  }, [key, status]);

  // Sinkronisasi multi-tab bila key diperbarui di tab lain saat state idle
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && status === 'idle') {
        try {
          const s = readCopilotSession(localStorage, key);
          if (s) {
            setMessages(s.messages);
            setContextCustomerId(s.contextCustomerId);
          } else {
            setMessages([]);
            setContextCustomerId(null);
          }
        } catch {
          // Abaikan
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, status]);

  const cancel = useCallback(() => {
    runIdRef.current++;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStage(null);
    setStep(null);
    setStartedAt(null);

    const currentMessages = messagesRef.current;
    const last = currentMessages[currentMessages.length - 1];
    let updated = currentMessages;
    if (last && last.role === 'assistant' && !last.content) {
      updated = currentMessages.map((m, i) =>
        i === currentMessages.length - 1
          ? { ...m, content: 'Pencarian dibatalkan oleh pengguna.', interrupted: true }
          : m
      );
    }
    setMessages(updated);

    // Penulisan storage dilakukan berurutan di luar updater React
    try {
      writeCopilotSession(localStorage, key, {
        version: 1,
        savedAt: Date.now(),
        expiresAt: Date.now() + COPILOT_SESSION_TTL_MS,
        contextCustomerId,
        messages: updated,
      });
    } catch {
      // Abaikan
    }

    setStatus('done');
  }, [key, contextCustomerId]);

  const reset = useCallback(() => {
    // 1. Invalidate turn in-flight agar callback yang datang diabaikan (anti-zombie)
    runIdRef.current++;
    // 2. Abort koneksi aktif
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // 3. Bersihkan storage
    try {
      localStorage.removeItem(key);
    } catch {
      // Abaikan
    }
    // 4. Bersihkan seluruh state
    setMessages([]);
    setStatus('idle');
    setHasUnread(false);
    setError(null);
    setStartedAt(null);
    setStage(null);
    setStep(null);
    setRowsFound(0);
    setContextCustomerId(null);
  }, [key]);

  const markRead = useCallback(() => {
    setHasUnread(false);
  }, []);

  const send = useCallback(
    async (text: string, ctx?: { conversationId?: string | null; customerId?: string | null }) => {
      const msg = text.trim();
      if (!msg || status === 'running') return;

      const currentRunId = ++runIdRef.current;
      const targetCustomerId = ctx?.customerId ?? null;
      setContextCustomerId(targetCustomerId);

      // Potong konteks LLM jika berganti pasien (D3 revisi)
      const historyForLlm = sliceHistoryForContext(messages, targetCustomerId)
        .slice(-COPILOT_MAX_MESSAGES)
        .map((m) => ({ role: m.role, content: m.content }));

      const userMsg: CopilotSessionMessage = {
        role: 'user',
        content: msg,
        contextCustomerId: targetCustomerId,
      };
      const assistantPlaceholder: CopilotSessionMessage = {
        role: 'assistant',
        content: '',
        contextCustomerId: targetCustomerId,
      };

      const nextMessages = [...messages, userMsg, assistantPlaceholder];
      setMessages(nextMessages);
      const assistantIndex = nextMessages.length - 1;

      const now = Date.now();
      setStatus('running');
      setError(null);
      setStartedAt(now);
      setStage(null);
      setStep(null);
      setRowsFound(0);

      // Durabilitas Poin #4: Tulis sesi SEGERA ke storage agar jika tab ditutup / browser crash
      // saat in-flight, placeholder kosong sudah tersimpan dan markInterrupted() aktif saat rehidrasi
      try {
        writeCopilotSession(localStorage, key, {
          version: 1,
          savedAt: now,
          expiresAt: now + COPILOT_SESSION_TTL_MS,
          contextCustomerId: targetCustomerId,
          messages: nextMessages,
        });
      } catch {
        // Abaikan
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      let accumulatedRows = 0;
      let finalAssistantMsg: CopilotSessionMessage = { ...assistantPlaceholder };

      try {
        const streamResult = await streamCopilotTurn({
          message: msg,
          history: historyForLlm,
          conversationId: ctx?.conversationId || undefined,
          customerId: targetCustomerId || undefined,
          signal: abortController.signal,
          handlers: {
            onStage: (payload) => {
              if (runIdRef.current !== currentRunId) return;
              if (payload?.label) setStage(payload.label);
              if (payload?.step && payload?.maxSteps) {
                setStep({ step: payload.step, maxSteps: payload.maxSteps });
              }
            },
            onToolStart: (payload) => {
              if (runIdRef.current !== currentRunId) return;
              const toolName = String(payload?.tool || '');
              setStage(`Mengecek ${toolName.replace(/_/g, ' ')}...`);
            },
            onToolResult: (payload) => {
              if (runIdRef.current !== currentRunId) return;
              const count = Number(payload?.count) || 0;
              accumulatedRows += count;
              setRowsFound((prev) => prev + count);
            },
            onChunk: (payload) => {
              if (runIdRef.current !== currentRunId) return;
              const chunkText = payload?.text || '';
              setMessages((prev) =>
                prev.map((m, i) => (i === assistantIndex ? { ...m, content: chunkText || m.content } : m))
              );
            },
          },
        });

        // Abaikan jika turn ini sudah direset / ditimpa turn baru
        if (runIdRef.current !== currentRunId) return;

        const elapsedSec = Math.floor((Date.now() - now) / 1000);
        finalAssistantMsg = {
          role: 'assistant',
          content: streamResult.answer,
          toolsUsed: streamResult.toolsUsed,
          grounded: streamResult.grounded,
          contextCustomerId: targetCustomerId,
          summaryMeta: {
            elapsedSec,
            toolsCount: streamResult.toolsUsed.length,
            rowsTotal: streamResult.rowsTotal,
          },
        };

        const finalMessages = nextMessages.map((m, i) => (i === assistantIndex ? finalAssistantMsg : m));
        setMessages(finalMessages);
        setStatus('done');
        setStartedAt(null);
        setHasUnread(!getPanelVisible());

        try {
          writeCopilotSession(localStorage, key, {
            version: 1,
            savedAt: Date.now(),
            expiresAt: Date.now() + COPILOT_SESSION_TTL_MS,
            contextCustomerId: targetCustomerId,
            messages: finalMessages,
          });
        } catch {
          // Abaikan
        }
      } catch (err: any) {
        if (runIdRef.current !== currentRunId) return;

        if (err?.name === 'AbortError' || abortController.signal.aborted) {
          finalAssistantMsg = {
            role: 'assistant',
            content: 'Pencarian dibatalkan oleh pengguna.',
            interrupted: true,
            contextCustomerId: targetCustomerId,
          };
          const abortedMessages = nextMessages.map((m, i) => (i === assistantIndex ? finalAssistantMsg : m));
          setMessages(abortedMessages);
          setStatus('done');
          setStartedAt(null);
          try {
            writeCopilotSession(localStorage, key, {
              version: 1,
              savedAt: Date.now(),
              expiresAt: Date.now() + COPILOT_SESSION_TTL_MS,
              contextCustomerId: targetCustomerId,
              messages: abortedMessages,
            });
          } catch {
            // Abaikan
          }
          return;
        }

        // Fallback non-streaming POST /api/admin/copilot/chat
        try {
          const res = await apiRequest<{
            success: boolean;
            data: { answer: string; toolsUsed: string[]; grounded: boolean };
          }>('/api/admin/copilot/chat', {
            method: 'POST',
            body: JSON.stringify({
              message: msg,
              history: historyForLlm,
              conversationId: ctx?.conversationId || undefined,
              customerId: targetCustomerId || undefined,
            }),
            timeoutMs: 305000,
          });

          if (runIdRef.current !== currentRunId) return;

          const data = res?.data;
          const elapsedSec = Math.floor((Date.now() - now) / 1000);
          finalAssistantMsg = {
            role: 'assistant',
            content: data?.answer || 'Tidak ada jawaban.',
            toolsUsed: data?.toolsUsed,
            grounded: data?.grounded,
            contextCustomerId: targetCustomerId,
            summaryMeta: {
              elapsedSec,
              toolsCount: data?.toolsUsed?.length || 0,
              rowsTotal: 0,
            },
          };
          const fallbackMessages = nextMessages.map((m, i) => (i === assistantIndex ? finalAssistantMsg : m));
          setMessages(fallbackMessages);
          setStatus('done');
          setStartedAt(null);
          setHasUnread(!getPanelVisible());

          try {
            writeCopilotSession(localStorage, key, {
              version: 1,
              savedAt: Date.now(),
              expiresAt: Date.now() + COPILOT_SESSION_TTL_MS,
              contextCustomerId: targetCustomerId,
              messages: fallbackMessages,
            });
          } catch {
            // Abaikan
          }
        } catch (fallbackErr: any) {
          if (runIdRef.current !== currentRunId) return;

          const errMsg = fallbackErr?.message || 'Copilot gagal menjawab';
          setError(errMsg);
          finalAssistantMsg = {
            role: 'assistant',
            content: 'Gagal menghubungi Copilot. Coba lagi.',
            interrupted: true,
            contextCustomerId: targetCustomerId,
          };
          const failedMessages = nextMessages.map((m, i) => (i === assistantIndex ? finalAssistantMsg : m));
          setMessages(failedMessages);
          setStatus('error');
          setStartedAt(null);
          setHasUnread(!getPanelVisible());

          try {
            writeCopilotSession(localStorage, key, {
              version: 1,
              savedAt: Date.now(),
              expiresAt: Date.now() + COPILOT_SESSION_TTL_MS,
              contextCustomerId: targetCustomerId,
              messages: failedMessages,
            });
          } catch {
            // Abaikan
          }
        }
      } finally {
        if (runIdRef.current === currentRunId) {
          setStage(null);
          setStep(null);
          setStartedAt(null);
          abortControllerRef.current = null;
        }
      }
    },
    [messages, status, key, getPanelVisible]
  );

  return {
    messages,
    status,
    hasUnread,
    error,
    startedAt,
    stage,
    step,
    rowsFound,
    contextCustomerId,
    send,
    cancel,
    reset,
    markRead,
  };
}

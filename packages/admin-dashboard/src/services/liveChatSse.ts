// SSE client untuk Live Chat Monitor.
// EventSource dipakai (bukan fetch-stream) karena auth dashboard berbasis cookie
// admin_session — EventSource mengirim cookie secara otomatis (same-origin).
// EventSource menangani auto-reconnect; server mengirim `retry: 3000`.

export interface LiveChatSseOptions {
  onEvent: (type: string, payload: any) => void;
  onStatusChange?: (connected: boolean) => void;
}

export function connectLiveChatSse(options: LiveChatSseOptions): () => void {
  let es: EventSource | null = null;
  let watchdogTimer: any = null;
  let isClosed = false;

  const resetWatchdog = () => {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    // Jika tidak ada ping/event dari server dalam 35 detik, reconnect
    watchdogTimer = setTimeout(() => {
      if (!isClosed) {
        console.warn('[LIVE CHAT SSE] Watchdog timeout (35s silent), reconnecting...');
        reconnect();
      }
    }, 35000);
  };

  const cleanupEs = () => {
    if (es) {
      es.onopen = null;
      es.onerror = null;
      es.close();
      es = null;
    }
  };

  const reconnect = () => {
    cleanupEs();
    if (!isClosed) {
      options.onStatusChange?.(false);
      open();
    }
  };

  const open = () => {
    if (isClosed) return;
    try {
      es = new EventSource('/api/admin/live-chat/events');

      es.onopen = () => {
        options.onStatusChange?.(true);
        resetWatchdog();
      };

      es.onerror = () => {
        options.onStatusChange?.(false);
        // EventSource will auto-reconnect, but if it stays errored, watchdog will trigger
      };

      const handleEvent = (type: string, e: Event) => {
        resetWatchdog();
        try {
          const dataStr = (e as MessageEvent).data;
          if (!dataStr || dataStr === ': ping') return;
          const parsed = JSON.parse(dataStr);
          options.onEvent(type, parsed);
        } catch (_) {
          // payload korup — abaikan
        }
      };

      es.addEventListener('message.created', (e) => handleEvent('message.created', e));
      es.addEventListener('message.updated', (e) => handleEvent('message.updated', e));
      es.addEventListener('message.status_updated', (e) => handleEvent('message.status_updated', e));
      es.addEventListener('conversation.updated', (e) => handleEvent('conversation.updated', e));
      es.addEventListener('ping', () => resetWatchdog());
      es.addEventListener('open', () => resetWatchdog());

      resetWatchdog();
    } catch (err) {
      console.warn('[LIVE CHAT SSE] Gagal inisialisasi EventSource:', err);
    }
  };

  open();

  return () => {
    isClosed = true;
    if (watchdogTimer) clearTimeout(watchdogTimer);
    cleanupEs();
  };
}

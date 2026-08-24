// SSE client Singleton untuk Live Chat Monitor & Notification Header.
// Memastikan hanya 1 koneksi EventSource aktif per tab browser agar tidak memakan kuota HTTP koneksi browser (6 connection limit).

export interface LiveChatSseOptions {
  onEvent: (type: string, payload: any) => void;
  onStatusChange?: (connected: boolean) => void;
}

let sharedEs: EventSource | null = null;
let watchdogTimer: any = null;
let graceCloseTimer: any = null;
let isConnected = false;
const subscribers = new Set<LiveChatSseOptions>();

function resetWatchdog() {
  if (watchdogTimer) clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    if (subscribers.size > 0) {
      console.warn('[LIVE CHAT SSE] Watchdog timeout (35s silent), reconnecting...');
      reconnectShared();
    }
  }, 35000);
}

function notifyStatus(status: boolean) {
  isConnected = status;
  for (const sub of Array.from(subscribers)) {
    try {
      sub.onStatusChange?.(status);
    } catch (_) {}
  }
}

function broadcastEvent(type: string, payload: any) {
  for (const sub of Array.from(subscribers)) {
    try {
      sub.onEvent(type, payload);
    } catch (err) {
      console.error('[LIVE CHAT SSE] Error in subscriber callback:', err);
    }
  }
}

function cleanupEs() {
  if (sharedEs) {
    sharedEs.onopen = null;
    sharedEs.onerror = null;
    sharedEs.close();
    sharedEs = null;
  }
}

function reconnectShared() {
  cleanupEs();
  if (subscribers.size > 0) {
    notifyStatus(false);
    openShared();
  }
}

function openShared() {
  if (sharedEs || typeof window === 'undefined' || !window.EventSource) return;

  try {
    sharedEs = new EventSource('/api/admin/live-chat/events');

    sharedEs.onopen = () => {
      notifyStatus(true);
      resetWatchdog();
    };

    sharedEs.onerror = () => {
      notifyStatus(false);
      // EventSource akan auto-reconnect, watchdog akan menangani jika koneksi hang
    };

    const handleEvent = (type: string, e: Event) => {
      resetWatchdog();
      try {
        const dataStr = (e as MessageEvent).data;
        if (!dataStr || dataStr === ': ping') return;
        const parsed = JSON.parse(dataStr);
        broadcastEvent(type, parsed);
      } catch (_) {}
    };

    sharedEs.addEventListener('message.created', (e) => handleEvent('message.created', e));
    sharedEs.addEventListener('message.updated', (e) => handleEvent('message.updated', e));
    sharedEs.addEventListener('message.status_updated', (e) => handleEvent('message.status_updated', e));
    sharedEs.addEventListener('conversation.updated', (e) => handleEvent('conversation.updated', e));
    sharedEs.addEventListener('ping', () => resetWatchdog());
    sharedEs.addEventListener('open', () => resetWatchdog());

    resetWatchdog();
  } catch (err) {
    console.warn('[LIVE CHAT SSE] Gagal inisialisasi EventSource shared:', err);
  }
}

export function connectLiveChatSse(options: LiveChatSseOptions): () => void {
  // Batalkan penutupan jika ada subscriber baru bergabung dalam masa grace period
  if (graceCloseTimer) {
    clearTimeout(graceCloseTimer);
    graceCloseTimer = null;
  }

  subscribers.add(options);

  // Kirim status koneksi saat ini ke subscriber baru
  if (options.onStatusChange) {
    options.onStatusChange(isConnected);
  }

  // Buka koneksi jika belum aktif
  if (!sharedEs) {
    openShared();
  }

  return () => {
    subscribers.delete(options);

    // Jika tidak ada subscriber tersisa, jadwalkan penutupan koneksi setelah 5 detik
    if (subscribers.size === 0) {
      if (graceCloseTimer) clearTimeout(graceCloseTimer);
      graceCloseTimer = setTimeout(() => {
        if (subscribers.size === 0) {
          if (watchdogTimer) clearTimeout(watchdogTimer);
          cleanupEs();
          isConnected = false;
        }
      }, 5000);
    }
  };
}

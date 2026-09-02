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
let networkListenersAttached = false;
let reconnectAttempts = 0;
let reconnectBackoffTimer: any = null;
const subscribers = new Set<LiveChatSseOptions>();

function resetWatchdog() {
  if (watchdogTimer) clearTimeout(watchdogTimer);
  // Backend ping 10 detik, watchdog 35 detik = toleransi 3x missed ping sebelum reconnect
  watchdogTimer = setTimeout(() => {
    if (subscribers.size > 0) {
      console.warn('[LIVE CHAT SSE] Watchdog timeout (35s silent), reconnecting...');
      scheduleReconnect();
    }
  }, 35000);
}

function scheduleReconnect() {
  if (reconnectBackoffTimer) clearTimeout(reconnectBackoffTimer);
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 15000);
  console.warn(`[LIVE CHAT SSE] Reconnect backoff attempt ${reconnectAttempts + 1} in ${delay}ms`);
  reconnectBackoffTimer = setTimeout(() => {
    reconnectAttempts++;
    reconnectShared();
  }, delay);
}

function resetBackoff() {
  reconnectAttempts = 0;
  if (reconnectBackoffTimer) {
    clearTimeout(reconnectBackoffTimer);
    reconnectBackoffTimer = null;
  }
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

function attachNetworkListenersOnce() {
  if (networkListenersAttached || typeof window === 'undefined') return;
  networkListenersAttached = true;

  // Saat koneksi HP kembali online setelah blackout sinyal di jalan
  window.addEventListener('online', () => {
    if (subscribers.size > 0) {
      console.info('[LIVE CHAT SSE] Network back online, fast reconnecting SSE...');
      reconnectShared();
    }
  });

  // Saat admin membuka kembali tab browser / membuka kunci layar HP
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && subscribers.size > 0) {
      // Jika koneksi sempat drop saat layar mati, segera refresh koneksi
      if (!isConnected || !sharedEs || sharedEs.readyState === EventSource.CLOSED) {
        reconnectShared();
      }
    }
  });
}

function openShared() {
  if (sharedEs || typeof window === 'undefined' || !window.EventSource) return;

  try {
    attachNetworkListenersOnce();
    sharedEs = new EventSource('/api/admin/live-chat/events');

    sharedEs.onopen = () => {
      resetBackoff();
      notifyStatus(true);
      resetWatchdog();
    };

    sharedEs.onerror = () => {
      notifyStatus(false);
      scheduleReconnect();
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
    sharedEs.addEventListener('message:reaction', (e) => handleEvent('message:reaction', e));
    sharedEs.addEventListener('message.reaction', (e) => handleEvent('message.reaction', e));
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


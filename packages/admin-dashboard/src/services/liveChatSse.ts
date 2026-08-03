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

  const open = () => {
    es = new EventSource('/api/admin/live-chat/events');

    es.onopen = () => options.onStatusChange?.(true);

    es.onerror = () => {
      // EventSource auto-reconnect; status pulih lewat onopen berikutnya
      options.onStatusChange?.(false);
    };

    es.addEventListener('message.created', (e) => {
      try {
        options.onEvent('message.created', JSON.parse((e as MessageEvent).data));
      } catch (_) {
        // payload korup — abaikan
      }
    });

    es.addEventListener('conversation.updated', (e) => {
      try {
        options.onEvent('conversation.updated', JSON.parse((e as MessageEvent).data));
      } catch (_) {
        // payload korup — abaikan
      }
    });
  };

  open();

  return () => {
    es?.close();
  };
}

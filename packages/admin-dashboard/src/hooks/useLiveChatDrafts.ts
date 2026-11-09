const DRAFT_KEY_PREFIX = 'liveChat:draft:';

export function saveConversationDraft(convId: string, text: string): void {
  if (!convId) return;
  try {
    const key = `${DRAFT_KEY_PREFIX}${convId}`;
    if (!text || !text.trim()) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify({ text, timestamp: Date.now() }));
    }
  } catch (_) {}
}

export function loadConversationDraft(convId: string): string {
  if (!convId) return '';
  try {
    const key = `${DRAFT_KEY_PREFIX}${convId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        // Bertahan 24 jam (86.400.000 ms)
        if (Date.now() - (parsed.timestamp || 0) > 86400000) {
          localStorage.removeItem(key);
          return '';
        }
        return parsed.text || '';
      }
    } catch {
      // Fallback jika tersimpan format string biasa
      return raw;
    }
    return '';
  } catch (_) {
    return '';
  }
}

export function clearConversationDraft(convId: string): void {
  if (!convId) return;
  try {
    localStorage.removeItem(`${DRAFT_KEY_PREFIX}${convId}`);
  } catch (_) {}
}

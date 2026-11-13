const SCROLL_POS_STORAGE_KEY = 'liveChat:scrollPositions';

export interface ScrollPosition {
  scrollTop: number;
  isNearBottom: boolean;
  updatedAt?: number;
}

export function getConversationScroll(convId: string): ScrollPosition | null {
  if (!convId) return null;
  try {
    const raw = sessionStorage.getItem(SCROLL_POS_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    return map[convId] || null;
  } catch (_) {
    return null;
  }
}

export function saveConversationScroll(convId: string, scrollTop: number, isNearBottom: boolean): void {
  if (!convId) return;
  try {
    const raw = sessionStorage.getItem(SCROLL_POS_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[convId] = { scrollTop, isNearBottom, updatedAt: Date.now() };
    sessionStorage.setItem(SCROLL_POS_STORAGE_KEY, JSON.stringify(map));
  } catch (_) {
    // Cache posisi scroll opsional; posisi awal hanya kurang nyaman.
  }
}

/**
 * Scroll viewport chat staf: ref container, penanda posisi dekat bawah, dan
 * auto-scroll yang menghormati posisi baca pengguna.
 */
import { useCallback, useRef } from 'react';

export function useStaffChatScroll() {
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const handleChatScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 120;
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    if (!force && !isNearBottomRef.current) return;
    const doScroll = () => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    };
    requestAnimationFrame(doScroll);
    if (force) {
      setTimeout(doScroll, 50);
    }
  }, []);

  return { chatContainerRef, messagesEndRef, isNearBottomRef, handleChatScroll, scrollToBottom };
}

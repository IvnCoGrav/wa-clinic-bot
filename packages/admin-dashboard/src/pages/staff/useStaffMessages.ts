/**
 * State dan pengambilan pesan chat staf. Menjaga rekonsiliasi idempoten agar
 * polling tidak memicu kedip, serta menyamarkan nomor untuk terapis non-supervisor.
 */
import { useCallback, useState } from 'react';
import { apiRequest } from '../../services/api';
import { maskPhoneInTextClient } from '../../utils/mediaExtractor';
import { ChatMessage } from './staffChatTypes';

interface UseStaffMessagesArgs {
  isSupervisorRef: React.MutableRefObject<boolean>;
  isNearBottomRef: React.MutableRefObject<boolean>;
  scrollToBottom: (force?: boolean) => void;
}

export function useStaffMessages({ isSupervisorRef, isNearBottomRef, scrollToBottom }: UseStaffMessagesArgs) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchMessages = useCallback(
    async (conversationId: string, opts?: { silent?: boolean }) => {
      const silent = !!opts?.silent;
      if (!silent) setLoadingMessages(true);
      if (!silent) setErrorMessage(null);
      try {
        const res = await apiRequest(`/api/staff/conversations/${conversationId}/messages`);
        if (res.success && Array.isArray(res.data)) {
          const shouldMask = !isSupervisorRef.current;
          const sanitized = res.data
            .slice(-30)
            .filter(
              (m: any) =>
                m &&
                typeof m === 'object' &&
                typeof m.id === 'string' &&
                !!m.created_at &&
                !isNaN(new Date(m.created_at).getTime()) &&
                (isSupervisorRef.current || (!(m as any).is_message_hidden && !(m as any).payload_raw?.is_hidden))
            )
            .map((m: any) => ({
              ...m,
              content:
                shouldMask && typeof m.content === 'string' ? maskPhoneInTextClient(m.content) : m.content,
              sender_name:
                shouldMask && typeof m.sender_name === 'string'
                  ? maskPhoneInTextClient(m.sender_name)
                  : m.sender_name,
              senderName:
                shouldMask && typeof m.senderName === 'string'
                  ? maskPhoneInTextClient(m.senderName)
                  : m.senderName,
            }));
          setMessages((prev) => {
            const sig = (arr: any[]) =>
              arr
                .map(
                  (m) =>
                    `${m.id}|${m.delivery_status || ''}|${m.read_at || ''}|${m.is_revoked ? 1 : 0}|${m.is_edited ? 1 : 0}|${
                      typeof m.content === 'string' ? m.content.length : 0
                    }`
                )
                .join('\n');
            return sig(prev) === sig(sanitized) ? prev : sanitized;
          });
          if (!silent) {
            isNearBottomRef.current = true;
            scrollToBottom(true);
          }
        }
      } catch (err: any) {
        if (!silent) setErrorMessage(err.message || 'Gagal memuat riwayat pesan.');
      } finally {
        if (!silent) {
          setLoadingMessages(false);
          isNearBottomRef.current = true;
          scrollToBottom(true);
        }
      }
    },
    [scrollToBottom, isSupervisorRef, isNearBottomRef]
  );

  return { messages, setMessages, loadingMessages, setLoadingMessages, errorMessage, setErrorMessage, fetchMessages };
}

/**
 * Outbox pesan gagal kirim: state, persistensi localStorage, dan coba kirim ulang.
 */
import { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { ChatMessage } from './staffChatTypes';

const FAILED_OUTBOX_KEY = 'staff_failed_outbox_v1';

export interface FailedOutboxItem {
  clientTempId: string;
  conversationId: string;
  text: string;
  image?: { preview: string; dataUrl: string; mimeType: string; fileName: string } | null;
  createdAt: string;
  error: string;
}

interface Args {
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  toast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function useStaffFailedOutbox({ setMessages, toast }: Args) {
  const [failedMessages, setFailedMessages] = useState<FailedOutboxItem[]>([]);
  const [retryingTempId, setRetryingTempId] = useState<string | null>(null);

  const persistFailedMessages = (list: Array<unknown>) => {
    try {
      localStorage.setItem(FAILED_OUTBOX_KEY, JSON.stringify(list.slice(-20)));
    } catch {
      /* storage penuh / private mode: abaikan (best-effort) */
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAILED_OUTBOX_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setFailedMessages(parsed);
    } catch {
      /* data lama rusak: mulai dari kosong */
    }
  }, []);

  const retryFailedMessage = async (item: FailedOutboxItem) => {
    if (retryingTempId) return;
    setRetryingTempId(item.clientTempId);
    try {
      const body: Record<string, any> = { text: item.text, clientTempId: item.clientTempId };
      if (item.image) {
        body.imageB64 = item.image.dataUrl;
        body.mimeType = item.image.mimeType;
        body.fileName = item.image.fileName;
      }
      const res = await apiRequest(`/api/staff/conversations/${item.conversationId}/reply`, {
        method: 'POST',
        body: JSON.stringify(body),
        timeoutMs: 45000,
      });
      if (res.success) {
        const assignedId = res.data?.messageId || res.data?.id;
        if (assignedId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === item.clientTempId ? { ...m, id: assignedId, delivery_status: 'sent' } : m))
          );
        }
        setFailedMessages((prev) => {
          const next = prev.filter((f) => f.clientTempId !== item.clientTempId);
          persistFailedMessages(next);
          return next;
        });
        toast('Pesan berhasil terkirim ulang.', 'success');
      } else {
        const errorMsg = res.error || 'Masih gagal mengirim. Periksa sinyal lalu coba lagi.';
        setFailedMessages((prev) => {
          const next = prev.map((f) => (f.clientTempId === item.clientTempId ? { ...f, error: errorMsg } : f));
          persistFailedMessages(next);
          return next;
        });
        toast(errorMsg, 'error');
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Masih gagal mengirim. Periksa sinyal lalu coba lagi.';
      setFailedMessages((prev) => {
        const next = prev.map((f) => (f.clientTempId === item.clientTempId ? { ...f, error: errorMsg } : f));
        persistFailedMessages(next);
        return next;
      });
      toast(errorMsg, 'error');
    } finally {
      setRetryingTempId(null);
    }
  };

  return { failedMessages, setFailedMessages, retryingTempId, retryFailedMessage, persistFailedMessages };
}

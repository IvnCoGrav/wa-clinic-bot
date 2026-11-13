/**
 * Outbox pesan gagal kirim: state, persistensi, dan coba kirim ulang.
 *
 * S-02 (privasi): isi pesan bisa memuat PII (teks + foto rumah/pasien).
 * - Persistensi memakai **sessionStorage** (bukan localStorage), TTL 2 jam,
 *   dan **gambar TIDAK ikut dipersist** (base64 besar + PII). Gambar tetap
 *   tersedia di memori selama tab hidup untuk retry; setelah reload, retry
 *   teks saja.
 * - `clearFailedOutbox()` dipanggil saat logout agar tidak ada sisa PII.
 */
import { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { ChatMessage } from './staffChatTypes';

const FAILED_OUTBOX_KEY = 'staff_failed_outbox_v2';
const LEGACY_OUTBOX_KEY = 'staff_failed_outbox_v1';
const OUTBOX_TTL_MS = 2 * 60 * 60 * 1000;

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

/** Bersihkan seluruh outbox tersimpan (dipanggil saat logout). */
export function clearFailedOutbox(): void {
  try {
    sessionStorage.removeItem(FAILED_OUTBOX_KEY);
    // Sisa versi lama (localStorage, memuat teks + gambar) wajib dihapus.
    localStorage.removeItem(LEGACY_OUTBOX_KEY);
  } catch {
    /* storage tidak tersedia */
  }
}

function readPersisted(): FailedOutboxItem[] {
  try {
    localStorage.removeItem(LEGACY_OUTBOX_KEY);
    const raw = sessionStorage.getItem(FAILED_OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return [];
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > OUTBOX_TTL_MS) {
      sessionStorage.removeItem(FAILED_OUTBOX_KEY);
      return [];
    }
    return parsed.items.filter((item: any) => item && typeof item.text === 'string');
  } catch {
    return [];
  }
}

function persist(list: FailedOutboxItem[]): void {
  try {
    const items = list.slice(-20).map((item) => ({ ...item, image: null }));
    sessionStorage.setItem(
      FAILED_OUTBOX_KEY,
      JSON.stringify({ savedAt: Date.now(), items })
    );
  } catch {
    /* storage penuh / private mode: abaikan (best-effort) */
  }
}

export function useStaffFailedOutbox({ setMessages, toast }: Args) {
  const [failedMessages, setFailedMessages] = useState<FailedOutboxItem[]>(readPersisted);
  const [retryingTempId, setRetryingTempId] = useState<string | null>(null);

  const persistFailedMessages = (list: FailedOutboxItem[] | Array<unknown>) =>
    persist(list as FailedOutboxItem[]);

  useEffect(() => {
    // Muat sekali saat mount (sudah dibaca di initializer; ini untuk kasus
    // hot-reload state yang di-reset).
    setFailedMessages((prev) => (prev.length > 0 ? prev : readPersisted()));
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

// Catatan kontrak error: catch kosong di hook ini adalah polling progres
// sinkronisasi latar. Sinkronisasi berjalan di server; kegagalan membaca
// progres hanya membuat indikator tidak bergerak, bukan menggagalkan proses.
import { useState, useEffect } from 'react';
import { apiRequest } from '../services/api';

export interface BgSyncProgressState {
  isSyncing: boolean;
  status: 'idle' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  syncedChats: number;
  skippedChats: number;
  syncedMessages: number;
  totalChats: number;
  currentChatName?: string;
  currentOffset: number;
  error?: string;
}

export interface UseLiveChatBackgroundSyncParams {
  loadChats: (resetPage?: boolean) => Promise<any> | void;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function useLiveChatBackgroundSync({
  loadChats,
  toast,
}: UseLiveChatBackgroundSyncParams) {
  const [bgSyncProgress, setBgSyncProgress] = useState<BgSyncProgressState>({
    isSyncing: false,
    status: 'idle',
    syncedChats: 0,
    skippedChats: 0,
    syncedMessages: 0,
    totalChats: 0,
    currentOffset: 0,
  });

  const checkBackgroundSyncStatus = async () => {
    try {
      const res = await apiRequest('/api/admin/live-chat/sync-status');
      if (res?.success && res.data) {
        setBgSyncProgress(res.data);
      }
    } catch (_) {}
  };

  useEffect(() => {
    checkBackgroundSyncStatus();
  }, []);

  // Polling halus setiap 2.5 detik selama background sync berjalan
  useEffect(() => {
    if (!bgSyncProgress.isSyncing) return;
    const interval = setInterval(async () => {
      try {
        const res = await apiRequest('/api/admin/live-chat/sync-status');
        if (res?.success && res.data) {
          setBgSyncProgress(res.data);
          if (!res.data.isSyncing) {
            loadChats(true);
            if (res.data.status === 'completed') {
              toast(
                `🎉 Sinkronisasi seluruh riwayat WhatsApp selesai: ${res.data.syncedChats} chat (${res.data.syncedMessages} pesan baru)!`,
                'success'
              );
            } else if (res.data.status === 'failed') {
              toast(
                `Sinkronisasi latar belakang terhenti: ${res.data.error || 'Terjadi kesalahan'}`,
                'error'
              );
            }
          }
        }
      } catch (_) {}
    }, 2500);
    return () => clearInterval(interval);
  }, [bgSyncProgress.isSyncing, loadChats, toast]);

  const handleStartBackgroundFullSync = async () => {
    try {
      const res = await apiRequest('/api/admin/live-chat/sync-full', {
        method: 'POST',
        body: JSON.stringify({ messagesPerChat: 100 }),
      });
      if (res?.success) {
        if ((res as any)?.progress) {
          setBgSyncProgress((res as any).progress);
        }
        if ((res as any)?.started === false) {
          toast(
            'Sinkronisasi riwayat WhatsApp memang sedang berjalan. Pantau progres di banner.',
            'info'
          );
          return;
        }
        toast('🚀 Sinkronisasi seluruh riwayat WhatsApp dimulai di latar belakang...', 'success');
        if (!(res as any)?.progress) {
          setBgSyncProgress((prev) => ({ ...prev, isSyncing: true, status: 'in_progress' }));
        }
      }
    } catch (err: any) {
      toast(`Gagal memulai sinkronisasi: ${err.message}`, 'error');
    }
  };

  const handleCancelBackgroundSync = async () => {
    try {
      await apiRequest('/api/admin/live-chat/sync-cancel', { method: 'POST' });
      toast('Sinkronisasi latar belakang dihentikan.', 'info');
      setBgSyncProgress((prev) => ({ ...prev, isSyncing: false, status: 'cancelled' }));
    } catch (err: any) {
      toast(`Gagal membatalkan: ${err.message}`, 'error');
    }
  };

  return {
    bgSyncProgress,
    setBgSyncProgress,
    checkBackgroundSyncStatus,
    handleStartBackgroundFullSync,
    handleCancelBackgroundSync,
  };
}

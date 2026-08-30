import { useState, useEffect, useRef, useCallback } from 'react';
import { useUiFeedback } from '../components/common/UiFeedback';

export interface DraftStoragePayload<T> {
  timestamp: number;
  expiresAt: number;
  formData: T;
}

export interface UseFormDraftOptions<T = any> {
  ttlMs?: number; // Default: 1 jam (3.600.000 ms)
  autoSave?: boolean; // Default: true
  autoSaveDebounceMs?: number; // Default: 1500 ms
  enabled?: boolean; // Default: true
  /**
   * Predikat validasi untuk menentukan apakah form memiliki data bermakna
   * yang pantas disimpan / dipulihkan sebagai draf.
   * Mencegah form kosong / default ter-autosave menjadi draf hantu.
   */
  isMeaningful?: (data: T) => boolean;
}

function formatTimeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes <= 0) return 'baru saja';
  if (minutes === 1) return '1 menit yang lalu';
  if (minutes < 60) return `${minutes} menit yang lalu`;
  const hours = Math.floor(minutes / 60);
  return `${hours} jam yang lalu`;
}

/**
 * Fallback inspector untuk memeriksa apakah objek data form memiliki isian bermakna.
 * Mengabaikan key boilerplate/default (seperti tanggal, jam default, status pending, kategori default).
 */
function defaultIsMeaningful(data: any): boolean {
  if (!data || typeof data !== 'object') return false;

  const IGNORED_KEYS = new Set([
    'date',
    'time',
    'bookingDate',
    'bookingTime',
    'dateDisplay',
    'timeDisplay',
    'status',
    'treatmentCategory',
    'category',
    'customServiceDuration',
    'customCategory',
    'customIsAddon',
    'showCustomServiceInput',
  ]);

  for (const [key, val] of Object.entries(data)) {
    if (IGNORED_KEYS.has(key)) continue;

    if (typeof val === 'string' && val.trim().length > 0) return true;
    if (typeof val === 'number' && val > 0 && key !== 'ongkir' && key !== 'promoOngkir') return true;
    if (Array.isArray(val) && val.length > 0) {
      const hasItem = val.some((item) => {
        if (!item) return false;
        if (typeof item === 'string') return item.trim().length > 0;
        if (typeof item === 'object') {
          return Object.entries(item).some(([k, v]) => {
            if (IGNORED_KEYS.has(k)) return false;
            return (typeof v === 'string' && v.trim().length > 0) || (typeof v === 'number' && v > 0);
          });
        }
        return false;
      });
      if (hasItem) return true;
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (Object.values(val).some((v) => v !== null && v !== undefined && v !== '')) return true;
    }
  }

  return false;
}

export function useFormDraft<T>(
  draftKey: string,
  currentFormData: T,
  onRestore: (restoredData: T) => void,
  options: UseFormDraftOptions<T> = {}
) {
  const { toast } = useUiFeedback();
  const {
    ttlMs = 60 * 60 * 1000, // 1 Jam
    autoSave = true,
    autoSaveDebounceMs = 1500,
    enabled = true,
    isMeaningful = defaultIsMeaningful,
  } = options;

  const storageKey = `wa_clinic_draft_${draftKey}`;
  const [hasDraft, setHasDraft] = useState(false);
  const [draftTimeAgo, setDraftTimeAgo] = useState('');
  const isInitialMount = useRef(true);
  const isRestoring = useRef(false);
  const isDiscardedRef = useRef(false);
  const debounceTimerRef = useRef<any>(null);

  // Periksa apakah ada draf yang valid di localStorage
  const refreshDraftStatus = useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed: DraftStoragePayload<T> = JSON.parse(raw);
        if (parsed && parsed.expiresAt && Date.now() < parsed.expiresAt && parsed.formData && isMeaningful(parsed.formData)) {
          setHasDraft(true);
          setDraftTimeAgo(formatTimeAgo(parsed.timestamp));
        } else {
          // Hapus jika sudah kedaluwarsa atau jika data di dalamnya kosong / tidak bermakna
          localStorage.removeItem(storageKey);
          setHasDraft(false);
        }
      } else {
        setHasDraft(false);
      }
    } catch (err) {
      console.warn('[useFormDraft] Failed to check draft:', err);
    }
  }, [storageKey, isMeaningful]);

  useEffect(() => {
    if (enabled) {
      isDiscardedRef.current = false;
      refreshDraftStatus();
    } else {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    }
  }, [enabled, refreshDraftStatus]);

  // Simpan draf ke localStorage
  const saveDraftToStorage = useCallback(
    (data: T, showToast = false) => {
      if (isDiscardedRef.current) return;
      if (!isMeaningful(data)) {
        if (showToast) {
          toast('Form masih kosong, belum ada data yang bisa disimpan sebagai draf.', 'info');
        } else {
          // Bersihkan draft jika user mengosongkan kembali form
          try {
            localStorage.removeItem(storageKey);
            setHasDraft(false);
          } catch {}
        }
        return;
      }

      try {
        const payload: DraftStoragePayload<T> = {
          timestamp: Date.now(),
          expiresAt: Date.now() + ttlMs,
          formData: data,
        };
        localStorage.setItem(storageKey, JSON.stringify(payload));
        setHasDraft(true);
        setDraftTimeAgo('baru saja');
        if (showToast) {
          toast('Draf berhasil disimpan! (Tersimpan selama 1 jam) 📝', 'success');
        }
      } catch (err) {
        console.warn('[useFormDraft] Failed to save draft:', err);
        if (showToast) {
          toast('Gagal menyimpan draf lokal.', 'error');
        }
      }
    },
    [storageKey, ttlMs, isMeaningful, toast]
  );

  // Auto-save dengan debounce saat form data berubah
  useEffect(() => {
    if (!enabled || isDiscardedRef.current) return;
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (!autoSave || isRestoring.current) {
      isRestoring.current = false;
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      if (!isDiscardedRef.current) {
        saveDraftToStorage(currentFormData, false);
      }
    }, autoSaveDebounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [currentFormData, autoSave, autoSaveDebounceMs, enabled, saveDraftToStorage]);

  // Simpan Draf Manual
  const saveDraftManually = useCallback(() => {
    isDiscardedRef.current = false;
    saveDraftToStorage(currentFormData, true);
  }, [currentFormData, saveDraftToStorage]);

  // Pulihkan Draf
  const restoreDraft = useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed: DraftStoragePayload<T> = JSON.parse(raw);
        if (parsed && parsed.formData && isMeaningful(parsed.formData)) {
          isRestoring.current = true;
          onRestore(parsed.formData);
          setHasDraft(false);
          toast('Draf reservasi berhasil dipulihkan! ✨', 'success');
        } else {
          localStorage.removeItem(storageKey);
          setHasDraft(false);
          toast('Tidak ada data draf yang tersimpan.', 'info');
        }
      }
    } catch (err) {
      console.warn('[useFormDraft] Failed to restore draft:', err);
      toast('Gagal memulihkan draf.', 'error');
    }
  }, [storageKey, onRestore, isMeaningful, toast]);

  // Hapus / Buang Draf
  const discardDraft = useCallback(
    (silent = false) => {
      try {
        isDiscardedRef.current = true;
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        localStorage.removeItem(storageKey);
        setHasDraft(false);
        if (!silent) {
          toast('Draf berhasil dihapus.', 'info');
        }
      } catch (err) {
        console.warn('[useFormDraft] Failed to discard draft:', err);
      }
    },
    [storageKey, toast]
  );

  return {
    hasDraft,
    draftTimeAgo,
    saveDraftManually,
    restoreDraft,
    discardDraft,
    refreshDraftStatus,
  };
}

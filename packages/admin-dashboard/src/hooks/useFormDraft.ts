import { useState, useEffect, useRef, useCallback } from 'react';
import { useUiFeedback } from '../components/common/UiFeedback';

export interface DraftStoragePayload<T> {
  timestamp: number;
  expiresAt: number;
  formData: T;
}

export interface UseFormDraftOptions {
  ttlMs?: number; // Default: 1 jam (3.600.000 ms)
  autoSave?: boolean; // Default: true
  autoSaveDebounceMs?: number; // Default: 1500 ms
  enabled?: boolean; // Default: true
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

export function useFormDraft<T>(
  draftKey: string,
  currentFormData: T,
  onRestore: (restoredData: T) => void,
  options: UseFormDraftOptions = {}
) {
  const { toast } = useUiFeedback();
  const {
    ttlMs = 60 * 60 * 1000, // 1 Jam
    autoSave = true,
    autoSaveDebounceMs = 1500,
    enabled = true,
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
        if (parsed && parsed.expiresAt && Date.now() < parsed.expiresAt) {
          setHasDraft(true);
          setDraftTimeAgo(formatTimeAgo(parsed.timestamp));
        } else {
          // Hapus jika sudah kedaluwarsa (> 1 jam)
          localStorage.removeItem(storageKey);
          setHasDraft(false);
        }
      } else {
        setHasDraft(false);
      }
    } catch (err) {
      console.warn('[useFormDraft] Failed to check draft:', err);
    }
  }, [storageKey]);

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
    [storageKey, ttlMs, toast]
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
        if (parsed && parsed.formData) {
          isRestoring.current = true;
          onRestore(parsed.formData);
          setHasDraft(false);
          toast('Draf reservasi berhasil dipulihkan! ✨', 'success');
        }
      }
    } catch (err) {
      console.warn('[useFormDraft] Failed to restore draft:', err);
      toast('Gagal memulihkan draf.', 'error');
    }
  }, [storageKey, onRestore, toast]);

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

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { bindToast } from '../../lib/toastBridge';
import { createPortal } from 'react-dom';
import { CheckCircle, AlertCircle, XCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

/**
 * UI Feedback Kit — Pengganti window.confirm() / window.alert()
 * dengan tema WhatsApp Light Mode / Clean Modern Emerald.
 *
 * Cara pakai:
 *   const { toast, confirm } = useUiFeedback();
 *   toast('Berhasil disimpan!', 'success');
 *   const ok = await confirm({ title: 'Konfirmasi', message: 'Yakin hapus?', danger: true, confirmText: 'Ya, Hapus' });
 */

export type ToastType = 'success' | 'error' | 'info';

interface ToastState {
  type: ToastType;
  text: string;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  resolve: (value: boolean) => void;
}

interface UiFeedbackContextValue {
  toast: (text: string, type?: ToastType) => void;
  confirm: (opts: {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }) => Promise<boolean>;
}

const UiFeedbackContext = createContext<UiFeedbackContextValue | null>(null);

export const UiFeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const toastTextRef = useRef<string | null>(null);
  const confirmPanelRef = useRef<HTMLDivElement>(null);
  const confirmTitleIdRef = useRef(`confirm-title-${Math.random().toString(36).slice(2, 9)}`);
  const confirmRestoreRef = useRef<HTMLElement | null>(null);

  useBodyScrollLock(confirmState !== null);

  const clearToastTimer = useCallback(() => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const startToastTimer = useCallback((text: string) => {
    clearToastTimer();
    toastTimerRef.current = window.setTimeout(() => {
      setToastState((curr) => (curr?.text === text ? null : curr));
    }, 4000);
  }, [clearToastTimer]);

  const toast = useCallback(
    (text: string, type: ToastType = 'info') => {
      toastTextRef.current = text;
      setToastState({ type, text });
      startToastTimer(text);
    },
    [startToastTimer]
  );

  useEffect(() => () => clearToastTimer(), [clearToastTimer]);

// Jembatan untuk modul non-React (services/errorPolicy.ts) agar kegagalan
// yang wajib terlihat tetap muncul sebagai toast yang sama.
useEffect(() => {
  bindToast(toast);
}, [toast]);

  const confirm = useCallback(
    ({
      title = 'Konfirmasi Tindakan',
      message,
      confirmText = 'Lanjutkan',
      cancelText = 'Batal',
      danger = false,
    }: {
      title?: string;
      message: string;
      confirmText?: string;
      cancelText?: string;
      danger?: boolean;
    }) => {
      return new Promise<boolean>((resolve) => {
        setConfirmState({
          title,
          message,
          confirmText,
          cancelText,
          danger,
          resolve,
        });
      });
    },
    []
  );

  const handleConfirmAnswer = (answer: boolean) => {
    if (confirmState) {
      confirmState.resolve(answer);
      setConfirmState(null);
    }
  };

  // Dialog konfirmasi: fokus awal, Escape, dan pengembalian fokus.
  useEffect(() => {
    if (!confirmState) return;
    confirmRestoreRef.current = document.activeElement as HTMLElement;
    const timer = window.setTimeout(() => {
      const nodes = confirmPanelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
      nodes?.[nodes.length - 1]?.focus();
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleConfirmAnswer(false);
        return;
      }
      if (e.key !== 'Tab' || !confirmPanelRef.current) return;
      const nodes = [...confirmPanelRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      confirmRestoreRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmState]);

  const toastBorder = (type: ToastType) => {
    switch (type) {
      case 'success':
        return 'border-l-4 border-l-accent';
      case 'error':
        return 'border-l-4 border-l-rose-500';
      case 'info':
      default:
        return 'border-l-4 border-l-info';
    }
  };

  const toastIcon = (type: ToastType) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="text-accent flex-shrink-0" size={18} />;
      case 'error':
        return <AlertCircle className="text-danger flex-shrink-0" size={18} />;
      case 'info':
      default:
        return <AlertCircle className="text-info flex-shrink-0" size={18} />;
    }
  };

  return (
    <UiFeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      {/* Toast Notification (Portal ke document.body di bagian atas layar agar tidak menutupi textfield/composer) */}
      {toastState &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            onMouseEnter={clearToastTimer}
            onMouseLeave={() => toastTextRef.current && startToastTimer(toastTextRef.current)}
            className={`fixed top-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] left-4 right-4 sm:left-auto sm:right-6 sm:top-6 z-toast px-4 py-3 rounded-xl bg-surface border border-divider text-xs font-semibold shadow-2xl flex items-center space-x-2.5 animate-fadeIn text-ink sm:max-w-sm ${toastBorder(toastState.type)}`}
          >
            {toastIcon(toastState.type)}
            <span className="flex-1 leading-snug">{toastState.text}</span>
            <button
              type="button"
              onClick={() => setToastState(null)}
              className="ml-1 text-ink-3 hover:text-ink p-0.5 rounded-full hover:bg-fill-1 cursor-pointer"
              aria-label="Tutup notifikasi"
            >
              <XCircle size={15} aria-hidden="true" />
            </button>
          </div>,
          document.body
        )}

      {/* Confirm Dialog Modal (lapisan z-dialog, di atas overlay lama) */}
      {confirmState &&
        createPortal(
          <div
            className="modal-backdrop fixed inset-0 z-dialog flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 animate-fadeIn"
            onClick={() => handleConfirmAnswer(false)}
          >
            <div
              ref={confirmPanelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={confirmTitleIdRef.current}
              className="bg-surface rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-md shadow-2xl border border-divider space-y-4 text-left relative max-h-[88dvh] overflow-y-auto overscroll-contain safe-bottom-padding animate-slideUp sm:animate-modalScaleUp"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Mobile Drag Handle */}
              <div className="w-10 h-1 bg-strong rounded-full mx-auto -mt-2 mb-2 sm:hidden" aria-hidden="true" />

              <h3 id={confirmTitleIdRef.current} className="text-base font-bold text-ink flex items-center space-x-2">
                {confirmState.danger ? (
                  <AlertTriangle className="text-danger flex-shrink-0" size={20} aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="text-accent flex-shrink-0" size={20} aria-hidden="true" />
                )}
                <span>{confirmState.title}</span>
              </h3>

              <p className="text-xs sm:text-sm text-ink-2 leading-relaxed whitespace-pre-wrap bg-app p-3.5 rounded-xl border border-divider">
                {confirmState.message}
              </p>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleConfirmAnswer(false)}
                  className="px-4 py-2.5 bg-fill-1 hover:bg-fill-2 text-ink-2 hover:text-ink rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
                >
                  {confirmState.cancelText}
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmAnswer(true)}
                  className={`px-4 py-2.5 text-on-solid rounded-xl text-xs font-bold shadow-xs transition active:scale-95 cursor-pointer ${
                    confirmState.danger
                      ? 'bg-danger hover:bg-danger-hover'
                      : 'bg-accent hover:bg-accent-hover'
                  }`}
                >
                  {confirmState.confirmText}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </UiFeedbackContext.Provider>
  );
};

export function useUiFeedback(): UiFeedbackContextValue {
  const ctx = useContext(UiFeedbackContext);
  if (!ctx) {
    throw new Error('useUiFeedback must be used within UiFeedbackProvider');
  }
  return ctx;
}

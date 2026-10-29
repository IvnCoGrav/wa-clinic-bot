import React, { createContext, useCallback, useContext, useState } from 'react';
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

  useBodyScrollLock(confirmState !== null);

  const toast = useCallback((text: string, type: ToastType = 'info') => {
    setToastState({ type, text });
    setTimeout(() => {
      setToastState((curr) => (curr?.text === text ? null : curr));
    }, 4000);
  }, []);

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
            style={{ zIndex: 99999 }}
            className={`fixed top-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] left-4 right-4 sm:left-auto sm:right-6 sm:top-6 px-4 py-3 rounded-xl bg-surface border border-divider text-xs font-semibold shadow-2xl flex items-center space-x-2.5 animate-fadeIn text-ink sm:max-w-sm ${toastBorder(toastState.type)}`}
          >
            {toastIcon(toastState.type)}
            <span className="flex-1 leading-snug">{toastState.text}</span>
            <button onClick={() => setToastState(null)} className="ml-1 text-ink-3 hover:text-ink p-0.5 rounded-full hover:bg-fill-1">
              <XCircle size={15} />
            </button>
          </div>,
          document.body
        )}

      {/* Confirm Dialog Modal (Portal ke document.body di lapisan terdepan zIndex: 99999) */}
      {confirmState &&
        createPortal(
          <div
            style={{ zIndex: 99999 }}
            className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn"
            onClick={() => handleConfirmAnswer(false)}
          >
            <div
              className="bg-surface rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-md shadow-2xl border border-divider space-y-4 text-left relative max-h-[88dvh] overflow-y-auto safe-bottom-padding animate-slideUp sm:animate-modalScaleUp"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Mobile Drag Handle */}
              <div className="w-10 h-1 bg-strong rounded-full mx-auto -mt-2 mb-2 sm:hidden" />

              <h3 className="text-base font-bold text-ink flex items-center space-x-2">
                {confirmState.danger ? (
                  <AlertTriangle className="text-danger flex-shrink-0" size={20} />
                ) : (
                  <CheckCircle2 className="text-accent flex-shrink-0" size={20} />
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
                  className={`px-4 py-2.5 text-white rounded-xl text-xs font-bold shadow-xs transition active:scale-95 cursor-pointer ${
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

import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle, AlertCircle, XCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';

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

  const toast = useCallback((text: string, type: ToastType = 'success') => {
    setToastState({ type, text });
    // Auto-dismiss after 3.5s
    setTimeout(() => setToastState(null), 3500);
  }, []);

  const confirm = useCallback((opts: {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({
        title: opts.title || 'Konfirmasi',
        message: opts.message,
        confirmText: opts.confirmText || 'Lanjutkan',
        cancelText: opts.cancelText || 'Batal',
        danger: opts.danger || false,
        resolve,
      });
    });
  }, []);

  const handleConfirmAnswer = (answer: boolean) => {
    confirmState?.resolve(answer);
    setConfirmState(null);
  };

  const toastIcon = (type: ToastType) => {
    switch (type) {
      case 'success': return <CheckCircle size={17} className="text-[#008069] flex-shrink-0" />;
      case 'error': return <AlertCircle size={17} className="text-rose-500 flex-shrink-0" />;
      default: return <AlertTriangle size={17} className="text-[#008069] flex-shrink-0" />;
    }
  };

  const toastBorder = (type: ToastType) => {
    switch (type) {
      case 'success': return 'border-l-4 border-l-[#008069]';
      case 'error': return 'border-l-4 border-l-rose-500';
      default: return 'border-l-4 border-l-blue-500';
    }
  };

  return (
    <UiFeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      {/* Toast Notification (Clean Floating Light Card) */}
      {toastState && (
        <div className={`fixed bottom-6 right-6 z-[110] px-4 py-3 rounded-xl bg-white border border-[#e9edef] text-xs font-semibold shadow-xl flex items-center space-x-2.5 animate-fadeIn text-[#111b21] max-w-sm ${toastBorder(toastState.type)}`}>
          {toastIcon(toastState.type)}
          <span className="flex-1 leading-snug">{toastState.text}</span>
          <button onClick={() => setToastState(null)} className="ml-1 text-[#667781] hover:text-[#111b21] p-0.5 rounded-full hover:bg-[#f0f2f5]">
            <XCircle size={15} />
          </button>
        </div>
      )}

      {/* Confirm Dialog Modal (Modern WhatsApp Emerald & Light Theme) */}
      {confirmState && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => handleConfirmAnswer(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl border border-[#e9edef] space-y-4 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-[#111b21] flex items-center space-x-2">
              {confirmState.danger ? (
                <AlertTriangle className="text-rose-500 flex-shrink-0" size={20} />
              ) : (
                <CheckCircle2 className="text-[#008069] flex-shrink-0" size={20} />
              )}
              <span>{confirmState.title}</span>
            </h3>

            <p className="text-xs sm:text-sm text-[#54656f] leading-relaxed whitespace-pre-wrap bg-[#f0f2f5] p-3.5 rounded-xl border border-[#e9edef]">
              {confirmState.message}
            </p>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => handleConfirmAnswer(false)}
                className="px-4 py-2.5 bg-[#f0f2f5] hover:bg-[#e9edef] text-[#54656f] hover:text-[#111b21] rounded-xl text-xs font-bold transition active:scale-95"
              >
                {confirmState.cancelText}
              </button>
              <button
                type="button"
                onClick={() => handleConfirmAnswer(true)}
                className={`px-4 py-2.5 text-white rounded-xl text-xs font-bold shadow-xs transition active:scale-95 ${
                  confirmState.danger
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-[#008069] hover:bg-[#00a884]'
                }`}
              >
                {confirmState.confirmText}
              </button>
            </div>
          </div>
        </div>
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

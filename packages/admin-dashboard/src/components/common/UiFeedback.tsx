import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle, AlertCircle, XCircle, AlertTriangle } from 'lucide-react';

/**
 * UI Feedback Kit — pengganti window.confirm() / window.alert()
 * yang diblokir di iframe / embedded admin panel.
 *
 * Cara pakai:
 *   const { toast, confirm } = useUiFeedback();
 *   toast('Berhasil disimpan!', 'success');
 *   const ok = await confirm('Yakin hapus?', { danger: true, confirmText: 'Ya, Hapus' });
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
        confirmText: opts.confirmText || 'Ya',
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
      case 'success': return <CheckCircle size={16} />;
      case 'error': return <AlertCircle size={16} />;
      default: return <AlertTriangle size={16} />;
    }
  };

  const toastColor = (type: ToastType) => {
    switch (type) {
      case 'success': return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
      case 'error': return 'bg-rose-500/10 border-rose-500/30 text-rose-400';
      default: return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
    }
  };

  return (
    <UiFeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      {/* Toast */}
      {toastState && (
        <div className={`fixed bottom-6 right-6 z-[80] px-4 py-3 rounded-xl border text-xs font-bold shadow-xl flex items-center space-x-2 animate-fadeIn ${toastColor(toastState.type)}`}>
          {toastIcon(toastState.type)}
          <span>{toastState.text}</span>
          <button onClick={() => setToastState(null)} className="ml-2 text-slate-500 hover:text-white">
            <XCircle size={14} />
          </button>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmState && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="glass-panel border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              {confirmState.danger ? (
                <AlertTriangle className="text-rose-400" size={18} />
              ) : (
                <AlertCircle className="text-pink-400" size={18} />
              )}
              <span>{confirmState.title}</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">{confirmState.message}</p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => handleConfirmAnswer(false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-xs font-bold transition"
              >
                {confirmState.cancelText}
              </button>
              <button
                onClick={() => handleConfirmAnswer(true)}
                className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition ${
                  confirmState.danger ? 'bg-rose-500 hover:bg-rose-600' : 'bg-pink-500 hover:bg-pink-600'
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

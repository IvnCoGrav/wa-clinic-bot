import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Aksi tambahan di kanan header, dirender sebelum tombol tutup. */
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** dialog: tengah layar. sheet: menempel bawah di mobile. */
  variant?: 'dialog' | 'sheet';
  className?: string;
  /** Ganti kelas area isi. Default: `p-5 space-y-4` dengan scroll internal. */
  bodyClassName?: string;
  closeOnBackdrop?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
  /**
   * 'top' untuk modal yang dibuka DI ATAS modal lain (mis. pemilih lokasi di
   * dalam form reservasi). Tanpa ini dialog kedua bisa tertutup lapisan bawah.
   */
  layer?: 'base' | 'top';
  /**
   * 'bare' = tanpa header bawaan; pemakai menyediakan header sendiri di
   * children (dipakai modal dengan bilah aksen & tab internal).
   */
  chrome?: 'default' | 'bare';
  /** Layar penuh di mobile, kartu di desktop. Dipakai form reservasi. */
  fullScreen?: boolean;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  headerAction,
  children,
  footer,
  size = 'md',
  variant = 'dialog',
  className = '',
  bodyClassName,
  closeOnBackdrop = true,
  initialFocusRef,
  layer = 'base',
  chrome = 'default',
  fullScreen = false,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleIdRef = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement;
    const timer = window.setTimeout(() => {
      const target = initialFocusRef?.current || panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null
      );
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

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose, initialFocusRef]);

  if (!open) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg sm:max-w-xl',
    xl: 'max-w-2xl sm:max-w-3xl',
    full: 'max-w-5xl w-full',
  }[size];

  const shellClass = fullScreen
    ? 'relative w-full max-w-2xl bg-surface border border-divider rounded-none sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[100dvh] sm:h-auto sm:max-h-[90vh] my-auto'
    : variant === 'sheet'
      ? `relative w-full ${sizeClasses} bg-surface border border-divider rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col mt-auto sm:my-auto max-h-[92dvh]`
      : `relative w-full ${sizeClasses} bg-surface border border-divider rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92dvh]`;

  return createPortal(
    <div className={`fixed inset-0 ${layer === 'top' ? 'z-dialog-top' : 'z-dialog'} flex items-end sm:items-center justify-center p-0 sm:p-5`}>
      <div
        className="absolute inset-0 bg-black/55 animate-fadeIn"
        onClick={() => closeOnBackdrop && onClose()}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleIdRef.current : undefined}
        data-modal-active="true"
        className={`${shellClass} ${className}`}
      >
        {variant === 'sheet' && (
          <div className="w-10 h-1 bg-strong rounded-full mx-auto mt-2 mb-1 sm:hidden shrink-0" aria-hidden="true" />
        )}

        {chrome === 'default' && (title || subtitle) && (
          <div className="px-5 py-4 border-b border-divider bg-surface-2 flex items-center justify-between shrink-0">
            <div className="min-w-0 pr-4">
              {title && (
                <h2 id={titleIdRef.current} className="text-sm font-bold text-ink truncate">
                  {title}
                </h2>
              )}
              {subtitle && <p className="text-xs text-ink-2 mt-0.5">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {headerAction}
              <button
                type="button"
                onClick={onClose}
                data-modal-close="true"
                className="text-ink-3 hover:text-ink p-1.5 rounded-lg hover:bg-fill-1 transition cursor-pointer"
                aria-label="Tutup dialog"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        <div
          className={
            bodyClassName ??
            (chrome === 'bare'
              ? 'flex flex-1 flex-col min-h-0 overflow-hidden'
              : 'p-5 overflow-y-auto overscroll-contain touch-scroll-y space-y-4')
          }
        >
          {children}
        </div>

        {footer && (
          <div className="px-5 py-3.5 border-t border-divider bg-surface-2 flex items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

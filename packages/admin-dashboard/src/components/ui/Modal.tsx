import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
  closeOnBackdrop?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  className = '',
  closeOnBackdrop = true,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleIdRef = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg sm:max-w-xl',
    xl: 'max-w-2xl sm:max-w-3xl',
    full: 'max-w-5xl w-full',
  }[size];

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleIdRef.current : undefined}
    >
      {/* Scrim / Backdrop */}
      <div
        className="fixed inset-0 bg-black/55 backdrop-blur-xs transition-opacity duration-200"
        onClick={() => {
          if (closeOnBackdrop) onClose();
        }}
        aria-hidden="true"
      />

      {/* Surface Card */}
      <div
        ref={modalRef}
        className={`relative w-full ${sizeClasses} bg-surface border border-divider rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto transform transition-all duration-200 animate-in fade-in zoom-in-95 ${className}`}
      >
        {/* Header */}
        {(title || subtitle) && (
          <div className="px-5 py-4 border-b border-divider bg-surface-2 flex items-center justify-between shrink-0">
            <div className="min-w-0 pr-4">
              {title && (
                <h2
                  id={titleIdRef.current}
                  className="text-sm font-bold text-ink truncate"
                >
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="text-xs text-ink-2 mt-0.5">{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-ink-3 hover:text-ink p-1.5 rounded-lg hover:bg-fill-1 transition cursor-pointer shrink-0"
              aria-label="Tutup modal"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="p-5 overflow-y-auto max-h-[calc(100dvh-180px)] space-y-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-5 py-3.5 border-t border-divider bg-surface-2 flex items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null;
};

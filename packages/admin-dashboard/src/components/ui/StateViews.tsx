import React from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';

/**
 * Primitif state bersama (R-27). Tiga state wajib menyebut sebab dan aksi,
 * bukan sekadar "Tidak ada data" atau spinner kosong.
 */

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  action,
  icon,
  className = '',
}) => (
  <div className={`py-12 px-4 text-center ${className}`}>
    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-fill-1 text-ink-3">
      {icon ?? <Inbox size={20} aria-hidden="true" />}
    </div>
    <p className="text-sm font-semibold text-ink">{title}</p>
    {description && <p className="text-xs text-ink-3 mt-1 max-w-sm mx-auto">{description}</p>}
    {action && <div className="mt-3 flex justify-center">{action}</div>}
  </div>
);

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Data gagal dimuat',
  description = 'Periksa koneksi Anda, lalu coba lagi.',
  onRetry,
  retryLabel = 'Coba lagi',
  className = '',
}) => (
  <div role="alert" className={`py-10 px-4 text-center ${className}`}>
    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-danger-soft text-danger">
      <AlertTriangle size={20} aria-hidden="true" />
    </div>
    <p className="text-sm font-semibold text-ink">{title}</p>
    <p className="text-xs text-ink-3 mt-1 max-w-sm mx-auto">{description}</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        aria-label={retryLabel}
        className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface border border-divider text-ink-2 text-xs font-semibold hover:bg-fill-1 transition cursor-pointer"
      >
        <RefreshCw size={13} aria-hidden="true" />
        {retryLabel}
      </button>
    )}
  </div>
);

export interface SkeletonRowsProps {
  rows?: number;
  className?: string;
}

/** Baris skeleton dengan tinggi setara baris data nyata (kurangi layout shift). */
export const SkeletonRows: React.FC<SkeletonRowsProps> = ({ rows = 6, className = '' }) => (
  <div className={`space-y-2 ${className}`} aria-label="Memuat data" role="status">
    <span className="sr-only">Memuat data</span>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 px-3 py-3 rounded-xl bg-fill-1/60">
        <div className="h-6 w-6 rounded-lg bg-fill-2 animate-pulse" />
        <div className="flex-1 space-y-1.5">
          <div className="h-2.5 w-1/3 rounded bg-fill-2 animate-pulse" />
          <div className="h-2 w-1/2 rounded bg-fill-2/70 animate-pulse" />
        </div>
      </div>
    ))}
  </div>
);

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({ label = 'Memuat data...', className = '' }) => (
  <div role="status" className={`py-12 flex flex-col items-center gap-2 ${className}`}>
    <Loader2 size={24} className="animate-spin text-accent" aria-hidden="true" />
    <span className="text-xs text-ink-3">{label}</span>
  </div>
);

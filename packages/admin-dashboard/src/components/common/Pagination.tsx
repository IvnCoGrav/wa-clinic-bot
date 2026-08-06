import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  disabled?: boolean;
  /** Label kiri; default "Halaman X / Y". Bila totalItems/loadedItems diisi, ditambah info jumlah. */
  label?: string;
  totalItems?: number;
  loadedItems?: number;
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  onPageChange,
  loading = false,
  disabled = false,
  label,
  totalItems,
  loadedItems,
}) => {
  if (totalPages <= 1) return null;

  return (
    <div className="p-4 border-t border-white/5 flex items-center justify-between text-xs text-slate-400">
      <span>
        {label || `Halaman ${page} / ${totalPages}`}
        {typeof totalItems === 'number' && typeof loadedItems === 'number' && (
          <span className="text-slate-500">
            {' · Menampilkan '}
            <span className="text-white font-bold">{loadedItems}</span> dari{' '}
            <span className="text-white font-bold">{totalItems}</span>
          </span>
        )}
      </span>

      <div className="flex items-center space-x-2">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1 || loading || disabled}
          className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
          aria-label="Halaman sebelumnya"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-bold text-white">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages || loading || disabled}
          className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
          aria-label="Halaman berikutnya"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};

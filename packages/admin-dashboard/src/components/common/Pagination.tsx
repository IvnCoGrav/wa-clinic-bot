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
    <div className="p-3.5 border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between text-xs text-[#667781] dark:text-[#8696a0] bg-[#f8fafc] dark:bg-[#111b21]">
      <span>
        {label || `Halaman ${page} / ${totalPages}`}
        {typeof totalItems === 'number' && typeof loadedItems === 'number' && (
          <span className="text-[#8696a0]">
            {' · Menampilkan '}
            <span className="text-[#111b21] dark:text-[#e9edef] font-bold">{loadedItems}</span> dari{' '}
            <span className="text-[#111b21] dark:text-[#e9edef] font-bold">{totalItems}</span>
          </span>
        )}
      </span>

      <div className="flex items-center space-x-2">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1 || loading || disabled}
          className="p-1.5 rounded-lg bg-white dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#374248] text-[#54656f] dark:text-[#aebac1] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#374248] disabled:opacity-30 disabled:cursor-not-allowed transition shadow-xs"
          aria-label="Halaman sebelumnya"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="font-bold text-[#111b21] dark:text-[#e9edef]">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages || loading || disabled}
          className="p-1.5 rounded-lg bg-white dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#374248] text-[#54656f] dark:text-[#aebac1] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#374248] disabled:opacity-30 disabled:cursor-not-allowed transition shadow-xs"
          aria-label="Halaman berikutnya"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
};

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
    <div className="p-3.5 border-t border-[#e9edef] flex items-center justify-between text-xs text-[#667781] bg-[#f8fafc]">
      <span>
        {label || `Halaman ${page} / ${totalPages}`}
        {typeof totalItems === 'number' && typeof loadedItems === 'number' && (
          <span className="text-[#8696a0]">
            {' · Menampilkan '}
            <span className="text-[#111b21] font-bold">{loadedItems}</span> dari{' '}
            <span className="text-[#111b21] font-bold">{totalItems}</span>
          </span>
        )}
      </span>

      <div className="flex items-center space-x-2">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1 || loading || disabled}
          className="p-1.5 rounded-lg bg-white border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] hover:bg-[#f0f2f5] disabled:opacity-30 disabled:cursor-not-allowed transition shadow-xs"
          aria-label="Halaman sebelumnya"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="font-bold text-[#111b21]">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages || loading || disabled}
          className="p-1.5 rounded-lg bg-white border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] hover:bg-[#f0f2f5] disabled:opacity-30 disabled:cursor-not-allowed transition shadow-xs"
          aria-label="Halaman berikutnya"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
};

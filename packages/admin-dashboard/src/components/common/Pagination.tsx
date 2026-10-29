import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';

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
    <div className="p-3.5 border-t border-divider flex items-center justify-between text-xs text-ink-3 bg-surface-2">
      <span>
        {label || (
          <span>
            Halaman <span className="num font-semibold text-ink">{page}</span> / <span className="num font-semibold text-ink">{totalPages}</span>
          </span>
        )}
        {typeof totalItems === 'number' && typeof loadedItems === 'number' && (
          <span className="text-ink-3">
            {' · Menampilkan '}
            <span className="text-ink font-bold num">{loadedItems}</span> dari{' '}
            <span className="text-ink font-bold num">{totalItems}</span>
          </span>
        )}
      </span>

      <div className="flex items-center space-x-2">
        <Button
          variant="neutral"
          size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1 || loading || disabled}
          aria-label="Halaman sebelumnya"
          className="p-1.5 min-h-[30px]"
        >
          <ChevronLeft size={15} />
        </Button>
        <span className="font-bold text-ink num px-1">
          {page} / {totalPages}
        </span>
        <Button
          variant="neutral"
          size="sm"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages || loading || disabled}
          aria-label="Halaman berikutnya"
          className="p-1.5 min-h-[30px]"
        >
          <ChevronRight size={15} />
        </Button>
      </div>
    </div>
  );
};

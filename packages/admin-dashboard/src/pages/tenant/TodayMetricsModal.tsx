/**
 * Rekap ringkasan metrik treatment harian.
 */
import React from 'react';
import { BarChart3 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { formatRupiah } from '../../utils/money';

interface TodayMetricsModalProps {
  dateLabel: string;
  totalCount: number;
  completedCount: number;
  otwCount: number;
  lunasCount: number;
  totalRevenue: number;
  onClose: () => void;
}

export const TodayMetricsModal: React.FC<TodayMetricsModalProps> = ({
  dateLabel,
  totalCount,
  completedCount,
  otwCount,
  lunasCount,
  totalRevenue,
  onClose,
}) => (
  <Modal
    open
    onClose={onClose}
    size="md"
    title={
      <span className="flex items-center gap-2">
        <BarChart3 size={20} className="text-accent" aria-hidden="true" />
        <span>Rekap Metrik Treatment {dateLabel}</span>
      </span>
    }
    subtitle={dateLabel}
  >
    <div className="grid grid-cols-2 gap-3 pt-1">
      <div className="bg-surface-2 dark:bg-surface-2 rounded-2xl border border-divider p-4">
        <span className="text-[11px] font-bold text-ink-2 uppercase tracking-wider block">Total Treatment</span>
        <p className="text-2xl font-black text-ink mt-1">{totalCount}</p>
        <span className="text-[11px] text-ink-3">Kunjungan terjadwal</span>
      </div>

      <div className="bg-emerald-50/40 dark:bg-emerald-950/30 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 p-4">
        <span className="text-[11px] font-bold text-emerald-700 dark:text-accent uppercase tracking-wider block">Selesai</span>
        <p className="text-2xl font-black text-emerald-700 dark:text-ink mt-1">{completedCount}</p>
        <span className="text-[11px] text-emerald-600 dark:text-ink-3">Pasien telah ditangani</span>
      </div>

      <div className="bg-sky-50/40 dark:bg-sky-950/30 rounded-2xl border border-sky-200 dark:border-sky-800/40 p-4">
        <span className="text-[11px] font-bold text-sky-700 dark:text-info uppercase tracking-wider block">Sedang OTW</span>
        <p className="text-2xl font-black text-sky-700 dark:text-ink mt-1">{otwCount}</p>
        <span className="text-[11px] text-sky-600 dark:text-ink-3">Dalam perjalanan</span>
      </div>

      <div className="bg-amber-50/40 dark:bg-amber-950/30 rounded-2xl border border-amber-200 dark:border-amber-800/40 p-4">
        <span className="text-[11px] font-bold text-amber-700 dark:text-warning uppercase tracking-wider block">Status Lunas</span>
        <p className="text-2xl font-black text-amber-700 dark:text-ink mt-1">
          {lunasCount} / {totalCount}
        </p>
        <span className="text-[11px] text-amber-600 dark:text-ink-3">{totalCount - lunasCount} Tagih di tempat</span>
      </div>
    </div>

    <div className="p-4 bg-surface-2 dark:bg-surface-2 rounded-2xl border border-divider flex items-center justify-between text-xs">
      <span className="font-bold text-ink-2">Total Nilai Transaksi:</span>
      <span className="font-black text-sm text-accent">{formatRupiah(totalRevenue)}</span>
    </div>

    <div className="flex justify-end pt-2">
      <button
        type="button"
        onClick={onClose}
        className="px-5 py-2.5 rounded-xl bg-accent text-accent-ink text-xs font-bold hover:bg-accent transition cursor-pointer shadow-xs"
      >
        Tutup Rekap
      </button>
    </div>
  </Modal>
);

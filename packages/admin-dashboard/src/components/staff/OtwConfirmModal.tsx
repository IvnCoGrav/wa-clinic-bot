import React from 'react';
import { Navigation, MapPin, RefreshCw, AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';

/**
 * Modal konfirmasi OTW terpadu (plan 2026-10-04, unifikasi 1-tap).
 *
 * Satu-satunya gerbang sebelum Bidan "berangkat": menampilkan draf pesan ke
 * pasien + status titik awal (GPS). Tombol utamanya memanggil `onConfirm`
 * SECARA SINKRON dari gesture klik — di dalamnya parent membuka Google Maps
 * (anti pop-up block) lalu mengirim OTW. Modal presentational murni.
 */
export interface OtwConfirmModalProps {
  open: boolean;
  patientName: string;
  /** Draf pesan OTW (DB-driven via /api/staff/otw-template). */
  draft: string;
  depart: { lat: number; lng: number; accuracy: number } | null;
  /** True saat GPS sedang direkam ulang (tombol retry). */
  gpsChecking?: boolean;
  /** True saat POST OTW sedang berjalan. */
  sending?: boolean;
  onRetryGps: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export const OtwConfirmModal: React.FC<OtwConfirmModalProps> = ({
  open,
  patientName,
  draft,
  depart,
  gpsChecking = false,
  sending = false,
  onRetryGps,
  onConfirm,
  onClose,
}) => {
  if (!open) return null;

  const hasGps = !!depart;

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="sheet"
      size="md"
      title={
        <span className="flex items-center gap-2">
          <Navigation className="text-accent shrink-0" size={20} aria-hidden="true" />
          <span>Mulai Jalan (OTW)</span>
        </span>
      }
      footer={
        <div className="w-full space-y-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={sending}
            className="w-full min-h-[48px] flex items-center justify-center space-x-2 py-3 px-4 bg-accent hover:bg-accent-hover text-on-solid rounded-2xl text-sm font-bold transition active:scale-[0.98] shadow-xs disabled:opacity-50"
          >
            {sending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
            ) : (
              <Navigation size={16} aria-hidden="true" />
            )}
            <span>{sending ? 'Mengirim...' : 'Kirim OTW & Buka Peta'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="w-full min-h-[44px] py-2.5 px-4 bg-surface hover:bg-fill-1 border border-divider text-ink-2 dark:text-ink rounded-2xl text-xs font-bold transition active:scale-[0.98] disabled:opacity-40"
          >
            Batal
          </button>
        </div>
      }
    >

        {/* Status titik awal (GPS) */}
        <div
          className={`rounded-xl border p-3 text-xs leading-relaxed flex items-start gap-2 ${
            hasGps
              ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-accent'
              : 'border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200'
          }`}
        >
          {hasGps ? (
            <MapPin size={15} className="mt-0.5 flex-shrink-0" />
          ) : (
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1">
            {hasGps ? (
              <span>
                Titik awal terekam (±{depart!.accuracy} m). Estimasi tiba dihitung dari sini.
              </span>
            ) : (
              <span>
                GPS belum terdeteksi: pesan tetap dikirim, namun titik awal tidak terekam.
              </span>
            )}
          </div>
          {!hasGps && (
            <button
              type="button"
              onClick={onRetryGps}
              disabled={gpsChecking || sending}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 dark:text-amber-100 bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-900/60 border border-amber-300 dark:border-amber-800 rounded-md px-2 py-1 disabled:opacity-50"
            >
              <RefreshCw size={11} className={gpsChecking ? 'animate-spin' : ''} />
              Coba lagi
            </button>
          )}
        </div>

        {/* Pratinjau pesan ke pasien */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-ink-2">
            Pesan WhatsApp ke {patientName}:
          </p>
          <p className="text-xs text-ink leading-relaxed whitespace-pre-wrap bg-fill-1 p-3.5 rounded-xl border border-divider">
            {draft}
          </p>
        </div>

    </Modal>
  );
};

export default OtwConfirmModal;

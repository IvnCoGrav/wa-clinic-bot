import React from 'react';
import { Navigation, X, MapPin, RefreshCw, AlertTriangle } from 'lucide-react';

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
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-xs animate-fadeIn"
      onClick={sending ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Konfirmasi berangkat OTW"
    >
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 w-full max-w-md shadow-2xl border border-[#e9edef] space-y-4 text-left animate-modalScaleUp max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-1.5 bg-[#d1d7db] rounded-full mx-auto -mt-2 mb-1 sm:hidden" />

        <div className="flex items-start justify-between">
          <h3 className="text-base font-bold text-[#111b21] flex items-center space-x-2">
            <Navigation className="text-[#008069] flex-shrink-0" size={20} />
            <span>Mulai Jalan (OTW)</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="text-[#667781] hover:text-[#111b21] p-1 rounded-full hover:bg-[#f0f2f5] disabled:opacity-40"
            aria-label="Tutup"
          >
            <X size={18} />
          </button>
        </div>

        {/* Status titik awal (GPS) */}
        <div
          className={`rounded-xl border p-3 text-xs leading-relaxed flex items-start gap-2 ${
            hasGps
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-amber-300 bg-amber-50 text-amber-800'
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
                GPS belum terdeteksi — pesan tetap dikirim, namun titik awal tidak terekam.
              </span>
            )}
          </div>
          {!hasGps && (
            <button
              type="button"
              onClick={onRetryGps}
              disabled={gpsChecking || sending}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md px-2 py-1 disabled:opacity-50"
            >
              <RefreshCw size={11} className={gpsChecking ? 'animate-spin' : ''} />
              Coba lagi
            </button>
          )}
        </div>

        {/* Pratinjau pesan ke pasien */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-[#667781]">
            Pesan WhatsApp ke {patientName}:
          </p>
          <p className="text-xs text-[#111b21] leading-relaxed whitespace-pre-wrap bg-[#f0f2f5] p-3.5 rounded-xl border border-[#e9edef]">
            {draft}
          </p>
        </div>

        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={onConfirm}
            disabled={sending}
            className="w-full min-h-[48px] flex items-center justify-center space-x-2 py-3 px-4 bg-[#008069] hover:bg-[#00a884] text-white rounded-2xl text-sm font-bold transition active:scale-[0.98] shadow-xs disabled:opacity-50"
          >
            {sending ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Navigation size={16} />
            )}
            <span>{sending ? 'Mengirim...' : 'Kirim OTW & Buka Peta'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="w-full min-h-[44px] py-2.5 px-4 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] rounded-2xl text-xs font-bold transition active:scale-[0.98] disabled:opacity-40"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  );
};

export default OtwConfirmModal;

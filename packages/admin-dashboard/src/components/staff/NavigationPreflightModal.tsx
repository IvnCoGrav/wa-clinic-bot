import React from 'react';
import { AlertTriangle, MessageCircle, Navigation, X, MapPin } from 'lucide-react';

/**
 * Gerbang pengaman pra-navigasi (insiden Bidan tersasar 2026-09-30).
 *
 * Muncul HANYA ketika bidan menekan tombol navigasi untuk titik yang BUKAN
 * `gps_pin` (estimasi wilayah / tebakan staf). Mencegah "false sense of
 * precision": Google Maps dilarang dibuka langsung sebelum bidan melihat
 * peringatan, membaca patokan, atau meminta shareloc presisi ke pasien.
 *
 * Presentational murni — semua aksi diserahkan ke parent via callback.
 */
export interface NavigationPreflightTask {
  customerName?: string | null;
  address: {
    fullText: string;
    landmark?: string | null;
    addressDetail?: string | null;
  };
}

export interface NavigationPreflightModalProps {
  open: boolean;
  task: NavigationPreflightTask | null;
  onClose: () => void;
  onProceedNavigation: () => void;
  onRequestShareloc: () => void;
  /** True saat draf shareloc sedang diambil dari server (DB-driven). */
  requesting?: boolean;
}

export const NavigationPreflightModal: React.FC<NavigationPreflightModalProps> = ({
  open,
  task,
  onClose,
  onProceedNavigation,
  onRequestShareloc,
  requesting = false,
}) => {
  if (!open || !task) return null;

  const patientName = task.customerName || 'Bunda';
  const landmark = (task.address?.landmark || '').trim();
  const addressDetail = (task.address?.addressDetail || '').trim();
  const fullText = (task.address?.fullText || '').trim();

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-xs animate-fadeIn"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Peringatan titik lokasi estimasi"
    >
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 w-full max-w-md shadow-2xl border border-[#e9edef] space-y-4 text-left animate-modalScaleUp max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-1.5 bg-[#d1d7db] rounded-full mx-auto -mt-2 mb-1 sm:hidden" />

        <div className="flex items-start justify-between">
          <h3 className="text-base font-bold text-[#111b21] flex items-center space-x-2">
            <AlertTriangle className="text-amber-500 flex-shrink-0" size={20} />
            <span>Titik Lokasi Estimasi</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[#667781] hover:text-[#111b21] p-1 rounded-full hover:bg-[#f0f2f5]"
            aria-label="Tutup"
          >
            <X size={18} />
          </button>
        </div>

        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
          Titik ini merupakan <b>estimasi wilayah / tebakan staf</b>, BUKAN titik GPS presisi
          dari pasien. Google Maps hanya akan memandu ke area umum perumahan — <b>bidan bisa
          tersasar ke blok yang salah</b>.
        </div>

        <div className="rounded-xl border border-[#e9edef] bg-[#f8fafc] p-3 space-y-2">
          <div className="flex items-start space-x-2">
            <MapPin size={14} className="text-[#008069] mt-0.5 flex-shrink-0" />
            <div className="text-xs text-[#111b21]">
              <p className="font-semibold">{patientName}</p>
              <p className="text-[#54656f] leading-relaxed">{fullText || 'Alamat belum lengkap'}</p>
              {landmark && (
                <p className="text-[#54656f] mt-1">
                  <span className="font-semibold">Patokan:</span> {landmark}
                </p>
              )}
              {addressDetail && (
                <p className="text-[#54656f] mt-1">
                  <span className="font-semibold">Detail:</span> {addressDetail}
                </p>
              )}
            </div>
          </div>
        </div>

        <p className="text-[11px] text-[#667781]">
          Sebaiknya minta shareloc WhatsApp & patokan rumah terlebih dahulu sebelum berangkat.
        </p>

        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={onRequestShareloc}
            disabled={requesting}
            className="w-full min-h-[48px] flex items-center justify-center space-x-2 py-3 px-4 bg-[#008069] hover:bg-[#00a884] text-white rounded-2xl text-sm font-bold transition active:scale-[0.98] shadow-xs disabled:opacity-50"
          >
            <MessageCircle size={16} />
            <span>{requesting ? 'Menyiapkan pesan...' : 'Minta Shareloc ke ' + patientName}</span>
          </button>
          <button
            type="button"
            onClick={onProceedNavigation}
            className="w-full min-h-[48px] flex items-center justify-center space-x-2 py-3 px-4 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded-2xl text-sm font-bold transition active:scale-[0.98]"
          >
            <Navigation size={16} />
            <span>Tetap Buka Peta (Alamat)</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] py-2.5 px-4 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] rounded-2xl text-xs font-bold transition active:scale-[0.98]"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  );
};

export default NavigationPreflightModal;

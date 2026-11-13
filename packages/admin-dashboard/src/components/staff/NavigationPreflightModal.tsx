import React from 'react';
import { AlertTriangle, MessageCircle, Navigation, MapPin } from 'lucide-react';
import { Modal } from '../ui/Modal';

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
    <Modal
      open={open}
      onClose={onClose}
      variant="sheet"
      size="md"
      title={
        <span className="flex items-center gap-2">
          <AlertTriangle className="text-warning shrink-0" size={20} aria-hidden="true" />
          <span>Titik Lokasi Estimasi</span>
        </span>
      }
      footer={
        <div className="w-full space-y-2">
          <button
            type="button"
            onClick={onRequestShareloc}
            disabled={requesting}
            className="w-full min-h-[48px] flex items-center justify-center space-x-2 py-3 px-4 bg-accent hover:bg-accent-hover text-on-solid rounded-2xl text-sm font-bold transition active:scale-[0.98] shadow-xs disabled:opacity-50"
          >
            <MessageCircle size={16} aria-hidden="true" />
            <span>{requesting ? 'Menyiapkan pesan...' : 'Minta Shareloc ke ' + patientName}</span>
          </button>
          <button
            type="button"
            onClick={onProceedNavigation}
            className="w-full min-h-[48px] flex items-center justify-center space-x-2 py-3 px-4 bg-warning-soft hover:bg-warning text-warning border border-warning-line rounded-2xl text-sm font-bold transition active:scale-[0.98]"
          >
            <Navigation size={16} aria-hidden="true" />
            <span>Tetap Buka Peta (Alamat)</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] py-2.5 px-4 bg-surface hover:bg-fill-1 border border-divider text-ink-2 rounded-2xl text-xs font-bold transition active:scale-[0.98]"
          >
            Batal
          </button>
        </div>
      }
    >

        <div className="rounded-xl border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
          Titik ini merupakan <b>estimasi wilayah / tebakan staf</b>, BUKAN titik GPS presisi
          dari pasien. Google Maps hanya akan memandu ke area umum perumahan: <b>bidan bisa
          tersasar ke blok yang salah</b>.
        </div>

        <div className="rounded-xl border border-divider bg-surface-2 p-3 space-y-2">
          <div className="flex items-start space-x-2">
            <MapPin size={14} className="text-accent mt-0.5 flex-shrink-0" />
            <div className="text-xs text-ink">
              <p className="font-semibold">{patientName}</p>
              <p className="text-ink-2 leading-relaxed">{fullText || 'Alamat belum lengkap'}</p>
              {landmark && (
                <p className="text-ink-2 mt-1">
                  <span className="font-semibold">Patokan:</span> {landmark}
                </p>
              )}
              {addressDetail && (
                <p className="text-ink-2 mt-1">
                  <span className="font-semibold">Detail:</span> {addressDetail}
                </p>
              )}
            </div>
          </div>
        </div>

        <p className="text-[11px] text-ink-2">
          Sebaiknya minta shareloc WhatsApp & patokan rumah terlebih dahulu sebelum berangkat.
        </p>
    </Modal>
  );
};

export default NavigationPreflightModal;

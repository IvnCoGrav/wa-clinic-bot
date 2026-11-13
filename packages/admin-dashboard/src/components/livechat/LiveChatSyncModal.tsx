import React from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { Modal } from '../ui/Modal';

export interface LiveChatSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const LiveChatSyncModal: React.FC<LiveChatSyncModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Sinkronisasi WhatsApp"
      subtitle="Penyelarasan riwayat chat di background"
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold text-ink-2 hover:text-ink hover:bg-fill-1 rounded-xl transition cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onConfirm();
            }}
            className="px-4 py-1.5 text-xs font-bold text-on-solid bg-accent hover:bg-accent-hover rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
          >
            <RefreshCw size={12} aria-hidden="true" />
            <span>Mulai Sinkronisasi Sekarang</span>
          </button>
        </>
      }
    >
      <div className="space-y-3 text-xs text-ink-2">
        <div className="p-3 bg-surface-2 border border-divider rounded-xl space-y-1">
          <p className="font-bold text-ink">Apa yang dilakukan?</p>
          <p className="leading-relaxed text-[11px]">
            Sistem akan menarik dan menyelaraskan seluruh percakapan dari server WhatsApp (WAHA)
            langsung ke database bot secara otomatis tanpa mengganggu chat yang sedang aktif.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="font-bold text-ink">Data yang disinkronkan (Scrape):</p>
          <ul className="space-y-1 text-[11px] pl-1">
            <li className="flex items-start space-x-2">
              <span><strong>Daftar Kontak & Customer:</strong> Deteksi nomor baru dan update nama pelanggan.</span>
            </li>
            <li className="flex items-start space-x-2">
              <span><strong>Riwayat Percakapan:</strong> Pesan teks, lampiran media (foto/gambar), dan status kirim/baca.</span>
            </li>
            <li className="flex items-start space-x-2">
              <span><strong>Foto Profil WhatsApp:</strong> Cache foto profil customer untuk notifikasi mobile & avatar.</span>
            </li>
          </ul>
        </div>

        <div className="p-2.5 bg-warning-soft border border-warning-line/80 rounded-xl space-y-1 text-warning">
          <p className="font-bold flex items-center space-x-1.5 text-[11px]">
            <Clock size={12} aria-hidden="true" />
            <span>Estimasi waktu bekerja di background:</span>
          </p>
          <p className="text-[11px] leading-relaxed text-warning">
            Estimasi <strong>~1 - 3 menit</strong> (tergantung banyaknya riwayat chat WhatsApp). Anda
            dapat tetap menggunakan dashboard dan membuka percakapan seperti biasa tanpa menunggu.
          </p>
        </div>
      </div>
    </Modal>
  );
};

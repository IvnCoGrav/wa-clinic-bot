import React from 'react';
import { RefreshCw, X } from 'lucide-react';

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn">
      <div className="bg-surface rounded-2xl max-w-md w-full p-5 shadow-2xl border border-divider space-y-4 animate-scaleUp max-h-[85dvh] overflow-y-auto overscroll-contain">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-divider">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-accent-soft text-accent">
              <RefreshCw size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink">Sinkronisasi WhatsApp</h3>
              <p className="text-[11px] text-ink-2">Penyelarasan Riwayat Chat di Background</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-ink-3 hover:text-ink rounded-lg hover:bg-fill-1 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Konten Penjelasan */}
        <div className="space-y-3 text-xs text-ink-2">
          {/* Apa yang dilakukan */}
          <div className="p-3 bg-surface-2 border border-divider rounded-xl space-y-1">
            <p className="font-bold text-ink flex items-center space-x-1.5">
              <span>⚙️</span>
              <span>Apa yang dilakukan?</span>
            </p>
            <p className="leading-relaxed text-[11px]">
              Sistem akan menarik dan menyelaraskan seluruh percakapan dari server WhatsApp (WAHA) langsung ke database bot secara otomatis tanpa mengganggu chat yang sedang aktif.
            </p>
          </div>

          {/* Data yang disinkronkan */}
          <div className="space-y-1.5">
            <p className="font-bold text-ink flex items-center space-x-1.5">
              <span>📥</span>
              <span>Data yang disinkronkan (Scrape):</span>
            </p>
            <ul className="space-y-1 text-[11px] pl-1">
              <li className="flex items-start space-x-2">
                <span className="text-accent font-bold">✓</span>
                <span><strong>Daftar Kontak & Customer:</strong> Deteksi nomor baru dan update nama pelanggan.</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="text-accent font-bold">✓</span>
                <span><strong>Riwayat Percakapan:</strong> Pesan teks, lampiran media (foto/gambar), dan status kirim/baca.</span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="text-accent font-bold">✓</span>
                <span><strong>Foto Profil WhatsApp:</strong> Cache foto profil customer untuk notifikasi mobile & avatar.</span>
              </li>
            </ul>
          </div>

          {/* Estimasi Waktu */}
          <div className="p-2.5 bg-warning-soft border border-warning-line/80 rounded-xl space-y-1 text-warning">
            <p className="font-bold flex items-center space-x-1.5 text-[11px]">
              <span>⏱️</span>
              <span>Estimasi Waktu Bekerja di Background:</span>
            </p>
            <p className="text-[11px] leading-relaxed text-warning">
              Estimasi <strong>~1 - 3 menit</strong> (tergantung banyaknya riwayat chat WhatsApp). Anda dapat tetap menggunakan dashboard dan membuka percakapan seperti biasa tanpa menunggu.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-2 pt-2 border-t border-divider">
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
            className="px-4 py-1.5 text-xs font-bold text-white bg-accent hover:bg-accent-hover rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
          >
            <RefreshCw size={12} />
            <span>Mulai Sinkronisasi Sekarang</span>
          </button>
        </div>
      </div>
    </div>
  );
};

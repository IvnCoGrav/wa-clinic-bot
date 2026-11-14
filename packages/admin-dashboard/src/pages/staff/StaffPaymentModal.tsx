/**
 * Form catat pembayaran pasien (tunai, transfer, QRIS).
 *
 * Modul ini memiliki state form sendiri: metode yang dipilih, foto bukti, dan
 * kompresi gambar. Halaman induk hanya menerima hasil akhir lewat `onSubmit`
 * dan tetap menjadi pemilik pemanggilan API serta pembaruan daftar tugas.
 */
import React, { useRef, useState } from 'react';
import { CheckCircle2, Copy, CreditCard, QrCode, Upload, X } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { formatRupiah } from '../../utils/money';
import { prepareChatImage } from '../../utils/imageCompressor';
import { StaffPaymentInfo, StaffTask } from './staffTaskTypes';

export type PaymentMethod = 'CASH' | 'TRANSFER' | 'QRIS';

interface StaffPaymentModalProps {
  task: StaffTask;
  paymentInfo: StaffPaymentInfo | null;
  loadingPaymentInfo: boolean;
  /** Metode awal saat modal dibuka, mis. QRIS dari tombol cepat. */
  initialMethod: PaymentMethod;
  submitting: boolean;
  onClose: () => void;
  onOpenQris: () => void;
  onCopyAccount: (accountNumber: string, bank: string) => void;
  onSubmit: (method: PaymentMethod, proofImageB64: string | null) => void;
}

export const StaffPaymentModal: React.FC<StaffPaymentModalProps> = ({
  task,
  paymentInfo,
  loadingPaymentInfo,
  initialMethod,
  submitting,
  onClose,
  onOpenQris,
  onCopyAccount,
  onSubmit,
}) => {
  const { toast } = useUiFeedback();
  const [method, setMethod] = useState<PaymentMethod>(initialMethod);
  const [proofImageB64, setProofImageB64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('File yang dipilih harus berupa gambar.', 'error');
      return;
    }
    try {
      // Util kanonis: HEIC/format tak didukung menghasilkan pesan actionable,
      // bukan gagal senyap seperti canvas manual sebelumnya.
      const prepared = await prepareChatImage(file, 'field');
      setProofImageB64(prepared.dataUrl);
    } catch (err: any) {
      toast(err?.message || 'Foto gagal diproses. Coba ambil ulang dari kamera.', 'error');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (method !== 'CASH' && !proofImageB64) {
      toast('Silakan unggah foto bukti transfer / QRIS terlebih dahulu.', 'error');
      return;
    }
    onSubmit(method, proofImageB64);
  };

  return (
    <Modal
      open
      onClose={onClose}
      variant="sheet"
      size="md"
      bodyClassName="p-6 overflow-y-auto overscroll-contain touch-scroll-y space-y-4 text-left"
      title={
        <span className="flex items-center gap-2">
          <CreditCard className="text-accent" size={20} aria-hidden="true" />
          <span>Catat Pembayaran Pasien</span>
        </span>
      }
      subtitle={`${task.customerName || 'Pasien'} • ${task.treatmentDetail || 'Treatment'}`}
    >
      {/* Total Tagihan Banner */}
      <div className="bg-fill-1 p-3.5 rounded-2xl border border-divider flex items-center justify-between">
        <div>
          <span className="text-xs text-ink-2 block">Total Tagihan:</span>
          <span className="text-base font-bold text-accent">{formatRupiah(task.pricing.totalFee)}</span>
          {Number(task.pricing.discountAmount || 0) > 0 && (
            <span className="block text-[10px] text-rose-600 dark:text-danger font-semibold">
              Termasuk diskon -{formatRupiah(Number(task.pricing.discountAmount))}
            </span>
          )}
        </div>
        <span className="text-[11px] font-semibold px-2.5 py-1 bg-surface text-ink-2 rounded-xl border border-divider">
          Ongkir: {formatRupiah(task.pricing.deliveryFee)}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <span className="block text-xs font-semibold text-ink mb-2">Metode Pembayaran:</span>
          <div className="grid grid-cols-3 gap-2">
            {(['CASH', 'TRANSFER', 'QRIS'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMethod(option)}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border transition ${
                  method === option
                    ? 'bg-accent text-on-solid border-accent shadow-xs'
                    : 'bg-surface text-ink-2 border-divider hover:bg-fill-1'
                }`}
              >
                {option === 'CASH' ? '💵 Tunai' : option === 'TRANSFER' ? '🏦 Transfer' : '📱 QRIS'}
              </button>
            ))}
          </div>
        </div>

        {/* Info pembayaran dimuat dari kebijakan klinik di server, bukan hardcode. */}
        {method === 'QRIS' && (
          <div className="p-3 bg-surface-2 rounded-2xl border border-divider space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                <QrCode size={15} className="text-accent" />
                <span>Barcode QRIS Klinik</span>
              </span>
              {paymentInfo?.qrisImageUrl && (
                <button
                  type="button"
                  onClick={onOpenQris}
                  className="text-[11px] font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>Perbesar Layar</span>
                </button>
              )}
            </div>

            {loadingPaymentInfo ? (
              <div className="py-6 flex flex-col items-center justify-center space-y-2 text-ink-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <span className="text-[11px]">Memuat QRIS resmi...</span>
              </div>
            ) : paymentInfo?.qrisImageUrl ? (
              <div className="flex flex-col items-center space-y-2">
                <button
                  type="button"
                  onClick={onOpenQris}
                  className="p-2 bg-surface rounded-xl border border-divider shadow-xs cursor-pointer hover:border-accent transition group"
                  title="Ketuk untuk memperbesar QRIS ke layar penuh"
                >
                  <img
                    src={paymentInfo.qrisImageUrl}
                    alt="QRIS Klinik"
                    className="w-44 h-44 object-contain rounded-lg group-hover:scale-[1.02] transition-transform"
                  />
                </button>
                <p className="text-[11px] text-ink-2 text-center">
                  Tunjukkan QRIS di atas kepada pasien untuk discan langsung via GoPay, OVO, Dana, BCA Mobile, dll.
                </p>
              </div>
            ) : (
              <div className="py-4 px-3 text-center text-xs text-warning bg-warning-soft rounded-xl border border-warning-line">
                Gambar QRIS belum dikonfigurasi di pengaturan klinik. Silakan minta admin mengunggah QRIS atau gunakan transfer rekening.
              </div>
            )}
            {paymentInfo?.instructions && (
              <p className="text-[10px] text-ink-3 italic text-center">{paymentInfo.instructions}</p>
            )}
          </div>
        )}

        {method === 'TRANSFER' && (
          <div className="p-3 bg-surface-2 rounded-2xl border border-divider space-y-2.5">
            <span className="text-xs font-bold text-ink block">Rekening Resmi Klinik:</span>

            {loadingPaymentInfo ? (
              <div className="py-6 flex flex-col items-center justify-center space-y-2 text-ink-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <span className="text-[11px]">Memuat rekening...</span>
              </div>
            ) : paymentInfo?.bankAccounts && paymentInfo.bankAccounts.length > 0 ? (
              <div className="space-y-2">
                {paymentInfo.bankAccounts.map((acc, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-surface rounded-xl border border-divider flex items-center justify-between shadow-2xs"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-ink block">{acc.bank}</span>
                      <span className="font-mono text-xs font-semibold text-accent tracking-wider block">
                        {acc.accountNumber}
                      </span>
                      <span className="text-[10px] text-ink-2 block truncate">a.n. {acc.accountName}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onCopyAccount(acc.accountNumber, acc.bank)}
                      className="px-2.5 py-1.5 rounded-lg bg-fill-1 hover:bg-bubble-out text-ink-2 hover:text-accent text-xs font-bold transition flex items-center gap-1 border border-divider active:scale-95 flex-shrink-0 cursor-pointer"
                      title="Salin nomor rekening"
                    >
                      <Copy size={12} />
                      <span>Salin</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-3 px-3 text-center text-xs text-warning bg-warning-soft rounded-xl border border-warning-line">
                Rekening bank belum terdaftar di pengaturan klinik.
              </div>
            )}
            {paymentInfo?.instructions && (
              <p className="text-[10px] text-ink-3 italic text-center">{paymentInfo.instructions}</p>
            )}
          </div>
        )}

        {method === 'CASH' && (
          <div className="p-3 bg-success-soft/60 rounded-2xl border border-success-line text-xs text-success space-y-1">
            <span className="font-bold block">Pembayaran Tunai di Tempat</span>
            <p className="text-[11px] text-success leading-relaxed">
              Terima uang tunai pas sejumlah{' '}
              <strong className="font-bold">{formatRupiah(task.pricing.totalFee)}</strong>. Bukti foto struk tidak
              diwajibkan untuk metode tunai.
            </p>
          </div>
        )}

        {method !== 'CASH' && (
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-ink">Foto Bukti Pembayaran (Wajib):</span>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            {proofImageB64 ? (
              <div className="relative rounded-xl overflow-hidden border border-divider bg-black/5 flex items-center justify-center max-h-48">
                <img src={proofImageB64} alt="Bukti bayar" className="object-contain max-h-48 w-auto" />
                <button
                  type="button"
                  onClick={() => setProofImageB64(null)}
                  className="absolute top-2 right-2 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition"
                  aria-label="Hapus foto bukti"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-4 border-2 border-dashed border-divider hover:border-accent rounded-2xl flex flex-col items-center justify-center text-xs text-ink-2 hover:text-accent transition bg-surface-2"
              >
                <Upload size={20} className="mb-1 text-ink-3" />
                <span>Ketuk untuk pilih atau ambil foto bukti transfer</span>
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end space-x-2 pt-3 border-t border-divider">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition"
          >
            Batal
          </button>
          <button
            aria-label="Tandai selesai"
            type="submit"
            disabled={submitting || (method !== 'CASH' && !proofImageB64)}
            className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-on-solid text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
          >
            {submitting ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                <span>Menyimpan...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                <span>Simpan Status Lunas</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};

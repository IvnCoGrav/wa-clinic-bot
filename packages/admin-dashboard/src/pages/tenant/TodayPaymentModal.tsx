/**
 * Modal pencatatan pembayaran lunas untuk tugas treatment harian.
 *
 * Form memegang sendiri pembacaan file bukti; metode dan hasil unggahan
 * dikirim ke halaman induk lewat callback.
 */
import React, { useState } from 'react';
import { CreditCard, Maximize2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { formatRupiah } from '../../utils/money';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { prepareChatImage } from '../../utils/imageCompressor';
import { TreatmentTask } from './todayTreatmentsTypes';

export type TodayPaymentMethod = 'CASH' | 'TRANSFER' | 'QRIS';

interface TodayPaymentModalProps {
  task: TreatmentTask;
  method: TodayPaymentMethod;
  proofImageB64: string | null;
  submitting: boolean;
  onClose: () => void;
  onMethodChange: (method: TodayPaymentMethod) => void;
  onProofChange: (dataUrl: string | null) => void;
  onSave: (e: React.FormEvent) => void;
  onShowImage: (url: string | null) => void;
}

export const TodayPaymentModal: React.FC<TodayPaymentModalProps> = ({
  task,
  method,
  proofImageB64,
  submitting,
  onClose,
  onMethodChange,
  onProofChange,
  onSave,
  onShowImage,
}) => {
  const { toast } = useUiFeedback();
  const [proofError, setProofError] = useState<string | null>(null);
  return (
  <Modal
    open
    onClose={onClose}
    size="md"
    bodyClassName="p-0 overflow-hidden flex-1 flex flex-col min-h-0"
    title={
      <span className="flex items-center gap-2">
        <CreditCard size={20} className="text-warning" aria-hidden="true" />
        <span>Catat Pembayaran Lunas</span>
      </span>
    }
    subtitle={task.customerName || 'Pasien'}
  >
    <form onSubmit={onSave} className="flex-1 overflow-y-auto p-5 space-y-4 text-left overscroll-contain">
      <div className="p-3.5 bg-amber-50/50 dark:bg-amber-950/30 rounded-2xl border border-amber-200 dark:border-amber-800/40 text-xs space-y-1">
        <div className="flex justify-between text-ink-2">
          <span>Biaya Layanan:</span>
          <span>{formatRupiah(task.pricing.treatmentFee)}</span>
        </div>
        {Number(task.pricing.discountAmount || 0) > 0 && (
          <div className="flex justify-between text-rose-600 dark:text-danger">
            <span>Diskon:</span>
            <span>-{formatRupiah(Number(task.pricing.discountAmount))}</span>
          </div>
        )}
        <div className="flex justify-between text-ink-2">
          <span>Ongkos Kirim:</span>
          <span>{formatRupiah(task.pricing.deliveryFee)}</span>
        </div>
        <div className="flex justify-between font-bold text-ink pt-1 border-t border-amber-200 dark:border-amber-800/40">
          <span>Total Tagihan:</span>
          <span className="text-accent text-sm">{formatRupiah(task.pricing.totalFee)}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="block text-xs font-bold text-ink">Metode Pembayaran:</span>
        <div className="grid grid-cols-3 gap-2">
          {(['CASH', 'TRANSFER', 'QRIS'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onMethodChange(option)}
              className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer ${
                method === option
                  ? 'bg-accent text-accent-ink border-accent shadow-xs'
                  : 'bg-surface text-ink-2 border-divider hover:bg-fill-1'
              }`}
            >
              {option === 'CASH' ? '💵 Tunai' : option === 'TRANSFER' ? '🏦 Transfer' : '📱 QRIS'}
            </button>
          ))}
        </div>
      </div>

      {method !== 'CASH' && (
        <div className="space-y-1.5">
          <span className="block text-xs font-bold text-ink">Upload Bukti Transfer:</span>
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                setProofError(null);
                const prepared = await prepareChatImage(file, 'field');
                onProofChange(prepared.dataUrl);
              } catch (err: any) {
                const message = err?.message || 'Foto gagal diproses. Coba ambil ulang dari kamera.';
                setProofError(message);
                toast(message, 'error');
              }
            }}
            className="w-full text-xs text-ink-2 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-accent-soft file:text-accent hover:file:bg-accent-soft/80 cursor-pointer"
          />
          {proofError && (
            <p className="text-[11px] text-danger font-semibold">{proofError}</p>
          )}
          {proofImageB64 && (
            <div className="relative mt-2 rounded-xl overflow-hidden border">
              <img src={proofImageB64} alt="Bukti" className="h-28 w-auto object-contain" />
              <button
                type="button"
                onClick={() => onShowImage(proofImageB64)}
                className="absolute bottom-1 right-1 p-1 bg-black/60 text-white rounded-md text-[10px] flex items-center gap-1 cursor-pointer"
              >
                <Maximize2 size={10} />
                <span>Zoom</span>
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end space-x-2 pt-3 border-t border-divider">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition cursor-pointer"
        >
          Batal
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
        >
          {submitting ? <span>Menyimpan...</span> : <span>Simpan Status Lunas</span>}
        </button>
      </div>
    </form>
  </Modal>
  );
};

/**
 * Modal bukti pembayaran reservasi: peringatan selisih nominal, ringkasan
 * tagihan, status, dan pratinjau gambar bukti.
 */
import React from 'react';
import { AlertTriangle, Maximize2, Receipt } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { evaluatePaymentProof } from '../../utils/paymentProof';
import { Reservation } from '../../types';

interface PaymentProofModalProps {
  proof: Reservation;
  paymentMethodLabel: string;
  statusBadge: React.ReactNode;
  onClose: () => void;
}

export const PaymentProofModal: React.FC<PaymentProofModalProps> = ({
  proof,
  paymentMethodLabel,
  statusBadge,
  onClose,
}) => {
  const modalEval = evaluatePaymentProof(proof);

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <Receipt size={16} className="text-accent shrink-0" aria-hidden="true" />
          <span>Bukti Pembayaran</span>
        </span>
      }
    >
      {modalEval.isMismatch && (
        <div className="p-3 rounded-2xl bg-danger-soft border border-danger-line text-danger space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-danger">
            <AlertTriangle size={15} className="shrink-0" />
            <span>Peringatan: Nominal Transfer Tidak Sesuai Tagihan</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-danger-line">
            <div>
              <span className="text-[10px] text-danger block uppercase font-bold">Total Tagihan:</span>
              <strong>Rp {modalEval.totalExpected.toLocaleString('id-ID')}</strong>
            </div>
            <div>
              <span className="text-[10px] text-danger block uppercase font-bold">Nominal di Struk:</span>
              <strong className="text-danger font-extrabold">
                Rp {modalEval.receiptAmount?.toLocaleString('id-ID')}
              </strong>
            </div>
          </div>
          <div className="text-[11px] font-semibold text-danger">
            Selisih:{' '}
            {modalEval.isUnderpaid
              ? `Kurang Rp ${Math.abs(modalEval.difference).toLocaleString('id-ID')}`
              : `Lebih Rp ${modalEval.difference.toLocaleString('id-ID')}`}
          </div>
        </div>
      )}

      <div className="text-xs space-y-1.5 bg-surface-2 border border-divider rounded-2xl p-3.5">
        <div className="flex justify-between">
          <span className="text-ink-3">Pasien:</span>
          <span className="font-bold text-ink">
            {proof.customer?.name || 'Bunda'} ({proof.customer?.phone})
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-3">Metode:</span>
          <span className="font-bold text-ink">{paymentMethodLabel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-3">Tagihan Resmi:</span>
          <span className="font-bold text-ink">
            {proof.purchase_value ? `Rp ${proof.purchase_value.toLocaleString('id-ID')}` : '-'}
          </span>
        </div>
        {proof.receipt_amount != null && (
          <div className="flex justify-between">
            <span className="text-ink-3">Nominal di Struk:</span>
            <span className="font-bold text-danger">Rp {proof.receipt_amount.toLocaleString('id-ID')}</span>
          </div>
        )}
        <div className="flex justify-between items-center pt-1 border-t border-divider">
          <span className="text-ink-3">Status:</span>
          {statusBadge}
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden border border-divider bg-surface-2">
        <img src={proof.proof_url!} alt="Bukti pembayaran" className="w-full max-h-72 object-contain" />
      </div>

      <div className="flex justify-end space-x-2 pt-2 border-t border-divider">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition cursor-pointer"
        >
          Tutup
        </button>
        <a
          href={proof.proof_url!}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
        >
          <Maximize2 size={13} />
          <span>Buka Gambar Penuh</span>
        </a>
      </div>
    </Modal>
  );
};

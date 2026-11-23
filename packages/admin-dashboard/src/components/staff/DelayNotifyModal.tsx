import React from 'react';
import { AlertCircle, Copy, MessageSquare, Send, Check } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { StaffTask } from '../../pages/staff/staffTaskTypes';

export interface DelayNotifyModalProps {
  open: boolean;
  task: StaffTask | null;
  draft: string;
  loadingDraft?: boolean;
  sending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  onCopyDraft: () => void;
  copied?: boolean;
  errorInfo?: { code: string; message: string } | null;
}

export const DelayNotifyModal: React.FC<DelayNotifyModalProps> = ({
  open,
  task,
  draft,
  loadingDraft = false,
  sending = false,
  onConfirm,
  onClose,
  onCopyDraft,
  copied = false,
  errorInfo,
}) => {
  if (!open || !task) return null;

  const patientName = task.customerName || 'Bunda';
  const delayMin = task.delay?.delayMinutes ?? 0;
  const etaWib = task.delay?.estimatedArrivalWib || '-';

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="sheet"
      size="md"
      title={
        <span className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <AlertCircle size={20} className="shrink-0" />
          <span>Infokan Keterlambatan ke Admin</span>
        </span>
      }
      subtitle={`Pasien: Bunda ${patientName}`}
      footer={
        <div className="w-full flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 bg-surface hover:bg-fill-1 border border-divider text-ink rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            Tutup
          </button>
          {!errorInfo && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={sending || loadingDraft}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
            >
              <Send size={13} />
              <span>{sending ? 'Mengirim...' : 'Kirim ke Admin'}</span>
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-3.5 text-xs">
        {/* Estimasi Keterlambatan */}
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-300 space-y-1">
          <div className="font-semibold flex items-center gap-1.5">
            <AlertCircle size={14} className="text-amber-500 shrink-0" />
            <span>
              {delayMin > 0
                ? `Potensi keterlambatan ±${delayMin} menit`
                : 'Waktu keberangkatan terlewat'}
            </span>
          </div>
          <p className="text-[11px] text-ink-2 pl-5">
            Estimasi tiba di lokasi: <strong>{etaWib} WIB</strong>
          </p>
        </div>

        {/* SOP Info */}
        <p className="text-ink-2 text-[11px] leading-relaxed">
          Pesan ini akan dikirimkan otomatis melalui bot resmi klinik ke WhatsApp Admin / CS,
          sehingga CS dapat langsung mengabari Bunda <strong>{patientName}</strong> melalui Live Chat.
        </p>

        {/* Error Info (bila ada) */}
        {errorInfo && (
          <div className="p-3 rounded-xl bg-danger-soft border border-danger-line text-danger space-y-2">
            <p className="font-medium text-xs">{errorInfo.message}</p>
            <p className="text-[11px] text-ink-2">
              Silakan salin draf pesan di bawah dan kirimkan manual ke grup/koordinator admin.
            </p>
          </div>
        )}

        {/* Draf Pesan */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-semibold text-ink flex items-center gap-1">
              <MessageSquare size={12} className="text-accent" />
              <span>Draf Pesan untuk Customer</span>
            </label>
            <button
              type="button"
              onClick={onCopyDraft}
              className="text-[11px] font-semibold text-accent hover:underline flex items-center gap-1 cursor-pointer"
            >
              {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
              <span>{copied ? 'Tersalin' : 'Salin Pesan'}</span>
            </button>
          </div>

          {loadingDraft ? (
            <div className="p-4 rounded-xl bg-fill-1 border border-divider text-center text-ink-2 text-xs">
              Memuat draf pesan...
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-fill-1 border border-divider text-ink font-sans text-xs whitespace-pre-wrap leading-relaxed select-all">
              {draft || 'Tidak ada draf tersedia.'}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

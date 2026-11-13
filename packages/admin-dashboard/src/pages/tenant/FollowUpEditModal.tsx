/**
 * Modal edit follow-up: jadwal kirim, tahap, varian pesan, dan teks khusus.
 * Presentasi murni; state dan pemanggilan API tetap di halaman induk.
 */
import React from 'react';
import { Calendar, CheckCircle, Edit2, Eye, FileText, Loader2, MessageSquare, RotateCcw, Tag } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { FollowUpEditModalState, FollowUpItem } from './followUpTypes';

interface FollowUpEditModalProps {
  state: FollowUpEditModalState;
  actionLoading: string | null;
  onChange: React.Dispatch<React.SetStateAction<FollowUpEditModalState>>;
  onSave: () => void;
  onVariantSelect: (variant: number) => void;
  getTypeLabel: (type: string, stage: number) => { label: string; [key: string]: any };
  getTemplateText: (type: string, stage: number, variant: number, category: string | null) => string;
  resolveCategory: (fu?: FollowUpItem | null) => string | null;
  editCategory: string | null;
  editHonorific: string;
  editFirstName: string;
  editBabyLabel: string;
}

export const FollowUpEditModal: React.FC<FollowUpEditModalProps> = ({
  state,
  actionLoading,
  onChange,
  onSave,
  onVariantSelect,
  getTypeLabel,
  getTemplateText,
  resolveCategory,
  editCategory,
  editHonorific,
  editFirstName,
  editBabyLabel,
}) => {
  const editModal = state as FollowUpEditModalState & { item: FollowUpItem };
  return (
  <Modal
    open
    onClose={() => onChange({ open: false, newDate: '', stage: 1, variant: 1, customText: '' })}
    size="xl"
    bodyClassName="p-0 overflow-hidden flex-1 flex flex-col min-h-0"
    title={
      <span className="flex items-center gap-2">
        <Edit2 size={16} className="text-accent" aria-hidden="true" />
        <span>Edit Follow-Up</span>
      </span>
    }
    subtitle="Atur jadwal pengiriman, varian pesan, atau sesuaikan teks khusus."
  >

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
          {/* Customer Banner */}
          <div className="bg-surface-2 p-3 rounded-xl border border-divider flex items-center justify-between text-xs">
            <div>
              <span className="text-ink-3 block text-[10px]">Pelanggan</span>
              <strong className="text-ink font-bold text-sm">
                {editModal.item.customer?.name || 'Tanpa Nama'}
              </strong>
              <span className="text-ink-3 block font-mono text-[11px]">{editModal.item.customer?.phone}</span>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-accent-soft text-accent border border-divider">
              {getTypeLabel(editModal.item.type, editModal.stage).label}
            </span>
          </div>

          {/* Field 1: Jadwal Kirim */}
          <div className="space-y-1">
            <span className="text-xs font-bold text-ink flex items-center space-x-1.5">
              <Calendar size={14} className="text-accent" />
              <span>Jadwal Kirim</span>
            </span>
            <input
              type="datetime-local"
              value={editModal.newDate}
              onChange={(e) => onChange({ ...editModal, newDate: e.target.value })}
              className="w-full p-2.5 bg-surface border border-divider hover:border-accent focus:border-accent rounded-xl text-xs text-ink focus:outline-none shadow-xs transition font-medium"
            />
          </div>

          {/* Field 2a: Tahap Jadwal (Stage) */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-ink flex items-center space-x-1.5">
              <Calendar size={14} className="text-accent" />
              <span>Tahap Jadwal</span>
              <span className="text-[10px] font-normal text-ink-3">(kapan dikirim)</span>
            </span>
            <select
              value={editModal.stage}
              onChange={(e) => {
                const newStage = parseInt(e.target.value, 10);
                const templateText = getTemplateText(editModal.item!.type, newStage, editModal.variant, resolveCategory(editModal.item));
                onChange((prev) => ({ ...prev, stage: newStage, customText: templateText }));
              }}
              className="w-full p-2.5 bg-surface border border-divider hover:border-accent focus:border-accent rounded-xl text-xs text-ink focus:outline-none shadow-xs font-medium"
            >
              {editModal.item?.type === 'NO_PURCHASE' ? (
                <>
                  <option value={1}>Hari ke-3</option>
                  <option value={2}>Hari ke-7</option>
                  <option value={3}>Hari ke-14</option>
                </>
              ) : editModal.item?.type === 'NEXT_TREATMENT' ? (
                <>
                  <option value={1}>Bulan ke-1</option>
                  <option value={2}>Bulan ke-2</option>
                  <option value={3}>Bulan ke-3</option>
                </>
              ) : editModal.item?.type === 'WINBACK_60D' ? (
                <option value={1}>Re-engagement (Sekali)</option>
              ) : (
                <>
                  <option value={1}>Tahap 1</option>
                  <option value={2}>Tahap 2</option>
                  <option value={3}>Tahap 3</option>
                </>
              )}
            </select>
            <p className="text-[10px] text-ink-3">Mengganti tahap akan mengubah jadwal, varian tetap di tahap yang dipilih.</p>
          </div>

          {/* Field 2b: Varian Pesan (gaya bahasa) */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-ink flex items-center space-x-1.5">
                <MessageSquare size={14} className="text-accent" />
                <span>Varian Pesan</span>
                <span className="text-[10px] font-normal text-ink-3">(gaya bahasa)</span>
              </span>
              <span className="text-[10px] text-ink-3">Klik varian untuk ganti teks tanpa ubah jadwal</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onVariantSelect(v)}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-1.5 active:scale-95 ${
                    editModal.variant === v
                      ? 'bg-accent-soft border-accent text-accent shadow-xs'
                      : 'bg-surface border-divider text-ink-2 hover:bg-surface-2'
                  }`}
                >
                  <span>Varian #{v}</span>
                  {editModal.variant === v && <CheckCircle size={12} className="text-accent" />}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-ink-3">Varian 1=Ramah/Hangat, 2=Promo/Direct, 3=Edukatif.</p>
          </div>

          {/* Field 3: Teks Pesan Follow-Up */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-ink flex items-center space-x-1.5">
                <FileText size={14} className="text-accent" />
                <span>Teks Pesan Follow-Up</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  if (editModal.item) {
                    const defaultText = getTemplateText(editModal.item.type, editModal.stage, editModal.variant, resolveCategory(editModal.item));
                    onChange((prev) => ({ ...prev, customText: defaultText }));
                  }
                }}
                className="text-[11px] text-accent hover:underline flex items-center space-x-1 font-semibold"
              >
                <RotateCcw size={11} />
                <span>Reset ke Template Default</span>
              </button>
            </div>

            <textarea
              rows={5}
              value={editModal.customText}
              onChange={(e) => onChange({ ...editModal, customText: e.target.value })}
              placeholder="Tulis pesan follow-up kustom untuk pelanggan ini..."
              className="w-full p-3 bg-surface border border-divider hover:border-accent focus:border-accent rounded-xl text-xs text-ink focus:outline-none shadow-xs leading-relaxed transition font-sans"
            />

            {/* Tag Helpers */}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[10px] text-ink-3 flex items-center gap-1">
                <Tag size={10} /> Sisipkan Variabel:
              </span>
              {['{name}', ...(editCategory === 'MOMS' ? [] : ['{babyName}']), '{time}'].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    onChange((prev) => ({
                      ...prev,
                      customText: `${prev.customText} ${tag}`,
                    }))
                  }
                  className="px-2 py-0.5 rounded-lg bg-fill-1 hover:bg-fill-2 text-[10px] font-mono text-ink-2 border border-divider transition active:scale-95"
                >
                  + {tag}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-ink-3 leading-tight">
              * Variabel <code>{'{name}'}</code> akan otomatis disanitasi menjadi sapaan bersih (misal: "Bunda [nama]").{editCategory === 'MOMS' ? ' Variabel {babyName} tidak tersedia untuk kategori MOMS.' : ''}
            </p>
            {/* Live Preview */}
            <div className="bg-success-soft border border-success-line rounded-xl p-3 space-y-1">
              <p className="text-[10px] font-bold text-success flex items-center gap-1"><Eye size={10} /> Preview WhatsApp ({editHonorific} {editFirstName}{editCategory === 'MOMS' ? '' : `, ${editBabyLabel}`}):</p>
              <p className="text-xs text-ink leading-relaxed whitespace-pre-wrap bg-surface p-2 rounded-lg border border-success-line">
                {editModal.customText
                  .replace(/Bunda\s*\{name\}/gi, `${editHonorific} ${editFirstName}`)
                  .replace(/\{name\}/g, editFirstName)
                  .replace(/\{babyName\}/g, editCategory === 'MOMS' ? '[variabel bayi tidak berlaku]' : editBabyLabel)
                  .replace(/\{time\}/g, '10:00 WIB') || '-'}
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-divider bg-surface-2 flex justify-end space-x-2 shrink-0">
          <button
            type="button"
            onClick={() => onChange({ open: false, newDate: '', stage: 1, variant: 1, customText: '' })}
            className="px-4 py-2 bg-surface hover:bg-fill-1 active:scale-95 border border-divider text-ink-2 rounded-xl text-xs font-semibold transition"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={actionLoading === editModal.item.id}
            className="px-5 py-2 bg-accent hover:bg-accent active:scale-95 text-on-solid rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5"
          >
            {actionLoading === editModal.item.id ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <CheckCircle size={13} />
            )}
            <span>Simpan Perubahan</span>
          </button>
        </div>
  </Modal>
  );
};

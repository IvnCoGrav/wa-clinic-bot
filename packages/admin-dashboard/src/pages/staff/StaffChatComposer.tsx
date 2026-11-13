/**
 * Bar balasan chat staf: chip balasan cepat, lampiran gambar, kamera/galeri,
 * textarea, dan tombol kirim.
 */
import React from 'react';
import { Camera, CreditCard, Image as ImageIcon, Send, X } from 'lucide-react';
import { StaffTask } from './staffTaskTypes';
import { isTrulyCompleted } from './staffTaskLogic';

interface StaffChatComposerProps {
  task: StaffTask;
  staffName?: string | null;
  replyText: string;
  replyTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  selectedImage: { file: File; preview: string } | null;
  sending: boolean;
  isSendingPaymentInfo: boolean;
  chatFileInputRef: React.RefObject<HTMLInputElement | null>;
  chatGalleryInputRef: React.RefObject<HTMLInputElement | null>;
  onReplyTextChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSetReplyText: (text: string) => void;
  onRemoveImage: () => void;
  onPickImage: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSend: (e: React.FormEvent) => void;
  onSendPaymentInfo: (task: StaffTask) => void;
  onRecordArrival: (task: StaffTask) => void;
}

export const StaffChatComposer: React.FC<StaffChatComposerProps> = ({
  task,
  staffName,
  replyText,
  replyTextareaRef,
  selectedImage,
  sending,
  isSendingPaymentInfo,
  chatFileInputRef,
  chatGalleryInputRef,
  onReplyTextChange,
  onSetReplyText,
  onRemoveImage,
  onPickImage,
  onSend,
  onSendPaymentInfo,
  onRecordArrival,
}) => (
  <>
  {/* WhatsApp Quick Reply Input Bar */}
  <form
    onSubmit={onSend}
    className="bg-fill-1 border-t border-divider dark:border-divider p-2.5 sm:p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] md:pb-3 z-10 space-y-2 shrink-0"
  >
    {/* Quick Reply Template Chips for Fast Field Messaging */}
    <div
      className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
      style={{ touchAction: 'pan-x', overscrollBehaviorX: 'contain' }}
    >
      {/* Action Button: Kirim Pembayaran — Icon-Only 44x44 (hemat ruang vertikal keyboard) */}
      <button
        type="button"
        disabled={isSendingPaymentInfo}
        onClick={() => task && onSendPaymentInfo(task)}
        className="h-[44px] w-[44px] min-h-[44px] min-w-[44px] rounded-full bg-bubble-out hover:bg-accent-soft text-accent border border-accent/40 flex items-center justify-center transition duration-150 hover:scale-105 active:scale-95 shadow-xs flex-shrink-0 disabled:opacity-50 select-none cursor-pointer"
        title="Kirim QRIS & Rekening Bank Resmi ke WhatsApp Pasien"
        aria-label="Kirim QRIS & Rekening Bank"
      >
        {isSendingPaymentInfo ? (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        ) : (
          <CreditCard size={18} className="text-accent" />
        )}
      </button>

      {[
        { label: '🛵 Sedang OTW', text: 'Halo Bunda, saya sudah dalam perjalanan (OTW) menuju ke lokasi Bunda ya 🙏' },
        { label: '📍 Sudah Sampai', text: 'Halo Bunda, saya sudah sampai di depan rumah/lokasi Bunda ya 🙏' },
      ].map((chip, idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => {
            if (
              chip.label.includes('Sudah Sampai') &&
              task &&
              !task.arrivedAt &&
              !isTrulyCompleted(task)
            ) {
              onRecordArrival(task);
              return;
            }
            onSetReplyText(chip.text);
            if (replyTextareaRef.current) {
              replyTextareaRef.current.focus();
              replyTextareaRef.current.style.height = 'auto';
              setTimeout(() => {
                if (replyTextareaRef.current) {
                  replyTextareaRef.current.style.height = `${Math.min(replyTextareaRef.current.scrollHeight, 130)}px`;
                }
              }, 0);
            }
          }}
          className="text-xs font-semibold bg-surface hover:bg-accent-soft dark:hover:bg-fill-2 text-accent border border-accent/30 min-h-[44px] px-3.5 py-2.5 rounded-full whitespace-nowrap transition-transform duration-150 hover:scale-105 active:scale-95 shadow-2xs flex-shrink-0 inline-flex items-center select-none"
        >
          {chip.label}
        </button>
      ))}
    </div>

    {selectedImage && (
      <div className="flex items-center space-x-2 bg-surface border border-divider rounded-xl p-2">
        <img
          src={selectedImage.preview}
          alt="Lampiran"
          className="h-12 w-12 object-cover rounded-lg border border-divider"
        />
        <span className="flex-1 text-xs text-ink-2 truncate">
          {selectedImage.file.name}
        </span>
        <button
          type="button"
          onClick={() => onRemoveImage()}
          className="p-1.5 rounded-lg text-danger bg-danger-soft hover:bg-danger-line transition"
          title="Hapus lampiran"
        >
          <X size={14} />
        </button>
      </div>
    )}
    <div className="flex items-end space-x-2">
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={chatFileInputRef as React.Ref<HTMLInputElement>}
        onChange={onPickImage}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => chatFileInputRef.current?.click()}
        disabled={sending}
        className="h-10 w-10 rounded-xl bg-surface border border-divider text-accent hover:bg-accent-soft dark:hover:bg-fill-2 transition shadow-xs flex items-center justify-center flex-shrink-0 disabled:opacity-40 active:scale-95"
        title="Buka Kamera & Ambil Foto Langsung"
        aria-label="Kamera"
      >
        <Camera size={18} />
      </button>
      <input
        type="file"
        accept="image/*"
        ref={chatGalleryInputRef as React.Ref<HTMLInputElement>}
        onChange={onPickImage}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => chatGalleryInputRef.current?.click()}
        disabled={sending}
        className="h-10 w-10 rounded-xl bg-surface border border-divider text-accent hover:bg-accent-soft dark:hover:bg-fill-2 transition shadow-xs flex items-center justify-center flex-shrink-0 disabled:opacity-40 active:scale-95"
        title="Pilih Foto / Screenshot dari Galeri"
        aria-label="Galeri"
      >
        <ImageIcon size={18} />
      </button>
      <div className="flex-1 relative">
        <textarea
          ref={replyTextareaRef as React.Ref<HTMLTextAreaElement>}
          rows={1}
          value={replyText}
          onChange={onReplyTextChange}
          placeholder={`Ketik balasan sebagai ~ ${staffName || 'Terapis'}...`}
          disabled={sending}
          style={{ fontSize: '16px' }}
          className="w-full resize-none bg-surface border border-divider focus:border-accent focus:ring-1 focus:ring-accent text-ink rounded-xl px-3.5 py-2 text-[16px] sm:text-sm focus:outline-none placeholder-ink-3 dark:placeholder-ink-3 transition-colors disabled:opacity-50 shadow-xs min-h-[40px] max-h-[130px] leading-relaxed block"
        />
      </div>

      <button
        aria-label="Kirim Pesan"
        type="submit"
        disabled={(!replyText.trim() && !selectedImage) || sending}
        className="h-10 w-10 rounded-xl bg-accent hover:bg-accent-hover text-on-solid font-semibold shadow-xs flex items-center justify-center transition disabled:opacity-40 disabled:hover:bg-accent flex-shrink-0 active:scale-95"
        title="Kirim Pesan"
      >
        {sending ? (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
        ) : (
          <Send size={15} className="ml-0.5 text-white" />
        )}
      </button>
    </div>
  </form>
  </>
);

/**
 * Modal quick live chat untuk satu pasien dari daftar treatment harian.
 *
 * Presentasi murni: pesan, draft balasan, dan pengiriman dipegang halaman induk.
 */
import React from 'react';
import { Camera, Send, X } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { TreatmentTask } from './todayTreatmentsTypes';
import { formatTime } from './todayTreatmentsLogic';
import { useBrandIdentity } from '../../contexts/BrandContext';

interface TodayQuickChatModalProps {
  task: TreatmentTask;
  messages: any[];
  loading: boolean;
  replyText: string;
  selectedImage: { file: File; preview: string } | null;
  sending: boolean;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  chatMessagesEndRef: React.RefObject<HTMLDivElement | null>;
  chatFileInputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onReplyChange: (text: string) => void;
  onImageChange: (image: { file: File; preview: string } | null) => void;
  onSend: (e: React.FormEvent) => void;
}

export const TodayQuickChatModal: React.FC<TodayQuickChatModalProps> = ({
  task,
  messages,
  loading,
  replyText,
  selectedImage,
  sending,
  chatContainerRef,
  chatMessagesEndRef,
  chatFileInputRef,
  onClose,
  onReplyChange,
  onImageChange,
  onSend,
}) => {
  const { businessName } = useBrandIdentity();
  return (
  <Modal
    open
    onClose={() => onClose()}
    size="lg"
    bodyClassName="p-0 overflow-hidden flex-1 flex flex-col min-h-0"
    title={
      <span className="flex items-center gap-2 min-w-0">
        <span className="h-7 w-7 rounded-full bg-accent text-accent-ink flex items-center justify-center font-bold text-[11px] shrink-0">
          {task.customerName?.charAt(0) || 'P'}
        </span>
        <span className="truncate">{task.customerName || 'Pasien'}</span>
      </span>
    }
    subtitle="WhatsApp Pasien"
    headerAction={
      <a
        href="/admin/live-chat"
        target="_blank"
        rel="noopener noreferrer"
        className="px-2.5 py-1 rounded-lg bg-accent-soft text-accent text-xs font-bold transition flex items-center gap-1 border border-divider"
        title="Buka halaman Live Chat lengkap di tab baru"
      >
        <span>Live Chat Penuh</span>
      </a>
    }
  >

        {/* Quick Replies Templates Bar */}
        <div className="p-2 border-b border-divider bg-fill-1 dark:bg-surface flex items-center gap-1.5 overflow-x-auto shrink-0">
          <button
            type="button"
            onClick={() => onReplyChange(`Halo Bunda ${task.customerName || ''}, saya dari ${businessName}. Mau konfirmasi jadwal treatment ya Bun 🙏`)}
            className="px-2.5 py-1 rounded-lg bg-surface border border-divider text-[11px] font-bold text-ink-2 hover:text-accent hover:border-accent transition shrink-0 cursor-pointer"
          >
            Sapa Pasien
          </button>
          <button
            type="button"
            onClick={() => onReplyChange(`Bunda ${task.customerName || ''}, saya sudah meluncur OTW ke lokasi Bunda ya 🛵 Estimasi sampai sekitar 15-20 menit.`)}
            className="px-2.5 py-1 rounded-lg bg-surface border border-divider text-[11px] font-bold text-ink-2 hover:text-accent hover:border-accent transition shrink-0 cursor-pointer"
          >
            Meluncur OTW
          </button>
          <button
            type="button"
            onClick={() => onReplyChange(`Halo Bunda, saya sudah sampai di depan rumah/lokasi Bunda ya 🏠`)}
            className="px-2.5 py-1 rounded-lg bg-surface border border-divider text-[11px] font-bold text-ink-2 hover:text-accent hover:border-accent transition shrink-0 cursor-pointer"
          >
            Sudah Sampai
          </button>
        </div>

        {/* Message History */}
        <div ref={chatContainerRef as React.Ref<HTMLDivElement>} className="flex-1 overflow-y-auto p-4 space-y-2 bg-content/30 dark:bg-app overscroll-contain">
          {loading ? (
            <div className="text-center py-10 text-xs text-ink-2">Memuat riwayat chat...</div>
          ) : messages.length === 0 ? (
            <div className="text-center py-10 text-xs text-ink-3">Belum ada pesan tercatat.</div>
          ) : (
            <>
              {messages.map((m: any) => {
                const isOut = m.direction === 'OUTBOUND';
                return (
                  <div key={m.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-xs shadow-xs ${
                        isOut ? 'bg-bubble-out text-ink rounded-tr-xs' : 'bg-surface text-ink rounded-tl-xs'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <span className="block text-[9px] text-ink-3 text-right mt-1 font-mono">
                        {formatTime(m.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div ref={chatMessagesEndRef as React.Ref<HTMLDivElement>} className="h-0 w-0 pointer-events-none" />
            </>
          )}
        </div>

        {/* Selected Image Attachment Preview */}
        {selectedImage && (
          <div className="p-2 border-t border-divider bg-surface flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2">
              <img src={selectedImage.preview} alt="Lampiran" className="h-10 w-10 object-cover rounded-lg border" />
              <span className="text-xs text-ink-2 font-medium">{selectedImage.file.name}</span>
            </div>
            <button
              type="button"
              onClick={() => onImageChange(null)}
              className="p-1 text-danger hover:text-danger cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Input Reply */}
        <form onSubmit={onSend} className="p-3 border-t border-divider bg-surface flex items-center gap-2 shrink-0">
          <input
            type="file"
            ref={chatFileInputRef as React.Ref<HTMLInputElement>}
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onImageChange({ file, preview: URL.createObjectURL(file) });
              }
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => chatFileInputRef.current?.click()}
            className="p-2 text-ink-2 hover:text-accent hover:bg-fill-1 rounded-xl transition cursor-pointer"
            title="Lampirkan Gambar"
          >
            <Camera size={18} />
          </button>

          <input
            type="text"
            value={replyText}
            onChange={(e) => onReplyChange(e.target.value)}
            placeholder="Ketik pesan balasan ke pasien..."
            className="flex-1 px-3.5 py-2 rounded-xl bg-fill-1 dark:bg-divider border-0 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={sending || (!replyText.trim() && !selectedImage)}
            className="px-4 py-2 bg-accent hover:bg-accent disabled:opacity-50 text-on-solid rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-xs cursor-pointer"
          >
            <Send size={13} aria-hidden="true" />
            <span>Kirim</span>
          </button>
        </form>
  </Modal>
  );
};

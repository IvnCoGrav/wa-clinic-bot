/**
 * Daftar pesan chat staf, keadaan kosong/loading, dan antrean pesan gagal.
 */
import React from 'react';
import { AlertCircle, MessageSquare, RefreshCw } from 'lucide-react';
import { StaffChatBubble } from './StaffChatBubble';
import { ChatMessage } from './staffChatTypes';
import { StaffTask } from './staffTaskTypes';

interface StaffChatThreadProps {
  task: StaffTask;
  messages: ChatMessage[];
  loadingMessages: boolean;
  staffName?: string | null;
  isSupervisor: boolean;
  gatewayCapability?: any;
  revokingId: string | null;
  failedMessages: any[];
  retryingTempId: string | null;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  onScrollToBottom: () => void;
  onStartEdit: (msg: ChatMessage) => void;
  onRevoke: (msg: ChatMessage) => void;
  onRetry: (failed: any) => void;
}

export const StaffChatThread: React.FC<StaffChatThreadProps> = ({
  task,
  messages,
  loadingMessages,
  staffName,
  isSupervisor,
  gatewayCapability,
  revokingId,
  failedMessages,
  retryingTempId,
  chatContainerRef,
  messagesEndRef,
  onScroll,
  onScrollToBottom,
  onStartEdit,
  onRevoke,
  onRetry,
}) => (
  <>
  <div
    ref={chatContainerRef as React.Ref<HTMLDivElement>}
    onScroll={onScroll}
    className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3 bg-content relative"
    style={{
      backgroundImage: 'radial-gradient(rgb(var(--c-strong)) 1px, transparent 1px)',
      backgroundSize: '24px 24px',
      WebkitOverflowScrolling: 'touch',
    }}
  >
    {loadingMessages ? (
      <div className="flex justify-center items-center h-48 space-x-2 text-ink-2 text-xs">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
        <span>Memuat riwayat chat...</span>
      </div>
    ) : messages.length === 0 ? (
      <div className="text-center py-20 text-ink-2 text-xs space-y-2">
        <MessageSquare size={36} className="mx-auto text-ink-3 mb-1" />
        <p className="font-semibold text-ink">Belum ada riwayat pesan</p>
        <p className="text-ink-2">Ketik balasan di bawah untuk mengirim pesan langsung ke WhatsApp pasien.</p>
      </div>
    ) : (
      messages.map((msg, idx) => (
        <StaffChatBubble
          key={msg?.id || `msg-${idx}`}
          msg={msg}
          prevCreatedAt={idx > 0 ? messages[idx - 1]?.created_at ?? null : null}
          customerName={task.customerName}
          staffName={staffName}
          isSupervisor={isSupervisor}
          supportsEdit={gatewayCapability?.supportsEdit ?? true}
          supportsRevoke={!!gatewayCapability?.supportsRevoke}
          revokingId={revokingId}
          onStartEdit={onStartEdit}
          onRevoke={onRevoke}
          onScrollToBottom={() => onScrollToBottom()}
        />
      ))
    )}
    {/* Invisible Anchor for 100% Reliable Auto-Scroll */}
    <div ref={messagesEndRef as React.Ref<HTMLDivElement>} className="h-0 w-0 pointer-events-none" />
  </div>

  {/* Fase 1.2: antrean pesan gagal — tombol "Coba Kirim Lagi" tanpa ketik ulang */}
  {failedMessages.filter((f) => f.conversationId === task.conversationId).length > 0 && (
    <div className="bg-danger-soft border-t border-danger-line px-3 py-2 space-y-1.5 shrink-0">
      {failedMessages
        .filter((f) => f.conversationId === task.conversationId)
        .map((f) => (
          <div key={f.clientTempId} className="flex items-center gap-2 text-[11px] text-danger">
            <AlertCircle size={13} className="flex-shrink-0 text-danger" />
            <span className="flex-1 min-w-0 truncate">
              {f.image && !f.text ? '📷 Foto' : f.text || '(pesan)'}: gagal terkirim
            </span>
            <button
              type="button"
              disabled={retryingTempId === f.clientTempId}
              onClick={() => onRetry(f)}
              className="px-2 py-1 rounded-lg bg-danger hover:bg-danger-hover text-on-solid font-semibold disabled:opacity-50 active:scale-95 flex items-center gap-1 shrink-0"
            >
              {retryingTempId === f.clientTempId ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
              ) : (
                <RefreshCw size={11} />
              )}
              Coba Kirim Lagi
            </button>
          </div>
        ))}
    </div>
  )}
  </>
);

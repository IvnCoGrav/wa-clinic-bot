import React from 'react';
import { Pin, X, Loader2 } from 'lucide-react';

export interface PinnedMessageData {
  id: string;
  wa_message_id?: string | null;
  content: string;
  sender_name?: string | null;
  sender_type?: string | null;
  created_at?: string;
  pinned_by?: string | null;
  pinned_at?: string | null;
}

interface MessagePinBannerProps {
  pinnedMessage: PinnedMessageData | null;
  onJumpToMessage: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
  isUnpinning?: boolean;
}

/**
 * Sticky Banner Sematan Bubble Chat (Pinned Message Banner).
 * Menampilkan cuplikan pesan yang disematkan di percakapan aktif.
 * Mengikuti prinsip modularitas & aesthetic WhatsApp/Clinical Dashboard.
 */
export const MessagePinBanner: React.FC<MessagePinBannerProps> = ({
  pinnedMessage,
  onJumpToMessage,
  onUnpin,
  isUnpinning = false,
}) => {
  if (!pinnedMessage) return null;

  const senderTypeUpper = (pinnedMessage.sender_type || '').toUpperCase();
  const isCustomer = senderTypeUpper === 'CUSTOMER';
  const isAdmin = senderTypeUpper === 'ADMIN' || senderTypeUpper === 'HUMAN' || senderTypeUpper === 'STAFF';
  const senderTitle = isCustomer
    ? (pinnedMessage.sender_name || 'Customer')
    : isAdmin
    ? (pinnedMessage.sender_name || 'Bidan / CS')
    : 'Bot';

  // Bersihkan teks untuk preview satu baris
  const cleanSnippet = (pinnedMessage.content || '')
    .replace(/\n+/g, ' ')
    .trim() || 'Pesan yang disematkan';

  return (
    <div className="sticky top-0 z-20 w-full px-3 py-1.5 bg-gradient-to-r from-emerald-50/95 via-teal-50/95 to-slate-50/95 dark:from-emerald-950/80 dark:via-teal-950/80 dark:to-slate-900/80 backdrop-blur-md border-b border-emerald-200/60 dark:border-emerald-800/60 shadow-xs animate-fadeIn select-none">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-2.5">
        {/* Tombol Klik Banner untuk Direct Jump ke Pesan */}
        <button
          type="button"
          onClick={() => onJumpToMessage(pinnedMessage.id)}
          className="flex-1 flex items-center gap-2.5 min-w-0 text-left group cursor-pointer focus:outline-hidden"
          title="Klik untuk melompat ke pesan yang disematkan ini"
        >
          {/* Badge Icon Pin */}
          <span className="w-6 h-6 rounded-full bg-emerald-600/10 dark:bg-emerald-400/15 text-[#008069] dark:text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
            <Pin size={13} className="fill-current -rotate-45" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10px] leading-tight">
              <span className="font-bold text-[#008069] dark:text-emerald-400 truncate">
                Pesan Disematkan • {senderTitle}
              </span>
              {pinnedMessage.pinned_by && (
                <span className="text-[9px] text-[#667781] dark:text-slate-400 hidden sm:inline">
                  (oleh {pinnedMessage.pinned_by})
                </span>
              )}
            </div>
            <p className="text-[11px] font-medium text-[#111b21] dark:text-slate-200 truncate group-hover:text-[#008069] dark:group-hover:text-emerald-400 transition-colors">
              {cleanSnippet}
            </p>
          </div>
        </button>

        {/* Tombol Lepas Sematan (Unpin) */}
        <button
          type="button"
          disabled={isUnpinning}
          onClick={(e) => {
            e.stopPropagation();
            onUnpin(pinnedMessage.id);
          }}
          className="p-1.5 rounded-full text-[#667781] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
          title="Lepas sematan pesan ini"
        >
          {isUnpinning ? (
            <Loader2 size={14} className="animate-spin text-[#008069]" />
          ) : (
            <X size={14} />
          )}
        </button>
      </div>
    </div>
  );
};

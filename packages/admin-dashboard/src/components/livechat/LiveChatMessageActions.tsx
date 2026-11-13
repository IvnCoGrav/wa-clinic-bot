/**
 * Tombol aksi di bawah gelembung Live Chat: salin, reaksi, balas, edit, tarik,
 * sematkan, dan sembunyikan. Presentasi murni dengan callback dari halaman.
 */
import React from 'react';
import { Copy, EyeOff, PenLine, Pin, Reply, Smile, Trash2 } from 'lucide-react';

interface LiveChatMessageActionsProps {
  isRevoked: boolean;
  isInternalNote: boolean;
  activeReactionMsgId: string | null;
  myReaction?: { emoji: string };
  canEdit: boolean;
  canRevoke: boolean;
  isMessagePinned: boolean;
  isMessageHidden: boolean;
  revokingId: string | null;
  isPinningMessageId: string | null;
  isHidingMessageId: string | null;
  messageId: string;
  onCopy: () => void;
  onToggleReactionBar: () => void;
  onReply: () => void;
  onEdit: () => void;
  onRevoke: () => void;
  onTogglePin: (nextPinned: boolean) => void;
  onToggleHide: (nextHidden: boolean) => void;
}

export const LiveChatMessageActions: React.FC<LiveChatMessageActionsProps> = ({
  isRevoked,
  isInternalNote,
  activeReactionMsgId,
  myReaction,
  canEdit,
  canRevoke,
  isMessagePinned,
  isMessageHidden,
  revokingId,
  isPinningMessageId,
  isHidingMessageId,
  messageId,
  onCopy,
  onToggleReactionBar,
  onReply,
  onEdit,
  onRevoke,
  onTogglePin,
  onToggleHide,
}) => (
  <>
    {!isRevoked && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCopy();
        }}
        className="ml-0.5 p-0.5 rounded text-ink-3 hover:text-accent hover:bg-accent-soft transition active:scale-90"
        title="Salin seluruh teks pesan"
      >
        <Copy size={11} />
      </button>
    )}
    {!isRevoked && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleReactionBar();
        }}
        className={`ml-0.5 p-0.5 rounded transition active:scale-90 ${
          activeReactionMsgId === messageId || myReaction
            ? 'text-accent bg-accent-soft'
            : 'text-ink-3 hover:text-accent hover:bg-accent-soft'
        }`}
        title={myReaction ? `Reaksi Anda: ${myReaction.emoji} (klik untuk ubah/batal)` : 'Beri reaksi emotikon'}
      >
        <Smile size={11} />
      </button>
    )}
    {!isRevoked && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onReply();
        }}
        className="ml-0.5 p-0.5 rounded text-ink-3 hover:text-accent hover:bg-accent-soft transition active:scale-90"
        title="Balas pesan ini"
      >
        <Reply size={11} />
      </button>
    )}
    {canEdit && (
      <button
        type="button"
        onClick={() => onEdit()}
        className="ml-0.5 p-0.5 rounded text-ink-3 hover:text-accent hover:bg-accent-soft transition active:scale-90"
        title="Edit pesan (maksimal 15 menit)"
      >
        <PenLine size={11} />
      </button>
    )}
    {canRevoke && (
      <button
        type="button"
        disabled={revokingId === messageId}
        onClick={() => onRevoke()}
        className="ml-0.5 p-0.5 rounded text-ink-3 hover:text-danger hover:bg-danger-soft transition active:scale-90"
        title="Tarik / Hapus pesan untuk semua orang (Delete for Everyone)"
      >
        {revokingId === messageId ? (
          <div className="h-2.5 w-2.5 animate-spin rounded-full border border-danger border-t-transparent" />
        ) : (
          <Trash2 size={11} />
        )}
      </button>
    )}
    {!isRevoked && (
      <button
        type="button"
        disabled={isPinningMessageId === messageId}
        onClick={() => onTogglePin(!isMessagePinned)}
        className={`ml-0.5 p-0.5 rounded transition active:scale-90 ${
          isMessagePinned
            ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 font-bold'
            : 'text-ink-3 hover:text-warning hover:bg-warning-soft'
        }`}
        title={isMessagePinned ? 'Lepas sematan pesan (Unpin)' : 'Sematkan pesan ini (Pin ke atas)'}
      >
        {isPinningMessageId === messageId ? (
          <div className="h-2.5 w-2.5 animate-spin rounded-full border border-warning border-t-transparent" />
        ) : (
          <Pin size={11} className={isMessagePinned ? 'fill-warning text-warning' : ''} />
        )}
      </button>
    )}
    {!isRevoked && !isInternalNote && (
      <button
        type="button"
        disabled={isHidingMessageId === messageId}
        onClick={() => onToggleHide(!isMessageHidden)}
        className={`ml-0.5 p-0.5 rounded transition active:scale-90 ${
          isMessageHidden
            ? 'text-ink-2 bg-fill-1 hover:bg-fill-2'
            : 'text-ink-3 hover:text-ink hover:bg-fill-2'
        }`}
        title={isMessageHidden ? 'Tampilkan kembali pesan ini (Unhide)' : 'Sembunyikan bubble ini di dashboard (Hide internal)'}
      >
        {isHidingMessageId === messageId ? (
          <div className="h-2.5 w-2.5 animate-spin rounded-full border border-strong border-t-transparent" />
        ) : (
          <EyeOff size={11} />
        )}
      </button>
    )}
  </>
);

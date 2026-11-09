import React, { useState } from 'react';
import { apiRequest } from '../services/api';
import { useUiFeedback } from '../components/common/UiFeedback';
import { useAuth } from '../contexts/AuthContext';
import { saveConversationDraft } from './useLiveChatDrafts';
import type { LiveChatItem, ChatMessage } from '../types/livechat';
import type { LiveChatComposerHandle } from '../components/livechat/LiveChatComposer';

export interface UseLiveChatMessageOperationsParams {
  selectedChat: LiveChatItem | null | undefined;
  selectedId: string | null;
  selectedIdRef: React.MutableRefObject<string | null>;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  chatsRef: React.MutableRefObject<LiveChatItem[]>;
  setChats: React.Dispatch<React.SetStateAction<LiveChatItem[]>>;
  refreshChatItem: (conversationId: string) => Promise<void>;
  composerRef: React.RefObject<LiveChatComposerHandle>;
  replyTextRef: React.MutableRefObject<string>;
  setHasReplyText: React.Dispatch<React.SetStateAction<boolean>>;
  scrollToMessage: (msgId: string, smooth?: boolean) => void;
  loadThread: (conversationId: string, focusId?: string) => Promise<void>;
  setPinnedBubble?: React.Dispatch<React.SetStateAction<any>>;
}

export function useLiveChatMessageOperations({
  selectedChat,
  selectedId,
  selectedIdRef,
  messages,
  setMessages,
  chatsRef,
  setChats,
  refreshChatItem,
  composerRef,
  replyTextRef,
  setHasReplyText,
  scrollToMessage,
  loadThread,
  setPinnedBubble,
}: UseLiveChatMessageOperationsParams) {
  const { user } = useAuth();
  const { toast, confirm } = useUiFeedback();

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [editingMsg, setEditingMsg] = useState<{ id: string; content: string } | null>(null);
  const [isEditingSaving, setIsEditingSaving] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isPinningMessageId, setIsPinningMessageId] = useState<string | null>(null);
  const [isHidingMessageId, setIsHidingMessageId] = useState<string | null>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [generatingDraft, setGeneratingDraft] = useState(false);

  const handleRevokeMessage = async (msg: ChatMessage) => {
    if (!selectedChat?.conversationId || revokingId) return;

    const confirmed = await confirm({
      title: 'Tarik Pesan WhatsApp',
      message: `Tarik / Hapus pesan ini untuk semua orang di WhatsApp?\n\n"${msg.content}"`,
      confirmText: 'Tarik Pesan',
      cancelText: 'Batal',
      danger: true,
    });

    if (!confirmed) return;

    setRevokingId(msg.id);
    try {
      const res = await apiRequest(
        `/api/admin/conversations/${selectedChat.conversationId}/messages/${msg.id}`,
        { method: 'DELETE' }
      );

      if (res?.success) {
        toast('Pesan berhasil ditarik dari WhatsApp!', 'success');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id ? { ...m, content: '🚫 Pesan ini telah ditarik', is_revoked: true } : m
          )
        );
      } else {
        toast(`Gagal menarik pesan: ${res?.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal menarik pesan: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setRevokingId(null);
    }
  };

  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMsg({ id: msg.id, content: msg.content });
    setEditContent(msg.content);
  };

  const handleSaveEdit = async () => {
    if (!editingMsg || !selectedChat?.conversationId || isEditingSaving) return;
    if (!editContent.trim()) {
      toast('Teks pesan tidak boleh kosong.', 'error');
      return;
    }

    setIsEditingSaving(true);
    try {
      const res = await apiRequest(
        `/api/admin/conversations/${selectedChat.conversationId}/messages/${editingMsg.id}/edit`,
        {
          method: 'PUT',
          body: JSON.stringify({ text: editContent.trim() }),
        }
      );

      if (res?.success) {
        toast('Pesan berhasil diperbarui di WhatsApp!', 'success');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === editingMsg.id
              ? { ...m, content: editContent.trim(), is_edited: true }
              : m
          )
        );
        setEditingMsg(null);
      } else {
        toast(`Gagal mengedit pesan: ${res?.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal mengedit pesan: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setIsEditingSaving(false);
    }
  };

  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(null);
  const [customEmojiMsgId, setCustomEmojiMsgId] = useState<string | null>(null);

  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  const EXTRA_REACTIONS = ['🔥', '👏', '🎉', '💯', '✨', '🤝', '🌸', '💐', '👶', '🍼', '🤱', '💪'];

  /**
   * Salin teks dengan fallback aman: Clipboard API bisa ditolak di luar user-gesture
   * (mis. setelah setTimeout hold), jadi fallback ke execCommand('copy') legacy.
   */
  const copyTextWithFallback = async (text: string): Promise<boolean> => {
    if (!text) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // jatuh ke fallback di bawah
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  };

  const handleCopyMessageText = async (content: string) => {
    const ok = await copyTextWithFallback(content);
    toast(ok ? '📋 Teks pesan berhasil disalin!' : 'Gagal menyalin teks pesan.', ok ? 'success' : 'error');
  };

  const handleToggleReaction = async (msg: ChatMessage, emoji: string) => {
    if (!selectedChat?.conversationId || !msg) return;
    setActiveReactionMsgId(null);
    setCustomEmojiMsgId(null);

    const targetMsgId = msg.id || msg.wa_message_id;
    const currentReactions: Array<{ emoji: string; fromMe: boolean; senderName?: string; actorId?: string }> =
      (msg as any).reactions || (msg as any).payload_raw?.reactions || [];
    const myReaction = currentReactions.find((r) => r.fromMe);
    const newEmoji = myReaction && myReaction.emoji === emoji ? '' : emoji;

    // Optimistic UI update
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msg.id || (msg.wa_message_id && m.wa_message_id === msg.wa_message_id)) {
          let updatedReactions = (
            (m as any).reactions || (m as any).payload_raw?.reactions || []
          ).filter((r: any) => !r.fromMe);

          if (newEmoji) {
            updatedReactions.push({
              emoji: newEmoji,
              fromMe: true,
              senderName: (user as any)?.name || 'Admin',
              createdAt: new Date().toISOString(),
            });
          }
          return {
            ...m,
            reactions: updatedReactions,
            payload_raw: {
              ...(typeof (m as any).payload_raw === 'object' && (m as any).payload_raw ? (m as any).payload_raw : {}),
              reactions: updatedReactions,
            },
          };
        }
        return m;
      })
    );

    try {
      const res = await apiRequest(
        `/api/admin/live-chat/conversations/${selectedChat.conversationId}/messages/${targetMsgId}/reaction`,
        {
          method: 'POST',
          body: JSON.stringify({ emoji: newEmoji }),
        }
      );

      if (res?.success) {
        if (res.reactions) {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === msg.id || (msg.wa_message_id && m.wa_message_id === msg.wa_message_id)) {
                return {
                  ...m,
                  reactions: res.reactions,
                  payload_raw: {
                    ...(typeof (m as any).payload_raw === 'object' && (m as any).payload_raw ? (m as any).payload_raw : {}),
                    reactions: res.reactions,
                  },
                };
              }
              return m;
            })
          );
        }
      } else {
        toast(`Gagal mengirim reaksi: ${res?.error || 'Terjadi kesalahan'}`, 'error');
        // Rollback: muat ulang dari server agar emoji optimistis tidak "nyangkut".
        void loadThread(selectedChat.conversationId);
      }
    } catch (err: any) {
      toast(`Gagal mengirim reaksi: ${err.message || 'Terjadi kesalahan'}`, 'error');
      void loadThread(selectedChat.conversationId);
    }
  };

  const handleToggleMessagePin = async (msg: ChatMessage, explicitPinned?: boolean) => {
    if (!selectedChat?.conversationId || isPinningMessageId) return;
    const nextPinned = explicitPinned !== undefined
      ? explicitPinned
      : !(msg.is_message_pinned || (msg as any).payload_raw?.is_pinned);
    setIsPinningMessageId(msg.id);

    // Optimistic update
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msg.id
          ? {
              ...m,
              is_message_pinned: nextPinned,
              payload_raw: {
                ...((m as any).payload_raw || {}),
                is_pinned: nextPinned,
              },
            }
          : nextPinned
          ? {
              ...m,
              is_message_pinned: false,
              payload_raw: {
                ...((m as any).payload_raw || {}),
                is_pinned: false,
              },
            }
          : m
      )
    );

    if (nextPinned) {
      setPinnedBubble?.({
        id: msg.id,
        wa_message_id: msg.wa_message_id,
        content: msg.content,
        sender_name: msg.sender_name,
        sender_type: msg.sender_type,
        created_at: msg.created_at,
      });
    } else {
      setPinnedBubble?.((cur: any) => (cur?.id === msg.id ? null : cur));
    }

    try {
      const res = await apiRequest(
        `/api/admin/live-chat/conversations/${selectedChat.conversationId}/messages/${msg.id}/pin`,
        {
          method: 'PATCH',
          body: JSON.stringify({ isPinned: nextPinned }),
        }
      );
      if (res?.success) {
        toast(nextPinned ? 'Pesan berhasil disematkan.' : 'Sematan pesan dilepas.', 'success');
      } else {
        toast(`Gagal mengubah sematan: ${res?.error || 'Terjadi kesalahan'}`, 'error');
        void loadThread(selectedChat.conversationId);
      }
    } catch (err: any) {
      toast(`Gagal mengubah sematan: ${err.message || 'Terjadi kesalahan'}`, 'error');
      void loadThread(selectedChat.conversationId);
    } finally {
      setIsPinningMessageId(null);
    }
  };

  const handleToggleMessageHide = async (msg: ChatMessage, explicitHidden?: boolean) => {
    if (!selectedChat?.conversationId || isHidingMessageId) return;
    const nextHidden = explicitHidden !== undefined
      ? explicitHidden
      : !(msg.is_message_hidden || (msg as any).payload_raw?.is_hidden);
    setIsHidingMessageId(msg.id);

    // Optimistic update
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msg.id
          ? {
              ...m,
              is_message_hidden: nextHidden,
              payload_raw: {
                ...((m as any).payload_raw || {}),
                is_hidden: nextHidden,
              },
            }
          : m
      )
    );

    try {
      const res = await apiRequest(
        `/api/admin/live-chat/conversations/${selectedChat.conversationId}/messages/${msg.id}/hide`,
        {
          method: 'PATCH',
          body: JSON.stringify({ isHidden: nextHidden }),
        }
      );
      if (res?.success) {
        toast(nextHidden ? 'Pesan disembunyikan dari dashboard.' : 'Pesan ditampilkan kembali.', 'success');
      } else {
        toast(`Gagal menyembunyikan pesan: ${res?.error || 'Terjadi kesalahan'}`, 'error');
        void loadThread(selectedChat.conversationId);
      }
    } catch (err: any) {
      toast(`Gagal menyembunyikan pesan: ${err.message || 'Terjadi kesalahan'}`, 'error');
      void loadThread(selectedChat.conversationId);
    } finally {
      setIsHidingMessageId(null);
    }
  };

  const handleJumpToPinnedMessage = (msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-3', 'ring-accent', 'bg-success-soft/50');
      setTimeout(() => el.classList.remove('ring-3', 'ring-accent', 'bg-success-soft/50'), 2000);
    } else if (selectedChat?.conversationId) {
      // Belum termuat di paginasi saat ini: trigger focusMessageId
      void loadThread(selectedChat.conversationId, msgId);
    }
  };

  const handleRelease = async (chat: LiveChatItem) => {
    const isMedical = chat.escalationReason === 'medical_concern';

    const isConfirmed = await confirm({
      title: 'Kembalikan ke Bot?',
      message: isMedical
        ? 'Percakapan ini ditandai sebagai eskalasi medis. Bot AI tidak memiliki auto-release waktu untuk kasus medis demi keselamatan. Apakah Anda benar-benar yakin ingin mengembalikan chat ini ke respon otomatis AI Bot?'
        : 'Apakah Anda yakin ingin mengembalikan percakapan ini ke bot otomatis? Bot akan mulai merespon chat berikutnya secara mandiri.',
      confirmText: 'Ya, Kembalikan',
      danger: isMedical,
    });
    if (!isConfirmed) return;

    setReleasingId(chat.conversationId);
    try {
      await apiRequest(`/api/admin/conversation/${chat.conversationId}/release`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });

      // Optimistic in-place update: chat tetap terbuka dan badge langsung beralih ke Bot secara mulus
      setChats((prev) =>
        prev.map((c) =>
          c.conversationId === chat.conversationId
            ? { ...c, isHumanHandling: false, escalationReason: null, status: 'active', lastHandledBy: 'bot' }
            : c
        )
      );
      chatsRef.current = chatsRef.current.map((c) =>
        c.conversationId === chat.conversationId
          ? { ...c, isHumanHandling: false, escalationReason: null, status: 'active', lastHandledBy: 'bot' }
          : c
      );

      // Sinkronisasi data server satu item (tanpa menggeser offset paginasi sidebar)
      void refreshChatItem(chat.conversationId);
      toast('Percakapan berhasil dikembalikan ke bot.', 'success');
    } catch (err: any) {
      toast(`Gagal merilis percakapan ke bot: ${err.message}`, 'error');
    } finally {
      setReleasingId(null);
    }
  };

  const handleTakeover = async (chat: LiveChatItem) => {
    const isConfirmed = await confirm({
      title: 'Ambil Alih Percakapan (CS)?',
      message: `Apakah Anda yakin ingin mengambil alih percakapan dengan ${chat.customerName || chat.customerPhone || 'pelanggan'}? Bot AI akan berhenti merespon secara otomatis agar Anda dapat melayani secara manual.`,
      confirmText: 'Ya, Ambil Alih',
    });
    if (!isConfirmed) return;

    setReleasingId(chat.conversationId);
    try {
      await apiRequest(`/api/admin/conversation/${chat.conversationId}/takeover`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });

      // Optimistic in-place update
      setChats((prev) =>
        prev.map((c) =>
          c.conversationId === chat.conversationId
            ? { ...c, isHumanHandling: true, escalationReason: 'manual_takeover', lastHandledBy: 'human' }
            : c
        )
      );
      chatsRef.current = chatsRef.current.map((c) =>
        c.conversationId === chat.conversationId
          ? { ...c, isHumanHandling: true, escalationReason: 'manual_takeover', lastHandledBy: 'human' }
          : c
      );

      void refreshChatItem(chat.conversationId);
      toast('Percakapan berhasil diambil alih oleh admin (CS).', 'success');
    } catch (err: any) {
      toast(`Gagal mengambil alih percakapan: ${err.message || err}`, 'error');
    } finally {
      setReleasingId(null);
    }
  };

  const handleGenerateAiDraft = async () => {
    if (!selectedId) return;
    setGeneratingDraft(true);
    try {
      const res = await apiRequest(`/api/admin/live-chat/conversations/${selectedId}/suggest-reply`, {
        method: 'POST',
      });
      if (res?.data?.draftText) {
        replyTextRef.current = res.data.draftText;
        setHasReplyText(true);
        composerRef.current?.setText(res.data.draftText);
        if (selectedId) {
          saveConversationDraft(selectedId, res.data.draftText);
        }
        toast('Draf jawaban AI berhasil dibuat! Anda dapat mengedit sebelum mengirim.', 'success');
      } else {
        toast('Gagal mendapatkan saran balasan AI.', 'error');
      }
    } catch (err: any) {
      toast(`Gagal memuat saran AI: ${err.message}`, 'error');
    } finally {
      setGeneratingDraft(false);
    }
  };


  return {
    revokingId,
    editingMsg,
    setEditingMsg,
    isEditingSaving,
    editContent,
    setEditContent,
    isPinningMessageId,
    setIsPinningMessageId,
    isHidingMessageId,
    releasingId,
    generatingDraft,
    handleRevokeMessage,
    handleStartEdit,
    handleSaveEdit,
    handleCopyMessageText,
    handleToggleReaction,
    handleToggleMessagePin,
    handleToggleMessageHide,
    handleJumpToPinnedMessage,
    handleRelease,
    handleTakeover,
    handleGenerateAiDraft,
  };
}

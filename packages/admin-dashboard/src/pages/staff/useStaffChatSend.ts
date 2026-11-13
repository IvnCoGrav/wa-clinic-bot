/**
 * State dan aksi composer chat staf: teks balasan, lampiran gambar, kirim
 * optimistis, dan pencatatan pesan gagal ke outbox.
 */
import { useState } from 'react';
import { apiRequest } from '../../services/api';
import { prepareChatImage } from '../../utils/imageCompressor';
import { ChatMessage } from './staffChatTypes';
import { StaffTask } from './staffTaskTypes';
import { FailedOutboxItem } from './useStaffFailedOutbox';

export interface SelectedChatImage {
  file: File;
  preview: string;
  dataUrl: string;
  mimeType: string;
  fileName: string;
}

interface Args {
  selectedTask: StaffTask | null;
  staffName?: string | null;
  isOnline: boolean;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setErrorMessage: (message: string | null) => void;
  setFailedMessages: React.Dispatch<React.SetStateAction<FailedOutboxItem[]>>;
  persistFailedMessages: (list: Array<unknown>) => void;
  replyTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  chatFileInputRef: React.RefObject<HTMLInputElement | null>;
  chatGalleryInputRef: React.RefObject<HTMLInputElement | null>;
  isNearBottomRef: React.MutableRefObject<boolean>;
  scrollToBottom: (force?: boolean) => void;
  toast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function useStaffChatSend({
  selectedTask,
  staffName,
  isOnline,
  setMessages,
  setErrorMessage,
  setFailedMessages,
  persistFailedMessages,
  replyTextareaRef,
  chatFileInputRef,
  chatGalleryInputRef,
  isNearBottomRef,
  scrollToBottom,
  toast,
}: Args) {
  const [replyText, setReplyText] = useState('');
  const [selectedImage, setSelectedImage] = useState<SelectedChatImage | null>(null);
  const [sending, setSending] = useState(false);

  const handleReplyTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyText(e.target.value);
    if (replyTextareaRef.current) {
      replyTextareaRef.current.style.height = 'auto';
      replyTextareaRef.current.style.height = `${Math.min(replyTextareaRef.current.scrollHeight, 130)}px`;
    }
  };

  const handlePickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const prepared = await prepareChatImage(file, 'field');
      if (selectedImage?.preview && selectedImage.preview.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(selectedImage.preview);
        } catch {
          /* pratinjau lama sudah dilepas */
        }
      }
      setSelectedImage({
        file,
        preview: prepared.preview,
        dataUrl: prepared.dataUrl,
        mimeType: prepared.mimeType,
        fileName: prepared.fileName,
      });
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal memproses foto.');
    } finally {
      if (chatFileInputRef.current) chatFileInputRef.current.value = '';
      if (chatGalleryInputRef.current) chatGalleryInputRef.current.value = '';
      e.target.value = '';
    }
  };

  const queueFailedMessage = (
    clientTempId: string,
    conversationId: string,
    text: string,
    image: SelectedChatImage | null,
    error: string
  ) => {
    setErrorMessage(error);
    toast(error, 'error');
    setMessages((prev) =>
      prev.map((m) => (m.id === clientTempId ? { ...m, delivery_status: 'failed' as const } : m))
    );
    setFailedMessages((prev) => {
      const next = [
        ...prev.filter((f) => f.clientTempId !== clientTempId),
        {
          clientTempId,
          conversationId,
          text,
          image: image
            ? { preview: image.preview, dataUrl: image.dataUrl, mimeType: image.mimeType, fileName: image.fileName }
            : null,
          createdAt: new Date().toISOString(),
          error,
        },
      ];
      persistFailedMessages(next);
      return next;
    });
  };

  const handleSendReply = async (e?: React.FormEvent | React.KeyboardEvent | React.SyntheticEvent) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const image = selectedImage;
    const textToSend = replyText.trim();
    if ((!textToSend && !image) || !selectedTask?.conversationId || sending) return;

    if (!isOnline) {
      setErrorMessage('Koneksi internet terputus. Pesan tidak terkirim, coba lagi setelah sinyal kembali.');
      return;
    }

    const signature = `~ ${staffName || 'Bidan Terapis'}`;
    const hasText = !!textToSend;
    const optimisticContent = hasText
      ? textToSend.endsWith(signature)
        ? textToSend
        : `${textToSend}\n\n${signature}`
      : '[IMAGE]';

    setSending(true);
    setErrorMessage(null);

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const conversationId = selectedTask.conversationId;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      direction: 'OUTBOUND',
      content: optimisticContent,
      media: image ? { url: image.preview, hdUrl: image.preview } : undefined,
      sender_type: 'STAFF',
      sender_name: staffName || 'Staff',
      created_at: new Date().toISOString(),
      delivery_status: 'sent',
    };

    setMessages((prev) => [...prev, optimisticMsg].slice(-30));
    setReplyText('');
    setSelectedImage(null);
    if (replyTextareaRef.current) replyTextareaRef.current.style.height = 'auto';
    isNearBottomRef.current = true;
    scrollToBottom(true);

    try {
      const body: Record<string, any> = { text: hasText ? textToSend : '', clientTempId: tempId };
      if (image) {
        body.imageB64 = image.dataUrl;
        body.mimeType = image.mimeType;
        body.fileName = image.fileName;
      }
      const res = await apiRequest(`/api/staff/conversations/${conversationId}/reply`, {
        method: 'POST',
        body: JSON.stringify(body),
        timeoutMs: 45000,
      });

      if (res.success) {
        const assignedId = res.data?.messageId || res.data?.id;
        if (assignedId) {
          setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: assignedId } : m)));
        }
        setFailedMessages((prev) => prev.filter((f) => f.clientTempId !== tempId));
      } else {
        const errorMsg = res.error || 'Gagal mengirim pesan balasan.';
        queueFailedMessage(tempId, conversationId, textToSend, image, errorMsg);
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Gagal mengirim pesan balasan. Harap periksa koneksi WhatsApp.';
      queueFailedMessage(tempId, conversationId, textToSend, image, errorMsg);
    } finally {
      setSending(false);
    }
  };

  return {
    replyText,
    setReplyText,
    selectedImage,
    setSelectedImage,
    sending,
    handleReplyTextChange,
    handlePickImage,
    handleSendReply,
  };
}

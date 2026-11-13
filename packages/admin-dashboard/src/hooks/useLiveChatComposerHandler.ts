// Catatan kontrak error: catch kosong di hook ini menangani penyimpanan draf
// lokal, clipboard, dan audio — semuanya pelengkap. Gagal menyimpan draf tidak
// menghentikan pengiriman pesan; pengiriman itu sendiri tetap memberi toast.
import React, { useState, useEffect, useCallback, startTransition } from 'react';
import { apiRequest } from '../services/api';
import { BRAND } from '../config/brand';
import { prepareChatImage } from '../utils/imageCompressor';
import { validateInvoiceReadiness } from '../utils/invoiceReadiness';
import {
  ExtractedScheduleData,
  formatIndonesianDate,
  cleanBundaName,
} from '../utils/chatScheduleExtractor';
import { saveConversationDraft, clearConversationDraft } from './useLiveChatDrafts';
import type { ChatMessage, LiveChatItem } from '../types/livechat';
import type { LiveChatComposerHandle } from '../components/livechat/LiveChatComposer';

export interface SelectedChatImage {
  file?: File;
  preview: string;
  dataUrl?: string;
  mimeType: string;
  fileName: string;
  mediaUrl?: string;
  origin?: 'upload' | 'quick-reply';
}

export interface QuickReplyItem {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category: string | null;
  media_type?: string | null;
  image_url?: string | null;
  mime_type?: string | null;
}

export function selectQuickReplyReservation(reservations: any[]): any {
  if (!Array.isArray(reservations) || reservations.length === 0) return null;
  const now = Date.now();
  const valid = reservations.filter((r) => r && r.booking_date);
  if (valid.length === 0) return null;

  // Prioritas 1: Jadwal mendatang terdekat
  const upcoming = valid
    .filter((r) => new Date(r.booking_date).getTime() >= now - 3600000)
    .sort((a, b) => new Date(a.booking_date).getTime() - new Date(b.booking_date).getTime());
  if (upcoming.length > 0) return upcoming[0];

  // Prioritas 2: Jadwal terakhir yang baru lewat
  return valid.sort((a, b) => new Date(b.booking_date).getTime() - new Date(a.booking_date).getTime())[0];
}

export interface UseLiveChatComposerHandlerParams {
  selectedId: string | null;
  selectedIdRef: React.MutableRefObject<string | null>;
  selectedChat: LiveChatItem | null | undefined;
  user: any;
  customerDetailData: any;
  clinicBrandName: string;
  clinicServices: any[];
  setClinicServices: React.Dispatch<React.SetStateAction<any[]>>;
  replyingTo: ChatMessage | null;
  setReplyingTo: (msg: ChatMessage | null) => void;
  composerRef: React.RefObject<LiveChatComposerHandle | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  replyTextRef: React.MutableRefObject<string>;
  setHasReplyText: (val: boolean) => void;
  dispatchOriginRef: React.MutableRefObject<boolean>;
  setDispatchDrawerOpen: (open: boolean) => void;
  setInvoiceModalData: (data: ExtractedScheduleData | null) => void;
  setShowInvoiceModal: (open: boolean) => void;
  pushModalHistory: (key: string) => void;
  setAddrBookCustomer: (cust: any) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setChats: React.Dispatch<React.SetStateAction<LiveChatItem[]>>;
  chatsRef: React.MutableRefObject<LiveChatItem[]>;
  optimisticMessageIdsRef: React.MutableRefObject<Set<string>>;
  sortChats: (items: LiveChatItem[]) => LiveChatItem[];
  scrollToBottom: (smooth?: boolean, force?: boolean) => void;
  notifyTyping: (isTyping: boolean) => void;
  loadThread: (convId: string) => Promise<any>;
  refreshChatItem: (convId: string) => Promise<any>;
  activeConfirmedReservation: any;
  activePendingReservation: any;
  handleOpenQuickReservation: () => void;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function useLiveChatComposerHandler({
  selectedId,
  selectedIdRef,
  selectedChat,
  user,
  customerDetailData,
  clinicBrandName,
  clinicServices,
  setClinicServices,
  replyingTo,
  setReplyingTo,
  composerRef,
  fileInputRef,
  replyTextRef,
  setHasReplyText,
  dispatchOriginRef,
  setDispatchDrawerOpen,
  setInvoiceModalData,
  setShowInvoiceModal,
  pushModalHistory,
  setAddrBookCustomer,
  setMessages,
  setChats,
  chatsRef,
  optimisticMessageIdsRef,
  sortChats,
  scrollToBottom,
  notifyTyping,
  loadThread,
  refreshChatItem,
  activeConfirmedReservation,
  activePendingReservation,
  handleOpenQuickReservation,
  toast,
}: UseLiveChatComposerHandlerParams) {
  const [selectedImage, setSelectedImage] = useState<SelectedChatImage | null>(null);
  const [sending, setSending] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReplyItem[]>([]);

  useEffect(() => {
    apiRequest('/api/admin/quick-replies')
      .then((res: any) => {
        if (res?.success && Array.isArray(res.data)) setQuickReplies(res.data);
        else if (Array.isArray(res)) setQuickReplies(res);
      })
      .catch(() => {});
  }, []);

  const interpolateQuickReplyContent = useCallback((content: string): string => {
    const rawName = customerDetailData?.name || selectedChat?.customerName || '';
    const cleaned = cleanBundaName(rawName);
    const hasValidName = Boolean(cleaned && cleaned.trim() !== '-');
    const name = hasValidName ? cleaned.trim() : '';
    const phone = customerDetailData?.phone || selectedChat?.customerPhone || '-';
    const kec = customerDetailData?.kecamatan || selectedChat?.kecamatan || '';
    const kota = customerDetailData?.kota || selectedChat?.kota || '';
    const alamat = customerDetailData?.address || customerDetailData?.kelurahan || selectedChat?.kelurahan || '';
    const clinicName = clinicBrandName || BRAND.businessName;
    const adminName = (user as any)?.name || (user as any)?.email || 'Admin';

    const children = (customerDetailData?.children || (selectedChat as any)?.children || []) as any[];
    const firstChild = Array.isArray(children) && children.length > 0 ? children[0] : null;
    const childName = firstChild?.name || (selectedChat as any)?.child_name || 'si Kecil';
    const childAge = firstChild?.current_age || firstChild?.raw_age_text || firstChild?.age || firstChild?.ageText || '';

    const resList = (customerDetailData?.reservations || []) as any[];
    const snapshotReservations = [
      (selectedChat as any)?.activeConfirmedReservation,
      (selectedChat as any)?.activeHoldReservation,
      (selectedChat as any)?.activePendingReservation,
    ].filter(Boolean);
    const activeRes = selectQuickReplyReservation([...resList, ...snapshotReservations]);
    const treatmentName = activeRes?.treatment_detail || activeRes?.treatment_name || '';
    let tanggal = '';
    let jam = '';
    if (activeRes?.booking_date) {
      const bd = new Date(activeRes.booking_date);
      if (!isNaN(bd.getTime())) {
        tanggal = bd.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
        jam = bd.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).replace(':', '.');
      }
    }

    let interpolated = content;
    if (hasValidName) {
      interpolated = interpolated.replace(/\{(?:name|nama|nama_bunda)\}/gi, name);
    } else {
      interpolated = interpolated.replace(/(?:bunda\s+)?\{(?:name|nama|nama_bunda)\}/gi, 'Bunda');
    }

    return interpolated
      .replace(/\{(?:phone|hp|no_hp)\}/gi, phone)
      .replace(/\{(?:kec|kecamatan)\}/gi, kec)
      .replace(/\{kota\}/gi, kota)
      .replace(/\{(?:alamat|address)\}/gi, alamat)
      .replace(/\{clinic_name\}/gi, clinicName)
      .replace(/\{admin_name\}/gi, adminName)
      .replace(/\{(?:nama_anak|child_name|nama_bayi)\}/gi, childName || 'si Kecil')
      .replace(/\{(?:usia_anak|usia_bayi|child_age|usia)\}/gi, childAge)
      .replace(/\{(?:layanan|treatment|treatment_name)\}/gi, treatmentName)
      .replace(/\{tanggal\}/gi, tanggal)
      .replace(/\{jam\}/gi, jam);
  }, [
    clinicBrandName,
    selectedChat?.customerName,
    selectedChat?.customerPhone,
    selectedChat?.kecamatan,
    selectedChat?.kota,
    selectedChat?.kelurahan,
    customerDetailData?.name,
    customerDetailData?.phone,
    customerDetailData?.kecamatan,
    customerDetailData?.kota,
    customerDetailData?.address,
    customerDetailData?.kelurahan,
    customerDetailData?.children,
    customerDetailData?.reservations,
    user,
  ]);

  const applyQuickReply = useCallback((qr: {
    content: string;
    resolved_content?: string | null;
    media_type?: string | null;
    image_url?: string | null;
    mime_type?: string | null;
  }) => {
    const rawTemplate = qr.resolved_content || qr.content;
    const interpolated = interpolateQuickReplyContent(rawTemplate);
    replyTextRef.current = interpolated;
    setHasReplyText(true);
    if (selectedIdRef.current) {
      saveConversationDraft(selectedIdRef.current, interpolated);
    }
    if (qr.image_url) {
      setSelectedImage({
        preview: qr.image_url,
        mediaUrl: qr.image_url,
        mimeType: qr.mime_type || 'image/jpeg',
        fileName: qr.media_type === 'QRIS' ? 'qris-klinik' : qr.media_type === 'PRICELIST' ? 'pricelist-klinik' : 'lampiran-quick-chat',
        origin: 'quick-reply',
      });
    } else {
      setSelectedImage((prev) => (prev?.origin === 'quick-reply' ? null : prev));
    }
    return interpolated;
  }, [interpolateQuickReplyContent, replyTextRef, setHasReplyText, selectedIdRef]);

  const handleInsertInvoiceToChat = (text: string) => {
    composerRef.current?.setText(text);
    replyTextRef.current = text;
    setHasReplyText(true);
    if (selectedIdRef.current) {
      saveConversationDraft(selectedIdRef.current, text);
    }
  };

  const handleInsertDispatchDraft = (text: string) => {
    const draft = (text || '').trim();
    if (!draft) return;
    dispatchOriginRef.current = true;
    composerRef.current?.setText(draft);
    replyTextRef.current = draft;
    setHasReplyText(true);
    if (selectedIdRef.current) {
      saveConversationDraft(selectedIdRef.current, draft);
    }
    setDispatchDrawerOpen(false);
    toast('Draf posisi Bidan disisipkan. Tekan Kirim untuk mengirim.', 'info');
  };

  const markSharelocRequested = (conversationId?: string | null) => {
    if (!conversationId) return;
    const nowIso = new Date().toISOString();
    const updated = (chatsRef.current || []).map((c) =>
      c.conversationId === conversationId ? { ...c, sharelocRequestedAt: nowIso } : c
    );
    chatsRef.current = updated;
    startTransition(() => setChats(updated));
    apiRequest(`/api/admin/live-chat/conversations/${conversationId}/shareloc-requested`, {
      method: 'PATCH',
    }).catch(() => {});
  };

  const handleRequestSharelocFromDispatch = () => {
    const qr = quickReplies.find((q) => q.shortcut === 'shareloc');
    if (!qr?.content) {
      toast('Template shareloc belum diatur di Balasan Cepat (kategori Pasca Booking).', 'error');
      return;
    }
    const name = (customerDetailData?.name || selectedChat?.customerName || '').trim() || 'Bunda';
    const draft = qr.content.replace(/\{name\}/g, name);
    handleInsertDispatchDraft(draft);
    markSharelocRequested(selectedChat?.conversationId);
  };

  const handleGenerateAndInsertInvoice = async (resItem: any) => {
    let currentServices = clinicServices;
    if (currentServices.length === 0) {
      try {
        const sRes = await apiRequest('/api/admin/services');
        if (sRes?.data && Array.isArray(sRes.data)) {
          currentServices = sRes.data;
          setClinicServices(sRes.data);
        } else if (Array.isArray(sRes)) {
          currentServices = sRes;
          setClinicServices(sRes);
        }
      } catch {}
    }

    const chatFallback: any = selectedChat ? {
      id: selectedChat.customerId,
      name: selectedChat.customerName,
      phone: selectedChat.customerPhone,
      address: (selectedChat as any).address || '',
      kelurahan: (selectedChat as any).kelurahan || null,
      kecamatan: (selectedChat as any).kecamatan || null,
      kota: (selectedChat as any).kota || null,
      children: (selectedChat as any).children || [],
      ongkir: (selectedChat as any).ongkir ?? null,
      distance_km: (selectedChat as any).distanceKm ?? (selectedChat as any).distance_km ?? null,
    } : null;

    const custData: any = customerDetailData
      ? {
          ...chatFallback,
          ...customerDetailData,
          ongkir: (customerDetailData as any).ongkir ?? chatFallback?.ongkir ?? null,
          distance_km:
            (customerDetailData as any).distance_km ??
            (customerDetailData as any).distanceKm ??
            chatFallback?.distance_km ??
            null,
        }
      : chatFallback;

    const readiness = validateInvoiceReadiness({
      bookingDate: resItem?.booking_date,
      treatmentName: resItem?.treatment_detail || resItem?.treatment_name,
      distanceKm: custData?.distance_km ?? custData?.distanceKm,
      ongkir: custData?.ongkir,
    });
    if (!readiness.ok) {
      const reasonMessages: Record<string, string> = {
        INVALID_SCHEDULE:
          'Invoice tidak bisa dibuat: tanggal/jadwal reservasi tidak valid. Lengkapi jadwal di kalender terlebih dahulu.',
        MISSING_TREATMENT:
          'Invoice tidak bisa dibuat: nama layanan pada reservasi kosong. Lengkapi data reservasi terlebih dahulu.',
        MISSING_DISTANCE:
          'Invoice tidak bisa dibuat: jarak/ongkir belum terhitung. Lengkapi alamat & titik lokasi customer (Buku Alamat) agar tagihan tidak salah.',
        INVALID_NUMBER:
          'Invoice tidak bisa dibuat: nilai jarak/ongkir tidak valid. Periksa data alamat customer terlebih dahulu.',
      };
      toast(reasonMessages[readiness.reason] || 'Invoice tidak bisa dibuat: data reservasi belum lengkap.', 'error');
      if (readiness.reason === 'MISSING_DISTANCE' && selectedChat) {
        setAddrBookCustomer({ id: selectedChat.customerId, name: selectedChat.customerName || undefined });
      }
      return;
    }
    const bookingD = readiness.bookingDate;
    const treatmentNameRaw = readiness.treatmentName;
    const distanceKm = readiness.distanceKm;
    const ongkir = readiness.ongkir;

    let timeStr = '';
    try {
      timeStr = bookingD.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).replace(':', '.');
    } catch {}
    if (!timeStr) {
      toast('Invoice tidak bisa dibuat: jam reservasi tidak dapat dibaca.', 'error');
      return;
    }

    const babySource = resItem?.babies || resItem?.children || custData?.children || [];
    const firstBaby = Array.isArray(babySource) && babySource.length > 0 ? babySource[0] : null;

    const mappedData: ExtractedScheduleData = {
      bookingDate: bookingD,
      dateDisplay: formatIndonesianDate(bookingD),
      timeDisplay: timeStr,
      treatmentName: treatmentNameRaw,
      treatmentPrice: Number(resItem?.purchase_value ?? resItem?.treatment_price ?? 0) || 0,
      treatmentCategory: (resItem?.treatment_category === 'MOMS' || resItem?.treatment_category === 'BUNDLE' || resItem?.treatment_category === 'BOTH' || resItem?.treatment_detail?.toLowerCase()?.includes('mom')) ? (resItem?.treatment_category === 'BUNDLE' || resItem?.treatment_category === 'BOTH' ? 'BUNDLE' : 'MOMS') : 'BABY',
      childName: firstBaby?.name || resItem?.child_name || '',
      childAge: firstBaby?.age || firstBaby?.ageText || firstBaby?.raw_age_text || firstBaby?.current_age || resItem?.child_age || '',
      babies: Array.isArray(babySource) ? babySource.map((b: any) => ({ name: b?.name || '', ageText: b?.age || b?.ageText || b?.raw_age_text || b?.current_age || '' })).filter((b: any) => b.name) : [],
      bundaName: cleanBundaName(custData?.name || selectedChat?.customerName || '', custData?.kecamatan, custData?.kota),
      phone: custData?.phone || selectedChat?.customerPhone || '',
      address: custData?.address || custData?.preferences?.address || custData?.kelurahan || '',
      kecamatan: custData?.kecamatan || '',
      kota: custData?.kota || '',
      distanceKm,
      ongkir,
      discount: 0,
      isExtractedFromChat: false,
      confidenceScore: 1.0,
      hasExplicitReservationForm: false,
    };

    setInvoiceModalData(mappedData);
    setShowInvoiceModal(true);
    pushModalHistory('invoice');
  };

  const handleGenerateActiveReservationInvoice = async () => {
    if (!selectedChat) {
      toast('Pilih percakapan customer terlebih dahulu.', 'info');
      return;
    }
    const activeRes = activeConfirmedReservation || activePendingReservation;
    if (!activeRes) {
      toast('Belum ada jadwal reservasi aktif di percakapan ini — buat reservasi dulu agar invoice tercatat di kalender.', 'info');
      void handleOpenQuickReservation();
      return;
    }
    await handleGenerateAndInsertInvoice(activeRes);
  };

  const handleSendReply = async (composerText?: string, isInternal?: boolean) => {
    const image = isInternal ? null : selectedImage;
    const text = (typeof composerText === 'string' ? composerText : replyTextRef.current || '').trim();
    if (!selectedId || (!text && !image)) return;

    notifyTyping(false);

    const currentReplyingTo = isInternal ? null : replyingTo;
    const tempId = `temp_${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      direction: 'OUTBOUND',
      content: text || (image ? '[IMAGE]' : ''),
      sender_type: isInternal ? 'INTERNAL_NOTE' : 'ADMIN',
      sender_name: user?.email || 'Admin',
      created_at: new Date().toISOString(),
      delivery_status: 'sent',
      media: image ? { url: image.preview, hdUrl: image.preview, mimeType: image.mimeType, caption: text || undefined } : undefined,
      quoted_message: currentReplyingTo ? {
        id: currentReplyingTo.id,
        wa_message_id: currentReplyingTo.wa_message_id,
        direction: currentReplyingTo.direction,
        sender_name: currentReplyingTo.sender_name || (currentReplyingTo.direction === 'INBOUND' ? (selectedChat?.customerName || 'Customer') : 'Admin'),
        sender_type: currentReplyingTo.sender_type,
        content: currentReplyingTo.content,
        media: currentReplyingTo.media,
      } : undefined,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    optimisticMessageIdsRef.current.add(tempId);
    window.setTimeout(() => optimisticMessageIdsRef.current.delete(tempId), 10000);

    setChats((prev) => {
      const updated = prev.map((c) =>
        c.conversationId === selectedId
          ? {
              ...c,
              lastMessageAt: optimisticMsg.created_at,
              lastMessages: [...(c.lastMessages || []), optimisticMsg].slice(-3),
              isAwaitingReply: isInternal ? c.isAwaitingReply : false,
            }
          : c
      );
      const sorted = sortChats(updated);
      chatsRef.current = sorted;
      return sorted;
    });

    replyTextRef.current = '';
    setHasReplyText(false);
    if (selectedId) clearConversationDraft(selectedId);
    if (image?.preview && image.preview.startsWith('blob:')) {
      try { URL.revokeObjectURL(image.preview); } catch {}
    }
    setSelectedImage(null);
    setReplyingTo(null);
    setTimeout(() => scrollToBottom(true, true), 50);

    setSending(true);
    try {
      const body: Record<string, any> = {
        adminName: user?.email || 'Admin',
      };
      if (text) body.text = text;
      if (isInternal) body.isInternalNote = true;
      if (currentReplyingTo) {
        body.replyToMessageId = currentReplyingTo.wa_message_id || currentReplyingTo.id;
      }
      if (image) {
        if (image.mediaUrl) {
          body.mediaUrl = image.mediaUrl;
        } else {
          body.imageB64 = image.dataUrl;
        }
        if (image.mimeType) body.mimeType = image.mimeType;
        if (image.fileName) body.fileName = image.fileName;
      }
      if (dispatchOriginRef.current) {
        body.dispatchOrigin = true;
        dispatchOriginRef.current = false;
      }

      const res = await apiRequest(`/api/admin/live-chat/conversations/${selectedId}/reply`, {
        method: 'POST',
        body: JSON.stringify(body),
        timeoutMs: 45000,
      });

      const actualMsg = res?.data?.message || res?.data;
      const actualId = actualMsg?.id || actualMsg?.messageId;
      if (actualId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  id: actualId,
                  wa_message_id: actualMsg.messageId || actualMsg.wa_message_id || m.wa_message_id,
                  delivery_status: 'sent',
                }
              : m
          )
        );
      }

      const sendWarning = (res as any)?.data?.warning || (res as any)?.warning;
      if (sendWarning === 'MESSAGE_SENT_NOT_PERSISTED') {
        toast(
          'Pesan SUDAH terkirim ke pasien, tetapi gagal disimpan ke riwayat dashboard. JANGAN kirim ulang — muat ulang halaman untuk rekonsiliasi.',
          'error'
        );
      } else if (sendWarning === 'NO_ACTIVE_RESERVATION_TODAY') {
        toast(
          'Pesan terkirim, tetapi tidak ada reservasi aktif HARI INI untuk customer ini. Pastikan kunjungan dicatat di kalender agar tidak hilang dari operasional.',
          'info'
        );
      } else if (sendWarning) {
        toast(`Pesan terkirim dengan peringatan: ${sendWarning}`, 'info');
      }
    } catch (err: any) {
      optimisticMessageIdsRef.current.delete(tempId);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setChats((prev) => {
        const updated = prev.map((c) =>
          c.conversationId === selectedId
            ? { ...c, lastMessages: (c.lastMessages || []).filter((m: any) => m.id !== tempId) }
            : c
        );
        chatsRef.current = updated;
        return updated;
      });

      const definitelyNotSent = typeof err?.status === 'number' && err.status >= 400 && err.status < 500;
      if (definitelyNotSent && text) {
        replyTextRef.current = text;
        setHasReplyText(true);
        composerRef.current?.setText(text);
        if (selectedId) saveConversationDraft(selectedId, text);
      }

      toast(
        `Gagal mengirim balasan: ${err.message}${definitelyNotSent && text ? ' — teks dikembalikan ke kolom kirim.' : ' — periksa dulu apakah pesan sudah masuk ke pasien sebelum mengirim ulang.'}`,
        'error'
      );

      if (selectedId) {
        void loadThread(selectedId);
        void refreshChatItem(selectedId);
      }
    } finally {
      setSending(false);
    }
  };

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast('File yang ditempel bukan gambar.', 'error');
      return;
    }
    try {
      const prepared = await prepareChatImage(file);
      if (selectedImage?.preview && selectedImage.preview.startsWith('blob:')) {
        try { URL.revokeObjectURL(selectedImage.preview); } catch {}
      }
      setSelectedImage({
        file,
        preview: prepared.preview,
        dataUrl: prepared.dataUrl,
        mimeType: prepared.mimeType,
        fileName: prepared.fileName,
        origin: 'upload',
      });
    } catch (err: any) {
      toast(err?.message || 'Gagal memproses foto.', 'error');
    }
  };

  const handlePickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await handleImageFile(file);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveSelectedImage = () => {
    if (selectedImage?.preview && selectedImage.preview.startsWith('blob:')) {
      try { URL.revokeObjectURL(selectedImage.preview); } catch {}
    }
    setSelectedImage(null);
  };

  useEffect(() => {
    return () => {
      if (selectedImage?.preview && selectedImage.preview.startsWith('blob:')) {
        try { URL.revokeObjectURL(selectedImage.preview); } catch {}
      }
    };
  }, [selectedImage?.preview]);

  return {
    selectedImage,
    setSelectedImage,
    sending,
    setSending,
    quickReplies,
    setQuickReplies,
    interpolateQuickReplyContent,
    applyQuickReply,
    handleSendReply,
    handleImageFile,
    handlePickImage,
    handleRemoveSelectedImage,
    handleInsertInvoiceToChat,
    handleInsertDispatchDraft,
    markSharelocRequested,
    handleRequestSharelocFromDispatch,
    handleGenerateAndInsertInvoice,
    handleGenerateActiveReservationInvoice,
  };
}

import { useMemo } from 'react';
import {
  extractScheduleFromMessages,
  hasExistingReservationForSchedule,
  findExistingReservationForSchedule,
  isNegotiatedScheduleCommitted,
  shouldShowNeutralExistingReservationBanner,
  ExtractedScheduleData,
} from '../utils/chatScheduleExtractor';
import { wibDayStartEnd } from '../utils/dateWib';
import { shouldWarnUnregisteredVisit } from '../utils/dispatchVisitContext';
import type { ChatMessage, LiveChatItem } from '../types/livechat';

export interface UseLiveChatBannersParams {
  messages: ChatMessage[];
  customerDetailData: any;
  clinicServices: any[];
  selectedChat: LiveChatItem | null | undefined;
  dismissedFormBanner: string | null;
  activeConfirmedReservation: any;
  activeHoldReservation: any;
  activePendingReservation: any;
  dispatchReservationId: string | null;
}

export function useLiveChatBanners({
  messages,
  customerDetailData,
  clinicServices,
  selectedChat,
  dismissedFormBanner,
  activeConfirmedReservation,
  activeHoldReservation,
  activePendingReservation,
  dispatchReservationId,
}: UseLiveChatBannersParams) {
  // Memoized Ekstraksi Jadwal untuk Banner Auto-Detect (Fase 4B)
  const formBannerExtracted = useMemo(() => {
    if (!messages || messages.length === 0) return null;
    try {
      return extractScheduleFromMessages(messages, customerDetailData, clinicServices, null);
    } catch {
      return null;
    }
  }, [messages, customerDetailData, clinicServices]);

  // Fase 4C — Supresi banner bila customer SUDAH punya reservasi pada tanggal yang
  // sama dengan jadwal ter-ekstrak. Gate pada state DB (customerDetailData.reservations),
  // bukan hafalan teks (lihat hasExistingReservationForSchedule). Treatment-aware.
  const hasExistingReservationForExtractedSchedule = useMemo(
    () =>
      hasExistingReservationForSchedule(
        customerDetailData?.reservations,
        formBannerExtracted?.bookingDate,
        formBannerExtracted?.treatmentName,
        formBannerExtracted?.treatmentCategory
      ),
    [
      customerDetailData?.reservations,
      formBannerExtracted?.bookingDate,
      formBannerExtracted?.treatmentName,
      formBannerExtracted?.treatmentCategory,
    ]
  );

  const matchedExistingReservation = useMemo(() => {
    return (
      findExistingReservationForSchedule(
        customerDetailData?.reservations,
        formBannerExtracted?.bookingDate,
        formBannerExtracted?.treatmentName,
        formBannerExtracted?.treatmentCategory
      ) ||
      (selectedChat as any)?.activeConfirmedReservation ||
      null
    );
  }, [
    customerDetailData?.reservations,
    formBannerExtracted?.bookingDate,
    formBannerExtracted?.treatmentName,
    formBannerExtracted?.treatmentCategory,
    selectedChat,
  ]);

  // MT-2.2: Palang Pintu Dispatch — Deteksi reservasi selesai hari ini di DB (state-based)
  const hasTodayCompletedReservation = useMemo(() => {
    if (!selectedChat) return false;
    const { start, end } = wibDayStartEnd(new Date());
    const isCompletedToday = (r: any) => {
      if (!r || r.status !== 'completed' || !r.booking_date) return false;
      const bd = new Date(r.booking_date).getTime();
      if (isNaN(bd)) return false;
      return bd >= start.getTime() && bd <= end.getTime();
    };
    if (customerDetailData && customerDetailData.id === selectedChat.customerId) {
      return (customerDetailData.reservations || []).some(isCompletedToday);
    }
    const fromChat = (selectedChat as any).activeConfirmedReservation;
    return Boolean(fromChat && isCompletedToday(fromChat));
  }, [selectedChat, customerDetailData]);

  // MT-3.1: Deteksi jadwal hasil negosiasi dengan komitmen aktif user (anti false-positive)
  const negotiatedScheduleState = useMemo(() => {
    return isNegotiatedScheduleCommitted(messages, formBannerExtracted);
  }, [messages, formBannerExtracted]);

  const hasValidNegotiatedSchedule = Boolean(
    negotiatedScheduleState &&
      formBannerExtracted?.isExtractedFromChat &&
      Boolean(formBannerExtracted?.treatmentName || formBannerExtracted?.hasExplicitReservationForm) &&
      !hasExistingReservationForExtractedSchedule &&
      !hasTodayCompletedReservation &&
      selectedChat?.escalationReason !== 'recruitment_inquiry'
  );

  // Signatur form: percakapan + entitas inti. Dismiss bertahan untuk form yang sama;
  // form BARU (konten beda) otomatis tampil lagi.
  const formBannerKey =
    (formBannerExtracted?.hasExplicitReservationForm || hasValidNegotiatedSchedule) && selectedChat && formBannerExtracted
      ? `${selectedChat.conversationId}|${formBannerExtracted.dateDisplay}|${formBannerExtracted.timeDisplay}|${formBannerExtracted.treatmentName}`
      : null;

  const showFormReservasiBanner = Boolean(
    formBannerKey &&
      formBannerKey !== dismissedFormBanner &&
      !hasExistingReservationForExtractedSchedule &&
      !activeHoldReservation &&
      !activeConfirmedReservation &&
      !activePendingReservation &&
      !hasTodayCompletedReservation &&
      selectedChat?.escalationReason !== 'recruitment_inquiry'
  );

  const showNeutralExistingReservationBanner = useMemo(() => {
    return shouldShowNeutralExistingReservationBanner({
      showFormReservasiBanner,
      activeConfirmedReservation,
      formBannerKey,
      dismissedFormBanner,
      hasExistingReservationForExtractedSchedule,
      matchedExistingReservation,
    });
  }, [
    showFormReservasiBanner,
    activeConfirmedReservation,
    formBannerKey,
    dismissedFormBanner,
    hasExistingReservationForExtractedSchedule,
    matchedExistingReservation,
  ]);

  const visitMessages = useMemo(
    () =>
      (messages || []).map((m: any) => ({
        direction: m.direction,
        sender_type: m.sender_type,
        content: m.content,
        media: m.media,
        location: m.location,
        created_at: m.created_at,
        dispatchOrigin: Boolean(m.payload_raw?.dispatchOrigin),
        isFieldStaff:
          String(m.sender_type || '').toUpperCase() === 'STAFF' ||
          Boolean(m.payload_raw?.forceEscalate),
      })),
    [messages]
  );

  const hasVisitIndicators = useMemo(() => {
    const { start, end } = wibDayStartEnd(new Date());
    return shouldWarnUnregisteredVisit({
      messages: visitMessages,
      dayStart: start,
      dayEnd: end,
      field: {
        hasTodayReservation: Boolean(
          activeConfirmedReservation || activePendingReservation || hasTodayCompletedReservation
        ),
        hasActiveTrip: Boolean(dispatchReservationId),
        hasOtwActive: Boolean((activeConfirmedReservation as any)?.otw_sent_at && !(activeConfirmedReservation as any)?.arrived_at),
      },
    });
  }, [visitMessages, activeConfirmedReservation, activePendingReservation, hasTodayCompletedReservation, dispatchReservationId]);

  const showUnregisteredVisitBanner = Boolean(
    hasVisitIndicators &&
      !showFormReservasiBanner &&
      !activeConfirmedReservation &&
      !activeHoldReservation &&
      !activePendingReservation &&
      !hasTodayCompletedReservation &&
      !hasExistingReservationForExtractedSchedule
  );

  return {
    formBannerExtracted,
    hasExistingReservationForExtractedSchedule,
    matchedExistingReservation,
    hasTodayCompletedReservation,
    negotiatedScheduleState,
    hasValidNegotiatedSchedule,
    formBannerKey,
    showFormReservasiBanner,
    showNeutralExistingReservationBanner,
    visitMessages,
    hasVisitIndicators,
    showUnregisteredVisitBanner,
  };
}

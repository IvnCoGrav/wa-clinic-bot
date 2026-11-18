/**
 * livechat-reservation-event.ts — Kontrak payload SSE untuk reservasi Live Chat.
 *
 * Invarian:
 * 1. conversationId wajib berupa UUID percakapan (bukan WhatsApp JID/chatId).
 * 2. customer_id wajib selalu tersemat di activeConfirmedReservation (fallback ke customerId pemilik).
 * 3. Nilai booking_date dinormalisasi ke string ISO (atau null bila tidak ada).
 */

export interface BuildReservationUpdatedPayloadParams {
  conversationId: string;
  customerId: string;
  reservation: any | null;
  isNew?: boolean;
  isUpdate?: boolean;
}

export function buildReservationUpdatedPayload(params: BuildReservationUpdatedPayloadParams) {
  const { conversationId, customerId, reservation, isNew, isUpdate } = params;
  return {
    conversationId,
    customerId,
    isNew: !!isNew,
    isUpdate: !!isUpdate,
    activeConfirmedReservation: reservation
      ? {
          id: reservation.id,
          booking_date: reservation.booking_date
            ? (reservation.booking_date instanceof Date
                ? reservation.booking_date.toISOString()
                : new Date(reservation.booking_date).toISOString())
            : null,
          status: reservation.status ?? null,
          treatment_category: reservation.treatment_category ?? null,
          treatment_detail: reservation.treatment_detail ?? null,
          duration_minutes: reservation.duration_minutes ?? null,
          customer_id: reservation.customer_id ?? customerId,
        }
      : undefined,
  };
}

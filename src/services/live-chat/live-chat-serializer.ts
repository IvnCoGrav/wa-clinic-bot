import { Direction } from '@prisma/client';
import { StaffOwnershipView } from '../staff-ownership.service';
import { CONFIRMED_FAMILY_STATUSES, isHoldActive, isTreatmentWithinActiveWindow } from '../../domain/reservation-status';
import { resolveReservationPaymentEvaluation } from '../reservation-core.service';
import { resolveLocationAdequacy, extractStaffVerifiedCoords } from '../../domain/location-adequacy';
import { LiveChatConversationItem, LiveChatReservationItem } from './types';

/** Deteksi sumber traffic dari baris ad_clicks. */
export function detectTrafficSource(adClick: any, isLegacy: boolean): 'meta' | 'legacy' | null {
  if (!adClick) {
    return isLegacy ? 'legacy' : null;
  }
  const utm = `${adClick.utmSource || ''} ${adClick.utmMedium || ''} ${adClick.utmCampaign || ''}`.toLowerCase();
  if (adClick.fbclid || adClick.fbc || /meta|facebook|instagram/i.test(utm)) {
    return 'meta';
  }
  return isLegacy ? 'legacy' : null;
}

export function serializeConversationItem(
  c: any,
  stats?: { purchaseCount: number; ltv: number },
  unreadCount = 0,
  staffOwnership: StaffOwnershipView | null = null
): LiveChatConversationItem {
  const lastMsg = c.messages && c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;
  const effectiveLastMsgAt = lastMsg?.created_at || c.last_message_at || c.updated_at;

  const isManualUnread = !!c.is_manual_unread;
  const effectiveUnreadCount = isManualUnread ? Math.max(1, unreadCount) : unreadCount;

  // Awaiting reply: unread = 0 (sudah dibaca), pesan terakhir dari customer (INBOUND), dan usia pesan <= 24 jam (86.400.000 ms).
  let isAwaitingReply = false;
  const lastRealMsg = (c.messages || [])
    .filter((m: any) => m?.sender_type !== 'INTERNAL_NOTE')
    .pop() || null;
  if (effectiveUnreadCount === 0 && !isManualUnread && lastRealMsg) {
    const isLastInbound = lastRealMsg.direction === Direction.INBOUND || lastRealMsg.direction === 'INBOUND';
    if (isLastInbound) {
      const msgAgeMs = Date.now() - new Date(lastRealMsg.created_at).getTime();
      if (msgAgeMs <= 24 * 60 * 60 * 1000) {
        isAwaitingReply = true;
      }
    }
  }

  const reservations: any[] = c.customer?.reservations || [];
  const hasActiveHold = reservations.some((r: any) => r.status === 'hold' && isHoldActive(r.booking_date));
  const hasUpcomingBooking = reservations.some(
    (r: any) => CONFIRMED_FAMILY_STATUSES.includes(r.status) && isTreatmentWithinActiveWindow(r.booking_date)
  );
  const hasPendingBooking = reservations.some(
    (r: any) => r.status === 'pending' && isTreatmentWithinActiveWindow(r.booking_date)
  );

  const formatReservationItem = (res: any): LiveChatReservationItem | null => {
    if (!res) return null;
    return {
      id: res.id,
      booking_date: res.booking_date
        ? typeof res.booking_date === 'string'
          ? res.booking_date
          : (res.booking_date as Date).toISOString()
        : null,
      status: res.status || 'pending',
      treatment_category: res.treatment_category || 'BABY',
      treatment_detail: res.treatment_detail || null,
      duration_minutes: (res as any).duration_minutes || 60,
      purchase_value: Number(res.purchase_value) || 0,
      payment_method: (res as any).payment_method || null,
      proof_url: (res as any).proof_url || null,
      receipt_amount:
        (res as any).receipt_amount !== undefined && (res as any).receipt_amount !== null
          ? Number((res as any).receipt_amount)
          : null,
      needs_staff_verification: (res as any).needs_staff_verification ?? false,
      raw_text: (res as any).raw_text || null,
      notes: (res as any).notes || null,
      assigned_staff_id: res.assigned_staff_id ?? null,
      assigned_staff: res.assigned_staff ? { id: res.assigned_staff.id, name: res.assigned_staff.name } : null,
      customer_id: res.customer_id || c.customer_id,
      delivery_fee: (res as any).delivery_fee ?? null,
      purchase_occurred_at: res.purchase_occurred_at
        ? typeof res.purchase_occurred_at === 'string'
          ? res.purchase_occurred_at
          : (res.purchase_occurred_at as Date).toISOString()
        : null,
      otw_sent_at: res.otw_sent_at
        ? typeof res.otw_sent_at === 'string'
          ? res.otw_sent_at
          : (res.otw_sent_at as Date).toISOString()
        : null,
      arrived_at: res.arrived_at
        ? typeof res.arrived_at === 'string'
          ? res.arrived_at
          : (res.arrived_at as Date).toISOString()
        : null,
      customer: {
        id: c.customer?.id || c.customer_id,
        name: c.customer?.name || 'Bunda',
        phone: c.customer?.phone || '',
        kelurahan: c.customer?.kelurahan || null,
        kecamatan: c.customer?.kecamatan || null,
        kota: c.customer?.kota || null,
        children: c.customer?.children || [],
        ongkir: (c.customer as any)?.ongkir || 0,
        distance_km: (c.customer as any)?.distance_km ?? null,
        preferences: (() => {
          const p = (c.customer as any)?.preferences || {};
          return {
            address: p.address || null,
            full_address: p.full_address || null,
            landmark: p.landmark || null,
            address_notes: p.address_notes || null,
          };
        })(),
      },
    };
  };

  const activeHold = reservations.find((r: any) => r.status === 'hold' && isHoldActive(r.booking_date)) || null;
  const activeConfirmed =
    reservations.find(
      (r: any) => CONFIRMED_FAMILY_STATUSES.includes(r.status) && isTreatmentWithinActiveWindow(r.booking_date)
    ) || null;
  const activePending =
    reservations.find((r: any) => r.status === 'pending' && isTreatmentWithinActiveWindow(r.booking_date)) || null;

  const activeHoldReservation = formatReservationItem(activeHold);
  const activeConfirmedReservation = formatReservationItem(activeConfirmed);
  const activePendingReservation = formatReservationItem(activePending);

  const prefs = (c.customer as any)?.preferences || {};
  const savedAddresses = Array.isArray(prefs.saved_addresses) ? prefs.saved_addresses : [];
  const primaryAddress = savedAddresses.find((a: any) => a?.isPrimary) || savedAddresses[0] || null;
  const purchaseCount = stats?.purchaseCount ?? (c.customer?.reservations?.length || 0);
  const adequacy = resolveLocationAdequacy({
    columnSource: (c.customer as any)?.location_source ?? null,
    preferenceSource: prefs.location_source ?? prefs.source ?? null,
    primaryAddressSource: primaryAddress?.locationSource ?? null,
    shareLocationSent: Boolean((c.customer as any)?.share_location_sent),
    lat: (c.customer as any)?.lat ?? null,
    lng: (c.customer as any)?.lng ?? null,
    staffVerified: Boolean(
      prefs.location_updated_by_staff_id ||
        prefs.location_updated_by_staff_name ||
        prefs.location_accuracy_m != null
    ),
    staffVerifiedCoords: extractStaffVerifiedCoords(prefs),
    housePhotoUrl: prefs.house_photo_url || null,
    purchaseCount,
    hasVisitedAddress: Boolean(primaryAddress?.lastUsedAt),
    hasCompleteAddress: Boolean(primaryAddress?.address || (c.customer as any)?.kelurahan),
  });

  return {
    conversationId: c.id,
    customerId: c.customer_id,
    customerName: c.customer?.name || null,
    customerPhone: c.customer?.phone || null,
    kelurahan: c.customer?.kelurahan || null,
    kecamatan: c.customer?.kecamatan || null,
    kota: c.customer?.kota || null,
    distanceKm: c.customer?.distance_km ?? null,
    ongkir: c.customer?.ongkir ?? null,
    currentState: c.current_state,
    isHumanHandling: !!c.is_human_handling,
    humanHandlingSince: c.human_handling_since || null,
    escalationReason: c.escalation_reason || null,
    lastMessageAt: effectiveLastMsgAt,
    createdAt: c.created_at,
    lastMessages: c.messages || [],
    isMql: !!c.customer?.is_mql,
    mqlBubbleCount: c.customer?.mql_bubble_count || 0,
    mqlTriggeredAt: c.customer?.mql_triggered_at || null,
    isSandboxTest: !!c.customer?.is_sandbox_test,
    trafficSource: detectTrafficSource(c.customer?.adClick, !!c.customer?.is_legacy_source),
    purchaseCount,
    ltv: stats?.ltv || 0,
    customerLabels: c.customer?.labels?.map((cl: any) => cl.label || cl) || [],
    customerProfilePictureUrl: c.customer?.profile_picture_url || null,
    unreadCount: effectiveUnreadCount,
    isManualUnread,
    isPinned: !!c.is_pinned,
    pinnedAt: c.pinned_at || null,
    isAwaitingReply,
    isFrustrated: !!c.is_frustrated,
    frustratedAt: c.frustrated_at || null,
    frustratedReason: c.frustrated_reason || null,
    hasActiveHold,
    hasUpcomingBooking,
    hasPendingBooking,
    activeHoldReservation,
    activeConfirmedReservation,
    activePendingReservation,
    matchedMessage: (c as any).matchedMessage || null,
    locationSource: (c.customer as any)?.location_source || null,
    effectiveLocationSource: adequacy.source,
    locationAdequacy: adequacy.reason,
    sharelocNeeded: adequacy.needsShareloc,
    shareLocationSent: Boolean((c.customer as any)?.share_location_sent),
    sharelocRequestedAt:
      (c as any)?.session_data?.shareloc_requested_at ||
      (c.customer as any)?.preferences?.share_location_requested_at ||
      null,
    staffOwnership,
  };
}

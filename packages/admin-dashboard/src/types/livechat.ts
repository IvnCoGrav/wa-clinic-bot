import type { ChatMediaData } from '../components/common/MediaImage';
import type { ChatLocationData } from '../utils/mediaExtractor';
import { extractMedia } from '../utils/mediaExtractor';
import type { StaffOwnership } from '../utils/staffOwnershipBadge';
import { formatChatDateSeparatorWib, isDifferentDayWib } from '../utils/dateWib';

export interface QuotedMessageData {
  id?: string;
  wa_message_id?: string | null;
  direction?: 'INBOUND' | 'OUTBOUND';
  sender_name?: string | null;
  sender_type?: string | null;
  content?: string;
  media?: ChatMediaData;
}

export interface ChatMessage {
  id: string;
  wa_message_id?: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  sender_type?: string | null;
  sender_name?: string | null;
  delivery_status?: 'sent' | 'delivered' | 'read' | 'failed' | null;
  delivered_at?: string | null;
  read_at?: string | null;
  created_at: string;
  media?: ChatMediaData;
  location?: ChatLocationData | null;
  quoted_message?: QuotedMessageData;
  is_revoked?: boolean;
  is_edited?: boolean;
  is_message_pinned?: boolean;
  is_message_hidden?: boolean;
  pinned_by?: string | null;
  pinned_at?: string | null;
  hidden_by?: string | null;
  hidden_at?: string | null;
  payload_raw?: any;
}

export interface CustomerLabelData {
  id: string;
  name: string;
  color: string;
  description?: string | null;
}

export interface LiveChatItem {
  conversationId: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  distanceKm?: number | null;
  ongkir?: number | null;
  currentState: string;
  isHumanHandling: boolean;
  humanHandlingSince: string | null;
  escalationReason: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  lastMessages?: { content: string; direction?: string; created_at?: string }[];
  isMql?: boolean;
  mqlBubbleCount?: number;
  isSandboxTest?: boolean;
  trafficSource?: 'meta' | 'legacy' | null;
  purchaseCount?: number;
  ltv?: number;
  customerLabels?: CustomerLabelData[];
  customerProfilePictureUrl?: string | null;
  staffOwnership?: StaffOwnership | null;
  unreadCount?: number;
  isManualUnread?: boolean;
  isPinned?: boolean;
  pinnedAt?: string | null;
  isAwaitingReply?: boolean;
  /** Pulse alert (Fase 4): percakapan butuh respon segera (SLA-breach). */
  isFrustrated?: boolean;
  frustratedAt?: string | null;
  frustratedReason?: string | null;
  hasActiveHold?: boolean;
  hasUpcomingBooking?: boolean;
  hasPendingBooking?: boolean;
  activeHoldReservation?: {
    id: string;
    booking_date: string | null;
    treatment_category?: string | null;
    treatment_detail?: string | null;
    assigned_staff_id?: string | null;
    assigned_staff?: { id: string; name: string } | null;
    notes?: string | null;
    customer_id?: string | null;
    otw_sent_at?: string | null;
    arrived_at?: string | null;
  } | null;
  activeConfirmedReservation?: {
    id: string;
    booking_date: string | null;
    treatment_category?: string | null;
    treatment_detail?: string | null;
    assigned_staff_id?: string | null;
    assigned_staff?: { id: string; name: string } | null;
    notes?: string | null;
    customer_id?: string | null;
    otw_sent_at?: string | null;
    arrived_at?: string | null;
  } | null;
  activePendingReservation?: {
    id: string;
    booking_date: string | null;
    treatment_category?: string | null;
    treatment_detail?: string | null;
    assigned_staff_id?: string | null;
    assigned_staff?: { id: string; name: string } | null;
    notes?: string | null;
    customer_id?: string | null;
    otw_sent_at?: string | null;
    arrived_at?: string | null;
  } | null;
  locationSource?: string | null;
  effectiveLocationSource?: string | null;
  locationAdequacy?: 'gps_pin' | 'staff_verified' | 'field_verified' | 'estimated_area' | 'unknown' | null;
  sharelocNeeded?: boolean;
  shareLocationSent?: boolean;
  sharelocRequestedAt?: string | null;
}

export function extractQuotedMessage(msg: any): QuotedMessageData | undefined {
  const q = msg?.quoted_message ??
            msg?.payload_raw?.quoted_message ??
            msg?.payloadRaw?.quoted_message ??
            msg?.payload_raw?.quotedMsg ??
            msg?.payload_raw?._data?.quotedMsg;
  if (!q) return undefined;

  const content = q.content ?? q.body ?? q.text ?? (q.message?.conversation || q.message?.extendedTextMessage?.text) ?? '';
  const senderName = q.sender_name ?? q.senderName ?? q.pushName ?? (q.fromMe ? 'Bidan / CS' : undefined);
  const media = extractMedia(q);

  return {
    id: q.id ?? q.messageId ?? q.key?.id,
    wa_message_id: q.wa_message_id ?? q.id ?? q.key?.id,
    direction: q.direction ?? (q.fromMe ? 'OUTBOUND' : 'INBOUND'),
    sender_name: senderName,
    sender_type: q.sender_type ?? (q.fromMe ? 'ADMIN' : 'CUSTOMER'),
    content,
    media,
  };
}

export function formatChatDateSeparator(dateStr: string): string {
  return formatChatDateSeparatorWib(dateStr);
}

export function isDifferentDay(d1Str: string, d2Str?: string | null): boolean {
  return isDifferentDayWib(d1Str, d2Str);
}

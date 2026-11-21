import type { ChatMediaData } from '../components/common/MediaImage';
import type { ChatLocationData } from '../utils/mediaExtractor';
import { extractMedia } from '../utils/mediaExtractor';
import type { StaffOwnership } from '../utils/staffOwnershipBadge';
import { formatChatDateSeparatorWib, isDifferentDayWib } from '../utils/dateWib';
import type { QuotedMessageData } from '../utils/quotedMessage';
export type { QuotedMessageData } from '../utils/quotedMessage';
export { extractQuotedMessage } from '../utils/quotedMessage';

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
  pinFromCustomerAt?: string | null;
  pinFromStaffAt?: string | null;
  sharelocRequestedAt?: string | null;
}

export function formatChatDateSeparator(dateStr: string): string {
  return formatChatDateSeparatorWib(dateStr);
}

export function isDifferentDay(d1Str: string, d2Str?: string | null): boolean {
  return isDifferentDayWib(d1Str, d2Str);
}

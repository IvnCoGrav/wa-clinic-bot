import { StaffOwnershipView } from '../staff-ownership.service';

export interface LiveChatConversationItem {
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
  humanHandlingSince: Date | null;
  escalationReason: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  lastMessages: any[];
  isMql?: boolean;
  mqlBubbleCount?: number;
  mqlTriggeredAt?: Date | null;
  isSandboxTest?: boolean;
  trafficSource?: 'meta' | 'legacy' | null;
  purchaseCount?: number;
  ltv?: number;
  customerLabels?: { id: string; name: string; color: string }[];
  customerProfilePictureUrl?: string | null;
  unreadCount: number;
  isManualUnread: boolean;
  isPinned: boolean;
  pinnedAt: Date | null;
  isAwaitingReply: boolean;
  /** Pulse alert (Fase 4): true bila percakapan butuh respon segera (SLA/SLA-breach). */
  isFrustrated?: boolean;
  frustratedAt?: Date | null;
  frustratedReason?: string | null;
  matchedMessage?: {
    id: string;
    content: string;
    createdAt: Date;
    direction?: string;
    senderName?: string | null;
  } | null;
  hasActiveHold?: boolean;
  hasUpcomingBooking?: boolean;
  hasPendingBooking?: boolean;
  activeHoldReservation?: LiveChatReservationItem | null;
  activeConfirmedReservation?: LiveChatReservationItem | null;
  activePendingReservation?: LiveChatReservationItem | null;
  locationSource?: string | null;
  /** Sumber kanonik lintas lapisan (kolom + preferences + kartu alamat primer). */
  effectiveLocationSource?: string | null;
  /** Alasan adequacy: gps_pin | staff_verified | field_verified | estimated_area | unknown. */
  locationAdequacy?: 'gps_pin' | 'staff_verified' | 'field_verified' | 'estimated_area' | 'unknown';
  /** True bila pelanggan masih benar-benar perlu diminta shareloc. */
  sharelocNeeded?: boolean;
  shareLocationSent?: boolean;
  sharelocRequestedAt?: string | Date | null;
  /** Pemilik retensi first-touch + bidan terakhir (read-only). */
  staffOwnership?: StaffOwnershipView | null;
}

export interface LiveChatReservationItem {
  id: string;
  booking_date: string | null;
  status?: string | null;
  treatment_category?: string | null;
  treatment_detail?: string | null;
  duration_minutes?: number | null;
  purchase_value?: number | null;
  payment_method?: string | null;
  proof_url?: string | null;
  receipt_amount?: number | null;
  delivery_fee?: number | null;
  purchase_occurred_at?: string | null;
  needs_staff_verification?: boolean;
  raw_text?: string | null;
  assigned_staff_id?: string | null;
  assigned_staff?: { id: string; name: string } | null;
  notes?: string | null;
  customer_id?: string | null;
  otw_sent_at?: string | null;
  arrived_at?: string | null;
  customer?: {
    id?: string;
    name?: string;
    phone?: string;
    kelurahan?: string | null;
    kecamatan?: string | null;
    kota?: string | null;
    children?: any[];
    ongkir?: number;
    distance_km?: number | null;
    preferences?: {
      address?: string | null;
      full_address?: string | null;
      landmark?: string | null;
      address_notes?: string | null;
    } | null;
  };
}

export interface AdminReplyResult {
  success: boolean;
  conversationId?: string;
  messageId?: string;
  id?: string;
  provider?: string;
  conversation?: any;
  /** True bila balasan adalah CATATAN INTERNAL (/notes) — TIDAK dikirim ke WhatsApp. */
  isInternal?: boolean;
  warning?: string;
  error?: { code: string; message?: string };
}

export interface SendAdminReplyParams {
  conversationId: string;
  text?: string;
  imageB64?: string;
  mediaUrl?: string;
  caption?: string;
  mimeType?: string;
  tenantId: string;
  senderName?: string;
  staffId?: string;
  acknowledgeOutsideWindow?: boolean;
  clientTempId?: string;
  replyToMessageId?: string;
  forwardedFrom?: any;
  forceInternal?: boolean;
}

export interface SendReactionParams {
  conversationId: string;
  messageId: string;
  emoji: string;
  tenantId: string;
  staffName?: string;
}

export interface RevokeMessageParams {
  conversationId: string;
  messageId: string;
  tenantId: string;
}

export interface EditMessageParams {
  conversationId: string;
  messageId: string;
  newContent: string;
  tenantId: string;
}

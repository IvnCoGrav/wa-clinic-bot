import type { StaffOwnership } from '../../utils/staffOwnershipBadge';

export interface CustomerItem {
  id: string;
  phone: string;
  name: string | null;
  status: string;
  isMql: boolean;
  mqlBubbleCount: number;
  mqlTriggeredAt: string | null;
  trackingCode?: string;
  adClick?: any;
  ltv: number;
  reservationCount: number;
  createdAt: string;
  updatedAt: string;
  isAdminLabeled?: boolean;
  isHoldLabeled?: boolean;
  kecamatan?: string | null;
  kota?: string | null;
  kelurahan?: string | null;
  distanceKm?: number | null;
  ongkir?: number | null;
  staffOwnership?: StaffOwnership | null;
}

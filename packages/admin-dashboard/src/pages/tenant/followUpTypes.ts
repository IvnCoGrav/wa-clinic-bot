/** Tipe data antrean follow-up dan modal editnya. */

export interface FollowUpCustomer {
  id: string;
  name: string | null;
  phone: string;
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  status: string;
  conversations?: Array<{
    id?: string;
    last_message_at: string;
    is_human_handling: boolean;
  }>;
}

export interface FollowUpItem {
  id: string;
  customer_id?: string;
  variant?: number;
  type: string;
  stage: number;
  treatment_category?: string | null;
  custom_text?: string | null;
  scheduled_at: string;
  sent_at: string | null;
  status: string;
  cancel_reason?: string | null;
  customer: FollowUpCustomer | null;
  reservation?: {
    id: string;
    booking_date: string | null;
    treatment_category: string;
    treatment_detail: string | null;
  } | null;
}

export interface FollowUpTemplateItem {
  id: string | null;
  type: string;
  variant: number;
  text: string;
  isDefault: boolean;
}

export interface FollowUpEditModalState {
  open: boolean;
  item?: FollowUpItem;
  newDate: string;
  stage: number;
  variant: number;
  customText: string;
}

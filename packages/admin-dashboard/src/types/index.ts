export interface User {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  role: 'super_admin' | 'tenant_admin' | 'admin_cs' | 'advertiser' | 'therapist';
  tenantId: string;
}

export interface BabyDetail {
  name: string;
  age: string;
}

export interface ChildInfo {
  id: string;
  name: string;
  birth_date: string | null;
  raw_age_text: string | null;
  age_months_at_registration: number | null;
  current_age: string;
}

export interface Reservation {
  id: string;
  customer_id: string;
  customer?: {
    id?: string;
    phone: string;
    name: string | null;
    is_legacy_source?: boolean;
    kelurahan: string | null;
    kecamatan: string | null;
    kota: string | null;
    lat?: number | null;
    lng?: number | null;
    ongkir: number | null;
    distance_km: number | null;
    preferences?: any;
    children?: ChildInfo[];
    totalTreatments?: number;
    ltv?: number;
  };
  treatment_category: 'BABY' | 'MOMS' | 'BOTH';
  treatment_detail: string;
  booking_date: string | null;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'hold';
  raw_text: string;
  purchase_event_sent_at?: string | null;
  purchase_occurred_at?: string | null;
  purchase_review_status?: 'pending' | 'approved' | 'ignored_outlier' | string;
  purchase_value?: number | null;
  payment_method?: 'CASH' | 'TRANSFER' | 'QRIS' | string | null;
  proof_url?: string | null;
  baby_details?: BabyDetail[];
  assigned_staff_id?: string | null;
  assigned_staff?: {
    id: string;
    name: string;
    phone?: string;
  } | null;
  series_id?: string | null;
  session_number?: number | null;
  total_sessions?: number | null;
  created_at: string;
}

export interface FAQChunk {
  id: string;
  title: string;
  question?: string;
  content: string;
  source_type: 'FAQ' | 'DOCUMENT';
  created_at: string;
}

export interface UnansweredQuestion {
  id: string;
  phone: string;
  question: string;
  detectedAt: string;
}

export interface SystemStatus {
  online: boolean;
  wahaStatus: string;
  redisStatus: boolean;
  dbSize: string;
  bullQueueDepth: number;
}

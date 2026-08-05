export interface User {
  id: string;
  email: string;
  role: 'tenant_admin' | 'super_admin';
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
    ongkir: number | null;
    distance_km: number | null;
    children?: ChildInfo[];
  };
  treatment_category: 'BABY' | 'MOMS' | 'BOTH';
  treatment_detail: string;
  booking_date: string | null;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  raw_text: string;
  baby_details?: BabyDetail[];
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

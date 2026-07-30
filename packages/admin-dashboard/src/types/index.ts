export interface User {
  id: string;
  email: string;
  role: 'tenant_admin' | 'super_admin';
  tenantId: string;
}

export interface Reservation {
  id: string;
  customer_id: string;
  customer?: {
    phone: string;
    name: string | null;
    kelurahan: string | null;
    kecamatan: string | null;
    kota: string | null;
    ongkir: number | null;
    distance_km: number | null;
  };
  treatment_category: 'BABY' | 'MOMS' | 'BOTH';
  treatment_detail: string;
  booking_date: string | null;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  raw_text: string;
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

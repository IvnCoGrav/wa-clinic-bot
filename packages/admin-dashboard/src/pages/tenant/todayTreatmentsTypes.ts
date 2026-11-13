/** Bentuk data tugas treatment harian yang dikirim server ke dashboard tenant. */
export interface TaskChild {
  name: string;
  rawAgeText: string | null;
  birthDate: string | null;
  currentAge?: string | null;
}

export interface TaskAddress {
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  lat?: number | null;
  lng?: number | null;
  distanceKm: number | null;
  estimatedMinutes?: number | null;
  distanceSource?: 'CLINIC' | 'PREVIOUS_PATIENT' | null;
  originName?: string | null;
  fullText: string;
  landmark?: string | null;
  housePhotoUrl?: string | null;
}

export interface TaskPricing {
  treatmentFee: number;
  deliveryFee: number;
  totalFee: number;
  paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT';
  paymentStatusLabel: string;
}

export interface TreatmentTask {
  reservationId: string;
  customerName: string | null;
  treatmentDetail: string | null;
  treatmentCategory: string | null;
  bookingDate: string | null;
  status: string;
  conversationId: string | null;
  mapsUrl: string | null;
  navigationUrl: string | null;
  address: TaskAddress;
  children: TaskChild[];
  pricing: TaskPricing;
  shareLocationText?: string | null;
  customerProfilePictureUrl?: string | null;
  assignedStaff?: {
    id: string;
    name: string;
    phone: string;
    role?: string;
  } | null;
  customerStats?: {
    totalTreatments: number;
    ltv: number;
  };
}

export interface DateMeta {
  dateStr: string;
  formattedDate: string;
  isToday: boolean;
  isTomorrow: boolean;
}

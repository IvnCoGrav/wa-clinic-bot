export interface StaffTaskChild {
  name: string;
  rawAgeText: string | null;
  birthDate: string | null;
  currentAge?: string;
}

export interface StaffTaskAddress {
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  lat?: number | null;
  lng?: number | null;
  distanceKm: number | null;
  estimatedMinutes?: number | null;
  fullText: string;
  distanceSource?: 'CLINIC' | 'PREVIOUS_PATIENT' | null;
  originName?: string | null;
  housePhotoUrl?: string | null;
  landmark?: string | null;
  /** Alamat jalan/perumahan lengkap (preferences.address/full_address) — untuk bold UI. */
  addressDetail?: string | null;
  /** Akurasi koordinat: gps_pin (presisi) | estimated_area (estimasi) | manual_staff. */
  locationSource?: 'gps_pin' | 'estimated_area' | 'manual_staff' | null;
}

export interface StaffTaskPricing {
  treatmentFee: number;
  deliveryFee: number;
  totalFee: number;
  paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT';
  paymentStatusLabel: string;
  /** Metode pembayaran tercatat (CASH/TRANSFER/QRIS) bila sudah lunas. */
  paymentMethod?: string | null;
  /** URL bukti transfer/QRIS yang diunggah terapis (null bila belum ada). */
  proofUrl?: string | null;
}

export interface StaffTaskItem {
  reservationId: string;
  customerName: string | null;
  treatmentDetail: string | null;
  treatmentCategory: string | null;
  bookingDate: Date | null;
  status: string;
  otwSentAt?: Date | string | null;
  arrivedAt?: Date | string | null;
  conversationId: string | null;
  mapsUrl: string | null;
  navigationUrl: string | null;
  address: StaffTaskAddress;
  children: StaffTaskChild[];
  pricing: StaffTaskPricing;
  shareLocationText: string | null;
  customerProfilePictureUrl?: string | null;
  assignedStaff?: { id: string; name: string; role?: string } | null;
  customerStats?: {
    totalTreatments: number;
    ltv: number;
  };
  /**
   * Status jendela akses chat (server-driven, sumber kebenaran tunggal).
   * Frontend hanya merender; keputusan waktu tidak dihitung ulang di klien.
   */
  chatWindow?: {
    open: boolean;
    reason: ChatWindowReason;
    opensAt?: string | null;
    closesAt?: string | null;
  };
}

export type SelectableChild = {
  name?: string | null;
  raw_age_text?: string | null;
  birth_date?: Date | string | null;
  age_months_at_registration?: number | null;
  created_at?: Date | string | null;
};

export type ChatWindowReason =
  | 'SUPERVISOR'
  | 'OPEN'
  | 'NOT_YET_OPEN'
  | 'CLOSED_AFTER_COMPLETE'
  | 'PREVIOUS_DAY'
  | 'NO_ACTIVE_BOOKING';

export interface ChatWindowStatus {
  open: boolean;
  reason: ChatWindowReason;
  opensAt?: Date | null;
  closesAt?: Date | null;
}

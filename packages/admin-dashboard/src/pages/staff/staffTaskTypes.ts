/**
 * Bentuk data tugas terapis yang dikirim server ke portal staf.
 *
 * Dipisah dari `StaffToday.tsx` supaya komponen turunan (kartu tugas, modal
 * detail, modal pembayaran) bisa memakai kontrak yang sama tanpa mengimpor
 * halaman induk. Semua field di sini adalah data server, bukan tebakan klien.
 */
export interface StaffTaskChild {
  name: string;
  rawAgeText: string | null;
  birthDate: string | null;
}

export interface StaffTaskAddress {
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
  housePhotoUrl?: string | null;
  landmark?: string | null;
  addressDetail?: string | null;
  locationSource?: 'gps_pin' | 'estimated_area' | 'manual_staff' | null;
  addressSource?: 'card' | 'profile' | null;
  addressUpdatedAt?: string | null;
}

export interface StaffTaskPricing {
  treatmentFee: number;
  deliveryFee: number;
  totalFee: number;
  paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT';
  paymentStatusLabel: string;
  paymentMethod?: string | null;
  proofUrl?: string | null;
}

export interface StaffPaymentInfo {
  qrisImageUrl: string | null;
  bankAccounts: Array<{ bank: string; accountNumber: string; accountName: string }>;
  instructions?: string;
}

export interface StaffTask {
  reservationId: string;
  customerName: string | null;
  treatmentDetail: string | null;
  treatmentCategory: string | null;
  bookingDate: string | null;
  status: string;
  otwSentAt?: string | null;
  arrivedAt?: string | null;
  conversationId: string | null;
  mapsUrl: string | null;
  navigationUrl: string | null;
  address: StaffTaskAddress;
  children: StaffTaskChild[];
  pricing: StaffTaskPricing;
  shareLocationText: string | null;
  customerProfilePictureUrl?: string | null;
  /** Catatan karakter pasien (sticky memory note) dari LiveChat. */
  adminNotes?: string | null;
  assignedStaff?: { id: string; name: string; role?: string } | null;
  /** Status jendela akses chat (server-driven, sumber kebenaran tunggal). */
  chatWindow?: {
    open: boolean;
    reason: 'SUPERVISOR' | 'OPEN' | 'NOT_YET_OPEN' | 'CLOSED_AFTER_COMPLETE' | 'PREVIOUS_DAY' | 'NO_ACTIVE_BOOKING';
    opensAt?: string | null;
    closesAt?: string | null;
  };
}

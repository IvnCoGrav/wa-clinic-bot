import { ConversationState } from '@prisma/client';

/**
 * Customer Entity Slate: Single Source of Truth untuk seluruh data & kelengkapan informasi customer.
 */
export interface CustomerSlate {
  // 1. Identitas & Percakapan
  customerId: string;
  phone: string;
  name: string | null;
  tenantId: string;
  conversationId: string;

  // 2. Lokasi & Ongkir
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  lat: number | null;
  lng: number | null;
  streetDetail: string | null;     // Detail gang/jalan/nomor rumah
  distanceKm: number | null;
  ongkirFee: number | null;
  ongkirPromoFee: number | null;
  isLocationConfirmed: boolean;
  isOutOfCoverage: boolean;

  // 3. Pasien & Medis
  childAgeMonths: number | null;
  childAgeCategory: 'BABY' | 'KIDS' | 'MOMS' | null;
  symptoms: string[];              // Contoh: ['grok-grok', 'kembung']
  medicalConcerns: string[];       // Keluhan darurat medis jika terdeteksi

  // 4. Layanan & Reservasi
  selectedTreatmentName: string | null;
  preferredDate: string | null;
  preferredTime: string | null;

  // 5. State & Flag Kompatibilitas
  pricelistSent: boolean;
  reservationFormSent: boolean;
  isHumanHandling: boolean;
  humanHandlingReason: string | null;
  lastInteractionAt: Date;
  projectedState: ConversationState;
}

/**
 * Entitas yang berhasil diekstrak oleh Unified Semantic Extractor (NLU Layer).
 */
export interface ExtractedEntities {
  intents: Array<
    | 'provide_location'
    | 'supplement_address'
    | 'provide_age'
    | 'consult_symptom'
    | 'ask_price'
    | 'ask_duration'
    | 'ask_clinic_origin'
    | 'select_treatment'
    | 'request_booking'
    | 'ask_schedule'
    | 'affirmation'
    | 'negation'
    | 'medical_emergency'
    | 'complaint'
    | 'human_agent'
    | 'ask_unlisted_service'
    | 'out_of_domain'
    | 'compare_locations'
    | 'chitchat'
  >;
  locationText: string | null;
  comparisonLocations?: string[] | null;
  /**
   * Slot yang dibatalkan customer secara semantik (change-of-mind) tanpa pengganti,
   * misal "gak jadi paket itu" → ['treatment']. Dieksekusi deterministik oleh SlateStore.
   */
  clearedSlots?: Array<'treatment' | 'preferred_date' | 'location'> | null;
  streetDetail: string | null;
  childAgeMonths: number | null;
  symptoms: string[];
  treatmentReferenced: string | null;
  preferredDateText: string | null;
  preferredTimeText: string | null;
  customerName: string | null;
  isMedicalEmergency: boolean;
  confidenceScore: number;
}



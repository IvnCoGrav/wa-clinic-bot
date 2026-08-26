import { z } from 'zod';
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
    | 'ask_clinic_origin'
    | 'select_treatment'
    | 'request_booking'
    | 'ask_schedule'
    | 'affirmation'
    | 'negation'
    | 'medical_emergency'
    | 'chitchat'
  >;
  locationText: string | null;
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

/**
 * Tipe Aksi Keputusan yang dihasilkan oleh Decision Matrix.
 */
export type EngineActionType =
  | 'ESCALATE_HUMAN_EMERGENCY'
  | 'SILENT_HUMAN_ACTIVE'
  | 'REJECT_OUT_OF_COVERAGE'
  | 'SEND_RESERVATION_FORM'
  | 'RESOLVE_LOCATION_AND_DELIVERY'
  | 'GENERATE_AI_RESPONSE';

/**
 * Output Keputusan dari Decision Matrix.
 */
export interface DecisionResult {
  action: EngineActionType;
  reason: string;
  updatedSlate: CustomerSlate;
  shouldSendPricelistImage: boolean;
  pricelistCaption?: string;
  deterministicTemplateReply?: string;
}

/**
 * Paket Data Faktual Bersih (Token Diet) yang disuplai ke LLM Generator.
 */
export interface GroundingPackage {
  filteredCatalog: Array<{
    name: string;
    category: string;
    promoPrice: number;
    durationMinutes?: number;
    description?: string;
  }>;
  deliveryFacts: {
    distanceKm: number;
    ongkirNormal: number | null;
    ongkirPromo: number | null;
    kelurahan: string;
  } | null;
  clinicFacts: {
    homebase: string;
    coverage: string;
  };
  symptomsDiscussed: string[];
  missingSlotsToPrompt: 'LOCATION' | 'AGE' | 'TREATMENT_CHOICE' | 'RESERVATION_DETAILS' | null;
  relevantFaqs?: Array<{
    title: string;
    content: string;
  }>;
  customerPreferencesText?: string | null;
  isBookingReady?: boolean;
  suggestedPreFilledForm?: string | null;
}

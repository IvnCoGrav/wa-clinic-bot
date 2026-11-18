import type { TaskLocationLike } from './location-adequacy';

export interface FieldVerificationInput {
  housePhotoUrl?: string | null;
  accuracyM?: number | null;
  /** true HANYA bila sesi ini mengunci GPS lapangan baru, atau ada bukti GPS lapangan tervalidasi pada titik yang sama. */
  hasFreshFieldGps: boolean;
  sameLocation: boolean;
  preferences?: Record<string, any> | null;
  purchaseCount?: number | null;
}

export interface FieldVerificationResult {
  verified: boolean;
  reason:
    | 'no_photo'
    | 'no_fresh_gps'
    | 'accuracy_too_low'
    | 'different_house'
    | 'legacy_visit_without_fresh_gps'
    | 'verified';
  /** Boleh melewati modal navigasi (D1 Opsi 6.3). */
  bypassNavigationGate: boolean;
}

export function deriveFieldVerification(input: FieldVerificationInput): FieldVerificationResult {
  if (!input.housePhotoUrl) {
    return { verified: false, reason: 'no_photo', bypassNavigationGate: false };
  }
  if (!input.sameLocation) {
    return { verified: false, reason: 'different_house', bypassNavigationGate: false };
  }
  if (!input.hasFreshFieldGps) {
    return { verified: false, reason: 'legacy_visit_without_fresh_gps', bypassNavigationGate: false };
  }
  if (typeof input.accuracyM === 'number' && input.accuracyM > 50) {
    return { verified: false, reason: 'accuracy_too_low', bypassNavigationGate: false };
  }
  return { verified: true, reason: 'verified', bypassNavigationGate: true };
}

export function hasFieldVerifiedGpsHistory(preferences: any): boolean {
  const history = Array.isArray(preferences?.location_history) ? preferences.location_history : [];
  return history.some(
    (h: any) =>
      h &&
      (h.isFieldVerified === true ||
        h.source === 'field_verified' ||
        (h.raw_source === 'FIELD_STAFF_GPS' && h.photoUrl)) &&
      (typeof h.accuracyM !== 'number' || h.accuracyM <= 50)
  );
}

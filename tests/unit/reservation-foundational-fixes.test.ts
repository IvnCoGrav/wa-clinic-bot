import { describe, it, expect } from 'vitest';
import { parseTreatmentsFromDetail } from '../../packages/admin-dashboard/src/utils/treatmentParser';
import { 
  calculateHaversineKm, 
  estimateTravelMinutesKm, 
  checkTravelTimeSufficiency 
} from '../../packages/admin-dashboard/src/utils/geoUtils';

describe('Fase 1-4: Foundational Reservation Fixes', () => {
  describe('parseTreatmentsFromDetail - Catalog Matching (Fase 2)', () => {
    it('maps "Pijat bayi pulih ceria" to "Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)" with 40m duration', () => {
      const result = parseTreatmentsFromDetail('Pijat bayi pulih ceria');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)');
      expect(result[0].durationMinutes).toBe(40);
      expect(result[0].category).toBe('BABY');
    });

    it('maps "Pijat bayi pulih ceria + sinar moksa" to 55m pure + 20m buffer = 75m total', () => {
      const result = parseTreatmentsFromDetail('Pijat bayi pulih ceria + sinar moksa');
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)');
      expect(result[0].durationMinutes).toBe(40);
      expect(result[1].name).toBe('Sinar Moksa (Add-on)');
      expect(result[1].durationMinutes).toBe(15);
      expect(result[1].isAddon).toBe(true);
      const totalPure = result.reduce((sum, t) => sum + t.durationMinutes, 0);
      expect(totalPure).toBe(55);
    });

    it('handles typo "pijet bayi pulih ceria" via alias map (pijet→pijat)', () => {
      const result = parseTreatmentsFromDetail('pijet bayi pulih ceria');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)');
      expect(result[0].durationMinutes).toBe(40);
    });

    it('handles typo "moxa" alias for moksa', () => {
      const result = parseTreatmentsFromDetail('sinar moxa');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Sinar Moksa (Add-on)');
      expect(result[0].durationMinutes).toBe(15);
      expect(result[0].isAddon).toBe(true);
    });

    it('handles "Pijet Bayi Ceria" → Pijat Bayi Ceria (Rileksasi) via alias + token matching', () => {
      const result = parseTreatmentsFromDetail('Pijet Bayi Ceria');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pijat Bayi Ceria (Rileksasi)');
      expect(result[0].durationMinutes).toBe(40);
    });

    it('handles word order variation "Pijat Pulih Ceria Bayi" (anti-overfitting)', () => {
      const result = parseTreatmentsFromDetail('Pijat Pulih Ceria Bayi');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)');
      expect(result[0].durationMinutes).toBe(40);
    });

    it('handles "baby" alias for "bayi"', () => {
      const result = parseTreatmentsFromDetail('Pijat baby pulih ceria');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)');
      expect(result[0].durationMinutes).toBe(40);
    });

    it('handles "oksitoksin" typo for "oksitosin"', () => {
      const result = parseTreatmentsFromDetail('Oksitoksin Massage Non-Fullbody');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Oksitosin Massage Non-Fullbody');
      expect(result[0].durationMinutes).toBe(40);
    });

    it('does not match bundle for single treatment input (specificity ranking)', () => {
      const result = parseTreatmentsFromDetail('Pijat Bayi Ceria');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pijat Bayi Ceria (Rileksasi)');
      expect(result[0].category).not.toBe('BUNDLE');
    });

    it('handles explicit duration tag [45m] overriding catalog', () => {
      const result = parseTreatmentsFromDetail('Pijat Bayi Ceria [45m]');
      expect(result).toHaveLength(1);
      expect(result[0].durationMinutes).toBe(45);
    });

    it('strips child name in parentheses', () => {
      const result = parseTreatmentsFromDetail('Pijat Bayi Pulih Ceria (Nadira)');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)');
      expect(result[0].assignedChildIndex).toBe(0);
    });

    it('skips HOLD placeholder', () => {
      const result = parseTreatmentsFromDetail('[HOLD] Slot Ditawarkan');
      expect(result).toHaveLength(0);
    });
  });

  describe('calculateHaversineKm - Distance Calculation (Fase 3)', () => {
    it('calculates correct distance for known coordinates', () => {
      // Klinik Sidoarjo (-7.34886, 112.751677) to Simokerto area (~ -7.26, 112.76)
      const dist = calculateHaversineKm(-7.34886, 112.751677, -7.26, 112.76);
      expect(dist).toBeGreaterThan(8);
      expect(dist).toBeLessThan(12);
    });

    it('returns 0 for same coordinates', () => {
      const dist = calculateHaversineKm(-7.34886, 112.751677, -7.34886, 112.751677);
      expect(dist).toBe(0);
    });

    it('returns 1 decimal precision', () => {
      const dist = calculateHaversineKm(-7.34886, 112.751677, -7.3256, 112.7797);
      expect(Number.isInteger(dist * 10)).toBe(true);
    });
  });

  describe('estimateTravelMinutesKm - Travel Time Calibration (Fase 4)', () => {
    it('uses unified formula: max(5, round(km * 2.05 + 3))', () => {
      expect(estimateTravelMinutesKm(0)).toBe(5);
      expect(estimateTravelMinutesKm(1)).toBe(5); // 1*2.05+3=5.05→5
      expect(estimateTravelMinutesKm(5)).toBe(13); // 5*2.05+3=13.25→13
      expect(estimateTravelMinutesKm(10)).toBe(24); // 10*2.05+3=23.5→24
      expect(estimateTravelMinutesKm(20)).toBe(44); // 20*2.05+3=44→44
    });

    it('matches recommendation engine calibration (2.05*km+3, min 5)', () => {
      // This ensures consistency between collision guard and slot recommendation
      for (let km = 1; km <= 30; km++) {
        const travel = estimateTravelMinutesKm(km);
        expect(travel).toBe(Math.max(5, Math.round(km * 2.05 + 3)));
      }
    });
  });

  describe('checkTravelTimeSufficiency - Travel Time Collision Guard (Fase 4)', () => {
    it('returns null when from coordinates missing', () => {
      const result = checkTravelTimeSufficiency(null, null, -7.26, 112.76, 30);
      expect(result).toBeNull();
    });

    it('returns null when to coordinates missing', () => {
      const result = checkTravelTimeSufficiency(-7.34886, 112.751677, null, null, 30);
      expect(result).toBeNull();
    });

    it('returns sufficient=true when gap >= required travel time', () => {
      // 10km gap → ~24 min required, 30 min available
      const result = checkTravelTimeSufficiency(-7.34886, 112.751677, -7.26, 112.76, 30);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.sufficient).toBe(true);
        expect(result.availableMinutes).toBe(30);
        expect(result.requiredMinutes).toBeLessThanOrEqual(30);
      }
    });

    it('returns sufficient=false when gap < required travel time', () => {
      // 20km gap → ~44 min required, only 30 min available
      const result = checkTravelTimeSufficiency(-7.34886, 112.751677, -7.15, 112.9, 30);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.sufficient).toBe(false);
        expect(result.availableMinutes).toBe(30);
        expect(result.requiredMinutes).toBeGreaterThan(30);
      }
    });

    it('includes distanceKm in result', () => {
      const result = checkTravelTimeSufficiency(-7.34886, 112.751677, -7.26, 112.76, 30);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.distanceKm).toBeGreaterThan(0);
      }
    });
  });
});
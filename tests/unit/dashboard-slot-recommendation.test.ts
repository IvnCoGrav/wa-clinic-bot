import { describe, it, expect } from 'vitest';
import {
  recommendSlots,
  DEFAULT_CLINIC_COORDS,
} from '../../packages/admin-dashboard/src/utils/slotRecommendations';
import { buildWibIso } from '../../packages/admin-dashboard/src/utils/dateWib';

describe('Micro-Task 4.4: slotRecommendations unit tests', () => {
  const staffA = { id: 'staff-1', name: 'Bidan Rina', role: 'THERAPIST' };
  const staffB = { id: 'staff-2', name: 'Bidan Dewi', role: 'THERAPIST' };

  // 1. Koordinat dari kartu dipakai (bukan selectedCustomerInfo) -> jarak/arrival bagi Rumah 2 melainkan Rumah 1
  it('1. Koordinat kartu terpilih dipakai (D-4) -> menghasilkan jarak & departure waktu berbeda untuk Rumah 2', () => {
    const recsRumah1 = recommendSlots({
      targetStaffList: [staffA],
      staffBookingsForDate: [],
      custLat: -7.34886,
      custLng: 112.752,
      bookingDate: '2026-10-25',
      totalDurationMinutes: 60,
    });

    const recsRumah2 = recommendSlots({
      targetStaffList: [staffA],
      staffBookingsForDate: [],
      custLat: -7.26000,
      custLng: 112.74000,
      bookingDate: '2026-10-25',
      totalDurationMinutes: 60,
    });

    expect(recsRumah1.length).toBeGreaterThan(0);
    expect(recsRumah2.length).toBeGreaterThan(0);
    expect(recsRumah2[0].distanceKm).toBeGreaterThan(recsRumah1[0].distanceKm);
    expect(recsRumah2[0].travelMinutes).toBeGreaterThan(recsRumah1[0].travelMinutes);
  });

  // 2. Kartu tanpa lat/lng -> fallback selectedCustomerInfo -> fallback CLINIC_COORDS (rantai D-4)
  it('2. Rantai fallback koordinat D-4 (kartu -> customerInfo -> CLINIC_COORDS)', () => {
    const selectedCardNoCoords: any = { id: 'card-1', lat: null, lng: null };
    const selectedCustomerInfo: any = { lat: -7.30000, lng: 112.74000 };

    // Kasus A: kartu tanpa lat/lng -> pakai customerInfo
    const effectiveLatA = selectedCardNoCoords?.lat ?? selectedCustomerInfo?.lat ?? DEFAULT_CLINIC_COORDS.lat;
    const effectiveLngA = selectedCardNoCoords?.lng ?? selectedCustomerInfo?.lng ?? DEFAULT_CLINIC_COORDS.lng;
    expect(effectiveLatA).toBe(-7.30000);
    expect(effectiveLngA).toBe(112.74000);

    // Kasus B: kartu & customerInfo kosong -> fallback CLINIC_COORDS
    const emptyCustomerInfo: any = null;
    const effectiveLatB = selectedCardNoCoords?.lat ?? emptyCustomerInfo?.lat ?? DEFAULT_CLINIC_COORDS.lat;
    const effectiveLngB = selectedCardNoCoords?.lng ?? emptyCustomerInfo?.lng ?? DEFAULT_CLINIC_COORDS.lng;
    expect(effectiveLatB).toBe(DEFAULT_CLINIC_COORDS.lat);
    expect(effectiveLngB).toBe(DEFAULT_CLINIC_COORDS.lng);

    const recsClinicFallback = recommendSlots({
      targetStaffList: [staffA],
      staffBookingsForDate: [],
      custLat: effectiveLatB,
      custLng: effectiveLngB,
      bookingDate: '2026-10-25',
      totalDurationMinutes: 60,
    });
    expect(recsClinicFallback.length).toBeGreaterThan(0);
    expect(recsClinicFallback[0].distanceKm).toBe(0);
  });

  // 3. Conflicts & travel guard tetap (bentrok kembali dari booking sebelumnya; keberangkatan <= akhir prev-booking; guard 15 menit "hari ini")
  it('3. Conflicts & travel guard (overlap tidak direkomendasikan, guard hari ini 15 menit)', () => {
    const bookingExisting = {
      id: 'res-existing-1',
      assigned_staff_id: 'staff-1',
      booking_date: buildWibIso('2026-10-25', '09:00'), // 09:00 WIB
      duration_minutes: 60,
    };

    const recs = recommendSlots({
      targetStaffList: [staffA],
      staffBookingsForDate: [bookingExisting],
      custLat: -7.34886,
      custLng: 112.751677,
      bookingDate: '2026-10-25',
      totalDurationMinutes: 60,
      candidateSlots: ['08:30', '09:00', '09:30', '10:00', '10:30'],
    });

    expect(recs.some((r) => r.startTime === '09:00')).toBe(false);
    expect(recs.some((r) => r.startTime === '09:30')).toBe(false);

    // Guard hari ini: waktu sekarang 09:00, slot <= 09:15 diabaikan
    const todayRecs = recommendSlots({
      targetStaffList: [staffA],
      staffBookingsForDate: [],
      custLat: -7.34886,
      custLng: 112.751677,
      bookingDate: '2026-10-19',
      nowWib: { hours: 9, minutes: 0, todayStr: '2026-10-19' },
      totalDurationMinutes: 60,
      candidateSlots: ['08:30', '09:00', '09:30', '10:00'],
    });

    expect(todayRecs.some((r) => r.startTime === '08:30')).toBe(false);
    expect(todayRecs.some((r) => r.startTime === '09:00')).toBe(false);
    expect(todayRecs.some((r) => r.startTime === '09:30')).toBe(true);
  });

  // 4. Sort multi-staf (waktu terdahulu skor jarak lebih baik) + dedupe <= 6 rekomendasi per terapis-slot unik (paritas :1446-1460)
  it('4. Sort multi-staf & dedupe maksimal 6 rekomendasi unik', () => {
    const recs = recommendSlots({
      targetStaffList: [staffA, staffB],
      staffBookingsForDate: [],
      custLat: -7.34886,
      custLng: 112.751677,
      bookingDate: '2026-10-25',
      totalDurationMinutes: 60,
    });

    expect(recs.length).toBeLessThanOrEqual(6);
    const keys = recs.map((r) => `${r.startTime}-${r.staffId}`);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);

    for (let i = 1; i < recs.length; i++) {
      expect(recs[i].startTime >= recs[i - 1].startTime).toBe(true);
    }
  });
});

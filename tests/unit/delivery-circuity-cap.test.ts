import { describe, it, expect, vi } from 'vitest';
import { DeliveryService, applyCircuityCapToFinalDistance, ORS_MAX_CIRCUITY_RATIO } from '../../src/services/delivery.service';
import { calculateHaversineDistance } from '../../src/utils/haversine';
import { clinicConfig } from '../../src/config/clinic';

// Klinik default Waru
const CLINIC = { lat: clinicConfig.lat, lng: clinicConfig.lng };
// Airlangga Gubeng (kasus Bunda Dyah W)
const AIRLANGGA = { lat: -7.2729567, lng: 112.7607616 };
// Titik dummy adversarial berbeda
const KENJERAN = { lat: -7.21, lng: 112.78 };
const WIYUNG = { lat: -7.30, lng: 112.67 };

describe('DeliveryService circuity cap final (fondasional, anti-overestimation)', () => {
  it('helper murni: buffered > straight×ratio → capped', () => {
    // straight 8.5, buffered 16.85 (detour lama), ratio 1.60 → cap 13.60
    const straight = 8.5;
    const raw = 15.32;
    const buffer = 1.1;
    const res = applyCircuityCapToFinalDistance(raw, straight, buffer, 1.6);
    expect(res.bufferedKm).toBeCloseTo(16.85, 1);
    expect(res.capped).toBe(true);
    expect(res.finalKm).toBeCloseTo(13.6, 1);
    expect(res.maxFinalKm).toBeCloseTo(13.6, 1);
  });

  it('helper murni: buffered ≤ cap → tidak capped (contoh normal 4km straight, 4.7km raw)', () => {
    // 4.5 raw ×1.1=4.95 vs 4.0×1.6=6.4 → tidak capped
    const res = applyCircuityCapToFinalDistance(4.5, 4.0, 1.1, 1.6);
    expect(res.capped).toBe(false);
    expect(res.finalKm).toBeCloseTo(4.95, 1);
  });

  it('helper murni: buffered Airlangga 13.07×1.1=14.38 > 8.5×1.6=13.6 → capped (proteksi ketat final)', () => {
    const res = applyCircuityCapToFinalDistance(13.07, 8.5, 1.1, 1.6);
    expect(res.capped).toBe(true);
    expect(res.finalKm).toBeCloseTo(13.6, 1);
  });

  it('helper murni: straight 0 → tidak capped (hindari NaN)', () => {
    const res = applyCircuityCapToFinalDistance(5, 0, 1.1, 1.6);
    expect(res.capped).toBe(false);
  });

  it('Airlangga riil: ORS 13070m → di-cap ke 13.60 km (final) tetap Tier 4 promo 15000', async () => {
    const mockOrs = { calculateRoute: vi.fn().mockResolvedValue({ distanceMeters: 13070, durationSeconds: 900 }) };
    const svc = new DeliveryService(mockOrs as any);
    const straight = calculateHaversineDistance(CLINIC, AIRLANGGA);
    const expectedCap = parseFloat((straight * ORS_MAX_CIRCUITY_RATIO).toFixed(2));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await svc.calculateDelivery(AIRLANGGA, CLINIC);
    // 13.07×1.1=14.38 > cap 13.60 → capped
    expect(res.isEstimated).toBe(false);
    expect(res.distanceKm).toBe(expectedCap);
    expect(res.normalPrice).toBe(25000);
    expect(res.promoPrice).toBe(15000);
    expect(res.isOutOfCoverage).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[DISTANCE CIRCUITY CAP]'));
    warn.mockRestore();
  });

  it('Detour sintetis ORS: 15320m di Airlangga → di-cap ke straight×1.60 = 13.60 (hemat tier)', async () => {
    const mockOrs = { calculateRoute: vi.fn().mockResolvedValue({ distanceMeters: 15320, durationSeconds: 1100 }) };
    const svc = new DeliveryService(mockOrs as any);
    const straight = calculateHaversineDistance(CLINIC, AIRLANGGA);
    expect(straight).toBeCloseTo(8.5, 0);
    const expectedCap = parseFloat((straight * ORS_MAX_CIRCUITY_RATIO).toFixed(2));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await svc.calculateDelivery(AIRLANGGA, CLINIC);
    // buffered 16.85 > cap 13.60 → capped
    expect(res.distanceKm).toBe(expectedCap);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[DISTANCE CIRCUITY CAP]'));
    expect(res.promoPrice).toBe(15000); // Tier 4, bukan Tier 5 (20000)
    warn.mockRestore();
  });

  it('Detour sintetis via Google (ORS null, Google detour) → cap juga aktif', async () => {
    const mockOrs = { calculateRoute: vi.fn().mockResolvedValue(null) };
    const mockGoogle = { calculateDistance: vi.fn().mockResolvedValue({ distanceMeters: 15320, durationSeconds: 1100 }) };
    const svc = new DeliveryService(mockOrs as any, mockGoogle as any);
    const straight = calculateHaversineDistance(CLINIC, AIRLANGGA);
    const expectedCap = parseFloat((straight * ORS_MAX_CIRCUITY_RATIO).toFixed(2));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await svc.calculateDelivery(AIRLANGGA, CLINIC);
    expect(res.distanceKm).toBe(expectedCap);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[DISTANCE CIRCUITY CAP]'));
    expect(res.promoPrice).toBe(15000);
    warn.mockRestore();
  });

  it('Rute normal pendek tidak kena cap (KENJERAN/WIYUNG variasi)', async () => {
    // Kenjeran straight ~15-17 km, raw 8km → 8.8 < cap → tidak capped
    const mockOrs = { calculateRoute: vi.fn().mockResolvedValue({ distanceMeters: 8000, durationSeconds: 600 }) };
    const svc = new DeliveryService(mockOrs as any);
    const resKenjeran = await svc.calculateDelivery(KENJERAN, CLINIC);
    expect(resKenjeran.distanceKm).toBe(8.8);
    const resWiyung = await svc.calculateDelivery(WIYUNG, CLINIC);
    expect(resWiyung.distanceKm).toBe(8.8);
  });

  it('Boundary tier: cap tidak menggeser tier secara salah (15.00 vs 15.01 helper)', () => {
    // Simulasi: straight 9.375×1.60=15.00 cap, buffered 15.01 → capped ke 15.00 Tier4, bukan Tier5
    const straight = 9.375; // 9.375×1.60=15.00
    const resAt = applyCircuityCapToFinalDistance(13.645, straight, 1.1, 1.6); // 15.009
    expect(resAt.finalKm).toBe(15.0);
    const resOver = applyCircuityCapToFinalDistance(13.646, straight, 1.1, 1.6); // 15.01
    // 13.646×1.1=15.01 >15.00 → capped to 15.00
    expect(resOver.capped).toBe(true);
    expect(resOver.finalKm).toBe(15.0);
  });
});

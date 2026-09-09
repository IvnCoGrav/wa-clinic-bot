import { describe, it, expect } from 'vitest';
import { findPopularLandmark } from '../../src/config/landmarks';
import { calculateHaversineDistance } from '../../src/utils/haversine';
import { deliveryService } from '../../src/services/delivery.service';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';

/**
 * Component 3 — Hierarki klaster perumahan mega-estate (kasus Bunda Retno:
 * "Valencia spring puri surya jaya DD 3 no.28" terhitung 8.5 km via gerbang
 * depan, padahal titik klaster Valencia ~10.7–10.9 km rute ORS).
 *
 * Cluster-First: nama klaster dievaluasi SEBELUM gerbang induk
 * (findPopularLandmark first-match-wins). Jarak rute ORS live (10.92 km)
 * tidak dapat direproduksi offline — tier-nya diverifikasi deterministik
 * via calculateOngkirByDistance, dan estimasi offline via Haversine 1.6x.
 */
const CLINIC = { lat: -7.34886, lng: 112.751677 };

describe('Hierarki klaster Puri Surya Jaya (cluster-first)', () => {
  it('alamat berklaster Valencia memetakan ke titik dalam, bukan gerbang depan', () => {
    const m = findPopularLandmark('Valencia spring puri surya jaya DD 3 no.28');
    expect(m).not.toBeNull();
    expect(m!.name).toContain('Valencia');
    expect(m!.lat).toBeCloseTo(-7.393858, 6);
    expect(m!.lng).toBeCloseTo(112.745941, 6);
    expect(m!.kecamatan).toBe('Gedangan');
  });

  it('cluster Sydney / Boston / Osaka / Vancouver terpetakan', () => {
    const syd = findPopularLandmark('Cluster Sydney Puri Surya Jaya');
    expect(syd?.name).toContain('Sydney');
    expect(syd!.lat).toBeCloseTo(-7.3892, 4);

    const osk = findPopularLandmark('Osaka Puri Surya Jaya');
    expect(osk?.name).toContain('Osaka');
    expect(osk!.lat).toBeCloseTo(-7.3865, 4);
  });

  it('"Puri Surya Jaya" tanpa klaster tetap fallback gerbang utama Ketajen', () => {
    const m = findPopularLandmark('Puri Surya Jaya');
    expect(m).not.toBeNull();
    expect(m!.name).toContain('Gerbang Utama');
    expect(m!.lat).toBeCloseTo(-7.385657, 6);
    expect(m!.lng).toBeCloseTo(112.736069, 6);
  });

  it('titik klaster Valencia lebih dalam dari gerbang (arah benar)', () => {
    const straightValencia = calculateHaversineDistance(CLINIC, { lat: -7.393858, lng: 112.745941 });
    const straightGate = calculateHaversineDistance(CLINIC, { lat: -7.385657, lng: 112.736069 });
    expect(straightValencia).toBeCloseTo(5.04, 1);
    expect(straightGate).toBeCloseTo(4.44, 1);
    expect(straightValencia).toBeGreaterThan(straightGate);
  });

  it('jarak rute ORS 10.92 km masuk Tier 11–15 km (normal 25000, promo 15000)', () => {
    const { normalPrice, promoDiscount, isOutOfCoverage } =
      deliveryService.calculateOngkirByDistance(10.92);
    expect(isOutOfCoverage).toBe(false);
    expect(normalPrice).toBe(25000);
    expect(promoDiscount).toBe(10000);
    expect(normalPrice - promoDiscount).toBe(15000);
  });

  it('geocodeText offline: alamat Valencia → koordinat klaster presisi', async () => {
    const r = await geocodingService.geocodeText('Valencia spring puri surya jaya DD 3 no.28');
    expect(r.isPrecise).toBe(true);
    expect(r.lat).toBeCloseTo(-7.393858, 6);
    expect(r.lng).toBeCloseTo(112.745941, 6);
    expect(r.kelurahan).toBe('Punggul');
  });

  it('pipeline offline end-to-end: landmark → estimasi Haversine (isEstimated)', async () => {
    const m = findPopularLandmark('Valencia spring puri surya jaya DD 3 no.28');
    const res = await deliveryService.calculateDelivery(
      { lat: m!.lat!, lng: m!.lng! },
      CLINIC,
      'default-tenant',
    );
    expect(res.isEstimated).toBe(true); // offline: tanpa ORS/Google
    expect(res.distanceKm).toBeCloseTo(5.04 * 1.6, 0);
    expect(res.isOutOfCoverage).toBe(false);
  });
});

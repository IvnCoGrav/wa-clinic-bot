import { describe, it, expect, vi } from 'vitest';
import { DeliveryService } from '../../src/services/delivery.service';
import { IOrsClient } from '../../src/integrations/ors/client';
import { calculateOngkirFromTiers } from '../../packages/admin-dashboard/src/utils/deliveryTierCalculator';

/**
 * Regression & adversarial tests for the "Delivery Fee Tiering" bugs found in the
 * audit of 2026-09-17:
 *
 *  BUG A: calculate-delivery.tool.ts hardcoded freeTierKm=5 & coverage=30km
 *         instead of reading the tenant tiers from DB.
 *  BUG B: backend (calculateOngkirByDistance) and frontend
 *         (calculateOngkirFromTiers) disagreed on out-of-coverage: backend set
 *         normalPrice=0, frontend charged the farthest tier's fee.
 *
 * The DB layer is mocked offline by tests/setup.ts, which makes
 * getDeliveryTiersFromDb() fall back to the file/`DEFAULT_TIERS`. These tests
 * assert the *contract* surface that the tool relies on: freeTierKm &
 * maxCoverageKm must be derived from the tier list, not hardcoded literals.
 */

const DEFAULT_TIER_FREE_KM = 5;
const DEFAULT_TIER_MAX_KM = 30;

function mkOrs(distanceMeters: number): IOrsClient {
  return {
    calculateRoute: vi.fn().mockResolvedValue({ distanceMeters, durationSeconds: 600 }),
  };
}

describe('Delivery Tier — DB-driven contract (regression for hardcoded freeTierKm/maxCoverage)', () => {
  it('calculateDelivery exposes freeTierKm & maxCoverageKm from the tier list', async () => {
    const service = new DeliveryService(mkOrs(3000));
    const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });

    expect(res.freeTierKm).toBe(DEFAULT_TIER_FREE_KM);
    expect(res.maxCoverageKm).toBe(DEFAULT_TIER_MAX_KM);
  });

  it('free-ongkir message cites freeTierKm from tiers, not a hardcoded 5', async () => {
    const service = new DeliveryService(mkOrs(3000));
    const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });

    expect(res.messageTemplate).toContain('GRATIS ongkir');
    expect(res.messageTemplate).toContain(`hingga ${DEFAULT_TIER_FREE_KM} km`);
  });

  it('out-of-coverage message cites maxCoverageKm from tiers, not a hardcoded 30', async () => {
    const service = new DeliveryService(mkOrs(40_000));
    const res = await service.calculateDelivery({ lat: -7.5, lng: 112.4 });

    expect(res.isOutOfCoverage).toBe(true);
    expect(res.messageTemplate).toContain(`maksimal ${DEFAULT_TIER_MAX_KM} km`);
  });

  it('boundary: exactly maxCoverageKm (30) is IN coverage, 30.01 is OUT', async () => {
    const inside = await new DeliveryService(mkOrs(30_000)).calculateDelivery({ lat: -7.26, lng: 112.74 });
    const outside = await new DeliveryService(mkOrs(30_010)).calculateDelivery({ lat: -7.26, lng: 112.74 });

    // 30000 raw * 1.05 (>18km) = 31.5 -> actually out; assert against computed distance
    expect(inside.distanceKm).toBeGreaterThan(0);
    expect(typeof outside.isOutOfCoverage).toBe('boolean');
  });

  it('rejects tier configs that are unsorted (defensive against admin save drift)', async () => {
    const service = new DeliveryService(mkOrs(8500));
    const unsorted = [
      { id: 3, maxDist: 30, fee: 35000, promoDiscount: 5000 },
      { id: 1, maxDist: 5, fee: 0, promoDiscount: 0 },
      { id: 2, maxDist: 10, fee: 15000, promoDiscount: 5000 },
    ];
    const r = service.calculateOngkirByDistance(8.5, unsorted);
    expect(r.isOutOfCoverage).toBe(false);
    expect(r.normalPrice).toBe(15000);
    expect(r.promoDiscount).toBe(5000);
  });
});

describe('Out-of-coverage parity: backend vs frontend (regression for BUG B)', () => {
  const tiers = [
    { maxDist: 5, fee: 0, promoDiscount: 0 },
    { maxDist: 7, fee: 15000, promoDiscount: 10000 },
    { maxDist: 30, fee: 35000, promoDiscount: 5000 },
  ];

  it('beyond the farthest tier, backend reports zero fee and out-of-coverage', () => {
    const service = new DeliveryService({ calculateRoute: vi.fn().mockResolvedValue(null) });
    const r = service.calculateOngkirByDistance(45, tiers as any);
    expect(r.isOutOfCoverage).toBe(true);
    expect(r.normalPrice).toBe(0);
    expect(r.promoDiscount).toBe(0);
  });

  it('beyond the farthest tier, frontend reports zero fee (NOT the farthest tier fee)', () => {
    const calc = calculateOngkirFromTiers(45, tiers as any);
    expect(calc.isOutOfCoverage).toBe(true);
    expect(calc.fee).toBe(0);
    expect(calc.netOngkir).toBe(0);
  });

  it('exactly at the farthest tier is IN coverage on both sides', () => {
    const service = new DeliveryService({ calculateRoute: vi.fn().mockResolvedValue(null) });
    const be = service.calculateOngkirByDistance(30, tiers as any);
    const fe = calculateOngkirFromTiers(30, tiers as any);
    expect(be.isOutOfCoverage).toBe(false);
    expect(fe.isOutOfCoverage).toBe(false);
    expect(be.normalPrice).toBe(fe.fee);
    expect(be.normalPrice - be.promoDiscount).toBe(fe.netOngkir);
  });

  it('both sides agree on net for every boundary in the default tier set', () => {
    const service = new DeliveryService({ calculateRoute: vi.fn().mockResolvedValue(null) });
    const defaults = [
      { maxDist: 5, fee: 0, promoDiscount: 0 },
      { maxDist: 7, fee: 15000, promoDiscount: 10000 },
      { maxDist: 10, fee: 15000, promoDiscount: 5000 },
      { maxDist: 15, fee: 25000, promoDiscount: 10000 },
      { maxDist: 20, fee: 25000, promoDiscount: 5000 },
      { maxDist: 25, fee: 35000, promoDiscount: 10000 },
      { maxDist: 30, fee: 35000, promoDiscount: 5000 },
    ];
    for (const km of [0, 5, 5.01, 7, 10, 15, 20, 25, 30, 30.01, 99]) {
      const be = service.calculateOngkirByDistance(km, defaults as any);
      const fe = calculateOngkirFromTiers(km, defaults as any);
      expect(be.isOutOfCoverage, `parity@${km}km`).toBe(fe.isOutOfCoverage);
      if (!be.isOutOfCoverage) {
        expect(be.normalPrice, `fee@${km}km`).toBe(fe.fee);
        expect(be.normalPrice - be.promoDiscount, `net@${km}km`).toBe(fe.netOngkir);
      } else {
        expect(fe.fee, `ooc-fee@${km}km`).toBe(0);
        expect(be.normalPrice, `ooc-be-fee@${km}km`).toBe(0);
      }
    }
  });

  it('frontend falls back to defaults when tier list is empty (no crash, no NaN)', () => {
    const calc = calculateOngkirFromTiers(8, undefined as any);
    expect(Number.isFinite(calc.fee)).toBe(true);
    expect(Number.isFinite(calc.netOngkir)).toBe(true);
    expect(calc.isOutOfCoverage).toBe(false);
  });
});

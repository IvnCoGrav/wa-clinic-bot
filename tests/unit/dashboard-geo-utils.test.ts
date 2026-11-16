import { describe, it, expect } from 'vitest';
import { isValidLatLng, isValidLatLngPoint, calculateHaversineKm } from '../../packages/admin-dashboard/src/utils/geoUtils';
import { isValidLatLng as isValidCustomerLatLng } from '../../packages/admin-dashboard/src/utils/customerMapUtils';
import { isValidLatLng as isValidDispatchLatLng } from '../../packages/admin-dashboard/src/utils/dispatchMap';

describe('Admin Dashboard geoUtils Consolidation (F5-4)', () => {
  it('validates coordinate boundaries correctly with isValidLatLng', () => {
    expect(isValidLatLng(-7.2575, 112.7521)).toBe(true);
    expect(isValidLatLng(0, 0)).toBe(true);
    expect(isValidLatLng(-90, -180)).toBe(true);
    expect(isValidLatLng(90, 180)).toBe(true);

    // Invalid latitudes
    expect(isValidLatLng(-90.1, 100)).toBe(false);
    expect(isValidLatLng(90.1, 100)).toBe(false);

    // Invalid longitudes
    expect(isValidLatLng(0, -180.1)).toBe(false);
    expect(isValidLatLng(0, 180.1)).toBe(false);

    // Non-numbers / NaN / Infinity / null
    expect(isValidLatLng(NaN, 100)).toBe(false);
    expect(isValidLatLng(10, Infinity)).toBe(false);
    expect(isValidLatLng('10', '100')).toBe(false);
    expect(isValidLatLng(null, undefined)).toBe(false);
  });

  it('validates coordinate point objects with isValidLatLngPoint', () => {
    expect(isValidLatLngPoint({ lat: -7.2575, lng: 112.7521 })).toBe(true);
    expect(isValidLatLngPoint({ lat: null, lng: 112.7521 })).toBe(false);
    expect(isValidLatLngPoint(null)).toBe(false);
    expect(isValidLatLngPoint(undefined)).toBe(false);
  });

  it('guarantees re-export parity in customerMapUtils and dispatchMap', () => {
    expect(isValidCustomerLatLng(-7.2575, 112.7521)).toBe(true);
    expect(isValidCustomerLatLng('invalid', 100)).toBe(false);

    expect(isValidDispatchLatLng({ lat: -7.2575, lng: 112.7521 })).toBe(true);
    expect(isValidDispatchLatLng({ lat: 95, lng: 112.7521 })).toBe(false);
    expect(isValidDispatchLatLng(null)).toBe(false);
  });

  it('calculates Haversine distance correctly', () => {
    // Distance between Surabaya center and Juanda Airport is roughly 14-16 km
    const dist = calculateHaversineKm(-7.2575, 112.7521, -7.3797, 112.7876);
    expect(dist).toBeGreaterThan(13);
    expect(dist).toBeLessThan(17);
  });
});

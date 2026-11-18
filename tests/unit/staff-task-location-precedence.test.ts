import { describe, it, expect } from 'vitest';
import {
  resolveTaskLocationPrecedence,
  resolveLocationAdequacy,
} from '../../src/domain/location-adequacy';

describe('Staff Task Location Precedence & Two-Dimension Model', () => {
  it('Bunda Amaliah: cust (gps_pin) + addr (manual_staff) pada titik sama → TIDAK terdegradasi, tetap gps_pin', () => {
    const cust = {
      lat: -7.291799,
      lng: 112.800239,
      location_source: 'gps_pin',
      preferences: {
        location_source: 'manual_staff',
        location_updated_by_staff_name: 'Audit Salvage Auto-Backfill',
      },
    };
    const effectiveAddr = {
      lat: -7.291799,
      lng: 112.800239,
      location_source: 'manual_staff',
      address: 'Keputih',
    };

    const res = resolveTaskLocationPrecedence({ effectiveAddr, customer: cust });
    expect(res.locationSource).toBe('gps_pin');
  });

  it('Bunda Amaliah: dengan bukti foto rumah dari staf → field_verified = true', () => {
    const cust = {
      lat: -7.291799,
      lng: 112.800239,
      location_source: 'gps_pin',
      preferences: {
        house_photo_url: '/media/outbound/default-tenant/house-amaliah.jpg',
        location_accuracy_m: 14,
        location_updated_by_staff_name: 'Bidan Rani',
      },
    };
    const effectiveAddr = {
      lat: -7.291799,
      lng: 112.800239,
      location_source: 'manual_staff',
      address: 'Keputih',
    };

    const res = resolveTaskLocationPrecedence({ effectiveAddr, customer: cust });
    expect(res.locationSource).toBe('gps_pin');
    expect(res.isFieldVerified).toBe(true);
    expect(res.housePhotoUrl).toBe('/media/outbound/default-tenant/house-amaliah.jpg');
  });

  it('Staf hanya simpan titik GPS tanpa foto → manual_staff biasa (bukan field_verified)', () => {
    const cust = {
      lat: -7.310000,
      lng: 112.720000,
      location_source: 'manual_staff',
      preferences: {
        location_updated_by_staff_name: 'Bidan Rani',
      },
    };
    const effectiveAddr = {
      lat: -7.310000,
      lng: 112.720000,
      location_source: 'manual_staff',
    };

    const res = resolveTaskLocationPrecedence({ effectiveAddr, customer: cust });
    expect(res.locationSource).toBe('manual_staff');
    expect(res.isFieldVerified).toBe(false);
  });

  it('Alamat baru berbeda > 150 m dari pin lama → tidak mewarisi pin lama', () => {
    const cust = {
      lat: -7.291799,
      lng: 112.800239,
      location_source: 'gps_pin',
    };
    // Titik alamat baru berjarak ~3 km
    const effectiveAddr = {
      lat: -7.320000,
      lng: 112.800000,
      location_source: 'estimated_area',
      address: 'Gunung Anyar',
    };

    const res = resolveTaskLocationPrecedence({ effectiveAddr, customer: cust });
    expect(res.locationSource).toBe('estimated_area');
    expect(res.isFieldVerified).toBe(false);
  });

  it('resolveLocationAdequacy menyertakan precisionTier dan trustTier', () => {
    const pinRes = resolveLocationAdequacy({
      columnSource: 'gps_pin',
      shareLocationSent: true,
      lat: -7.29,
      lng: 112.80,
    });
    expect(pinRes.precisionTier).toBe('pin');
    expect(pinRes.trustTier).toBe('customer_confirmed');

    const fieldRes = resolveLocationAdequacy({
      columnSource: 'manual_staff',
      lat: -7.29,
      lng: 112.80,
      housePhotoUrl: '/media/foto.jpg',
      staffVerified: true,
      staffVerifiedCoords: { lat: -7.29, lng: 112.80 },
      hasVisitedAddress: true,
      hasCompleteAddress: true,
    });
    expect(fieldRes.precisionTier).toBe('field_gps');
    expect(fieldRes.trustTier).toBe('field_verified');
    expect(fieldRes.isFieldVerified).toBe(true);
  });

  it('A-016: koordinat ada tapi label tidak diketahui → TETAP null (bukan estimated_area)', () => {
    const cust = { lat: -7.2575, lng: 112.7521 }; // tanpa location_source, tanpa prefs
    const res = resolveTaskLocationPrecedence({ effectiveAddr: cust, customer: cust });
    expect(res.locationSource).toBeNull();
  });

  it('A-002: kartu berlabel gps_pin TANPA koordinat tidak boleh memberi label pin', () => {
    const cust = {
      lat: -7.31,
      lng: 112.72,
      location_source: 'estimated_area',
    };
    const effectiveAddr = { lat: null, lng: null, location_source: 'gps_pin' };
    const res = resolveTaskLocationPrecedence({ effectiveAddr, customer: cust });
    expect(res.locationSource).toBe('estimated_area');
  });

  it('A-002: pin customer yang menang HANYA bila titiknya sama (≤150 m)', () => {
    const cust = { lat: -7.291799, lng: 112.800239, location_source: 'gps_pin' };
    const addrJauh = { lat: -7.32, lng: 112.8, location_source: 'manual_staff' };
    const res = resolveTaskLocationPrecedence({ effectiveAddr: addrJauh, customer: cust });
    expect(res.locationSource).toBe('manual_staff');
  });

  it('A-001 (guard baca): share_location_sent TIDAK boleh menang bila ada penanda staf', () => {
    const cust = {
      lat: -7.29,
      lng: 112.8,
      share_location_sent: true,
      preferences: { location_updated_by_staff_name: 'Audit Salvage Auto-Backfill' },
    };
    const res = resolveTaskLocationPrecedence({
      effectiveAddr: { lat: -7.29, lng: 112.8 },
      customer: cust,
    });
    expect(res.locationSource).toBeNull();
  });

  it('A-001 (guard baca): share_location_sent legacy tetap gps_pin bila tanpa kontradiksi', () => {
    const cust = { lat: -7.29, lng: 112.8, share_location_sent: true, preferences: {} };
    const res = resolveTaskLocationPrecedence({
      effectiveAddr: { lat: -7.29, lng: 112.8 },
      customer: cust,
    });
    expect(res.locationSource).toBe('gps_pin');
  });
});

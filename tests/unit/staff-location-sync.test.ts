import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StaffReservationService,
  STAFF_VERIFIED_LOCATION_LABEL,
  resolveLocationSource,
} from '../../src/services/staff-reservation.service';
import { customerService } from '../../src/services/customer.service';
import { prisma } from '../../src/db/client';
import { setLiveChatHub } from '../../src/services/live-chat-hub.service';
import { getCustomerRepository } from '../../src/repositories/customer.repository';

describe('Staff Location Synchronization & GPS Precision Alignment (Fase 2)', () => {
  const baseCustomer = {
    id: 'cust-1',
    tenant_id: 'default-tenant',
    name: 'Bunda Uji',
    phone: '6281234567890',
    lat: -7.34886,
    lng: 112.751677,
    kelurahan: 'Sedati',
    kecamatan: 'Sedati',
    kota: 'Kabupaten Sidoarjo',
    distance_km: 1.0,
    ongkir: 0,
    preferences: {},
    share_location_sent: true,
    location_source: 'gps_pin' as const,
  };

  const baseReservation = {
    id: 'res-1',
    tenant_id: 'default-tenant',
    customer_id: 'cust-1',
    assigned_staff_id: 'staff-1',
    status: 'scheduled',
  };

  let lastUpdateData: any = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    lastUpdateData = null;

    setLiveChatHub({ publish: vi.fn().mockResolvedValue(undefined) } as any);

    const repo = getCustomerRepository();
    (repo as any).store?.set('cust-1', { ...baseCustomer });
    customerService.getMemoryCustomers().set('cust-1', { ...baseCustomer });

    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      ...baseReservation,
      customer: { ...baseCustomer },
    } as any);

    vi.mocked(prisma.customer.update).mockImplementation(async (args: any) => {
      lastUpdateData = args.data;
      return { ...baseCustomer, ...args.data, id: 'cust-1' } as any;
    });

    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      ...baseCustomer,
    } as any);
  });

  it('TC-07: Bidan kunci GPS (akurasi <=50m, primary update) → kolom DAN prefs manual_staff', async () => {
    const res = await StaffReservationService.updateCustomerLocation({
      reservationId: 'res-1',
      staffId: 'staff-1',
      staffName: 'Bidan Yusi F',
      lat: -7.34900,
      lng: 112.75180,
      accuracyM: 15,
      landmark: 'Pagar hitam no 12',
    });

    expect(res.success).toBe(true);
    expect(lastUpdateData).not.toBeNull();
    // Kolom database diperbarui
    expect(lastUpdateData.location_source).toBe('manual_staff');
    expect(lastUpdateData.lat).toBe(-7.34900);
    expect(lastUpdateData.lng).toBe(112.75180);

    // Preferences tersinkronisasi 100%
    const prefs = lastUpdateData.preferences;
    expect(prefs.location_source).toBe('manual_staff');
    expect(prefs.location_source_label).toBe(STAFF_VERIFIED_LOCATION_LABEL);
    expect(prefs.location_accuracy_m).toBe(15);
    expect(prefs.landmark).toBe('Pagar hitam no 12');

    // History mencatat manual_staff
    const history = prefs.location_history;
    expect(Array.isArray(history)).toBe(true);
    const lastEntry = history[history.length - 1];
    expect(lastEntry.source).toBe('manual_staff');
    expect(lastEntry.raw_source).toBe('FIELD_STAFF_GPS');
    expect(lastEntry.sourceLabel).toBe(STAFF_VERIFIED_LOCATION_LABEL);
    expect(lastEntry.accuracyM).toBe(15);
  });

  it('TC-08: Bidan kunci GPS menyimpang >1 km dari pin presisi lama → karantina utuh', async () => {
    // Geser > 2 km dari koordinat lama (-7.34886, 112.751677)
    const res = await StaffReservationService.updateCustomerLocation({
      reservationId: 'res-1',
      staffId: 'staff-1',
      staffName: 'Bidan Yusi F',
      lat: -7.32000,
      lng: 112.751677,
      accuracyM: 20,
      landmark: 'Pagar putih',
    });

    expect(res.success).toBe(true);
    expect(lastUpdateData).not.toBeNull();
    // Koordinat utama dan kolom location_source TIDAK BERUBAH
    expect(lastUpdateData.lat).toBeUndefined();
    expect(lastUpdateData.lng).toBeUndefined();
    expect(lastUpdateData.location_source).toBeUndefined();

    // Preferences: karantina divergence aktif, tidak dipromosikan ke manual_staff
    const prefs = lastUpdateData.preferences;
    expect(prefs.location_source).toBeUndefined();
    expect(prefs.field_gps_diverged).toBe(true);
    expect(prefs.field_gps_lat).toBe(-7.32000);
    expect(prefs.field_gps_lng).toBe(112.751677);
    expect(prefs.landmark).toContain('[📍 GPS Lapangan:');
  });

  it('TC-09: Staf simpan catatan teks tanpa GPS (lat/lng null) → status tidak promosi', async () => {
    const res = await StaffReservationService.updateCustomerLocation({
      reservationId: 'res-1',
      staffId: 'staff-1',
      staffName: 'Bidan Yusi F',
      lat: null,
      lng: null,
      landmark: 'Catatan tambahan: rumah warna hijau',
    });

    expect(res.success).toBe(true);
    expect(lastUpdateData).not.toBeNull();
    expect(lastUpdateData.location_source).toBeUndefined();
    expect(lastUpdateData.lat).toBeUndefined();
    expect(lastUpdateData.lng).toBeUndefined();

    const prefs = lastUpdateData.preferences;
    expect(prefs.location_source).toBeUndefined();
    expect(prefs.location_source_label).toBeUndefined();
    expect(prefs.landmark).toBe('Catatan tambahan: rumah warna hijau');
  });

  it('TC-10: GPS akurasi buruk (>50 m) → ditolak dengan pesan error akurasi', async () => {
    const res = await StaffReservationService.updateCustomerLocation({
      reservationId: 'res-1',
      staffId: 'staff-1',
      staffName: 'Bidan Yusi F',
      lat: -7.34900,
      lng: 112.75180,
      accuracyM: 75, // melebihi batas toleransi 50m
      landmark: 'Dekat lapangan',
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/akurasi.*50m/i);
    expect(lastUpdateData).toBeNull();
  });

  it('Kanonisasi & Anti-Degradasi: resolveLocationSource & refresh admin mempertahankan manual_staff', async () => {
    // 1. resolveLocationSource memetakan FIELD_STAFF_GPS ke manual_staff
    const legacyStaffCoord = {
      location_source: null,
      preferences: { location_source: 'FIELD_STAFF_GPS' },
    };
    expect(resolveLocationSource(legacyStaffCoord)).toBe('manual_staff');

    // 2. refreshCustomerLocationAndOngkir untuk customer manual_staff tetap manual_staff
    const staffCustomer = {
      ...baseCustomer,
      location_source: 'manual_staff' as const,
      preferences: {
        location_source: 'manual_staff',
        location_source_label: STAFF_VERIFIED_LOCATION_LABEL,
      },
    };
    (getCustomerRepository() as any).seed?.(staffCustomer);
    customerService.getMemoryCustomers().set('cust-1', staffCustomer);

    const refreshRes = await customerService.refreshCustomerLocationAndOngkir(
      'cust-1',
      'default-tenant',
      'admin@kalamomsspa.com'
    );

    expect(refreshRes.success).toBe(true);
    expect(lastUpdateData).not.toBeNull();
    expect(lastUpdateData.location_source).toBe('manual_staff');
    expect(lastUpdateData.preferences.location_source).toBe('manual_staff');
    expect(lastUpdateData.preferences.location_source_label).toBe(STAFF_VERIFIED_LOCATION_LABEL);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { prisma } from '../../src/db/client';

describe('Staff location photo guard — foto rumah wajib GPS (TDD Fase 1)', () => {
  const baseCustomer = {
    id: 'cust-1',
    tenant_id: 'default-tenant',
    name: 'Bunda Uji',
    phone: '6281234567890',
    lat: null,
    lng: null,
    kelurahan: 'Waru',
    kecamatan: 'Waru',
    kota: 'Sidoarjo',
    distance_km: null,
    preferences: {},
    share_location_sent: false,
    location_source: null,
  };
  const baseReservation = {
    id: 'res-1',
    tenant_id: 'default-tenant',
    customer_id: 'cust-1',
    assigned_staff_id: 'staff-1',
    status: 'scheduled',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock reservation + customer lookup succeeds
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ ...baseReservation, customer: { ...baseCustomer } } as any);
    // Prevent real media writes — mock resize/save
    vi.mocked(prisma.customer.update).mockImplementation(async (args: any) => ({ ...baseCustomer, ...args.data, id: 'cust-1' } as any));
  });

  it('foto + lat/lng null → success:false dengan pesan GPS/koordinat', async () => {
    const res = await StaffReservationService.updateCustomerLocation({
      reservationId: 'res-1',
      staffId: 'staff-1',
      staffName: 'Bidan Yusi',
      lat: null as any,
      lng: null as any,
      housePhotoB64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      landmark: 'Depan warung',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/GPS|koordinat/i);
  });

  it('foto + koordinat valid → lolos ke logika lama (tidak diblokir guard)', async () => {
    // Mock mediaService to avoid real processing
    vi.doMock('../../src/services/media.service', () => ({
      mediaService: {
        resizeImageToMax: vi.fn().mockResolvedValue(Buffer.from('x')),
        overlayGpsBadge: vi.fn().mockResolvedValue(Buffer.from('x')),
        saveOutboundMedia: vi.fn().mockResolvedValue({ hdUrl: '/media/outbound/mock.jpg' }),
      },
    }));
    const res = await StaffReservationService.updateCustomerLocation({
      reservationId: 'res-1',
      staffId: 'staff-1',
      staffName: 'Bidan Yusi',
      lat: -7.3,
      lng: 112.7,
      housePhotoB64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      landmark: 'Depan warung',
    });
    // Guard tidak boleh memblokir — harus masuk ke validasi jarak/lain atau sukses
    // Jika success masih false, pastikan bukan karena guard foto-tanpa-GPS
    if (!res.success) {
      expect(res.error).not.toMatch(/wajib disertai titik GPS/i);
    } else {
      expect(res.success).toBe(true);
    }
  });

  it('landmark-only tanpa foto & tanpa koordinat → tetap lolos (bukan foto)', async () => {
    const res = await StaffReservationService.updateCustomerLocation({
      reservationId: 'res-1',
      staffId: 'staff-1',
      staffName: 'Bidan Yusi',
      landmark: 'Gang sebelah masjid',
    });
    // Tidak boleh diblokir oleh guard foto
    if (!res.success) {
      expect(res.error).not.toMatch(/wajib disertai titik GPS/i);
    } else {
      expect(res.success).toBe(true);
    }
  });
});

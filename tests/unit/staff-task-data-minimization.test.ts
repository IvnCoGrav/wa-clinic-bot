import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { StaffReservationService } from '../../src/services/staff-reservation.service';

/**
 * S-05: data tugas staf lapangan tidak boleh membawa data bisnis sensitif
 * (LTV, catatan admin internal, seluruh preferences). Alamat tetap boleh
 * (whitelist field yang dibutuhkan navigasi).
 */
describe('Staff task data minimization (S-05)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('tidak men-select admin_notes/ltv_cache dan tidak mengirimkannya ke staf', async () => {
    const findMany = vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([
      {
        id: 'r1',
        treatment_detail: 'Pijat Bayi Ceria',
        treatment_category: 'BABY',
        booking_date: new Date(),
        status: 'confirmed',
        purchase_value: 100000,
        purchase_occurred_at: null,
        updated_at: new Date(),
        otw_sent_at: null,
        arrived_at: null,
        payment_method: 'TRANSFER',
        proof_url: null,
        payment_status: 'LUNAS',
        customer: {
          name: 'Bunda A',
          lat: -7.3,
          lng: 112.7,
          kelurahan: 'Waru',
          kecamatan: 'Waru',
          kota: 'Sidoarjo',
          location_source: 'gps',
          distance_km: 5,
          ongkir: 0,
          preferences: { address: 'Jl. Melati 1', house_photo_url: null, landmark: null },
          profile_picture_url: null,
          admin_notes: 'CATATAN INTERNAL RAHASIA',
          ltv_cache: 9999999,
          children: [],
          conversations: [],
        },
        children: [],
        assigned_staff: { id: 's1', name: 'Bidan A', role: 'THERAPIST' },
      } as any,
    ]);

    const rows = await StaffReservationService.getTodayTasks('s1', 'tenant-s05');

    // 1) Select DB tidak boleh menyentuh kolom sensitif.
    const select = (findMany.mock.calls[0]?.[0] as any)?.select?.customer?.select || {};
    expect(select.admin_notes).toBeUndefined();
    expect(select.ltv_cache).toBeUndefined();

    // 2) Payload ke staf tidak memuat adminNotes / LTV.
    expect(rows.length).toBe(1);
    expect(rows[0]).not.toHaveProperty('adminNotes');
    expect(rows[0].customerStats).toBeDefined();
    expect(rows[0].customerStats as any).not.toHaveProperty('ltv');
  });
});

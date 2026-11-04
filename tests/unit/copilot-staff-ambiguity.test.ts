import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { queryReservationsByFilter } from '../../src/services/copilot/copilot-tools';
import { clearOperationalHoursCache } from '../../src/config/operational-hours';

/**
 * Regresi N7 — ambiguitas nama terapis HARUS ditentukan dari resolusi nama staf,
 * bukan dari hasil reservasi kosong. Filter tanggal/status/bayar yang menghasilkan
 * 0 baris pada nama yang sah tidak boleh berubah menjadi pertanyaan klarifikasi.
 */
describe('queryReservationsByFilter — ambiguitas nama terapis (F14 / N7)', () => {
  const tenantId = 'tenant-test';

  const staffRows = [
    { name: 'Bidan Yusi F' },
    { name: 'Bidan Thabita' },
    { name: 'Bidan Hanifah' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    clearOperationalHoursCache();
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
      id: tenantId,
      settings: { operationalHours: { startHourWib: 8, endHourWib: 17 } },
    } as any);
    vi.spyOn(prisma.staff, 'findMany').mockResolvedValue(staffRows as any);
  });

  it('nama valid + semua pasien sudah lunas → BUKAN ambigu, jawab kosong apa adanya', async () => {
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
      {
        id: 'res-1',
        booking_date: new Date('2026-11-04T02:00:00Z'),
        duration_minutes: 75,
        status: 'confirmed',
        treatment_detail: 'Kala Baby – Pijat Ceria',
        purchase_occurred_at: new Date('2026-11-04T03:00:00Z'),
        customer: { id: 'c1', name: 'Bunda Rika', phone: '6281234567801', conversations: [] },
        assigned_staff: { name: 'Bidan Yusi F' },
      },
    ] as any);

    const res = await queryReservationsByFilter.run(tenantId, {
      date: '2026-11-04',
      staffName: 'Yusi',
      paymentStatus: 'unpaid',
    });

    expect(res.ambiguous).toBe(false);
    expect(res.candidates).toEqual([]);
    expect(res.count).toBe(0);
  });

  it('nama valid + tidak ada jadwal pada tanggal itu → BUKAN ambigu', async () => {
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([] as any);

    const res = await queryReservationsByFilter.run(tenantId, {
      date: '2026-11-05',
      staffName: 'Bidan Yusi F',
    });

    expect(res.ambiguous).toBe(false);
    expect(res.candidates).toEqual([]);
    expect(res.count).toBe(0);
  });

  it('nama parsial yang cocok ke >1 terapis → ambigu + daftar kandidat', async () => {
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([] as any);

    const res = await queryReservationsByFilter.run(tenantId, {
      date: '2026-11-04',
      staffName: 'a',
    });

    expect(res.ambiguous).toBe(true);
    expect(res.candidates.length).toBeGreaterThan(1);
    expect(res.candidates).toContain('Bidan Thabita');
  });

  it('nama tidak dikenal → ambigu + seluruh staf aktif sebagai kandidat', async () => {
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([] as any);

    const res = await queryReservationsByFilter.run(tenantId, {
      date: '2026-11-04',
      staffName: 'Zukri',
    });

    expect(res.ambiguous).toBe(true);
    expect(res.candidates).toEqual(['Bidan Yusi F', 'Bidan Thabita', 'Bidan Hanifah']);
  });
});

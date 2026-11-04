import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { queryReservationsByFilter } from '../../src/services/copilot/copilot-tools';
import { clearOperationalHoursCache } from '../../src/config/operational-hours';

describe('Copilot duration and slots (Fase 7 & 13 - Menutup V11, N1 & N2)', () => {
  const tenantId = 'tenant-test';

  beforeEach(() => {
    vi.clearAllMocks();
    clearOperationalHoursCache();
  });

  it('deteksi tabrakan jadwal (scheduleCollisions) berbasis interval durasi pada terapis yang SAMA', async () => {
    // Yusi: 15:00 WIB (08:00 UTC) durasi 160 menit (selesai 17:40 WIB)
    // Yusi: 15:30 WIB (08:30 UTC) durasi 60 menit (selesai 16:30 WIB) -> BENTROK!
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
      {
        id: 'res-yusi-1',
        booking_date: new Date('2026-11-04T08:00:00Z'), // 15:00 WIB
        duration_minutes: 160,
        status: 'confirmed',
        treatment_detail: 'Pregnant Massage',
        customer: { id: 'c1', name: 'Bunda Sarah', phone: '6281234567801', conversations: [] },
        assigned_staff: { name: 'Yusi' },
      },
      {
        id: 'res-yusi-2',
        booking_date: new Date('2026-11-04T08:30:00Z'), // 15:30 WIB
        duration_minutes: 60,
        status: 'confirmed',
        treatment_detail: 'Kids Spa',
        customer: { id: 'c2', name: 'Bunda Dewi', phone: '6281234567802', conversations: [] },
        assigned_staff: { name: 'Yusi' },
      },
    ] as any);

    const result = await queryReservationsByFilter.run(tenantId, { date: '2026-11-04', staffName: 'Yusi' });

    expect(result.summaryFacts).toBeDefined();
    expect(result.summaryFacts.hasCollision).toBe(true);
    expect(result.summaryFacts.scheduleCollisions).toHaveLength(1);
    const col = result.summaryFacts.scheduleCollisions[0];
    expect(col.staff).toBe('Yusi');
    expect(col.timeRange1).toBe('15:00–17:40');
    expect(col.timeRange2).toBe('15:30–16:30');
    expect(col.conflictMinutes).toBe(60); // Overlap 15:30 s/d 16:30
  });

  it('dua jadwal jam sama pada terapis BERBEDA BUKAN tabrakan (anti false-positive)', async () => {
    // Yusi: 15:00 WIB durasi 160 menit
    // Thabita: 15:00 WIB durasi 60 menit -> BEDA TERAPIS -> TIDAK BENTROK!
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
      {
        id: 'res-yusi-1',
        booking_date: new Date('2026-11-04T08:00:00Z'),
        duration_minutes: 160,
        status: 'confirmed',
        treatment_detail: 'Pregnant Massage',
        customer: { id: 'c1', name: 'Bunda Sarah', phone: '6281234567801', conversations: [] },
        assigned_staff: { name: 'Yusi' },
      },
      {
        id: 'res-thabita-1',
        booking_date: new Date('2026-11-04T08:00:00Z'),
        duration_minutes: 60,
        status: 'confirmed',
        treatment_detail: 'Baby Spa',
        customer: { id: 'c3', name: 'Bunda Rini', phone: '6281234567803', conversations: [] },
        assigned_staff: { name: 'Thabita' },
      },
    ] as any);

    const result = await queryReservationsByFilter.run(tenantId, { date: '2026-11-04' });

    expect(result.summaryFacts).toBeDefined();
    expect(result.summaryFacts.hasCollision).toBe(false);
    expect(result.summaryFacts.scheduleCollisions).toHaveLength(0);
  });

  it('N1: menghitung slot kosong memakai jam operasional data-driven default (08:00–17:00)', async () => {
    // Thabita pada tanggal 2026-11-04:
    // Sesi 1: 10:00 - 13:15 WIB (durasi 195m)
    // Sesi 2: 15:30 - 17:00 WIB (durasi 90m)
    // Jam buka default operasional: 08:00 - 17:00 WIB
    // Celah yang valid:
    // 1. 08:00–10:00 (120 menit)
    // 2. 13:15–15:30 (135 menit)
    // Sesi 2 selesai jam 17:00 -> klinik tutup, TIDAK ADA slot 17:00–18:00 palsu!
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
      {
        id: 'res-t-1',
        booking_date: new Date('2026-11-04T03:00:00Z'),
        duration_minutes: 195,
        status: 'confirmed',
        treatment_detail: 'Postpartum Care',
        customer: { id: 'c1', name: 'Bunda Sarah', phone: '6281234567801', conversations: [] },
        assigned_staff: { name: 'Thabita' },
      },
      {
        id: 'res-t-2',
        booking_date: new Date('2026-11-04T08:30:00Z'),
        duration_minutes: 90,
        status: 'confirmed',
        treatment_detail: 'Mom Massage',
        customer: { id: 'c2', name: 'Bunda Dewi', phone: '6281234567802', conversations: [] },
        assigned_staff: { name: 'Thabita' },
      },
    ] as any);

    const result = await queryReservationsByFilter.run(tenantId, { date: '2026-11-04', staffName: 'Thabita' });

    expect(result.summaryFacts).toBeDefined();
    const freeSlots = result.summaryFacts.freeSlots;
    expect(freeSlots).toBeDefined();
    expect(freeSlots.length).toBe(2);

    expect(freeSlots[0]).toMatchObject({
      staff: 'Thabita',
      dateWib: '2026-11-04',
      startTimeWib: '08:00',
      endTimeWib: '10:00',
      durationMinutes: 120,
    });

    expect(freeSlots[1]).toMatchObject({
      staff: 'Thabita',
      dateWib: '2026-11-04',
      startTimeWib: '13:15',
      endTimeWib: '15:30',
      durationMinutes: 135,
    });

    // Tidak ada slot setelah 17:00 karena klinik tutup jam 17:00
    const slotAfter17 = freeSlots.find((s: any) => s.startTimeWib === '17:00');
    expect(slotAfter17).toBeUndefined();
  });

  it('N1: tenant override jam kerja (09:00–20:00) dan min jeda (30m) diterapkan dinamis dari DB', async () => {
    // Tenant mengatur jam operasional 09:00 - 20:00 dan minSlotDurationMinutes: 30
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
      id: tenantId,
      settings: {
        operationalHours: { startHourWib: 9, endHourWib: 20 },
        copilot: { minSlotDurationMinutes: 30 },
      },
    } as any);

    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
      {
        id: 'res-t-1',
        booking_date: new Date('2026-11-04T03:00:00Z'), // 10:00 WIB
        duration_minutes: 195, // selesai 13:15 WIB
        status: 'confirmed',
        treatment_detail: 'Postpartum Care',
        customer: { id: 'c1', name: 'Bunda Sarah', phone: '6281234567801', conversations: [] },
        assigned_staff: { name: 'Thabita' },
      },
      {
        id: 'res-t-2',
        booking_date: new Date('2026-11-04T08:30:00Z'), // 15:30 WIB
        duration_minutes: 90, // selesai 17:00 WIB
        status: 'confirmed',
        treatment_detail: 'Mom Massage',
        customer: { id: 'c2', name: 'Bunda Dewi', phone: '6281234567802', conversations: [] },
        assigned_staff: { name: 'Thabita' },
      },
    ] as any);

    const result = await queryReservationsByFilter.run(tenantId, { date: '2026-11-04', staffName: 'Thabita' });
    const freeSlots = result.summaryFacts.freeSlots;

    expect(freeSlots).toBeDefined();
    expect(freeSlots.length).toBe(3);

    // Slot 1: mulai jam buka 09:00 (bukan 08:00) sampai 10:00 (60 menit)
    expect(freeSlots[0]).toMatchObject({
      staff: 'Thabita',
      startTimeWib: '09:00',
      endTimeWib: '10:00',
      durationMinutes: 60,
    });

    // Slot 2: 13:15 - 15:30 (135 menit)
    expect(freeSlots[1]).toMatchObject({
      staff: 'Thabita',
      startTimeWib: '13:15',
      endTimeWib: '15:30',
      durationMinutes: 135,
    });

    // Slot 3: 17:00 sampai jam tutup 20:00 (180 menit)
    expect(freeSlots[2]).toMatchObject({
      staff: 'Thabita',
      startTimeWib: '17:00',
      endTimeWib: '20:00',
      durationMinutes: 180,
    });
  });

  it('N2: 25 reservasi dalam satu hari dihitung utuh untuk bentrok & slot, tampilan dipotong 20 dengan truncated=true', async () => {
    // Generate 25 reservasi untuk Yusi sepanjang hari
    const reservations: any[] = [];
    for (let i = 0; i < 25; i++) {
      reservations.push({
        id: `res-${i + 1}`,
        booking_date: new Date(`2026-11-04T${String(1 + Math.floor(i / 3)).padStart(2, '0')}:${(i % 3) * 20}:00Z`),
        duration_minutes: 30,
        status: 'confirmed',
        treatment_detail: `Layanan ${i + 1}`,
        customer: { id: `c-${i + 1}`, name: `Pasien ${i + 1}`, phone: `62812345678${String(i).padStart(2, '0')}`, conversations: [] },
        assigned_staff: { name: 'Yusi' },
      });
    }

    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce(reservations as any);

    const result = await queryReservationsByFilter.run(tenantId, { date: '2026-11-04', staffName: 'Yusi' });

    // summaryFacts mencakup data utuh (25 baris)
    expect(result.summaryFacts.totalReservations).toBe(25);
    expect(result.totalCount).toBe(25);
    expect(result.truncated).toBe(true);

    // Baris yang dikembalikan ke LLM dipotong tepat 20 baris (MAX_ROWS)
    expect(result.rows).toHaveLength(20);
    expect(result.count).toBe(20);
  });
});

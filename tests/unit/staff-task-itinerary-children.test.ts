import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  StaffReservationService,
  selectTaskChildren,
} from '../../src/services/staff-reservation.service';

/**
 * Fase 1.1/1.2/1.3 — Uji adversarial kartu tugas terapis.
 *
 * Bukan happy-path: menguji gating anak (multi-child, fallback, dedupe), isolasi
 * rute berantai per-terapis + determinisme (anti-race), dan gerbang pelunasan
 * backend pada completeTask.
 */

function makeCustomer(overrides: Record<string, any> = {}) {
  return {
    name: 'Bunda Uji',
    lat: -7.2575,
    lng: 112.7521,
    kelurahan: 'Gayungan',
    kecamatan: 'Gayungan',
    kota: 'Surabaya',
    distance_km: null,
    ongkir: 0,
    children: [],
    conversations: [{ id: 'conv-1' }],
    ...overrides,
  };
}

describe('Fase 1.1 — selectTaskChildren (gating anak)', () => {
  it('multi-child: customer punya 2 anak, booking hanya 1 → hanya anak booking tampil', () => {
    const resChildren = [{ name: 'Ani', raw_age_text: '6 bulan' }];
    const custChildren = [
      { name: 'Budi', raw_age_text: '2 tahun' },
      { name: 'Ani', raw_age_text: '6 bulan' },
    ];
    const out = selectTaskChildren(resChildren, custChildren);
    expect(out.map((c) => c.name)).toEqual(['Ani']);
  });

  it('fallback: reservasi tanpa anak → pakai anak profil customer', () => {
    const custChildren = [{ name: 'Budi', raw_age_text: '2 tahun' }];
    expect(selectTaskChildren([], custChildren).map((c) => c.name)).toEqual(['Budi']);
    expect(selectTaskChildren(null, custChildren).map((c) => c.name)).toEqual(['Budi']);
  });

  it('tanpa anak sama sekali → array kosong (bukan throw)', () => {
    expect(selectTaskChildren(null, null)).toEqual([]);
    expect(selectTaskChildren(undefined, [])).toEqual([]);
  });

  it('dedupe case/whitespace: "  Ani " == "ani" digabung, nama asli (trim) dipertahankan', () => {
    const out = selectTaskChildren([{ name: '  Ani ' }], [{ name: 'ani' }]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Ani');
  });

  it('anak tanpa nama diabaikan; birth_date Date & string dinormalkan ke ISO', () => {
    const out = selectTaskChildren(
      [
        { name: '', raw_age_text: 'x' },
        { name: 'Dede', birth_date: new Date('2026-01-02T00:00:00.000Z') },
        { name: 'Kaka', birth_date: '2025-03-04T00:00:00.000Z' },
      ],
      []
    );
    expect(out.map((c) => c.name)).toEqual(['Dede', 'Kaka']);
    expect(out[0].birthDate).toBe('2026-01-02T00:00:00.000Z');
    expect(out[1].birthDate).toBe('2025-03-04T00:00:00.000Z');
  });
});

describe('Fase 1.1 — integrasi getTodayTasks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('kartu booking hanya memuat anak yang terdaftar di reservasi', async () => {
    (prisma.reservation.findMany as any).mockResolvedValue([
      {
        id: 'res-1',
        treatment_detail: 'Pijat Bayi',
        treatment_category: 'BABY',
        booking_date: new Date(),
        status: 'confirmed',
        purchase_value: 120000,
        purchase_occurred_at: new Date(),
        assigned_staff: { id: 'staff-a', name: 'Bidan A', role: 'staff' },
        customer: makeCustomer({
          children: [
            { name: 'Budi', raw_age_text: '2 tahun', birth_date: null },
            { name: 'Ani', raw_age_text: '6bulan', birth_date: null },
          ],
        }),
        children: [{ name: 'Ani', raw_age_text: '6bulan', birth_date: null }],
      },
    ]);

    const tasks = await StaffReservationService.getTodayTasks('staff-a', 'default-tenant');
    expect(tasks[0].children.map((c) => c.name)).toEqual(['Ani']);
  });
});

describe('Fase 1.2 — isolasi & determinisme rute berantai', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dua terapis: pasien pertama tiap terapis dihitung dari Klinik (tidak menyambung terapis lain)', async () => {
    (prisma.reservation.findMany as any).mockResolvedValue([
      {
        id: 'r-a1',
        treatment_detail: 'Pijat',
        treatment_category: 'BABY',
        booking_date: new Date('2026-09-29T02:00:00.000Z'),
        status: 'confirmed',
        purchase_value: 100000,
        purchase_occurred_at: new Date(),
        assigned_staff: { id: 'staff-a', name: 'Bidan A', role: 'staff' },
        customer: makeCustomer({ name: 'Bunda A1', lat: -7.30, lng: 112.75, distance_km: 3.1 }),
        children: [],
      },
      {
        id: 'r-b1',
        treatment_detail: 'Pijat',
        treatment_category: 'BABY',
        booking_date: new Date('2026-09-29T02:30:00.000Z'),
        status: 'confirmed',
        purchase_value: 100000,
        purchase_occurred_at: new Date(),
        assigned_staff: { id: 'staff-b', name: 'Bidan B', role: 'staff' },
        customer: makeCustomer({ name: 'Bunda B1', lat: -7.40, lng: 112.80, distance_km: 5.2 }),
        children: [],
      },
      {
        id: 'r-b2',
        treatment_detail: 'Pijat',
        treatment_category: 'BABY',
        booking_date: new Date('2026-09-29T03:00:00.000Z'),
        status: 'confirmed',
        purchase_value: 100000,
        purchase_occurred_at: new Date(),
        assigned_staff: { id: 'staff-b', name: 'Bidan B', role: 'staff' },
        customer: makeCustomer({ name: 'Bunda B2', lat: -7.41, lng: 112.81, distance_km: 5.6 }),
        children: [],
      },
    ]);

    const tasks = await StaffReservationService.getTodayTasks('spv', 'default-tenant', 'all', true);
    const byId = new Map(tasks.map((t) => [t.reservationId, t]));

    // Pasien pertama masing-masing terapis → CLINIC
    expect(byId.get('r-a1')!.address.distanceSource).toBe('CLINIC');
    expect(byId.get('r-b1')!.address.distanceSource).toBe('CLINIC');
    expect(byId.get('r-b1')!.address.originName).toBe('Kala Moms and Baby Spa');
    // Pasien kedua terapis B → dari pasien pertama terapis B (Bunda B1), BUKAN tersambung dari terapis A
    expect(byId.get('r-b2')!.address.distanceSource).toBe('PREVIOUS_PATIENT');
    expect(byId.get('r-b2')!.address.originName).toBe('Bunda B1');
  });

  it('deterministik: rantai tidak bergantung urutan resolusi async (diulang 20x)', async () => {
    const buildRows = () => [
      {
        id: 'r1',
        treatment_detail: 'Pijat',
        treatment_category: 'BABY',
        booking_date: new Date('2026-09-29T02:00:00.000Z'),
        status: 'confirmed',
        purchase_value: 100000,
        purchase_occurred_at: new Date(),
        assigned_staff: { id: 'staff-a', name: 'Bidan A', role: 'staff' },
        customer: makeCustomer({ name: 'Bunda Satu', lat: -7.30, lng: 112.75, distance_km: 3.1 }),
        children: [],
      },
      {
        id: 'r2',
        treatment_detail: 'Pijat',
        treatment_category: 'BABY',
        booking_date: new Date('2026-09-29T03:00:00.000Z'),
        status: 'confirmed',
        purchase_value: 100000,
        purchase_occurred_at: new Date(),
        assigned_staff: { id: 'staff-a', name: 'Bidan A', role: 'staff' },
        customer: makeCustomer({ name: 'Bunda Dua', lat: -7.36, lng: 112.76, distance_km: 4.8 }),
        children: [],
      },
    ];

    let expected: string[] | null = null;
    for (let i = 0; i < 20; i++) {
      (prisma.reservation.findMany as any).mockResolvedValue(buildRows());
      const tasks = await StaffReservationService.getTodayTasks('staff-a', 'default-tenant');
      const sig = tasks.map(
        (t) => `${t.reservationId}:${t.address.distanceSource}:${t.address.originName}:${t.address.distanceKm}`
      );
      if (expected === null) expected = sig;
      else expect(sig).toEqual(expected);
    }
    expect(expected![0]).toContain('CLINIC');
    expect(expected![1]).toContain('PREVIOUS_PATIENT');
  });

  it('pasien tanpa koordinat tidak menjadi waypoint palsu (rantai tetap benar)', async () => {
    (prisma.reservation.findMany as any).mockResolvedValue([
      {
        id: 'n1',
        treatment_detail: 'Pijat',
        treatment_category: 'BABY',
        booking_date: new Date('2026-09-29T02:00:00.000Z'),
        status: 'confirmed',
        purchase_value: 100000,
        purchase_occurred_at: new Date(),
        assigned_staff: { id: 'staff-a', name: 'Bidan A', role: 'staff' },
        customer: makeCustomer({ name: 'Bunda Tanpa Koor', lat: null, lng: null, distance_km: 4.2 }),
        children: [],
      },
      {
        id: 'n2',
        treatment_detail: 'Pijat',
        treatment_category: 'BABY',
        booking_date: new Date('2026-09-29T03:00:00.000Z'),
        status: 'confirmed',
        purchase_value: 100000,
        purchase_occurred_at: new Date(),
        assigned_staff: { id: 'staff-a', name: 'Bidan A', role: 'staff' },
        customer: makeCustomer({ name: 'Bunda Ada Koor', lat: -7.30, lng: 112.75, distance_km: 3.0 }),
        children: [],
      },
    ]);

    const tasks = await StaffReservationService.getTodayTasks('staff-a', 'default-tenant');
    const byId = new Map(tasks.map((t) => [t.reservationId, t]));
    expect(byId.get('n1')!.address.distanceKm).toBe(4.2);
    expect(byId.get('n2')!.address.distanceSource).toBe('CLINIC');
    expect(byId.get('n2')!.address.originName).toBe('Kala Moms and Baby Spa');
  });
});

describe('Fase 1.3 — gerbang pelunasan completeTask', () => {
  beforeEach(() => vi.clearAllMocks());

  it('menolak menyelesaikan bila pembayaran belum dicatat (requiresPayment)', async () => {
    (prisma.reservation.findUnique as any).mockResolvedValue({
      id: 'res-unpaid',
      tenant_id: 'default-tenant',
      assigned_staff_id: 'staff-a',
      purchase_occurred_at: null,
      customer_id: 'cust-1',
    });

    const res = await StaffReservationService.completeTask({
      reservationId: 'res-unpaid',
      staffId: 'staff-a',
      tenantId: 'default-tenant',
    });

    expect(res.success).toBe(false);
    expect(res.requiresPayment).toBe(true);
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('forceUnpaid menembus gerbang tapi tercatat sebagai audit khusus', async () => {
    (prisma.reservation.findUnique as any).mockResolvedValue({
      id: 'res-unpaid',
      tenant_id: 'default-tenant',
      assigned_staff_id: 'staff-a',
      purchase_occurred_at: null,
      customer_id: 'cust-1',
    });
    (prisma.reservation.update as any).mockResolvedValue({ id: 'res-unpaid', status: 'completed' });

    const res = await StaffReservationService.completeTask({
      reservationId: 'res-unpaid',
      staffId: 'staff-a',
      tenantId: 'default-tenant',
      forceUnpaid: true,
    });

    expect(res.success).toBe(true);
    expect(prisma.reservation.update).toHaveBeenCalled();
  });

  it('kunjungan yang sudah lunas lolos tanpa forceUnpaid', async () => {
    (prisma.reservation.findUnique as any).mockResolvedValue({
      id: 'res-paid',
      tenant_id: 'default-tenant',
      assigned_staff_id: 'staff-a',
      purchase_occurred_at: new Date(),
      customer_id: 'cust-1',
    });
    (prisma.reservation.update as any).mockResolvedValue({ id: 'res-paid', status: 'completed' });

    const res = await StaffReservationService.completeTask({
      reservationId: 'res-paid',
      staffId: 'staff-a',
      tenantId: 'default-tenant',
    });

    expect(res.success).toBe(true);
  });

  it('menolak tenant lain & terapis bukan pemilik (anti-IDOR)', async () => {
    (prisma.reservation.findUnique as any).mockResolvedValue({
      id: 'res-x',
      tenant_id: 'tenant-lain',
      assigned_staff_id: 'staff-lain',
      purchase_occurred_at: new Date(),
      customer_id: 'cust-1',
    });

    const crossTenant = await StaffReservationService.completeTask({
      reservationId: 'res-x',
      staffId: 'staff-a',
      tenantId: 'default-tenant',
    });
    expect(crossTenant.success).toBe(false);

    (prisma.reservation.findUnique as any).mockResolvedValue({
      id: 'res-x',
      tenant_id: 'default-tenant',
      assigned_staff_id: 'staff-lain',
      purchase_occurred_at: new Date(),
      customer_id: 'cust-1',
    });
    const notOwner = await StaffReservationService.completeTask({
      reservationId: 'res-x',
      staffId: 'staff-a',
      tenantId: 'default-tenant',
    });
    expect(notOwner.success).toBe(false);
  });
});

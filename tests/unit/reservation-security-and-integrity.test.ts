import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { executeSaveReservation } from '../../src/v3/tools/save-reservation.tool';
import { reservationLifecycleService } from '../../src/services/reservation-lifecycle.service';
import { findOverlappingStaffReservations } from '../../src/services/reservation-core.service';
import * as customerServiceModule from '../../src/services/customer.service';

describe('Reservation Security & Integrity Tests (Adversarial Suite)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Spatial Integrity: Street Address Never Leaked to Kelurahan', () => {
    it('should pass kelurahan as undefined when only street address is provided', async () => {
      const spyLifecycle = vi.spyOn(reservationLifecycleService, 'onReservationCreated').mockResolvedValue(undefined as any);
      vi.mocked(prisma.reservation.findMany).mockResolvedValue([]);
      vi.mocked(prisma.reservation.count).mockResolvedValue(0);
      vi.mocked(prisma.reservation.create).mockResolvedValue({
        id: 'new-res-spatial',
        status: 'confirmed',
        booking_date: new Date('2026-10-15T03:00:00.000Z'),
      } as any);

      // Panggil saveReservation dengan alamat jalan lengkap, tanpa kelurahan
      const result = await reservationCoreService.saveReservation({
        tenantId: 'default-tenant',
        customerId: 'cust-spatial-test',
        customerName: 'Bunda Rina',
        address: 'Jl. Rungkut Asri Timur No 15 Perumahan Graha Asri',
        kelurahan: undefined,
        treatmentDetail: 'Kala Baby – Pijat Ceria',
        bookingDate: new Date('2026-10-15T03:00:00.000Z'),
        durationMinutes: 60,
        source: 'AGENT',
      });

      expect(spyLifecycle).toHaveBeenCalled();
      const callArgs = spyLifecycle.mock.calls[0][0];

      // Verifikasi: kelurahan TIDAK boleh berisi alamat jalan
      expect(callArgs.kelurahan).toBeUndefined();
      expect(callArgs.address).toBe('Jl. Rungkut Asri Timur No 15 Perumahan Graha Asri');
      expect(result.reservation.id).toBe('new-res-spatial');

      spyLifecycle.mockRestore();
    });

    it('should KEEP an explicit kelurahan when both kelurahan and street address are provided', async () => {
      const spyLifecycle = vi.spyOn(reservationLifecycleService, 'onReservationCreated').mockResolvedValue(undefined as any);
      vi.mocked(prisma.reservation.findMany).mockResolvedValue([]);
      vi.mocked(prisma.reservation.count).mockResolvedValue(0);
      vi.mocked(prisma.reservation.create).mockResolvedValue({
        id: 'new-res-spatial-2',
        status: 'confirmed',
        booking_date: new Date('2026-10-15T03:00:00.000Z'),
      } as any);

      await reservationCoreService.saveReservation({
        tenantId: 'default-tenant',
        customerId: 'cust-spatial-test-2',
        customerName: 'Bunda Sari',
        address: 'Jl. Rungkut Asri Timur No 15 Perumahan Graha Asri',
        kelurahan: 'Rungkut',
        kecamatan: 'Rungkut',
        kota: 'Surabaya',
        treatmentDetail: 'Kala Baby – Pijat Ceria',
        bookingDate: new Date('2026-10-15T03:00:00.000Z'),
        durationMinutes: 60,
        source: 'AGENT',
      });

      const callArgs = spyLifecycle.mock.calls[0][0];
      expect(callArgs.kelurahan).toBe('Rungkut');
      expect(callArgs.address).toBe('Jl. Rungkut Asri Timur No 15 Perumahan Graha Asri');

      spyLifecycle.mockRestore();
    });
  });

  describe('2. AI Tool: Add-On Only Reservation Rejection', () => {
    it('should reject save_reservation if customer only books an add-on service without main treatment', async () => {
      // Mock day mention evidence agar lolos day gate
      const result = await executeSaveReservation({
        tenantId: 'default-tenant',
        customerId: 'cust-addon-test',
        chatId: '628123456789@c.us',
        treatmentName: 'Sinar Moksa (Infrared / Moxa)',
        bookingDate: 'Sabtu, 10 Oktober 2026',
        dayMentionEvidence: ['Sabtu, 10 Oktober 2026'],
        address: 'Waru, Sidoarjo',
      });

      expect(result.success).toBe(false);
      expect(result.summary).toContain('Layanan add-on memerlukan layanan utama');
      expect(result.message).toContain('Layanan add-on tidak bisa berdiri sendiri');
    });

    it('adversarial paraphrase: add-on murni dalam ragam penyebutan tetap ditolak', async () => {
      const paraphrases = [
        'Sinar Moksa (Add-on)',
        'Terapi Uap',
        'Nebulizer Saline',
        'Kala Terapi - Infrared (Sinar Moksa)',
      ];
      for (const [i, name] of paraphrases.entries()) {
        const result = await executeSaveReservation({
          tenantId: 'default-tenant',
          customerId: `cust-addon-adv-${i}`,
          chatId: '628123456789@c.us',
          treatmentName: name,
          bookingDate: 'Sabtu, 10 Oktober 2026',
          dayMentionEvidence: ['Sabtu, 10 Oktober 2026'],
          address: 'Waru, Sidoarjo',
        });
        expect(result.success, `name="${name}"`).toBe(false);
        expect(result.summary, `name="${name}"`).toContain('Layanan add-on memerlukan layanan utama');
      }
    });

    it('should accept save_reservation when add-on is combined with a main treatment', async () => {
      const spySave = vi.spyOn(reservationCoreService, 'saveReservation').mockResolvedValue({
        reservation: {
          id: 'res-combo-1',
          status: 'confirmed',
          booking_date: new Date('2026-10-10T02:00:00.000Z'),
        } as any,
        customer: {} as any,
      } as any);

      const result = await executeSaveReservation({
        tenantId: 'default-tenant',
        customerId: 'cust-addon-combo-test',
        chatId: '628123456789@c.us',
        treatmentName: 'Kala Baby – Pijat Pulih Ceria',
        additionalTreatments: ['Sinar Moksa (Infrared / Moxa)'],
        bookingDate: 'Sabtu, 10 Oktober 2026',
        dayMentionEvidence: ['Sabtu, 10 Oktober 2026'],
        address: 'Waru, Sidoarjo',
      });

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Kala Baby – Pijat Pulih Ceria');
      expect(spySave).toHaveBeenCalled();
      const callArgs = spySave.mock.calls[0][0];
      expect(callArgs.treatmentDetail).toContain('Kala Baby – Pijat Pulih Ceria');
      expect(callArgs.treatmentDetail).toContain('Sinar Moksa (Infrared / Moxa)');

      spySave.mockRestore();
    });
  });

  describe('3. Staff Collision Detection on Edit & Schedule Shift', () => {
    it('should detect collision when staff already has booking in the overlapping window', async () => {
      const staffId = 'staff-yusi-123';
      const bookingDate = new Date('2026-10-15T02:00:00.000Z'); // 09:00 WIB

      // Mock prisma reservation findMany mengembalikan reservasi yang sudah ada
      vi.mocked(prisma.reservation.findMany).mockResolvedValue([
        {
          id: 'res-existing-1',
          tenant_id: 'default-tenant',
          assigned_staff_id: staffId,
          booking_date: new Date('2026-10-15T02:15:00.000Z'), // 09:15 WIB (bentrok!)
          duration_minutes: 60,
          status: 'confirmed',
        } as any,
      ]);

      const conflicts = await findOverlappingStaffReservations({
        tenantId: 'default-tenant',
        staffId,
        bookingDate,
        durationMinutes: 60,
        excludeId: 'res-editing-current',
      });

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].id).toBe('res-existing-1');
    });

    it('should ignore self when excludeId is provided during reschedule of the same reservation', async () => {
      const staffId = 'staff-yusi-123';
      const bookingDate = new Date('2026-10-15T02:00:00.000Z');

      // Mock reservasi yang ada adalah reservasi yang sedang diedit itu sendiri
      vi.mocked(prisma.reservation.findMany).mockResolvedValue([
        {
          id: 'res-editing-current',
          tenant_id: 'default-tenant',
          assigned_staff_id: staffId,
          booking_date: new Date('2026-10-15T02:00:00.000Z'),
          duration_minutes: 60,
          status: 'confirmed',
        } as any,
      ]);

      const conflicts = await findOverlappingStaffReservations({
        tenantId: 'default-tenant',
        staffId,
        bookingDate,
        durationMinutes: 60,
        excludeId: 'res-editing-current',
      });

      // Self-exclusion: tidak boleh membenturkan diri sendiri
      expect(conflicts.length).toBe(0);
    });
  });

  describe('4. Lifecycle Auto-Distance Gazetteer Fallback', () => {
    it('should resolve coordinates via gazetteer when Google geocoding is not precise', async () => {
      // Mock geocodingService agar return isPrecise: false
      const { geocodingService } = await import('../../src/integrations/google-maps/geocoding');
      vi.spyOn(geocodingService, 'geocodeText').mockResolvedValue({
        isPrecise: false,
        lat: null,
        lng: null,
      } as any);

      // Spy on customerService methods langsung pada instance
      const updateLocSpy = vi.spyOn(customerServiceModule.customerService, 'updateCustomerLocation').mockResolvedValue({} as any);
      vi.spyOn(customerServiceModule.customerService, 'getCustomerById').mockResolvedValue({
        id: 'cust-gz-test',
        distance_km: null,
        lat: null,
      } as any);

      const { deliveryService } = await import('../../src/services/delivery.service');
      vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
        distanceKm: 10.74,
        ongkir: 15000,
        normalPrice: 25000,
        promoPrice: 15000,
        isOutOfCoverage: false,
        isEstimated: false,
        freeTierKm: 5,
        maxCoverageKm: 30,
        messageTemplate: '',
      });

      // Panggil lifecycle onReservationCreated dengan nama/alamat mengandung "Wiyung"
      await reservationLifecycleService.onReservationCreated({
        tenantId: 'default-tenant',
        customerId: 'cust-gz-test',
        reservationId: 'res-gz-test',
        customerName: 'Bunda Christine',
        address: 'Wiyung, Surabaya',
      });

      // Deterministik: poll sampai side-effect background muncul (bukan sleep
      // tetap yang flaky di bawah beban full-suite).
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline && updateLocSpy.mock.calls.length === 0) {
        await new Promise((r) => setTimeout(r, 25));
      }

      // Verifikasi updateCustomerLocation dipanggil dengan koordinat hasil Gazetteer Wiyung
      expect(updateLocSpy).toHaveBeenCalled();
      const calls = updateLocSpy.mock.calls;
      const distCall = calls.find((c) => c[1] && c[1].distanceKm != null);
      expect(distCall).toBeDefined();
      expect(distCall![1].lat).toBeDefined();
      expect(distCall![1].lng).toBeDefined();
      expect(distCall![1].distanceKm).toBe(10.74);
      expect(distCall![1].ongkir).toBe(15000);
    });
  });

  describe('5. Admin Route Security & IDOR Isolation (release-hold)', () => {
    it('should reject release-hold if reservation belongs to different tenant (IDOR protection)', async () => {
      const Fastify = (await import('fastify')).default;
      const { reservationDispatchRoutes } = await import('../../src/routes/admin/reservation-dispatch.route');
      const app = Fastify();
      await app.register(reservationDispatchRoutes);

      // Mock prisma.reservation.findFirst returns null saat mencari dengan tenant_id penyerang
      const findFirstSpy = vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/reservation/res-tenant-victim/release-hold',
        headers: {
          'x-tenant-id': 'attacker-tenant',
          'x-admin-key': 'test-key',
        },
      });

      expect(response.statusCode).toBe(404);
      const json = JSON.parse(response.body);
      expect(json.success).toBe(false);
      expect(json.error).toContain('Reservasi tidak ditemukan');
      // Non-tautologis: query WAJIB ter-scope tenant (bukan hanya id). Header
      // `x-tenant-id` TIDAK menetapkan tenant (tenant berasal dari sesi staf),
      // sehingga tenant efektif = DEFAULT_TENANT_ID — yang penting di sini
      // adalah `tenant_id` HADIR di klausa `where`.
      expect(findFirstSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'res-tenant-victim',
            tenant_id: 'default-tenant',
          }),
        })
      );
      await app.close();
    });

    it('should reject release-hold if reservation status is not hold (e.g. confirmed)', async () => {
      const Fastify = (await import('fastify')).default;
      const { reservationDispatchRoutes } = await import('../../src/routes/admin/reservation-dispatch.route');
      const app = Fastify();
      await app.register(reservationDispatchRoutes);

      // Mock prisma.reservation.findFirst returns reservasi confirmed (bukan hold)
      vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
        id: 'res-confirmed-target',
        tenant_id: 'default-tenant',
        status: 'confirmed',
      } as any);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/reservation/res-confirmed-target/release-hold',
        headers: {
          'x-tenant-id': 'default-tenant',
          'x-admin-key': 'test-key',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = JSON.parse(response.body);
      expect(json.success).toBe(false);
      expect(json.error).toContain('Hanya reservasi berstatus hold yang dapat dilepas');
      await app.close();
    });

    it('memory fallback: entri hold tanpa tenant_id DILARANG lolos isolasi (fail-closed)', async () => {
      const Fastify = (await import('fastify')).default;
      const { reservationDispatchRoutes } = await import('../../src/routes/admin/reservation-dispatch.route');
      const { memoryReservations } = await import('../../src/routes/admin/stores');
      const app = Fastify();
      await app.register(reservationDispatchRoutes);

      // Entri legacy tanpa tenant_id — harus ditolak (bukan diloloskan).
      memoryReservations.set('res-legacy-no-tenant', { id: 'res-legacy-no-tenant', status: 'hold' } as any);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/reservation/res-legacy-no-tenant/release-hold',
        headers: {
          'x-tenant-id': 'default-tenant',
          'x-admin-key': 'test-key',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(memoryReservations.get('res-legacy-no-tenant')).toBeDefined();
      memoryReservations.delete('res-legacy-no-tenant');
      await app.close();
    });
  });
});


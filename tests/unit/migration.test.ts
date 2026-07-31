import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wahaClient } from '../../src/integrations/waha/client';
import { migrationService } from '../../src/services/migration.service';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { StagingStatus, TreatmentCategory } from '@prisma/client';

describe('WAHA Chat Migration & Legacy Staging Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wahaClient.mockChats = [];
    wahaClient.mockMessages.clear();
  });

  describe('1. WAHA Extraction Logic', () => {
    it('should extract chats and correctly parse leadCreatedAt & firstPurchaseAt', async () => {
      // 1. Setup mock chats
      wahaClient.mockChats = [
        { id: '628123456789@c.us', name: 'Bunda Rian' },
      ];

      // 2. Setup mock historical messages (from oldest to newest)
      wahaClient.mockMessages.set('628123456789@c.us', [
        {
          id: 'msg_1',
          body: 'Halo Bidan Yusi, saya mau tanya-tanya paket spa',
          from: '628123456789',
          fromMe: false,
          timestamp: 1784000000, // 2026-07-14 approx
          type: 'chat',
        },
        {
          id: 'msg_2',
          body: 'Hari dan tanggal : Kamis, 23 Juli\nNama Bunda: riandika\nAlamat & Shareloc : jl semolowaru\nKec : sukolilo\nKota : surabaya\nNo. Hp : 08123456789\n\nPilihan Treatment (Baby & Kids)\nNama Bayi : Chelsea\nUsia Bayi/Anak : 2th\nTreatment : Pijat bayi',
          from: '628123456789',
          fromMe: false,
          timestamp: 1784010000,
          type: 'chat',
        },
      ]);

      // Spy on Prisma Upsert
      const upsertSpy = vi.mocked(prisma.legacyStaging.upsert).mockResolvedValue({} as any);

      // Run extraction
      const result = await migrationService.extractFromWaha();

      expect(result.success).toBe(true);
      expect(result.extractedCount).toBe(1);

      // Verify upsert calls
      expect(upsertSpy).toHaveBeenCalledTimes(1);
      const args = upsertSpy.mock.calls[0][0];

      // Check extracted fields
      expect(args.create.phoneNumber).toBe('628123456789');
      expect(args.create.leadCreatedAt).toEqual(new Date(1784000000 * 1000));
      expect(args.create.firstPurchaseAt).toEqual(new Date(1784010000 * 1000));
      expect(args.create.extractedReservationJson).toBeDefined();
      expect(args.create.extractedReservationJson.name).toBe('riandika');
      expect(args.create.extractedReservationJson.treatmentCategory).toBe(TreatmentCategory.BABY);
      expect(args.create.extractedLocation).toBe('sukolilo, surabaya');
    });

    it('should skip group chats', async () => {
      wahaClient.mockChats = [
        { id: '123456789@g.us', name: 'Grup Arisan' },
      ];

      const result = await migrationService.extractFromWaha();
      expect(result.success).toBe(true);
      expect(result.extractedCount).toBe(0);
    });
  });

  describe('2. Legacy Commitment/Promotion Logic', () => {
    it('should upsert customer, set status to legacy, and migrate messages & reservations', async () => {
      // 1. Mock Staging Records
      const stagingRecord = {
        id: 'staging_123',
        tenantId: 'default-tenant',
        phoneNumber: '628123456789',
        name: 'Bunda Rian',
        extractedLocation: 'sukolilo, surabaya',
        leadCreatedAt: new Date(1784000000 * 1000),
        firstPurchaseAt: new Date(1784010000 * 1000),
        extractedReservationJson: {
          name: 'riandika',
          phone: '082137172877',
          address: 'jl semolowaru',
          kec: 'sukolilo',
          kota: 'surabaya',
          treatmentCategory: TreatmentCategory.BABY,
          treatmentDetail: 'Pijat bayi',
          bookingDate: new Date().toISOString(),
        },
        status: StagingStatus.APPROVED,
        rawMessagesCount: 2,
        rawMessagesJson: [
          { body: 'Halo Bidan Yusi', fromMe: false, timestamp: new Date(1784000000 * 1000).toISOString() },
          { body: 'Form reservasi...', fromMe: false, timestamp: new Date(1784010000 * 1000).toISOString() },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.legacyStaging.findMany).mockResolvedValue([stagingRecord]);

      // Mock Customer Service & Prisma updates
      const mockCustomer = { id: 'cust_999', phone: '628123456789', name: 'Bunda Rian', created_at: new Date() };
      vi.spyOn(customerService, 'getOrCreateCustomer').mockResolvedValue(mockCustomer as any);
      
      vi.mocked(prisma.message.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null);

      const customerUpdateSpy = vi.mocked(prisma.customer.update).mockResolvedValue({} as any);
      const messageCreateSpy = vi.mocked(prisma.message.create).mockResolvedValue({} as any);
      const reservationCreateSpy = vi.mocked(prisma.reservation.create).mockResolvedValue({} as any);
      const stagingUpdateSpy = vi.mocked(prisma.legacyStaging.update).mockResolvedValue({} as any);

      // Run commit
      const commitResult = await migrationService.commitApprovedRecords();

      expect(commitResult.success).toBe(true);
      expect(commitResult.committedCount).toBe(1);

      // A. Verify Customer status updated to legacy
      expect(customerUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cust_999' },
          data: expect.objectContaining({ status: 'legacy' }),
        })
      );

      // B. Verify historical messages created with original timestamps
      expect(messageCreateSpy).toHaveBeenCalledTimes(2);
      expect(messageCreateSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            content: 'Halo Bidan Yusi',
            created_at: new Date(1784000000 * 1000),
          }),
        })
      );

      // C. Verify historical Reservation created as confirmed
      expect(reservationCreateSpy).toHaveBeenCalledTimes(1);
      expect(reservationCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customer_id: 'cust_999',
            status: 'confirmed',
            treatment_detail: 'Pijat bayi',
          }),
        })
      );

      // D. Verify Staging status marked as COMMITTED
      expect(stagingUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'staging_123' },
          data: { status: StagingStatus.COMMITTED },
        })
      );
    });
  });

  describe('3. Side-Effect Guards — No Unwanted Live Triggers', () => {
    it('should NOT create any follow_up records for legacy customers (skipFollowUpScheduling enforced)', async () => {
      // Arrange: staging record tanpa form reservasi untuk isolasi test
      const stagingRecord = {
        id: 'staging_nofu_001',
        tenantId: 'default-tenant',
        phoneNumber: '628111000001',
        name: 'Bunda Legacy',
        extractedLocation: null,
        leadCreatedAt: new Date(),
        firstPurchaseAt: null,
        extractedReservationJson: null,
        status: StagingStatus.APPROVED,
        rawMessagesCount: 1,
        rawMessagesJson: [
          { body: 'Halo', fromMe: false, timestamp: new Date().toISOString() },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.legacyStaging.findMany).mockResolvedValue([stagingRecord as any]);

      // Spy on getOrCreateCustomer untuk verifikasi parameter yang dikirim
      const mockCustomer = { id: 'cust_legacy_001', phone: '628111000001', created_at: new Date() };
      const getOrCreateSpy = vi.spyOn(customerService, 'getOrCreateCustomer').mockResolvedValue(mockCustomer as any);

      vi.mocked(prisma.customer.update).mockResolvedValue({} as any);
      vi.mocked(prisma.message.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.message.create).mockResolvedValue({} as any);
      vi.mocked(prisma.legacyStaging.update).mockResolvedValue({} as any);

      // Spy on followUpService — pastikan tidak pernah dipanggil
      const followUpModule = await import('../../src/services/follow-up.service');
      const followUpSpy = vi.spyOn(followUpModule.followUpService, 'createNoPurchaseFollowUps').mockResolvedValue(undefined as any);

      // Act
      const result = await migrationService.commitApprovedRecords();

      // Assert: commit berhasil
      expect(result.success).toBe(true);
      expect(result.committedCount).toBe(1);

      // CRITICAL: getOrCreateCustomer dipanggil dengan skipFollowUpScheduling: true
      expect(getOrCreateSpy).toHaveBeenCalledWith(
        '628111000001',
        'Bunda Legacy',
        'default-tenant',
        { skipFollowUpScheduling: true }
      );

      // CRITICAL: followUpService tidak boleh dipanggil sama sekali
      expect(followUpSpy).not.toHaveBeenCalled();
    });

    it('should NOT call googleCalendarService for historical reservations committed from migration', async () => {
      // Arrange: staging dengan form reservasi untuk memastikan reservation.create terpanggil
      const stagingRecord = {
        id: 'staging_nocal_001',
        tenantId: 'default-tenant',
        phoneNumber: '628111000002',
        name: 'Bunda Historis',
        extractedLocation: 'genteng, surabaya',
        leadCreatedAt: new Date(),
        firstPurchaseAt: new Date(),
        extractedReservationJson: {
          name: 'Bunda Historis',
          phone: '08111000002',
          treatmentCategory: 'BABY',
          treatmentDetail: 'Pijat bayi dan kids ceria',
          bookingDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 hari lalu
          rawText: 'Pilihan Treatment (Baby & Kids) ...',
        },
        status: StagingStatus.APPROVED,
        rawMessagesCount: 1,
        rawMessagesJson: [
          { body: 'Form historis', fromMe: false, timestamp: new Date().toISOString() },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.legacyStaging.findMany).mockResolvedValue([stagingRecord as any]);

      const mockCustomer = { id: 'cust_legacy_002', phone: '628111000002', created_at: new Date() };
      vi.spyOn(customerService, 'getOrCreateCustomer').mockResolvedValue(mockCustomer as any);
      vi.mocked(prisma.customer.update).mockResolvedValue({} as any);
      vi.mocked(prisma.message.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.message.create).mockResolvedValue({} as any);
      vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.reservation.create).mockResolvedValue({} as any);
      vi.mocked(prisma.legacyStaging.update).mockResolvedValue({} as any);

      // Spy on googleCalendarService — HARUS ZERO CALLS
      const calendarModule = await import('../../src/services/google-calendar.service');
      const calendarCreateSpy = vi.spyOn(calendarModule.googleCalendarService, 'createEvent').mockResolvedValue('cal_event_id');

      // Act
      const result = await migrationService.commitApprovedRecords();

      // Assert: commit berhasil dan reservation terbuat
      expect(result.success).toBe(true);
      expect(result.committedCount).toBe(1);
      expect(vi.mocked(prisma.reservation.create)).toHaveBeenCalledTimes(1);

      // CRITICAL: Google Calendar TIDAK boleh dipanggil untuk reservasi historis
      expect(calendarCreateSpy).not.toHaveBeenCalled();
    }, 15000);

    it('should NOT call capiService.sendLeadEvent for legacy customers (no fake Meta Lead events)', async () => {
      // Arrange: staging dengan data lengkap (customer + reservation) agar
      // semua code-path migration dieksekusi — CAPI harus tetap 0 calls
      const stagingRecord = {
        id: 'staging_nocapi_001',
        tenantId: 'default-tenant',
        phoneNumber: '628111000003',
        name: 'Bunda Migrasi CAPI',
        extractedLocation: 'gubeng, surabaya',
        leadCreatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 hari lalu
        firstPurchaseAt: new Date(Date.now() - 55 * 24 * 60 * 60 * 1000),
        extractedReservationJson: {
          name: 'Bunda Migrasi CAPI',
          phone: '08111000003',
          treatmentCategory: 'BABY',
          treatmentDetail: 'Pijat bayi full body',
          bookingDate: new Date(Date.now() - 55 * 24 * 60 * 60 * 1000).toISOString(),
          rawText: 'Pilihan Treatment (Baby & Kids) - Pijat bayi full body',
        },
        status: StagingStatus.APPROVED,
        rawMessagesCount: 2,
        rawMessagesJson: [
          { body: 'Halo bidan', fromMe: false, timestamp: new Date().toISOString() },
          { body: 'Saya mau pesan', fromMe: false, timestamp: new Date().toISOString() },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.legacyStaging.findMany).mockResolvedValue([stagingRecord as any]);

      const mockCustomer = { id: 'cust_legacy_003', phone: '628111000003', created_at: new Date() };
      vi.spyOn(customerService, 'getOrCreateCustomer').mockResolvedValue(mockCustomer as any);
      vi.mocked(prisma.customer.update).mockResolvedValue({} as any);
      vi.mocked(prisma.message.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.message.create).mockResolvedValue({} as any);
      vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.reservation.create).mockResolvedValue({} as any);
      vi.mocked(prisma.legacyStaging.update).mockResolvedValue({} as any);

      // Spy on capiService — HARUS EXACTLY 0 CALLS
      // Data customer lama tidak boleh mencemari Meta CAPI dengan event Lead palsu
      const capiModule = await import('../../src/services/capi.service');
      const capiSendLeadSpy = vi.spyOn(capiModule.capiService, 'sendCapiEvent').mockResolvedValue(undefined as any);

      // Act
      const result = await migrationService.commitApprovedRecords();

      // Assert: commit berhasil
      expect(result.success).toBe(true);
      expect(result.committedCount).toBe(1);

      // CRITICAL: capiService.sendCapiEvent TIDAK BOLEH dipanggil untuk migrasi historis
      // Memanggil CAPI untuk data lama = menciptakan event Lead palsu di Meta Ads Manager
      expect(capiSendLeadSpy).not.toHaveBeenCalled();
      expect(capiSendLeadSpy).toHaveBeenCalledTimes(0);
    });
  });

});

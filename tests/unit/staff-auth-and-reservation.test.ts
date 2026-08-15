import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/utils/bcrypt';
import { StaffAuthService, hashToken } from '../../src/services/staff-auth.service';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { prisma } from '../../src/db/client';

describe('Staff Auth & Reservation Services', () => {
  describe('Bcrypt Utility', () => {
    it('should hash and verify password correctly', async () => {
      const password = 'terapis_password_123';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPassword('wrong_password', hash);
      expect(isInvalid).toBe(false);
    });
  });

  describe('StaffAuthService', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should hashToken using SHA-256 hex', () => {
      const token = 'test-token-123';
      const hashed = hashToken(token);
      expect(hashed).toHaveLength(64); // SHA-256 produces 64 hex chars
    });

    it('should return null when staff not found on login', async () => {
      (prisma.staff.findFirst as any).mockResolvedValue(null);

      const result = await StaffAuthService.login('08123456789', 'secret', 'default-tenant');
      expect(result).toBeNull();
    });

    it('should return null when password mismatch on login', async () => {
      const hashed = await hashPassword('correct_pass');
      (prisma.staff.findFirst as any).mockResolvedValue({
        id: 'staff-1',
        name: 'Bidan Dewi',
        phone: '08123456789',
        password_hash: hashed,
        active: true,
      });

      const result = await StaffAuthService.login('08123456789', 'wrong_pass', 'default-tenant');
      expect(result).toBeNull();
    });

    it('should create session and return token when login succeeds', async () => {
      const hashed = await hashPassword('correct_pass');
      (prisma.staff.findFirst as any).mockResolvedValue({
        id: 'staff-1',
        name: 'Bidan Dewi',
        phone: '08123456789',
        password_hash: hashed,
        active: true,
      });
      (prisma.staffSession.create as any).mockResolvedValue({ id: 'session-1' });

      const result = await StaffAuthService.login('08123456789', 'correct_pass', 'default-tenant');
      expect(result).toBeDefined();
      expect(result?.token).toBeDefined();
      expect(result?.staff.id).toBe('staff-1');
      expect(prisma.staffSession.create).toHaveBeenCalled();
    });

    it('should validate active session correctly', async () => {
      const token = 'valid-token';
      const futureDate = new Date(Date.now() + 3600000);

      (prisma.staffSession.findUnique as any).mockResolvedValue({
        id: 'session-1',
        token_hash: hashToken(token),
        expires_at: futureDate,
        revoked_at: null,
        staff: {
          id: 'staff-1',
          name: 'Bidan Dewi',
          active: true,
        },
      });

      const session = await StaffAuthService.validateSession(token);
      expect(session).toBeDefined();
      expect(session?.staff.name).toBe('Bidan Dewi');
    });

    it('should return null if session is expired or staff inactive', async () => {
      const token = 'expired-token';
      const pastDate = new Date(Date.now() - 3600000);

      (prisma.staffSession.findUnique as any).mockResolvedValue({
        id: 'session-1',
        token_hash: hashToken(token),
        expires_at: pastDate,
        revoked_at: null,
        staff: { id: 'staff-1', active: true },
      });

      const expiredSession = await StaffAuthService.validateSession(token);
      expect(expiredSession).toBeNull();

      (prisma.staffSession.findUnique as any).mockResolvedValue({
        id: 'session-2',
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + 3600000),
        revoked_at: null,
        staff: { id: 'staff-1', active: false }, // inactive
      });

      const inactiveSession = await StaffAuthService.validateSession(token);
      expect(inactiveSession).toBeNull();
    });

    it('should logout and revoke all sessions', async () => {
      (prisma.staffSession.updateMany as any).mockResolvedValue({ count: 1 });

      const loggedOut = await StaffAuthService.logout('some-token');
      expect(loggedOut).toBe(true);

      const revokedAll = await StaffAuthService.revokeAllSessions('staff-1');
      expect(revokedAll).toBe(true);
    });
  });

  describe('StaffReservationService', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should get today tasks and build mapsUrl, navigationUrl, address, children, and pricing without exposing customer phone', async () => {
      const today = new Date();
      (prisma.reservation.findMany as any).mockResolvedValue([
        {
          id: 'res-1',
          treatment_detail: 'Pijat Bayi Ceria (60 min)',
          treatment_category: 'BABY',
          booking_date: today,
          status: 'confirmed',
          purchase_value: 120000,
          purchase_occurred_at: new Date(),
          customer: {
            name: 'Bunda Sarah',
            lat: -7.2575,
            lng: 112.7521,
            kelurahan: 'Gayungan',
            kecamatan: 'Gayungan',
            kota: 'Surabaya',
            distance_km: 2.5,
            ongkir: 5000,
            children: [{ name: 'Kenzo', raw_age_text: '6 bulan', birth_date: null }],
            conversations: [{ id: 'conv-123' }],
          },
          children: [],
        },
      ]);

      const tasks = await StaffReservationService.getTodayTasks('staff-1', 'default-tenant');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].reservationId).toBe('res-1');
      expect(tasks[0].customerName).toBe('Bunda Sarah');
      expect(tasks[0].treatmentDetail).toBe('Pijat Bayi Ceria (60 min)');
      expect(tasks[0].conversationId).toBe('conv-123');
      expect(tasks[0].mapsUrl).toContain('https://maps.google.com/?q=-7.2575,112.7521');
      expect(tasks[0].navigationUrl).toContain('https://www.google.com/maps/dir/?api=1&destination=-7.2575,112.7521&travelmode=bicycling');
      expect(tasks[0].address.kelurahan).toBe('Gayungan');
      expect(tasks[0].address.distanceKm).toBe(2.5);
      expect(tasks[0].address.fullText).toContain('Gayungan');
      expect(tasks[0].children).toHaveLength(1);
      expect(tasks[0].children[0].name).toBe('Kenzo');
      expect(tasks[0].children[0].rawAgeText).toBe('6 bulan');
      expect(tasks[0].pricing.treatmentFee).toBe(120000);
      expect(tasks[0].pricing.deliveryFee).toBe(5000);
      expect(tasks[0].pricing.totalFee).toBe(125000);
      expect(tasks[0].pricing.paymentStatus).toBe('LUNAS');
      expect(tasks[0].shareLocationText).toContain('Bunda Sarah');
      expect(tasks[0].shareLocationText).toContain('125.000');
      expect((tasks[0] as any).customerPhone).toBeUndefined();
      expect((tasks[0] as any).phone).toBeUndefined();
    });

    it('should set paymentStatus to TAGIH_DI_TEMPAT if purchase_occurred_at is null', async () => {
      const today = new Date();
      (prisma.reservation.findMany as any).mockResolvedValue([
        {
          id: 'res-2',
          treatment_detail: 'Pijat Tradisional Moms',
          treatment_category: 'MOMS',
          booking_date: today,
          status: 'confirmed',
          purchase_value: 150000,
          purchase_occurred_at: null,
          customer: {
            name: 'Bunda Nisa',
            lat: null,
            lng: null,
            kelurahan: 'Tropodo',
            kecamatan: 'Waru',
            kota: 'Sidoarjo',
            distance_km: 4.2,
            ongkir: 10000,
            children: [],
            conversations: [{ id: 'conv-456' }],
          },
          children: [],
        },
      ]);

      const tasks = await StaffReservationService.getTodayTasks('staff-1', 'default-tenant');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].pricing.paymentStatus).toBe('TAGIH_DI_TEMPAT');
      expect(tasks[0].pricing.paymentStatusLabel).toContain('Tagih di Tempat');
      expect(tasks[0].pricing.totalFee).toBe(160000);
      expect(tasks[0].mapsUrl).toBeNull();
      expect(tasks[0].navigationUrl).toBeNull();
    });

    it('should calculate sequential itinerary distance using Haversine from clinic for patient 1 and previous patient for patient 2', async () => {
      const today = new Date();
      (prisma.reservation.findMany as any).mockResolvedValue([
        {
          id: 'res-seq-1',
          treatment_detail: 'Pijat Bayi Ceria',
          treatment_category: 'BABY',
          booking_date: new Date(today.getTime() + 1000 * 60 * 60 * 9), // 09:00
          status: 'confirmed',
          purchase_value: 120000,
          purchase_occurred_at: today,
          customer: {
            name: 'Bunda Aurel',
            lat: -7.34886, // Same as clinic or nearby
            lng: 112.751677,
            kelurahan: 'Gayungan',
            kecamatan: 'Gayungan',
            kota: 'Surabaya',
            distance_km: 2.5,
            ongkir: 15000,
            children: [],
            conversations: [{ id: 'conv-1' }],
          },
          children: [],
        },
        {
          id: 'res-seq-2',
          treatment_detail: 'Pijat Lahap Juara',
          treatment_category: 'BABY',
          booking_date: new Date(today.getTime() + 1000 * 60 * 60 * 11), // 11:00
          status: 'confirmed',
          purchase_value: 140000,
          purchase_occurred_at: null,
          customer: {
            name: 'Nisa',
            lat: -7.3614, // ~1.6 km straight from patient 1
            lng: 112.7592,
            kelurahan: 'Tropodo',
            kecamatan: 'Waru',
            kota: 'Sidoarjo',
            distance_km: 4.8,
            ongkir: 20000,
            children: [],
            conversations: [{ id: 'conv-2' }],
          },
          children: [],
        },
      ]);

      const tasks = await StaffReservationService.getTodayTasks('staff-1', 'default-tenant');
      expect(tasks).toHaveLength(2);

      // Patient 1: From Clinic
      expect(tasks[0].address.distanceSource).toBe('CLINIC');
      expect(tasks[0].address.originName).toBe('Kala Moms and Baby Spa');
      expect(tasks[0].address.distanceKm).toBe(2.5);
      expect(tasks[0].address.estimatedMinutes).toBe(7); // 2.5 * 2.05 + 2 = 7.125 -> 7 min

      // Patient 2: From Patient 1 (Bunda Aurel)
      expect(tasks[1].address.distanceSource).toBe('PREVIOUS_PATIENT');
      expect(tasks[1].address.originName).toBe('Bunda Aurel');
      expect(tasks[1].address.distanceKm).toBeGreaterThan(0);
      expect(tasks[1].address.estimatedMinutes).toBeGreaterThan(0);
    });

    it('should assert conversation ownership based on active task today', async () => {
      (prisma.conversation.findUnique as any).mockResolvedValue({
        customer_id: 'cust-1',
        tenant_id: 'default-tenant',
      });

      (prisma.reservation.findFirst as any).mockResolvedValue({ id: 'res-1' });

      const isOwned = await StaffReservationService.assertConversationOwnedByStaffToday('conv-1', 'staff-1', 'default-tenant');
      expect(isOwned).toBe(true);

      (prisma.reservation.findFirst as any).mockResolvedValue(null);
      const isNotOwned = await StaffReservationService.assertConversationOwnedByStaffToday('conv-1', 'staff-2', 'default-tenant');
      expect(isNotOwned).toBe(false);
    });
  });
});

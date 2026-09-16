import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextGrounder } from '../../../src/v3/agent/pipeline/context-grounder';
import { GoalTracker, CustomerGoalSession } from '../../../src/v3/state/goal-tracker';
import { executeSaveReservation } from '../../../src/v3/tools/save-reservation.tool';
import { reservationCoreService } from '../../../src/services/reservation-core.service';

vi.mock('../../../src/services/reservation-core.service', () => ({
  reservationCoreService: {
    saveReservation: vi.fn(async () => ({
      reservation: { id: 'res-loc-gate-1' },
      isNew: true,
      isUpdate: false,
    })),
  },
  ReservationConflictError: class ReservationConflictError extends Error {},
}));

describe('Fase 3: Booking Commit & Location Prerequisite Gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const TREATMENT = 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)';

  describe('ContextGrounder.isBookingCommitReady', () => {
    it('MENOLAK (false) pertanyaan same-day bila lokasi customer BELUM diketahui (kasus Turn 4 sesi 173235)', () => {
      const sessionWithoutLocation: CustomerGoalSession = {
        genderGreeting: 'Bunda',
        selectedTreatment: TREATMENT,
        cartItems: [{ name: TREATMENT, promoPrice: 75000 } as any],
        booking: {},
      };

      const ready = ContextGrounder.isBookingCommitReady(
        sessionWithoutLocation,
        'Kak kalo hari ini jam 3 sore ada jadwal kosong?',
        [
          { role: 'user', content: 'halo kak' },
          { role: 'assistant', content: 'Halo Bunda! Rumahnya dimana ya?' },
          { role: 'user', content: 'yg untuk kembung apa kak' },
          { role: 'assistant', content: 'Pijat Bayi Pulih Ceria...' },
        ]
      );

      expect(ready).toBe(false);
    });

    it('MENOLAK (false) bila afirmasi same-day tapi lokasi belum ada', () => {
      const sessionWithoutLocation: CustomerGoalSession = {
        genderGreeting: 'Bunda',
        selectedTreatment: TREATMENT,
        cartItems: [{ name: TREATMENT, promoPrice: 75000 } as any],
        booking: {},
      };

      const ready = ContextGrounder.isBookingCommitReady(
        sessionWithoutLocation,
        'saya mau ambil hari ini jam 3 sore',
        []
      );

      expect(ready).toBe(false);
    });

    it('MELOLOSKAN (true) bila lokasi SUDAH diketahui dan treatment sudah disepakati', () => {
      const sessionWithLocation: CustomerGoalSession = {
        genderGreeting: 'Bunda',
        selectedTreatment: TREATMENT,
        cartItems: [{ name: TREATMENT, promoPrice: 75000 } as any],
        location: {
          kelurahan: 'Waru',
          kecamatan: 'Waru',
          distanceKm: 5,
        } as any,
        booking: {},
      };

      const ready = ContextGrounder.isBookingCommitReady(
        sessionWithLocation,
        'siap bund hari ini jam 3 sore',
        []
      );

      expect(ready).toBe(true);
    });
  });

  describe('executeSaveReservation location gate', () => {
    it('MENOLAK (success: false) bila conversationId ada tapi lokasi sesi & input kosong', async () => {
      const convId = 'conv-no-loc-' + Date.now();
      // Ensure session has no location
      await GoalTracker.updateGoalSession(convId, {
        selectedTreatment: TREATMENT,
      }, 'default-tenant');

      const out = await executeSaveReservation({
        customerId: 'cust-no-loc',
        chatId: '628123456@c.us',
        treatmentName: TREATMENT,
        bookingDate: 'Hari ini',
        bookingTime: '15:00',
        dayMentionEvidence: ['hari ini jam 3 sore'],
        conversationId: convId,
        tenantId: 'default-tenant',
      });

      expect(out.success).toBe(false);
      expect(out.summary).toMatch(/lokasi/i);
      expect(out.message).toMatch(/daerah|kelurahan|kecamatan/i);
      expect(vi.mocked(reservationCoreService.saveReservation)).not.toHaveBeenCalled();
    });

    it('MELOLOSKAN (success: true) bila lokasi sudah tersimpan di sesi', async () => {
      const convId = 'conv-with-loc-' + Date.now();
      await GoalTracker.updateGoalSession(convId, {
        selectedTreatment: TREATMENT,
        location: {
          kelurahan: 'Kureksari',
          kecamatan: 'Waru',
          kota: 'Sidoarjo',
          distanceKm: 3.5,
        } as any,
      }, 'default-tenant');

      const out = await executeSaveReservation({
        customerId: 'cust-with-loc',
        chatId: '628123457@c.us',
        treatmentName: TREATMENT,
        bookingDate: 'Hari ini',
        bookingTime: '15:00',
        dayMentionEvidence: ['hari ini jam 3 sore'],
        conversationId: convId,
        tenantId: 'default-tenant',
      });

      expect(out.success).toBe(true);
      expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalled();
    });

    it('MELOLOSKAN (success: true) bila input memuat parameter address eksplisit', async () => {
      const convId = 'conv-explicit-addr-' + Date.now();
      await GoalTracker.updateGoalSession(convId, {
        selectedTreatment: TREATMENT,
      }, 'default-tenant');

      const out = await executeSaveReservation({
        customerId: 'cust-explicit-addr',
        chatId: '628123458@c.us',
        treatmentName: TREATMENT,
        bookingDate: 'Hari ini',
        bookingTime: '15:00',
        address: 'Perum Deltasari Indah Blok A No 12 Waru',
        dayMentionEvidence: ['hari ini jam 3 sore'],
        conversationId: convId,
        tenantId: 'default-tenant',
      });

      expect(out.success).toBe(true);
      expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalled();
    });
  });
});

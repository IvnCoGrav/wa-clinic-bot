import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeSaveReservation } from '../../src/v3/tools/save-reservation.tool';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { reservationCoreService } from '../../src/services/reservation-core.service';

describe('Treatment Identity Contract & Anti-Hijacking (Task 0.8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should REJECT save_reservation (success: false) when treatmentName is outside verifiedTreatmentNames', async () => {
    // Sesi memiliki daftar layanan yang telah disepakati oleh customer
    vi.spyOn(GoalTracker, 'getGoalSession').mockResolvedValue({
      verifiedTreatmentNames: ['Pijat Bayi Ceria'],
      location: {
        kelurahan: 'Rungkut Kidul',
        kecamatan: 'Rungkut',
        kota: 'Surabaya',
      },
    } as any);

    // Mock reservationCoreService agar tidak benar-benar menulis jika lolos
    vi.spyOn(reservationCoreService, 'saveReservation').mockResolvedValue({
      reservation: { id: 'res-test-123' },
    } as any);

    // LLM memanggil save_reservation dengan nama layanan acak yang tidak disepakati
    const result = await executeSaveReservation(
      {
        treatmentName: 'Totok Wajah dan Relaksasi Ibu',
        bookingDate: 'besok jam 10 pagi',
        dayMentionEvidence: ['besok'],
        conversationId: 'conv-test-identity',
        customerName: 'Bunda Sarah',
      },
      'default-tenant'
    );

    // Pada kode lama, save_reservation tidak memvalidasi terhadap verifiedTreatmentNames
    // dan langsung menyimpan (success: true).
    // Pada Fase 4 ID 4.5.2, layanan di luar verifiedTreatmentNames WAJIB ditolak (success: false).
    expect(result.success).toBe(false);
    expect(result.summary).toMatch(/kesepakatan|diverifikasi|verified/i);
  });
});

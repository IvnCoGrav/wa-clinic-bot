import { describe, it, expect, beforeEach, vi } from 'vitest';
import { followUpService, NEXT_TREATMENT_STAGE_DAYS } from '../../src/services/follow-up.service';
import { followUpLifecycleService } from '../../src/services/follow-up-lifecycle.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { FOLLOWUP_ROLLING_TEMPLATES } from '../../src/config/followup-templates';

describe('Follow-Up Repeat Schedule (25-50-75 Hari) Adversarial Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. NEXT_TREATMENT_STAGE_DAYS bernilai [25, 50, 75] secara default', () => {
    expect(NEXT_TREATMENT_STAGE_DAYS).toEqual([25, 50, 75]);
  });

  it('2. computeNextTreatmentAtWib0900 menghasilkan jadwal presisi pada jam 09:00 WIB (02:00 UTC)', () => {
    // 10 Oktober 2026 10:00 WIB (03:00 UTC)
    const booking = new Date('2026-10-10T10:00:00+07:00');

    // Stage 1 (+25 hari): 10 Okt + 25 = 35 - 31 = 4 November 2026 pukul 09:00 WIB
    const stage1 = followUpLifecycleService.computeNextTreatmentAtWib0900(booking, 1);
    expect(stage1.toISOString()).toBe('2026-11-04T02:00:00.000Z');

    // Stage 2 (+50 hari): 10 Okt + 50 = 60 - 31 = 29 November 2026 pukul 09:00 WIB
    const stage2 = followUpLifecycleService.computeNextTreatmentAtWib0900(booking, 2);
    expect(stage2.toISOString()).toBe('2026-11-29T02:00:00.000Z');

    // Stage 3 (+75 hari): 10 Okt + 75 = 85. Okt(31) + Nov(30) = 61. 85 - 61 = 24 Desember 2026 pukul 09:00 WIB
    const stage3 = followUpLifecycleService.computeNextTreatmentAtWib0900(booking, 3);
    expect(stage3.toISOString()).toBe('2026-12-24T02:00:00.000Z');
  });

  it('3. Adversarial Edge Case: Akhir Tahun (Desember melintasi Januari tahun baru)', () => {
    // 20 Desember 2026 14:00 WIB
    const booking = new Date('2026-12-20T14:00:00+07:00');

    // Stage 1 (+25 hari): 20 Des + 25 = 45 - 31 = 14 Januari 2027 pukul 09:00 WIB
    const s1 = followUpLifecycleService.computeNextTreatmentAtWib0900(booking, 1);
    expect(s1.toISOString()).toBe('2027-01-14T02:00:00.000Z');

    // Stage 2 (+50 hari): 20 Des + 50 = 70. Des(31) + Jan(31) = 62. 70 - 62 = 8 Februari 2027 pukul 09:00 WIB
    const s2 = followUpLifecycleService.computeNextTreatmentAtWib0900(booking, 2);
    expect(s2.toISOString()).toBe('2027-02-08T02:00:00.000Z');

    // Stage 3 (+75 hari): 20 Des + 75 = 95. Des(31) + Jan(31) + Feb(28) = 90. 95 - 90 = 5 Maret 2027 pukul 09:00 WIB
    const s3 = followUpLifecycleService.computeNextTreatmentAtWib0900(booking, 3);
    expect(s3.toISOString()).toBe('2027-03-05T02:00:00.000Z');
  });

  it('4. Adversarial Edge Case: Tahun Kabisat (Februari 29 Hari) vs Non-Kabisat (Februari 28 Hari)', () => {
    // Tahun Kabisat 2028: booking 10 Februari 2028
    const leapBooking = new Date('2028-02-10T10:00:00+07:00');
    // 10 Feb + 25 hari = 35. Feb 2028 punya 29 hari. 35 - 29 = 6 Maret 2028.
    const leapS1 = followUpLifecycleService.computeNextTreatmentAtWib0900(leapBooking, 1);
    expect(leapS1.toISOString()).toBe('2028-03-06T02:00:00.000Z');

    // Tahun Non-Kabisat 2027: booking 10 Februari 2027
    const normalBooking = new Date('2027-02-10T10:00:00+07:00');
    // 10 Feb + 25 hari = 35. Feb 2027 punya 28 hari. 35 - 28 = 7 Maret 2027.
    const normalS1 = followUpLifecycleService.computeNextTreatmentAtWib0900(normalBooking, 1);
    expect(normalS1.toISOString()).toBe('2027-03-07T02:00:00.000Z');
  });

  it('5. createNextTreatmentFollowUps membuat 3 baris dengan tanggal +25, +50, +75 hari', async () => {
    vi.spyOn(prisma.customer, 'findUnique').mockResolvedValue(null as any);
    vi.spyOn(prisma.followUp, 'findFirst').mockResolvedValue(null as any);
    const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

    const booking = new Date('2030-05-01T10:00:00+07:00');
    await followUpService.createNextTreatmentFollowUps('cust-new', booking, DEFAULT_TENANT_ID);

    const createdNext = createSpy.mock.calls
      .map((c: any) => c[0]?.data)
      .filter((d: any) => d?.type === 'NEXT_TREATMENT');

    expect(createdNext.length).toBe(3);

    // Mei punya 31 hari:
    // Stage 1 (+25 hari): 1 Mei + 25 = 26 Mei 2030 pukul 09:00 WIB
    expect(new Date(createdNext.find((d: any) => d.stage === 1).scheduled_at).toISOString()).toBe('2030-05-26T02:00:00.000Z');

    // Stage 2 (+50 hari): 1 Mei + 50 = 51 - 31 = 20 Juni 2030 pukul 09:00 WIB
    expect(new Date(createdNext.find((d: any) => d.stage === 2).scheduled_at).toISOString()).toBe('2030-06-20T02:00:00.000Z');

    // Stage 3 (+75 hari): 1 Mei + 75 = 76. Mei(31) + Jun(30) = 61. 76 - 61 = 15 Juli 2030 pukul 09:00 WIB
    expect(new Date(createdNext.find((d: any) => d.stage === 3).scheduled_at).toISOString()).toBe('2030-07-15T02:00:00.000Z');
  });

  it('6. Jaminan Non-Retroaktif: baris lama (created_at < epoch) tidak digeser', async () => {
    // Skenario: Customer A punya follow-up lama terjadwal di DB dengan skema lama (30 hari).
    // Sistem DILARANG merombak baris tersebut tanpa ada reservasi baru.
    const oldScheduledDate = new Date('2030-06-01T02:00:00.000Z');
    vi.spyOn(prisma.customer, 'findUnique').mockResolvedValue(null as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);

    // Mock bahwa follow-up stage 1 sudah ada dengan oldScheduledDate,
    // dibuat SEBELUM epoch skema 25/50/75.
    vi.spyOn(prisma.followUp, 'findFirst')
      .mockResolvedValueOnce({
        id: 'fu-old-scheduled',
        status: 'QUEUED',
        scheduled_at: oldScheduledDate,
        reservation_id: 'res-old',
        created_at: new Date('2026-06-01T00:00:00.000Z'),
      } as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any);

    await followUpService.createNextTreatmentFollowUps(
      'cust-existing',
      new Date('2030-05-01T10:00:00+07:00'),
      DEFAULT_TENANT_ID,
      'res-old'
    );

    // Baris lama tidak boleh disentuh sama sekali.
    const touchedOld = updateSpy.mock.calls.find((c: any) => c[0]?.where?.id === 'fu-old-scheduled');
    expect(touchedOld).toBeUndefined();
  });

  it('6b. Reconciler hanya memindai kunjungan setelah epoch skema (non-retroaktif)', async () => {
    const reservationFind = vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([] as any);
    const { NEXT_TREATMENT_SCHEME_EPOCH } = await import('../../src/config/followup-scheduling');

    await followUpLifecycleService.reconcileOrphanedCompletedFollowUps(DEFAULT_TENANT_ID);

    const where = (reservationFind as any).mock.calls[0]?.[0]?.where;
    expect(where?.booking_date?.gte).toBeInstanceOf(Date);
    expect((where.booking_date.gte as Date).getTime()).toBeGreaterThanOrEqual(
      NEXT_TREATMENT_SCHEME_EPOCH.getTime()
    );
  });

  it('7. Template Default NEXT_TREATMENT_1 & NEXT_TREATMENT_MOMS_1 selaras dengan pengingat H-5 / hampir sebulan', () => {
    const babyTemplates = FOLLOWUP_ROLLING_TEMPLATES.NEXT_TREATMENT_1;
    expect(babyTemplates.length).toBeGreaterThanOrEqual(3);
    const renderedBaby1 = babyTemplates[0]({ name: 'Citra', babyName: 'Alif', businessName: 'Momby' });
    expect(renderedBaby1).toContain('hampir 1 bulan');

    const momsTemplates = FOLLOWUP_ROLLING_TEMPLATES.NEXT_TREATMENT_MOMS_1;
    expect(momsTemplates.length).toBeGreaterThanOrEqual(3);
    const renderedMoms1 = momsTemplates[0]({ name: 'Citra', momStage: 'POSTPARTUM', businessName: 'Momby' });
    expect(renderedMoms1).toContain('hampir 1 bulan');
  });
});

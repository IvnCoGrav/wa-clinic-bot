import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { reservationCoreService, computeAdvisoryLockKey } from '../../src/services/reservation-core.service';

vi.mock('../../src/services/reservation-lifecycle.service', () => ({
  reservationLifecycleService: { onReservationCreated: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../src/services/follow-up.service', () => ({
  followUpService: { createReservationFollowUps: vi.fn().mockResolvedValue(undefined) },
}));

/**
 * Stage 7 (R6) — idempotency request_id.
 * Bila request_id sudah ada untuk tenant → kembalikan baris itu, DILARANG
 * membuat baris baru (retry webhook / concurrency aman).
 */
describe('Reservation idempotency request_id (Stage 7 / R6)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const base = {
    tenantId: 'default-tenant',
    customerId: 'cust-req-1',
    chatId: '628111@c.us',
    treatmentCategory: 'BABY' as const,
    treatmentDetail: 'Pijat Bayi Ceria Newborn',
    source: 'AGENT' as const,
    bookingDate: new Date('2026-09-20T03:00:00.000Z'),
    requestId: 'default-tenant:cust-req-1:2026-09-20:Pijat Bayi Ceria Newborn',
  };

  it('request_id sudah ada → kembalikan existing, tidak create baru', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'existing-req', tenant_id: 'default-tenant', request_id: base.requestId,
      status: 'confirmed', booking_date: base.bookingDate, treatment_detail: 'Pijat Bayi Ceria Newborn',
    } as any);

    const res = await reservationCoreService.saveReservation(base);

    expect(res.isNew).toBe(false);
    expect(res.reservation.id).toBe('existing-req');
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('request_id belum ada → buat baru dengan request_id tersimpan', async () => {
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'new-req', request_id: base.requestId } as any);

    // A2 (KB-4): bookingDate WAJIB → sertakan tanggal. Tanpa idempotent hit → buat baru.
    const res = await reservationCoreService.saveReservation({ ...base, requestId: undefined });

    expect(res.isNew).toBe(true);
    expect(prisma.reservation.create).toHaveBeenCalled();
    const createArg = vi.mocked(prisma.reservation.create).mock.calls[0][0] as any;
    expect(createArg.data.request_id).toBeNull();
  });

  it('CG-05 (flag): AGENT non-same-day confirmed → needs_staff_verification=true', async () => {
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'new-verify' } as any);

    await reservationCoreService.saveReservation({ ...base, requestId: undefined });

    const createArg = vi.mocked(prisma.reservation.create).mock.calls[0][0] as any;
    expect(createArg.data.needs_staff_verification).toBe(true);
  });

  it('CG-05 (flag): ADMIN_PANEL → needs_staff_verification=false', async () => {
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'admin-new' } as any);

    await reservationCoreService.saveReservation({ ...base, source: 'ADMIN_PANEL', requestId: undefined });

    const createArg = vi.mocked(prisma.reservation.create).mock.calls[0][0] as any;
    expect(createArg.data.needs_staff_verification).toBe(false);
  });
});

/**
 * A2 (KB-4) — booking_date WAJIB. Gerbang deterministik di lapisan data:
 * DILARANG menyimpan reservasi tanpa tanggal (data sampah, memicu
 * CONFIRMED_NULL_DATE, tidak bisa dicek bentrok/kuota/jadwal).
 */
describe('A2 — booking_date WAJIB (KB-4)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const base = {
    tenantId: 'default-tenant',
    customerId: 'cust-a2',
    chatId: '628111@c.us',
    treatmentCategory: 'BABY' as const,
    treatmentDetail: 'Pijat Bayi Ceria Newborn',
    source: 'AGENT' as const,
  };

  it('tanpa bookingDate → ditolak MISSING_BOOKING_DATE, DILARANG create', async () => {
    await expect(reservationCoreService.saveReservation({ ...base } as any)).rejects.toMatchObject({
      code: 'MISSING_BOOKING_DATE',
      statusCode: 400,
    });
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('bookingDate invalid (NaN) → ditolak', async () => {
    await expect(
      reservationCoreService.saveReservation({ ...base, bookingDate: new Date('bukan-tanggal') } as any)
    ).rejects.toMatchObject({ code: 'MISSING_BOOKING_DATE' });
  });

  it('dengan bookingDate valid → DIIZINKAN (regression lock)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prisma.reservation.count).mockResolvedValueOnce(0 as any);
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'ok-date', status: 'confirmed' } as any);
    const res = await reservationCoreService.saveReservation({
      ...base,
      bookingDate: new Date('2026-10-15T02:00:00.000Z'),
    });
    expect(res.isNew).toBe(true);
  });

  it('channel-aware: ADMIN_PANEL tanpa tanggal → DIIZINKAN sebagai intake, dipaksa status pending', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null as any);
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'intake-1', status: 'pending' } as any);
    await reservationCoreService.saveReservation({
      ...base,
      source: 'ADMIN_PANEL',
      status: 'confirmed', // admin minta confirmed, tapi tanpa tanggal TIDAK boleh
      bookingDate: undefined,
    } as any);
    const arg = vi.mocked(prisma.reservation.create).mock.calls[0][0] as any;
    expect(arg.data.status).toBe('pending');
    expect(arg.data.booking_date).toBeNull();
    expect(arg.data.pendingScheduleCheck).toBe(false);
  });

  it('channel-aware: WEBHOOK (auto-capture) tanpa tanggal → intake pending (bukan ditolak)', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null as any);
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'intake-2', status: 'pending' } as any);
    const res = await reservationCoreService.saveReservation({
      ...base,
      source: 'WEBHOOK',
      status: 'confirmed',
      bookingDate: undefined,
    } as any);
    expect(res.isNew).toBe(true);
    const arg = vi.mocked(prisma.reservation.create).mock.calls[0][0] as any;
    expect(arg.data.status).toBe('pending');
  });

  it('channel-aware: BOT tanpa tanggal tetap DITOLAK (customer-facing wajib tanggal)', async () => {
    await expect(
      reservationCoreService.saveReservation({ ...base, source: 'BOT', bookingDate: undefined } as any)
    ).rejects.toMatchObject({ code: 'MISSING_BOOKING_DATE' });
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('channel-aware: intake tanpa tanggal di-dedup 24 jam (update baris pending lama, bukan create baru)', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({ id: 'pending-lama', treatment_detail: 'X' } as any);
    vi.mocked(prisma.reservation.update).mockResolvedValue({ id: 'pending-lama', status: 'pending' } as any);
    const res = await reservationCoreService.saveReservation({
      ...base,
      source: 'WEBHOOK',
      bookingDate: undefined,
      requestId: undefined,
    } as any);
    expect(res.isNew).toBe(false);
    expect(res.isUpdate).toBe(true);
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });
});

/**
 * A3 — advisory lock key: deterministik per (tenant+staf+hari WIB).
 * Dua booking pada slot/hari yang sama HARUS memakai kunci identik (serialisasi);
 * hari berbeda / staf berbeda / tenant berbeda → kunci berbeda.
 */
describe('A3 — computeAdvisoryLockKey (serialisasi double-booking)', () => {
  const pagi = new Date('2026-10-15T02:00:00.000Z'); // 09:00 WIB
  const siang = new Date('2026-10-15T06:00:00.000Z'); // 13:00 WIB (hari sama)

  it('slot berbeda pada hari & staf yang sama → kunci SAMA (satu lock per hari+staf)', () => {
    expect(computeAdvisoryLockKey('t1', 'staff-1', pagi)).toBe(computeAdvisoryLockKey('t1', 'staff-1', siang));
  });

  it('staf berbeda → kunci berbeda', () => {
    expect(computeAdvisoryLockKey('t1', 'staff-1', pagi)).not.toBe(computeAdvisoryLockKey('t1', 'staff-2', pagi));
  });

  it('tenant berbeda → kunci berbeda', () => {
    expect(computeAdvisoryLockKey('t1', 'staff-1', pagi)).not.toBe(computeAdvisoryLockKey('t2', 'staff-1', pagi));
  });

  it('hari WIB berbeda (23:30 WIB vs 00:30 WIB besok) → kunci berbeda', () => {
    const malamIni = new Date('2026-10-15T16:30:00.000Z'); // 23:30 WIB 15 Okt
    const besokPagi = new Date('2026-10-15T17:30:00.000Z'); // 00:30 WIB 16 Okt
    expect(computeAdvisoryLockKey('t1', 'staff-1', malamIni)).not.toBe(
      computeAdvisoryLockKey('t1', 'staff-1', besokPagi)
    );
  });

  it('staf null (unassigned) memakai grup khusus yang berbeda dari staf ber-ID', () => {
    expect(computeAdvisoryLockKey('t1', null, pagi)).not.toBe(computeAdvisoryLockKey('t1', 'staff-1', pagi));
  });

  it('deterministik & bertipe integer 32-bit', () => {
    const k1 = computeAdvisoryLockKey('t1', 'staff-1', pagi);
    const k2 = computeAdvisoryLockKey('t1', 'staff-1', pagi);
    expect(k1).toBe(k2);
    expect(Number.isInteger(k1)).toBe(true);
  });
});

/**
 * A3 — saat DB nyata mendukung transaksi interaktif, saveReservation WAJIB
 * mengakuisisi `pg_advisory_xact_lock` DENGAN KUNCI YANG BENAR sebelum
 * cek-bentrok/insert. Test ini membuktikan lock tidak sekadar no-op.
 */
describe('A3 — advisory lock benar-benar diakuisisi (bukan no-op)', () => {
  const origTx = (prisma as any).$transaction;
  const origExec = (prisma as any).$executeRawUnsafe;

  afterEach(() => {
    (prisma as any).$transaction = origTx;
    (prisma as any).$executeRawUnsafe = origExec;
    vi.clearAllMocks();
  });

  it('memanggil $transaction + pg_advisory_xact_lock dengan kunci (tenant+staf+hari)', async () => {
    const bookingDate = new Date('2026-10-15T02:00:00.000Z');
    const expectedKey = computeAdvisoryLockKey('default-tenant', 'staff-lock-1', bookingDate);
    const execSpy = vi.fn().mockResolvedValue(undefined);
    (prisma as any).$executeRawUnsafe = execSpy;
    (prisma as any).$transaction = vi.fn(async (fn: any) => fn(prisma));

    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.reservation.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'locked-new', status: 'confirmed' } as any);

    await reservationCoreService.saveReservation({
      tenantId: 'default-tenant',
      customerId: 'cust-lock',
      chatId: '6281@c.us',
      treatmentCategory: 'BABY' as const,
      treatmentDetail: 'Pijat Bayi Ceria',
      source: 'ADMIN_PANEL' as const,
      bookingDate,
      assignedStaffId: 'staff-lock-1',
      durationMinutes: 60,
    });

    expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
    expect(execSpy).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock($1)', expectedKey);
  });

  it('lock error (bukan business error) → fallback jalankan sekali tanpa lock (tidak menggandakan)', async () => {
    (prisma as any).$executeRawUnsafe = vi.fn().mockRejectedValue(new Error('lock unavailable'));
    (prisma as any).$transaction = vi.fn(async () => { throw new Error('lock unavailable'); });

    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.reservation.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'fallback-new', status: 'confirmed' } as any);

    const res = await reservationCoreService.saveReservation({
      tenantId: 'default-tenant',
      customerId: 'cust-lock-2',
      chatId: '6281@c.us',
      treatmentCategory: 'BABY' as const,
      treatmentDetail: 'Pijat Bayi Ceria',
      source: 'ADMIN_PANEL' as const,
      bookingDate: new Date('2026-10-15T02:00:00.000Z'),
      assignedStaffId: 'staff-lock-2',
      durationMinutes: 60,
    });

    expect(res.isNew).toBe(true);
    expect(prisma.reservation.create).toHaveBeenCalledTimes(1); // tepat sekali, tidak dobel
  });
});

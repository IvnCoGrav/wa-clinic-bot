import { describe, it, expect, beforeEach, vi } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import { customerService } from '../../src/services/customer.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Follow-Up Repeat Order & Reconciler Unit Tests (TDD Adversarial)', () => {
  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    vi.restoreAllMocks();
  });

  // 1. Repeat-order: SENT Agustus (sent_at / scheduled_at < booking Oktober) → Tahap 1, 2, 3 kunjungan baru WAJIB terbuat
  it('1. repeat-order: baris SENT masa lalu tidak memblokir follow-up kunjungan baru', async () => {
    const phone = `62899${Date.now()}rep`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Repeat', DEFAULT_TENANT_ID);
    const bookingDate = new Date('2030-10-03T10:00:00+07:00'); // kunjungan baru masa depan

    // Mock findFirst per stage:
    // Stage 1 & 2: ada baris SENT Agustus (sent_at & scheduled_at Agustus 2030 < Oktober 2030)
    // Stage 3: null (belum ada)
    const findFirstSpy = vi.spyOn(prisma.followUp, 'findFirst');
    findFirstSpy
      .mockResolvedValueOnce({
        id: 'fu-sent-aug-s1',
        status: 'SENT',
        sent_at: new Date('2030-08-05T02:00:00.000Z'),
        scheduled_at: new Date('2030-08-05T02:00:00.000Z'),
      } as any)
      .mockResolvedValueOnce({
        id: 'fu-sent-aug-s2',
        status: 'SENT',
        sent_at: new Date('2030-09-05T02:00:00.000Z'),
        scheduled_at: new Date('2030-09-05T02:00:00.000Z'),
      } as any)
      .mockResolvedValueOnce(null as any);

    const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

    await followUpService.createNextTreatmentFollowUps(customer.id, bookingDate, DEFAULT_TENANT_ID);

    const createdRows = createSpy.mock.calls.filter((c: any) => c[0]?.data?.type === 'NEXT_TREATMENT');
    // Semua 3 stage harus terbuat karena SENT lama tidak boleh memblokir siklus kunjungan baru
    expect(createdRows.length).toBe(3);
    const stages = createdRows.map((c: any) => c[0].data.stage).sort();
    expect(stages).toEqual([1, 2, 3]);
  });

  // 2. Same-visit idempoten: baris SENT siklus ini (sent_at >= bookingDate) TIDAK direcreate
  it('2. same-visit idempoten: baris SENT siklus ini tidak direcreate', async () => {
    const phone = `62899${Date.now()}same`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda SameVisit', DEFAULT_TENANT_ID);
    const bookingDate = new Date('2030-10-03T10:00:00+07:00');

    // Stage 1: sudah SENT di siklus ini (sent_at >= bookingDate)
    // Stage 2 & 3: belum dibuat (null)
    const findFirstSpy = vi.spyOn(prisma.followUp, 'findFirst');
    findFirstSpy
      .mockResolvedValueOnce({
        id: 'fu-sent-cycle-s1',
        status: 'SENT',
        sent_at: new Date('2030-11-03T02:00:00.000Z'), // >= bookingDate
        scheduled_at: new Date('2030-11-03T02:00:00.000Z'),
      } as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any);

    const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

    await followUpService.createNextTreatmentFollowUps(customer.id, bookingDate, DEFAULT_TENANT_ID);

    const createdRows = createSpy.mock.calls.filter((c: any) => c[0]?.data?.type === 'NEXT_TREATMENT');
    // Hanya stage 2 dan 3 yang terbuat, stage 1 di-skip
    expect(createdRows.length).toBe(2);
    expect(createdRows.map((c: any) => c[0].data.stage).sort()).toEqual([2, 3]);
  });

  // 3. Panggil 2x kunjungan sama → tidak duplikat (idempoten / re-anchor)
  it('3. panggil 2x kunjungan sama tidak menduplikasi antrean follow-up', async () => {
    const phone = `62899${Date.now()}double`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda DoubleCall', DEFAULT_TENANT_ID);
    const bookingDate = new Date('2030-10-03T10:00:00+07:00');

    const findFirstSpy = vi.spyOn(prisma.followUp, 'findFirst');
    // Panggilan 1: null (terbuat 3)
    // Panggilan 2: baris QUEUED dengan scheduled_at yang sama (skip idempoten)
    const s1Date = new Date('2030-11-03T02:00:00.000Z');
    const s2Date = new Date('2030-12-03T02:00:00.000Z');
    const s3Date = new Date('2031-01-03T02:00:00.000Z');

    findFirstSpy
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ id: 's1', status: 'QUEUED', scheduled_at: s1Date } as any)
      .mockResolvedValueOnce({ id: 's2', status: 'QUEUED', scheduled_at: s2Date } as any)
      .mockResolvedValueOnce({ id: 's3', status: 'QUEUED', scheduled_at: s3Date } as any);

    const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);

    await followUpService.createNextTreatmentFollowUps(customer.id, bookingDate, DEFAULT_TENANT_ID);
    const countAfterFirst = createSpy.mock.calls.filter((c: any) => c[0]?.data?.type === 'NEXT_TREATMENT').length;
    expect(countAfterFirst).toBe(3);

    await followUpService.createNextTreatmentFollowUps(customer.id, bookingDate, DEFAULT_TENANT_ID);
    const countAfterSecond = createSpy.mock.calls.filter((c: any) => c[0]?.data?.type === 'NEXT_TREATMENT').length;
    expect(countAfterSecond).toBe(3); // tidak bertambah
    expect(updateSpy).not.toHaveBeenCalled(); // tidak perlu update karena tanggal sudah cocok
  });

  // 4. Kunjungan baru < 14 hari: suppressPrematureNextTreatment menggeser tanggal, tidak menduplikasi
  it('4. recent visit guard menunda NEXT_TREATMENT saat customer baru berkunjung (<14 hari)', async () => {
    const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
    vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);

    const recentVisit = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000); // 4 hari lalu
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValueOnce({ booking_date: recentVisit } as any);

    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    const { typingService } = await import('../../src/services/typing.service');
    const sendSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true } as any);

    const fu = {
      id: 'fu-recent-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-recent-1',
      type: 'NEXT_TREATMENT',
      stage: 1,
      scheduled_at: new Date(Date.now() - 1000), // jatuh tempo
      status: 'QUEUED',
      customer: {
        id: 'cust-recent-1',
        name: 'Bunda Rina Baru Selesai',
        phone: '6285109356999',
        children: [],
        conversations: [],
      },
    };

    const result = await followUpService.executeFollowUp(fu as any, DEFAULT_TENANT_ID);

    expect(result).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();
    const postponeUpdate = updateSpy.mock.calls.find((c: any) => c[0]?.data?.scheduled_at);
    expect(postponeUpdate).toBeDefined();
    expect((postponeUpdate![0].data.scheduled_at as Date).getTime()).toBeGreaterThan(Date.now());
  });

  // 5. Bypass / sandbox / dummy: tidak membuat baris follow-up
  it('5. bypass / sandbox / dummy customer tidak dibuatkan baris follow-up', async () => {
    const phone = `62899${Date.now()}dummy`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Testing Dummy Bot', DEFAULT_TENANT_ID);
    // Tandai customer sebagai sandbox/dummy
    vi.spyOn(prisma.customer, 'findUnique').mockResolvedValueOnce({
      id: customer.id,
      phone,
      name: 'Testing Dummy Bot',
      is_sandbox_test: true,
      labels: [],
    } as any);

    const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);
    const bookingDate = new Date('2030-10-03T10:00:00+07:00');

    await followUpService.createNextTreatmentFollowUps(customer.id, bookingDate, DEFAULT_TENANT_ID);

    expect(createSpy).not.toHaveBeenCalled();
  });

  // 6. Beda tenant: tenant-isolated, tidak bocor lintas tenant
  it('6. reconciler dan follow-up generator terisolasi per tenant (tenant-isolation)', async () => {
    const tenantA = 'tenant-a';
    const tenantB = 'tenant-b';
    const pastCompletedDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 hari lalu (dalam window 90d)

    // Mock reservation completed di tenant-a
    vi.spyOn(prisma.reservation, 'findMany').mockImplementation(async (args: any) => {
      if (args?.where?.tenant_id === tenantA && args?.where?.status === 'completed') {
        return [{ customer_id: 'cust-tenant-a', booking_date: pastCompletedDate }] as any;
      }
      return [] as any;
    });

    // Mock hasNext: tenant-a tidak punya baris aktif
    vi.spyOn(prisma.followUp, 'findMany').mockImplementation(async (args: any) => {
      expect(args?.where?.tenant_id).toBe(tenantA);
      return [] as any;
    });

    vi.spyOn(prisma.customer, 'findMany').mockResolvedValue([
      { id: 'cust-tenant-a', phone: '628111111111', name: 'Bunda Tenant A', status: 'active' },
    ] as any);

    // Mock count agar after > 0
    vi.spyOn(prisma.followUp, 'count').mockResolvedValue(3);

    const createSpy = vi.spyOn(followUpService, 'createNextTreatmentFollowUps').mockResolvedValue(undefined as any);

    const resA = await followUpService.reconcileOrphanedCompletedFollowUps(tenantA);
    expect(resA.reconciledCount).toBe(1);
    expect(createSpy).toHaveBeenCalledWith('cust-tenant-a', expect.any(Date), tenantA);

    // Sekarang jalankan reconciler untuk tenantB: harus kosong
    createSpy.mockClear();
    const resB = await followUpService.reconcileOrphanedCompletedFollowUps(tenantB);
    expect(resB.reconciledCount).toBe(0);
    expect(createSpy).not.toHaveBeenCalled();
  });
});

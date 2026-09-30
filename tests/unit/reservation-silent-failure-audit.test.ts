import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../src/db/client';
import { reservationCoreService } from '../../src/services/reservation-core.service';

// Pulihkan spy antar-test agar tidak bocor (mis. spy saveReservation dari 173f).
afterEach(() => {
  vi.restoreAllMocks();
});

vi.mock('../../src/services/reservation-lifecycle.service', () => ({
  reservationLifecycleService: {
    onReservationCreated: vi.fn().mockResolvedValue(undefined),
    onReservationCompleted: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../src/services/follow-up.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/services/follow-up.service')>();
  return {
    ...original,
    followUpService: {
      ...original.followUpService,
      createReservationFollowUps: vi.fn().mockResolvedValue(undefined),
    },
  };
});

/**
 * RED-CAPABLE REGRESSION SUITE — Silent Failure Audit (R2.1, R2.3)
 *
 * Setiap test di bawah ini GAGAL pada kode commit 353c756b (bug nyata) dan
 * diharapkan HIJAU setelah perbaikan fondasional. Dibuat test-first sesuai
 * mandat `tdd` — bukan meniru bukti JSON sintetis.
 */
describe('AUDIT R2.1 — Staff overlap window blind spot (H5)', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * Fake Prisma yang MENGHORMATI klausa `where.booking_date.gte/lte`.
   * Inilah kunci test red-capable: window sempit lama [09:00,10:00] akan
   * mengecualikan booking 08:00 sehingga 0 konflik (BUG). Window hari penuh
   * menangkapnya → 1 konflik.
   */
  function installWindowAwareReservationFake(rows: any[]) {
    vi.mocked(prisma.reservation.findMany).mockImplementation(async (args: any) => {
      const gte = args?.where?.booking_date?.gte as Date | undefined;
      const lte = args?.where?.booking_date?.lte as Date | undefined;
      const customerId = args?.where?.customer_id as string | undefined;
      const staffId = args?.where?.assigned_staff_id as string | undefined;
      const statusIn = args?.where?.status?.in as string[] | undefined;
      return rows.filter((r) => {
        const t = new Date(r.booking_date).getTime();
        if (gte && t < new Date(gte).getTime()) return false;
        if (lte && t > new Date(lte).getTime()) return false;
        if (customerId && r.customer_id && r.customer_id !== customerId) return false;
        if (staffId && r.assigned_staff_id && r.assigned_staff_id !== staffId) return false;
        if (statusIn && r.status && !statusIn.includes(r.status)) return false;
        return true;
      }) as any;
    });
  }

  it('existing 120m (08:00-10:00 WIB) vs new 30m (09:30-10:00 WIB) pada staf yang sama HARUS terdeteksi bentrok', async () => {
    // 08:00 WIB = 01:00Z ; 09:30 WIB = 02:30Z
    const existingStart = new Date('2026-10-05T01:00:00.000Z');
    const newStart = new Date('2026-10-05T02:30:00.000Z');
    installWindowAwareReservationFake([
      { id: 'existing-120m', customer_id: 'other-cust', assigned_staff_id: 'staff-overlap-1', status: 'confirmed', booking_date: existingStart, duration_minutes: 120, treatment_detail: 'Sesi Panjang' },
    ]);

    await expect(
      reservationCoreService.saveReservation({
        tenantId: 'default-tenant',
        customerId: 'cust-overlap',
        chatId: '6281@c.us',
        treatmentCategory: 'BABY' as const,
        treatmentDetail: 'Sesi Pendek',
        source: 'ADMIN_PANEL' as const,
        bookingDate: newStart,
        durationMinutes: 30,
        assignedStaffId: 'staff-overlap-1',
      })
    ).rejects.toMatchObject({ code: 'STAFF_COLLISION' });
  });

  it('sesi yang benar-benar tidak bertabrakan (08:00-09:00 vs 09:30-10:00) tetap DIIZINKAN', async () => {
    const existingStart = new Date('2026-10-05T01:00:00.000Z'); // 08:00 WIB, 60m → 09:00 WIB
    const newStart = new Date('2026-10-05T02:30:00.000Z'); // 09:30 WIB
    installWindowAwareReservationFake([
      { id: 'existing-60m', customer_id: 'other-cust', assigned_staff_id: 'staff-overlap-2', status: 'confirmed', booking_date: existingStart, duration_minutes: 60, treatment_detail: 'Sesi Pagi' },
    ]);
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'new-ok' } as any);

    const res = await reservationCoreService.saveReservation({
      tenantId: 'default-tenant',
      customerId: 'cust-ok',
      chatId: '6281@c.us',
      treatmentCategory: 'BABY' as const,
      treatmentDetail: 'Sesi Tengah',
      source: 'ADMIN_PANEL' as const,
      bookingDate: newStart,
      durationMinutes: 30,
      assignedStaffId: 'staff-overlap-2',
    });
    expect(res.isNew).toBe(true);
  });
});

describe('AUDIT R2.3 — Cancel-then-rebook idempotency dead-end (H9)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-booking dengan request_id identik pada baris cancelled HARUS mereaktivasi ke confirmed', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'cancelled-row',
      tenant_id: 'default-tenant',
      request_id: 'default-tenant:cust-rebook:2026-10-05:Pijat Bayi Ceria',
      status: 'cancelled',
      booking_date: new Date('2026-10-05T02:00:00.000Z'),
      treatment_detail: 'Pijat Bayi Ceria',
    } as any);
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
      id: 'cancelled-row',
      status: 'confirmed',
    } as any);

    const res = await reservationCoreService.saveReservation({
      tenantId: 'default-tenant',
      customerId: 'cust-rebook',
      chatId: '6281@c.us',
      treatmentCategory: 'BABY' as const,
      treatmentDetail: 'Pijat Bayi Ceria',
      source: 'AGENT' as const,
      bookingDate: new Date('2026-10-05T02:00:00.000Z'),
      requestId: 'default-tenant:cust-rebook:2026-10-05:Pijat Bayi Ceria',
    });

    expect((res.reservation as any).status).toBe('confirmed');
    expect(prisma.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cancelled-row' },
        data: expect.objectContaining({ status: 'confirmed' }),
      })
    );
  });

  it('re-booking dengan request_id identik pada baris confirmed tetap idempoten (tanpa update status)', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'confirmed-row',
      tenant_id: 'default-tenant',
      request_id: 'req-same',
      status: 'confirmed',
      booking_date: new Date('2026-10-05T02:00:00.000Z'),
    } as any);

    const res = await reservationCoreService.saveReservation({
      tenantId: 'default-tenant',
      customerId: 'cust-rebook',
      chatId: '6281@c.us',
      treatmentCategory: 'BABY' as const,
      treatmentDetail: 'Pijat Bayi Ceria',
      source: 'AGENT' as const,
      bookingDate: new Date('2026-10-05T02:00:00.000Z'),
      requestId: 'req-same',
    });

    expect(res.isNew).toBe(false);
    expect(res.isUpdate).toBe(false);
    expect((res.reservation as any).status).toBe('confirmed');
  });
});

describe('AUDIT R2.4 — In-memory mock false success gate (F1)', () => {
  const ADMIN_KEY = 'test_admin_key_silent_failure';
  const origEnv = process.env.NODE_ENV;
  let app: any;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    const { buildApp } = await import('../../src/app');
    app = buildApp();
    await app.ready();
  });
  afterAll(async () => {
    process.env.NODE_ENV = origEnv;
    await app?.close?.();
  });
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    process.env.NODE_ENV = origEnv; // pulihkan sebelum mock di-set
  });

  it('PRODUCTION: DB offline pada /quick-hold HARUS membalas 5xx, bukan 201 success palsu', async () => {
    vi.mocked(prisma.reservation.create).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.findMany).mockRejectedValue(new Error('Database offline'));

    process.env.NODE_ENV = 'production';
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/reservation/quick-hold',
        headers: { 'x-api-key': ADMIN_KEY },
        payload: {
          customerId: 'cust-f1',
          bookingDate: new Date('2026-10-05T02:00:00.000Z').toISOString(),
        },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  }, 20000);
});

describe('AUDIT K1 — Customer form false acknowledgement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('DB gagal simpan form → reply DILARANG mengklaim "data reservasi sudah kami terima"', async () => {
    const { ConversationStateMachine } = await import('../../src/state-machine/machine');
    const { ConversationState } = await import('@prisma/client');
    const { customerService } = await import('../../src/services/customer.service');
    const { conversationService } = await import('../../src/services/conversation.service');

    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, 'default-tenant');
    const conversation = await conversationService.getOrCreateConversation(cust.id, 'default-tenant');
    conversation.current_state = ConversationState.RESERVATION_SENT;

    // DB offline untuk simpan (create ditolak)
    vi.mocked(prisma.reservation.findMany).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.create).mockRejectedValue(new Error('Database offline'));

    const sm = new ConversationStateMachine({
      simulateHumanReply: vi.fn().mockResolvedValue({ success: true }),
      sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
    } as any);

    const res = await sm.processMessage({
      tenantId: 'default-tenant',
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_k1',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: {
          body: `Berikut list untuk reservasi : \n\nHari dan tanggal :  23 Juni 2026\nNama Bunda: shafira\nAlamat & Shareloc : pandean 2/27, Kel. Peneleh\nKec : Genteng\nKota : Surabaya\nNo. Hp : 081217639971\n\nPilihan treatment (Baby & Kids)\n\nNama Bayi : Danish\nUsia Bayi/Anak : 1 bulan 2 hari\nTreatment : paket selapan ceria`,
        },
      },
    } as any);

    expect(res.replyText).toBeDefined();
    expect(res.replyText).not.toContain('data reservasi sudah kami terima');
    expect(res.isHumanHandling).toBe(true);
  });
});

describe('AUDIT 173f — request_id memuat jam (anti timpa pagi/sore)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('dua booking treatment SAMA di slot BERBEDA (pagi & sore) TIDAK boleh memakai request_id yang sama', async () => {
    const { executeSaveReservation } = await import('../../src/v3/tools/save-reservation.tool');
    const { GoalTracker } = await import('../../src/v3/state/goal-tracker');
    vi.spyOn(GoalTracker, 'getGoalSession').mockResolvedValue({} as any);
    vi.spyOn(GoalTracker, 'updateGoalSession').mockResolvedValue(undefined as any);

    const spy = vi
      .spyOn(reservationCoreService, 'saveReservation')
      .mockResolvedValue({ reservation: { id: 'r-x' }, isNew: true, isUpdate: false } as any);

    const base = {
      customerId: 'cust-slot',
      chatId: '6281@c.us',
      customerName: 'Bunda Slot',
      treatmentName: 'Pijat Bayi Ceria',
      bookingDate: 'besok',
      tenantId: 'default-tenant',
      address: 'Jl. Mawar No. 1',
    } as any;

    await executeSaveReservation({ ...base, bookingTime: '09:00' });
    await executeSaveReservation({ ...base, bookingTime: '15:00' });

    const ids = spy.mock.calls.map((c: any) => c[0]?.requestId);
    expect(ids[0]).toBeDefined();
    expect(ids[1]).toBeDefined();
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('AUDIT 173i-a — Follow-up WAHA gagal TIDAK boleh ditandai SENT', () => {
  beforeEach(() => vi.clearAllMocks());

  it('simulateHumanReply success=false → status FAILED, return false, bukan SENT', async () => {
    const { FollowUpService } = await import('../../src/services/follow-up.service');
    const { typingService } = await import('../../src/services/typing.service');
    const svc = new FollowUpService();

    vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: false, error: 'WAHA down' } as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    vi.spyOn(await import('../../src/integrations/whatsapp/factory'), 'resolveGatewayForTenant').mockResolvedValue({ providerType: 'WAHA' } as any);

    const fuMock: any = {
      id: 'fu-fail-1',
      tenant_id: 'default-tenant',
      customer_id: 'cust-1',
      type: 'NO_PURCHASE',
      stage: 1,
      scheduled_at: new Date(),
      status: 'QUEUED',
      customer: { id: 'cust-1', name: 'Rina', phone: '6281234567890', children: [] },
    };

    const ok = await svc.executeFollowUp(fuMock, 'default-tenant');
    expect(ok).toBe(false);
    const sentUpdate = updateSpy.mock.calls.find((c: any) => c[0]?.data?.status === 'SENT');
    expect(sentUpdate).toBeUndefined();
    const failedUpdate = updateSpy.mock.calls.find((c: any) => c[0]?.data?.status === 'FAILED');
    expect(failedUpdate).toBeDefined();
  });
});

describe('AUDIT 173i-b — completeTask staf menjalankan lifecycle completion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('completeTask memanggil onReservationCompleted saat booking_date ada', async () => {
    const { StaffReservationService } = await import('../../src/services/staff-reservation.service');
    const { reservationLifecycleService } = await import('../../src/services/reservation-lifecycle.service');
    const lifecycleSpy = vi
      .spyOn(reservationLifecycleService, 'onReservationCompleted')
      .mockResolvedValue(undefined as any);

    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      id: 'res-complete',
      tenant_id: 'default-tenant',
      assigned_staff_id: 'staff-a',
      purchase_occurred_at: new Date(),
      customer_id: 'cust-1',
      booking_date: new Date('2026-10-05T02:00:00.000Z'),
      treatment_category: 'BABY',
      status: 'confirmed',
    } as any);
    vi.mocked(prisma.reservation.update).mockResolvedValue({ id: 'res-complete', status: 'completed' } as any);

    const res = await StaffReservationService.completeTask({
      reservationId: 'res-complete',
      staffId: 'staff-a',
      tenantId: 'default-tenant',
    });

    expect(res.success).toBe(true);
    expect(lifecycleSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: 'res-complete', customerId: 'cust-1' })
    );
  });

  it('completeTask MENOLAK reservasi berstatus cancelled', async () => {
    const { StaffReservationService } = await import('../../src/services/staff-reservation.service');
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      id: 'res-cancel',
      tenant_id: 'default-tenant',
      assigned_staff_id: 'staff-a',
      purchase_occurred_at: new Date(),
      customer_id: 'cust-1',
      status: 'cancelled',
    } as any);

    const res = await StaffReservationService.completeTask({
      reservationId: 'res-cancel',
      staffId: 'staff-a',
      tenantId: 'default-tenant',
    });
    expect(res.success).toBe(false);
  });
});

const ADMIN_API_KEY_TEST = 'test_admin_key_silent_failure';

describe('AUDIT 173i-d — DELETE hard: notifikasi staf SEBELUM reservasi dihapus', () => {
  it('sendReservationCancelledNotification dipanggil saat reservasi MASIH ada', async () => {
    process.env.ADMIN_API_KEY = ADMIN_API_KEY_TEST;
    const notifOrder: string[] = [];

    let reservationExists = true;
    vi.mocked(prisma.reservation.findFirst).mockImplementation(async () => {
      if (!reservationExists) return null as any;
      return {
        id: 'res-del',
        tenant_id: 'default-tenant',
        customer_id: 'cust-del',
        assigned_staff_id: 'staff-del',
        google_calendar_event_id: null,
        customer: { id: 'cust-del', phone: '628123', name: 'Bunda' },
      } as any;
    });
    (prisma.reservation as any).delete = vi.fn().mockImplementation(async () => {
      reservationExists = false;
      return {} as any;
    });
    (prisma.child as any).updateMany = vi.fn().mockResolvedValue({ count: 0 } as any);

    const { staffNotificationService } = await import('../../src/services/staff-notification.service');
    vi.spyOn(staffNotificationService, 'sendReservationCancelledNotification').mockImplementation(async () => {
      notifOrder.push(reservationExists ? 'notified-while-exists' : 'notified-after-delete');
      return { sent: true } as any;
    });

    const { buildApp } = await import('../../src/app');
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/reservation/res-del?hard=true',
      headers: { 'x-api-key': ADMIN_API_KEY_TEST },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(notifOrder).toContain('notified-while-exists');
    expect(notifOrder).not.toContain('notified-after-delete');
  }, 20000);
});

describe('AUDIT 173d — cek bentrok fail-closed di production', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PRODUCTION: DB error saat cek bentrok → saveReservation DITOLAK (CONFLICT_CHECK_UNAVAILABLE)', async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      vi.mocked(prisma.reservation.findMany).mockRejectedValue(new Error('Database offline'));
      await expect(
        reservationCoreService.saveReservation({
          tenantId: 'default-tenant',
          customerId: 'cust-173d',
          chatId: '6281@c.us',
          treatmentCategory: 'BABY' as const,
          treatmentDetail: 'Pijat Bayi Ceria',
          source: 'AGENT' as const,
          bookingDate: new Date('2026-10-05T02:00:00.000Z'),
        })
      ).rejects.toMatchObject({ code: 'CONFLICT_CHECK_UNAVAILABLE' });
    } finally {
      process.env.NODE_ENV = orig;
    }
  });

  it('NON-production: DB error saat cek bentrok → tetap fail-open (tidak melempar)', async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      vi.mocked(prisma.reservation.findMany).mockRejectedValue(new Error('Database offline'));
      vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'r-open' } as any);
      const res = await reservationCoreService.saveReservation({
        tenantId: 'default-tenant',
        customerId: 'cust-173d-open',
        chatId: '6281@c.us',
        treatmentCategory: 'BABY' as const,
        treatmentDetail: 'Pijat Bayi Ceria',
        source: 'AGENT' as const,
        bookingDate: new Date('2026-10-05T02:00:00.000Z'),
      });
      expect(res.isNew).toBe(true);
    } finally {
      process.env.NODE_ENV = orig;
    }
  });
});

describe('AUDIT R2.6 — ongkir diterapkan SETELAH reservasi tersimpan', () => {
  const ADMIN_KEY = 'test_admin_key_silent_failure';

  it('save gagal → Customer.ongkir TIDAK ter-update (anti partial-write)', async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    const { customerService } = await import('../../src/services/customer.service');
    vi.spyOn(customerService, 'getCustomerById').mockResolvedValue({
      id: 'cust-r26', tenant_id: 'default-tenant', phone: '628999', name: 'Bunda R26',
    } as any);
    // Core save gagal total
    vi.mocked(prisma.reservation.findMany).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.create).mockRejectedValue(new Error('Database offline'));
    const custUpdate = vi.spyOn(prisma.customer, 'update').mockResolvedValue({} as any);

    const { buildApp } = await import('../../src/app');
    const app = buildApp();
    await app.ready();
    process.env.NODE_ENV = 'production';
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/reservation',
        headers: { 'x-api-key': ADMIN_KEY },
        payload: {
          customerId: 'cust-r26',
          treatmentCategory: 'BABY',
          treatmentDetail: 'Pijat Bayi Ceria',
          ongkir: 15000,
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(custUpdate).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = 'test';
      await app.close();
    }
  }, 20000);
});

describe('AUDIT KB-4 — notif default jam 09:00 bila jam tidak disebut', () => {
  beforeEach(() => vi.clearAllMocks());

  async function runTool(overrides: any = {}) {
    const { executeSaveReservation } = await import('../../src/v3/tools/save-reservation.tool');
    const { reservationCoreService } = await import('../../src/services/reservation-core.service');
    vi.spyOn(reservationCoreService, 'saveReservation').mockResolvedValue({
      reservation: { id: 'r-kb4' }, isNew: true, isUpdate: false,
    } as any);
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return executeSaveReservation({
      customerId: 'cust-kb4',
      chatId: '6281@c.us',
      customerName: 'Bunda KB4',
      treatmentName: 'Pijat Bayi Ceria',
      bookingDate: dateStr,
      tenantId: 'default-tenant',
      address: 'Jl. Mawar No. 1',
      ...overrides,
    } as any);
  }

  it('tanpa bookingTime → balasan WAJIB menyebut default pukul 09.00 WIB', async () => {
    const res = await runTool();
    expect(res.success).toBe(true);
    expect(res.message).toContain('09.00');
  });

  it('dengan bookingTime eksplisit → balasan TIDAK menyebut default', async () => {
    const res = await runTool({ bookingTime: '15:00' });
    expect(res.success).toBe(true);
    expect(res.message).not.toContain('09.00');
  });
});

describe('AUDIT KB-6 — snapshot delivery_fee per-reservasi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('core menyimpan delivery_fee saat create', async () => {
    const { reservationCoreService } = await import('../../src/services/reservation-core.service');
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([]);
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'r-fee' } as any);

    const res = await reservationCoreService.saveReservation({
      tenantId: 'default-tenant',
      customerId: 'cust-fee',
      chatId: '6281@c.us',
      treatmentCategory: 'BABY' as const,
      treatmentDetail: 'Pijat Bayi Ceria',
      source: 'ADMIN_PANEL' as const,
      bookingDate: new Date('2026-10-05T02:00:00.000Z'),
      deliveryFee: 15000,
    });
    expect(res.isNew).toBe(true);
    const createArg = vi.mocked(prisma.reservation.create).mock.calls[0][0] as any;
    expect(createArg.data.delivery_fee).toBe(15000);
  });

  it('resolver: snapshot menang atas Customer.ongkir; null → fallback', async () => {
    const { resolveDeliveryFeeSnapshot } = await import('../../src/services/reservation-core.service');
    expect(resolveDeliveryFeeSnapshot({ delivery_fee: 15000, customer: { ongkir: 99999 } })).toBe(15000);
    expect(resolveDeliveryFeeSnapshot({ delivery_fee: null, customer: { ongkir: 12000 } })).toBe(12000);
    expect(resolveDeliveryFeeSnapshot({ delivery_fee: null, customer: { ongkir: null } })).toBe(0);
  });

  it('getLastDeliveryFee: snapshot terakhir menang atas Customer.ongkir', async () => {
    const { customerService } = await import('../../src/services/customer.service');
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({ delivery_fee: 18000 } as any);
    expect(await customerService.getLastDeliveryFee('cust-x', 'default-tenant')).toBe(18000);

    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({ ongkir: 12000 } as any);
    expect(await customerService.getLastDeliveryFee('cust-y', 'default-tenant')).toBe(12000);
  });
});

describe('AUDIT KB-3 — gerbang kuota kapasitas bot (staf null)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('BOT/AGENT tanpa staf, kapasitas terapis penuh → DITOLAK (CAPACITY_EXCEEDED)', async () => {
    // 2 terapis aktif; sudah ada 2 booking unassigned hari itu.
    vi.mocked(prisma.staff.count).mockResolvedValue(2 as any);
    vi.mocked(prisma.reservation.count).mockResolvedValue(2 as any);
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);

    await expect(
      reservationCoreService.saveReservation({
        tenantId: 'default-tenant',
        customerId: 'cust-kb3',
        chatId: '6281@c.us',
        treatmentCategory: 'BABY' as const,
        treatmentDetail: 'Pijat Bayi Ceria',
        source: 'AGENT' as const,
        bookingDate: new Date('2026-10-05T02:00:00.000Z'),
      })
    ).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });
  });

  it('masih ada kapasitas (1 terapis, 0 booked) → booking diterima', async () => {
    vi.mocked(prisma.staff.count).mockResolvedValue(1 as any);
    vi.mocked(prisma.reservation.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'r-kb3-ok' } as any);

    const res = await reservationCoreService.saveReservation({
      tenantId: 'default-tenant',
      customerId: 'cust-kb3-ok',
      chatId: '6281@c.us',
      treatmentCategory: 'BABY' as const,
      treatmentDetail: 'Pijat Bayi Ceria',
      source: 'AGENT' as const,
      bookingDate: new Date('2026-10-05T02:00:00.000Z'),
    });
    expect(res.isNew).toBe(true);
  });

  it('ADMIN_PANEL dikecualikan dari gerbang kuota (admin menugaskan manual)', async () => {
    vi.mocked(prisma.staff.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.reservation.count).mockResolvedValue(99 as any);
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'r-admin-kb3' } as any);

    const res = await reservationCoreService.saveReservation({
      tenantId: 'default-tenant',
      customerId: 'cust-admin-kb3',
      chatId: '6281@c.us',
      treatmentCategory: 'BABY' as const,
      treatmentDetail: 'Pijat Bayi Ceria',
      source: 'ADMIN_PANEL' as const,
      bookingDate: new Date('2026-10-05T02:00:00.000Z'),
    });
    expect(res.isNew).toBe(true);
  });
});

describe('AUDIT KB-2 — notifikasi admin same-day', () => {
  beforeEach(() => vi.clearAllMocks());

  it('same-day pending (AGENT) → Web Push ADMIN + alert dikirim', async () => {
    const { webPushService } = await import('../../src/services/web-push.service');
    const pushSpy = vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 } as any);

    vi.mocked(prisma.staff.count).mockResolvedValue(5 as any);
    vi.mocked(prisma.reservation.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.reservation.create).mockResolvedValue({
      id: 'r-sameday', status: 'pending', raw_text: '[SAME_DAY_REQUEST] Perlu cek rute terapis hari ini',
    } as any);

    await reservationCoreService.saveReservation({
      tenantId: 'default-tenant',
      customerId: 'cust-sameday',
      chatId: '6281@c.us',
      treatmentCategory: 'BABY' as const,
      treatmentDetail: 'Pijat Bayi Ceria',
      source: 'AGENT' as const,
      bookingDate: new Date(),
      status: 'pending',
      rawText: '[SAME_DAY_REQUEST] Perlu cek rute terapis hari ini',
    });

    // notifikasi async — tunggu microtask
    await new Promise((r) => setTimeout(r, 50));
    expect(pushSpy).toHaveBeenCalledWith(
      'default-tenant',
      'ADMIN',
      expect.objectContaining({ data: expect.objectContaining({ type: 'SAME_DAY_REQUEST' }) })
    );
  });
});

describe('AUDIT R0.2 — Alert aggregation (anti silent drop)', () => {
  beforeEach(async () => {
    const { alertService } = await import('../../src/services/alert.service');
    alertService.clearCooldowns();
    vi.restoreAllMocks();
  });

  it('burst 5 alert sejenis: alert pertama terkirim, sisanya teragregasi dengan counter', async () => {
    const { alertService, AlertType, AlertSeverity } = await import('../../src/services/alert.service');
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const first = await alertService.notifyAlert({
        type: AlertType.DATABASE_OFFLINE,
        severity: AlertSeverity.CRITICAL,
        message: 'DB down #1',
      });
      expect(first.sent).toBe(true);

      let lastAggregated = 0;
      for (let i = 2; i <= 5; i++) {
        const r = await alertService.notifyAlert({
          type: AlertType.DATABASE_OFFLINE,
          severity: AlertSeverity.CRITICAL,
          message: `DB down #${i}`,
        });
        expect(r.sent).toBe(false);
        expect(r.throttled).toBe(true);
        lastAggregated = (r as any).aggregatedCount ?? lastAggregated;
      }
      // 4 alert ditahan setelah yang pertama → counter agregasi = 4
      expect(lastAggregated).toBe(4);
    } finally {
      process.env.NODE_ENV = orig;
    }
  });
});

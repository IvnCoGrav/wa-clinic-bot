import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { prisma } from '../../src/db/client';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { capiService } from '../../src/services/capi.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

vi.mock('axios');
const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn> };
const META_OK = { status: 200, data: { events_received: 1, fbtrace_id: 'trace-1' } };

vi.mock('../../src/services/reservation-lifecycle.service', () => ({
  reservationLifecycleService: { onReservationCreated: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../src/services/follow-up.service', () => ({
  followUpService: {
    createReservationFollowUps: vi.fn().mockResolvedValue(undefined),
    onReservationCreated: vi.fn().mockResolvedValue(undefined),
  },
}));

/**
 * Pembedaan New vs Repeat Order (Meta CAPI standard `Purchase` + custom_data).
 *
 * Aturan kanonis: transaksi PERTAMA customer (belum ada reservasi confirmed/completed
 * sebelumnya) → is_repeat_order=false. Transaksi KEDUA+ → is_repeat_order=true.
 * Nilai ini dipersist ke kolom Reservation.is_repeat_order agar dapat dibaca ulang
 * oleh pipeline CAPI queue (customer_type: 'new' | 'repeat', order_number).
 *
 * Bersifat adversarial: menguji edge case update (tidak menghitung reservasi itu sendiri),
 * dan customer tanpa riwayat.
 */
describe('Reservation is_repeat_order otomasi (root cause: sebelumnya di-set oleh follow-up pending)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const base = {
    tenantId: 'default-tenant',
    customerId: 'cust-repeat-1',
    chatId: '6281@c.us',
    treatmentCategory: 'BABY' as const,
    treatmentDetail: 'Pijat Bayi Ceria',
    source: 'ADMIN_PANEL' as const,
  };
  const slot = new Date('2026-09-09T02:30:00.000Z'); // 09:30 WIB

  it('transaksi pertama customer → is_repeat_order=false (new)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([]); // tidak ada konflik hari itu
    vi.mocked(prisma.reservation.count).mockResolvedValueOnce(0); // tidak ada riwayat confirmed/completed
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'new-1', is_repeat_order: false } as any);

    await reservationCoreService.saveReservation({ ...base, bookingDate: slot });

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ is_repeat_order: false }) })
    );
  });

  it('transaksi kedua+ customer → is_repeat_order=true (repeat)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.reservation.count).mockResolvedValueOnce(2); // sudah ada 2 transaksi confirmed/completed
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'new-2', is_repeat_order: true } as any);

    await reservationCoreService.saveReservation({ ...base, bookingDate: slot });

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ is_repeat_order: true }) })
    );
  });

  it('menghitung riwayat HANYA dari status confirmed/completed (bukan cancelled/hold)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.reservation.count).mockResolvedValueOnce(0);
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'new-3', is_repeat_order: false } as any);

    await reservationCoreService.saveReservation({ ...base, bookingDate: slot });

    expect(prisma.reservation.count).toHaveBeenCalledWith({
      where: {
        customer_id: 'cust-repeat-1',
        tenant_id: 'default-tenant',
        status: { in: ['confirmed', 'completed'] },
      },
    });
  });

  it('DB offline (count gagal) → fail-safe menjadi new (false), tidak melempar', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.reservation.count).mockRejectedValueOnce(new Error('Database offline'));
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'new-4', is_repeat_order: false } as any);

    await expect(
      reservationCoreService.saveReservation({ ...base, bookingDate: slot })
    ).resolves.toBeDefined();

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ is_repeat_order: false }) })
    );
  });

  it('jalur idempotent merge (update) ikut memutakhirkan is_repeat_order', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: 'existing-1', booking_date: slot, duration_minutes: 60, treatment_category: 'BABY', treatment_detail: 'lama', purchase_value: 160000, assigned_staff_id: null } as any,
    ]);
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({ id: 'existing-1', is_repeat_order: true } as any);
    vi.mocked(prisma.reservation.count).mockResolvedValueOnce(3);

    const res = await reservationCoreService.saveReservation({
      ...base, source: 'WEBHOOK', bookingDate: slot, treatmentDetail: 'baru',
    });

    expect(res.isUpdate).toBe(true);
    expect(prisma.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ is_repeat_order: true }) })
    );
  });
});

/**
 * Injeksi payload Meta CAPI standard `Purchase`: event_name TIDAK berubah,
 * pembeda new/repeat disematkan ke custom_data. Seam = body HTTP yang benar-benar
 * dikirim ke Graph API (via axios mock) — bukan internal service.
 */
describe('Meta CAPI Purchase — custom_data new vs repeat (standard event name tetap)', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of ['FB_PIXEL_ID', 'FB_CAPI_ACCESS_TOKEN', 'ADMIN_API_KEY']) saved[k] = process.env[k];
    process.env.ADMIN_API_KEY = 'test_admin_key_repeat';
    process.env.FB_PIXEL_ID = 'PIXEL_REPEAT';
    process.env.FB_CAPI_ACCESS_TOKEN = 'EAA_REPEAT_TOKEN';
    mockedAxios.post = vi.fn().mockResolvedValue(META_OK);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const postBody = () => mockedAxios.post.mock.calls[0][1] as any;

  it('pembelian pertama → customer_type=new, is_repeat_order=false, order_number=1', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.adClick.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.count).mockResolvedValue(0);

    const res = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-new', phone: '6281200000001', name: 'Bunda New' },
      tenantId: DEFAULT_TENANT_ID,
      value: 160000,
      reservationId: 'res-new',
    });

    expect(res.success).toBe(true);
    const cd = postBody().data[0].custom_data;
    expect(postBody().data[0].event_name).toBe('Purchase');
    expect(cd.customer_type).toBe('new');
    expect(cd.is_repeat_order).toBe(false);
    expect(cd.order_number).toBe(1);
    expect(cd.prior_orders_count).toBe(0);
  });

  it('pembelian kedua+ → customer_type=repeat, is_repeat_order=true, order_number=3', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.adClick.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.count).mockResolvedValue(2);

    const res = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-repeat', phone: '6281200000002', name: 'Bunda Repeat' },
      tenantId: DEFAULT_TENANT_ID,
      value: 160000,
      reservationId: 'res-repeat',
    });

    expect(res.success).toBe(true);
    const cd = postBody().data[0].custom_data;
    expect(cd.customer_type).toBe('repeat');
    expect(cd.is_repeat_order).toBe(true);
    expect(cd.order_number).toBe(3);
    expect(cd.prior_orders_count).toBe(2);
  });

  it('tidak menyentuh data non-Purchase (Lead) dengan field repeat', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.adClick.findFirst).mockRejectedValue(new Error('Database offline'));

    const res = await capiService.sendCapiEvent({
      eventName: 'Lead',
      customer: { id: 'cust-lead', phone: '6281200000003', name: 'Bunda Lead' },
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(res.success).toBe(true);
    const cd = postBody().data[0].custom_data;
    expect(cd.customer_type).toBeUndefined();
    expect(cd.is_repeat_order).toBeUndefined();
  });
});

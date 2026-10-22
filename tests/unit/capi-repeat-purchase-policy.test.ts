import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { prisma } from '../../src/db/client';
import { capiService, getTenantMetaPurchasePolicy } from '../../src/services/capi.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { buildApp } from '../../src/app';
import { auditService } from '../../src/services/audit.service';

vi.mock('axios');
const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn> };
const META_OK = { status: 200, data: { events_received: 1, fbtrace_id: 'trace-meta-1' } };

describe('Meta CAPI Repeat Purchase Policy & Blueprint Compliance', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of ['FB_PIXEL_ID', 'FB_CAPI_ACCESS_TOKEN', 'ADMIN_API_KEY', 'DEFAULT_META_PURCHASE_POLICY']) {
      savedEnv[k] = process.env[k];
    }
    process.env.ADMIN_API_KEY = 'test_admin_key_policy';
    process.env.FB_PIXEL_ID = 'PIXEL_POLICY_TEST';
    process.env.FB_CAPI_ACCESS_TOKEN = 'EAA_POLICY_TOKEN';
    // Di file test ini, pastikan default env kosong agar pengujian tenant-aware murni
    delete process.env.DEFAULT_META_PURCHASE_POLICY;
    mockedAxios.post = vi.fn().mockResolvedValue(META_OK);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const postBody = () => mockedAxios.post.mock.calls[0]?.[1] as any;

  it('1. Customer baru → Purchase, customer_segmentation=new_customer_to_business, order_id disematkan', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      settings: { metaPurchasePolicy: 'SUPPRESS_REPEAT' },
    } as any);
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.adClick.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.count).mockResolvedValue(0);

    const res = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-new-1', phone: '081234567890', name: 'Bunda Baru' },
      tenantId: DEFAULT_TENANT_ID,
      value: 175000,
      reservationId: 'res-new-uuid-001',
    });

    expect(res.success).toBe(true);
    expect(res.skipped).toBeUndefined();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    const event = postBody().data[0];
    expect(event.event_name).toBe('Purchase');
    expect(event.custom_data.customer_segmentation).toBe('new_customer_to_business');
    expect(event.custom_data.customer_type).toBe('new');
    expect(event.custom_data.order_id).toBe('res-new-uuid-001');
    expect(event.custom_data.is_repeat_order).toBe(false);
    expect(event.custom_data.order_number).toBe(1);
    expect(event.custom_data.value).toBe(175000);
    expect(event.custom_data.currency).toBe('IDR');
  });

  it('2. Repeat Customer + SUPPRESS_REPEAT → skipped: true, network axios TIDAK dipanggil', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      settings: { metaPurchasePolicy: 'SUPPRESS_REPEAT' },
    } as any);
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.adClick.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.count).mockResolvedValue(2); // Repeat order

    const res = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-retno', phone: '082132249740', name: 'Bunda Retno' },
      tenantId: DEFAULT_TENANT_ID,
      value: 70000,
      reservationId: 'res-retno-repeat',
    });

    expect(res.success).toBe(true);
    expect(res.skipped).toBe(true);
    expect(res.policy).toBe('SUPPRESS_REPEAT');
    expect(res.message).toContain('CAC protection');
    // Pembuktian keras: tidak ada network call yang keluar ke Meta CAPI
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('3. Repeat Customer + DUAL_EVENT → event_name diubah jadi ReturningCustomerPurchase', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      settings: { metaPurchasePolicy: 'DUAL_EVENT' },
    } as any);
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.adClick.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.count).mockResolvedValue(1);

    const res = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-nurul', phone: '082146540499', name: 'Bunda Nurul Hidayati' },
      tenantId: DEFAULT_TENANT_ID,
      value: 85000,
      reservationId: 'res-nurul-repeat',
    });

    expect(res.success).toBe(true);
    expect(res.skipped).toBeUndefined();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    const event = postBody().data[0];
    expect(event.event_name).toBe('ReturningCustomerPurchase');
    expect(event.custom_data.customer_segmentation).toBe('existing_customer_to_business');
    expect(event.custom_data.customer_type).toBe('repeat');
    expect(event.custom_data.is_repeat_order).toBe(true);
    expect(event.custom_data.order_id).toBe('res-nurul-repeat');
  });

  it('4. Repeat Customer + ALL_WITH_TAG → event Purchase dikirim dengan opt_out: true resmi Meta', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      settings: { metaPurchasePolicy: 'ALL_WITH_TAG' },
    } as any);
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.adClick.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.count).mockResolvedValue(3);

    const res = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-all', phone: '081233344455', name: 'Bunda All Tag' },
      tenantId: DEFAULT_TENANT_ID,
      value: 100000,
      reservationId: 'res-all-tag',
    });

    expect(res.success).toBe(true);
    expect(res.skipped).toBeUndefined();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    const event = postBody().data[0];
    expect(event.event_name).toBe('Purchase');
    expect(event.opt_out).toBe(true);
    expect(event.custom_data.customer_segmentation).toBe('existing_customer_to_business');
    expect(event.custom_data.customer_type).toBe('repeat');
    expect(event.custom_data.is_repeat_order).toBe(true);
    expect(event.custom_data.order_id).toBe('res-all-tag');
  });

  it('5. force_send_repeat_purchase escape hatch → tetap terkirim walau policy SUPPRESS_REPEAT', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      settings: { metaPurchasePolicy: 'SUPPRESS_REPEAT' },
    } as any);
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.adClick.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.count).mockResolvedValue(1);

    const res = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-force', phone: '089988776655', name: 'Bunda Force' },
      tenantId: DEFAULT_TENANT_ID,
      value: 120000,
      reservationId: 'res-force',
      customData: {
        force_send_repeat_purchase: true,
      },
    });

    expect(res.success).toBe(true);
    expect(res.skipped).toBeUndefined();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    const event = postBody().data[0];
    expect(event.event_name).toBe('Purchase');
    expect(event.custom_data.customer_segmentation).toBe('existing_customer_to_business');
    expect(event.custom_data.force_send_repeat_purchase).toBeUndefined();
  });

  it('6. DB offline saat hitung riwayat → fail-safe dianggap new, TIDAK pernah salah-suppress', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      settings: { metaPurchasePolicy: 'SUPPRESS_REPEAT' },
    } as any);
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.adClick.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.count).mockRejectedValue(new Error('Database connection failed'));

    const res = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-offline', phone: '081299887766', name: 'Bunda Offline' },
      tenantId: DEFAULT_TENANT_ID,
      value: 90000,
      reservationId: 'res-offline-safe',
    });

    expect(res.success).toBe(true);
    expect(res.skipped).toBeUndefined();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(postBody().data[0].custom_data.customer_segmentation).toBe('new_customer_to_business');
  });

  it('7. Customer dengan riwayat hanya cancelled/no_show → tetap new (tidak dihitung repeat)', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      settings: { metaPurchasePolicy: 'SUPPRESS_REPEAT' },
    } as any);
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.adClick.findFirst).mockRejectedValue(new Error('Database offline'));
    // Prisma count query hanya mencari status in ['confirmed', 'en_route', 'completed']
    vi.mocked(prisma.reservation.count).mockResolvedValue(0);

    const res = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-cancelled-past', phone: '081211112222', name: 'Bunda Pernah Batal' },
      tenantId: DEFAULT_TENANT_ID,
      value: 150000,
      reservationId: 'res-success-first-time',
    });

    expect(res.success).toBe(true);
    expect(res.skipped).toBeUndefined();
    expect(postBody().data[0].custom_data.customer_segmentation).toBe('new_customer_to_business');
  });

  it('8. PII sanitasi: nomor HP wajib SHA-256 ter-hash, tidak ada nomor HP mentah di user_data', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      settings: { metaPurchasePolicy: 'SUPPRESS_REPEAT' },
    } as any);
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.adClick.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.count).mockResolvedValue(0);

    await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-pii', phone: '081234567890', name: 'Bunda Rahasia' },
      tenantId: DEFAULT_TENANT_ID,
      value: 100000,
    });

    const userData = postBody().data[0].user_data;
    expect(userData.ph).toBeDefined();
    expect(Array.isArray(userData.ph)).toBe(true);
    // SHA-256 hash length is 64 hex characters (plus optional Meta ParamBuilder version suffix)
    expect(userData.ph[0]).toMatch(/^[a-f0-9]{64}(\.[a-zA-Z0-9]+)?$/);
    expect(userData.ph[0]).not.toContain('081234567890');
    expect(userData.ph[0]).not.toContain('6281234567890');
  });

  it('9. getTenantMetaPurchasePolicy default & fallback aman', async () => {
    // Undefined tenant
    expect(await getTenantMetaPurchasePolicy(undefined)).toBe('SUPPRESS_REPEAT');

    // Tenant dengan settings null/kosong
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({ id: 't1', settings: null } as any);
    expect(await getTenantMetaPurchasePolicy('t1')).toBe('SUPPRESS_REPEAT');

    // Tenant dengan nilai ngawur
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 't2',
      settings: { metaPurchasePolicy: 'NGAWUR_VALUE' },
    } as any);
    expect(await getTenantMetaPurchasePolicy('t2')).toBe('SUPPRESS_REPEAT');

    // Tenant dengan nilai valid
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 't3',
      settings: { metaPurchasePolicy: 'DUAL_EVENT' },
    } as any);
    expect(await getTenantMetaPurchasePolicy('t3')).toBe('DUAL_EVENT');

    // DB Offline
    vi.mocked(prisma.tenant.findUnique).mockRejectedValueOnce(new Error('DB Offline'));
    expect(await getTenantMetaPurchasePolicy('t4')).toBe('SUPPRESS_REPEAT');
  });

  it('10. Endpoint GET & PUT /api/admin/settings/meta-purchase-policy', async () => {
    const app = buildApp();
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    // GET
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      settings: { metaPurchasePolicy: 'DUAL_EVENT' },
    } as any);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/admin/settings/meta-purchase-policy',
      headers: { 'x-api-key': 'test_admin_key_policy' },
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.body);
    expect(getBody.success).toBe(true);
    expect(getBody.data.policy).toBe('DUAL_EVENT');
    expect(Array.isArray(getBody.data.options)).toBe(true);

    // PUT - Invalid policy -> 400
    const invalidRes = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/meta-purchase-policy',
      headers: { 'x-api-key': 'test_admin_key_policy' },
      payload: { policy: 'INVALID_POLICY' },
    });
    expect(invalidRes.statusCode).toBe(400);

    // PUT - Valid policy -> 200 & merge settings
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      settings: { brand: { logoUrl: 'https://kala.id/logo.png' } },
    } as any);
    vi.mocked(prisma.tenant.update).mockResolvedValueOnce({ id: DEFAULT_TENANT_ID } as any);

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/meta-purchase-policy',
      headers: { 'x-api-key': 'test_admin_key_policy' },
      payload: { policy: 'ALL_WITH_TAG' },
    });
    expect(putRes.statusCode).toBe(200);
    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DEFAULT_TENANT_ID },
        data: {
          settings: expect.objectContaining({
            brand: { logoUrl: 'https://kala.id/logo.png' },
            metaPurchasePolicy: 'ALL_WITH_TAG',
          }),
        },
      })
    );
    expect(auditService.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE_META_PURCHASE_POLICY',
        payload: expect.objectContaining({ newPolicy: 'ALL_WITH_TAG' }),
      })
    );
  });

  it('11. Approve-purchase route skipped: status approved, purchase_event_sent_at null, note transparan', async () => {
    const app = buildApp();
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    // Mock tenant SUPPRESS_REPEAT
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      settings: { metaPurchasePolicy: 'SUPPRESS_REPEAT' },
    } as any);

    // Mock reservation repeat order
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: 'res-approve-repeat-1',
      customer_id: 'cust-approve-repeat',
      tenant_id: DEFAULT_TENANT_ID,
      booking_date: new Date(),
      purchase_value: 80000,
      purchase_review_status: 'pending',
      created_at: new Date(),
      customer: {
        id: 'cust-approve-repeat',
        phone: '081234567890',
        name: 'Bunda Retno Test',
      },
    } as any);

    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.adClick.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.count).mockResolvedValue(2); // Repeat customer
    vi.mocked(prisma.reservation.update).mockResolvedValue({
      id: 'res-approve-repeat-1',
      purchase_review_status: 'approved',
      purchase_event_sent_at: null,
    } as any);
    vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 0 } as any);

    const approveRes = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/res-approve-repeat-1/approve-purchase',
      headers: { 'x-api-key': 'test_admin_key_policy' },
      payload: {},
    });

    expect(approveRes.statusCode).toBe(200);
    const body = JSON.parse(approveRes.body);
    expect(body.success).toBe(true);
    expect(body.skipped).toBe(true);
    expect(body.note).toContain('CAPI repeat purchase tidak dikirim ke Meta');

    // Pastikan update data tidak menyertakan purchase_event_sent_at
    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0];
    expect(updateCall.data.purchase_review_status).toBe('approved');
    expect(updateCall.data.purchase_event_sent_at).toBeUndefined();

    // Verifikasi audit log
    expect(auditService.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPROVE_PURCHASE_EVENT',
        payload: expect.objectContaining({
          capi_suppressed: true,
          capi_policy: 'SUPPRESS_REPEAT',
        }),
      })
    );
  });
  it('12. Listing queue riwayat: will_suppress_capi hanya aktif bila pending atau approved tanpa sent_at', async () => {
    const app = buildApp();

    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      landing_domain: null,
      waba_business_account_id: null,
      settings: { metaPurchasePolicy: 'SUPPRESS_REPEAT' },
    } as any);

    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);

    const mockDate = new Date('2026-10-20T10:00:00Z');
    const queueRows = [
      {
        id: 'res-queue-1',
        customer_id: 'cust-1',
        status: 'confirmed',
        purchase_review_status: 'pending',
        purchase_event_sent_at: null,
        booking_date: mockDate,
        purchase_value: 100000,
        customer: {
          id: 'cust-1',
          name: 'Bunda A',
          phone: '0811111111',
          is_sandbox_test: false,
          children: [],
          adClick: null,
        },
      },
      {
        id: 'res-queue-2',
        customer_id: 'cust-2',
        status: 'confirmed',
        purchase_review_status: 'approved',
        purchase_event_sent_at: mockDate,
        booking_date: mockDate,
        purchase_value: 120000,
        customer: {
          id: 'cust-2',
          name: 'Bunda B',
          phone: '0822222222',
          is_sandbox_test: false,
          children: [],
          adClick: null,
        },
      },
      {
        id: 'res-queue-3',
        customer_id: 'cust-3',
        status: 'confirmed',
        purchase_review_status: 'approved',
        purchase_event_sent_at: null,
        booking_date: mockDate,
        purchase_value: 150000,
        customer: {
          id: 'cust-3',
          name: 'Bunda C',
          phone: '0833333333',
          is_sandbox_test: false,
          children: [],
          adClick: null,
        },
      },
    ];

    vi.mocked(prisma.reservation.findMany).mockImplementation(async (args: any) => {
      if (args?.select?.customer_id || args?.where?.status?.in?.includes('en_route')) {
        return [
          { id: 'res-prior-1', customer_id: 'cust-1', created_at: new Date('2026-10-01') },
          { id: 'res-queue-1', customer_id: 'cust-1', created_at: new Date('2026-10-20') },
          { id: 'res-prior-2', customer_id: 'cust-2', created_at: new Date('2026-10-01') },
          { id: 'res-queue-2', customer_id: 'cust-2', created_at: new Date('2026-10-20') },
          { id: 'res-prior-3', customer_id: 'cust-3', created_at: new Date('2026-10-01') },
          { id: 'res-queue-3', customer_id: 'cust-3', created_at: new Date('2026-10-20') },
        ] as any;
      }
      return queueRows as any;
    });

    const queueRes = await app.inject({
      method: 'GET',
      url: '/api/admin/capi-queue',
      headers: { 'x-api-key': 'test_admin_key_policy' },
    });

    expect(queueRes.statusCode).toBe(200);
    const body = JSON.parse(queueRes.body);
    expect(body.success).toBe(true);

    const items = body.data.filter((item: any) => item.id && item.id.startsWith('res-queue-'));
    expect(items).toHaveLength(3);

    // a) pending, sent_at null -> will_suppress_capi === true
    expect(items[0].id).toBe('res-queue-1');
    expect(items[0].will_suppress_capi).toBe(true);

    // b) approved, sent_at terisi -> will_suppress_capi === false (sudah terkirim historis)
    expect(items[1].id).toBe('res-queue-2');
    expect(items[1].will_suppress_capi).toBe(false);

    // c) approved, sent_at null -> will_suppress_capi === true (hasil suppress)
    expect(items[2].id).toBe('res-queue-3');
    expect(items[2].will_suppress_capi).toBe(true);
  });
});

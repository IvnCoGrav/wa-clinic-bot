import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { maybeFirePurchaseEvent } from '../../src/services/purchase-detection.service';
import { capiService } from '../../src/services/capi.service';
import { customerService } from '../../src/services/customer.service';
import { isReservationPaid, getPaymentDisplayStatus } from '../../src/domain/reservation-payment';
import { buildApp } from '../../src/app';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { FastifyInstance } from 'fastify';

/**
 * Suite Uji Regresi Mandatori: Meta CAPI Queue-First & Anti-Duplikat
 *
 * Menguji 8 invarian arsitektur deterministik:
 * 1. confirmed_baru_masuk_antrean_pending_kasir_kosong
 * 2. intake_tanpa_tanggal_tidak_masuk_antrean
 * 3. reaktivasi_reset_jejak_kirim
 * 4. approve_tidak_palsukan_lunas_dan_tidak_katrol_ltv
 * 5. bayar_lapangan_tidak_kirim_ganda_dan_pertahankan_approved
 * 6. payment_message_tidak_bypass_antrean
 * 7. outlier_ditolak_tidak_muncul_di_default
 * 8. kasir_dan_keuangan_konsisten
 */

const ADMIN_KEY = 'test_admin_key_queue_first';
const HEADERS = { 'x-api-key': ADMIN_KEY, 'x-tenant-id': DEFAULT_TENANT_ID };

describe('Meta CAPI Queue-First & Anti-Duplikat Workflow (Fase 5 Suite)', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.FB_PIXEL_ID = 'test_pixel_123';
    process.env.FB_CAPI_ACCESS_TOKEN = 'test_token_123';

    (prisma as any).auditLog = {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    };
    (prisma as any).followUp = {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    };
    (prisma as any).tenant = {
      findUnique: vi.fn().mockResolvedValue({ id: DEFAULT_TENANT_ID, auto_send_purchase_capi: false }),
      upsert: vi.fn().mockResolvedValue({ id: DEFAULT_TENANT_ID, auto_send_purchase_capi: false }),
    };
    (prisma as any).adClick = {
      findFirst: vi.fn().mockResolvedValue(null),
    };
    (prisma as any).customer = {
      findUnique: vi.fn().mockResolvedValue({ id: 'cust-1', name: 'Bunda Test', phone: '628123456789' }),
      findMany: vi.fn().mockResolvedValue([]),
    };
    (prisma as any).reservation = {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'res-mock-created' }),
      update: vi.fn().mockResolvedValue({ id: 'res-mock-updated' }),
    };
    (prisma as any).$executeRawUnsafe = vi.fn().mockResolvedValue(1);
    (prisma as any).$transaction = vi.fn().mockImplementation(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(prisma);
      }
      return arg;
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (app) {
      await app.close().catch(() => {});
    }
  });

  // 1. confirmed_baru_masuk_antrean_pending_kasir_kosong
  it('1. confirmed_baru_masuk_antrean_pending_kasir_kosong — create confirmed langsung pending di CAPI, kasir tetap kosong', async () => {
    let capturedCreateData: any = null;
    vi.mocked(prisma.reservation.create).mockImplementation(async ({ data }: any) => {
      capturedCreateData = data;
      return {
        id: 'res-new-confirmed',
        ...data,
        created_at: new Date(),
        updated_at: new Date(),
      };
    });

    const result = await reservationCoreService.saveReservation({
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      bookingDate: new Date('2026-10-20T10:00:00.000Z'),
      status: 'confirmed',
      treatmentCategory: 'BABY',
      treatmentDetail: 'Pijat Bayi Ceria',
      durationMinutes: 40,
      source: 'ADMIN_PANEL',
    });

    expect(result.isNew).toBe(true);
    expect(capturedCreateData).toBeDefined();
    // Invarian Queue-First: status pending di meja antrean CAPI
    expect(capturedCreateData.purchase_review_status).toBe('pending');
    // Invarian Integritas Kasir: purchase_occurred_at WAJIB null (belum terima uang)
    expect(capturedCreateData.purchase_occurred_at).toBeNull();
  });

  // 2. intake_tanpa_tanggal_tidak_masuk_antrean
  it('2. intake_tanpa_tanggal_tidak_masuk_antrean — intake tanpa tanggal tidak boleh membanjiri antrean CAPI (review_status = null)', async () => {
    let capturedCreateData: any = null;
    vi.mocked(prisma.reservation.create).mockImplementation(async ({ data }: any) => {
      capturedCreateData = data;
      return {
        id: 'res-intake-nodate',
        ...data,
        created_at: new Date(),
        updated_at: new Date(),
      };
    });

    const result = await reservationCoreService.saveReservation({
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      bookingDate: null,
      status: 'pending', // intake tanpa tanggal
      treatmentCategory: 'BABY',
      treatmentDetail: 'Pijat Bayi Ceria',
      source: 'CHAT',
    });

    expect(result.isNew).toBe(true);
    expect(capturedCreateData).toBeDefined();
    // Intake tanpa tanggal dilarang masuk antrean
    expect(capturedCreateData.purchase_review_status).toBeNull();
    expect(capturedCreateData.purchase_occurred_at).toBeNull();
  });

  // 3. reaktivasi_reset_jejak_kirim
  it('3. reaktivasi_reset_jejak_kirim — reaktivasi baris cancelled mereset review_status, event_sent_at, dan occurred_at', async () => {
    let capturedUpdateData: any = null;
    const existingCancelled = {
      id: 'res-cancelled-prev-approved',
      status: 'cancelled',
      request_id: 'req-rebooking-123',
      booking_date: new Date('2026-10-10T10:00:00.000Z'),
      duration_minutes: 40,
      assigned_staff_id: 'staff-1',
      purchase_review_status: 'approved',
      purchase_event_sent_at: new Date('2026-10-10T10:05:00.000Z'),
      purchase_occurred_at: new Date('2026-10-10T10:05:00.000Z'),
    };

    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(existingCancelled as any);
    vi.mocked(prisma.reservation.update).mockImplementation(async ({ data }: any) => {
      capturedUpdateData = data;
      return {
        ...existingCancelled,
        ...data,
      } as any;
    });

    const result = await reservationCoreService.saveReservation({
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      requestId: 'req-rebooking-123',
      bookingDate: new Date('2026-10-25T10:00:00.000Z'),
      status: 'confirmed',
      treatmentCategory: 'BABY',
      treatmentDetail: 'Pijat Bayi Ceria',
      source: 'ADMIN_PANEL',
    });

    expect(result.isUpdate).toBe(true);
    expect(capturedUpdateData).toBeDefined();
    expect(capturedUpdateData.status).toBe('confirmed');
    // Reset jejak kirim lama
    expect(capturedUpdateData.purchase_review_status).toBe('pending');
    expect(capturedUpdateData.purchase_event_sent_at).toBeNull();
    expect(capturedUpdateData.purchase_occurred_at).toBeNull();
  });

  // 4. approve_tidak_palsukan_lunas_dan_tidak_katrol_ltv
  it('4. approve_tidak_palsukan_lunas_dan_tidak_katrol_ltv — klik approve hanya urusan iklan, kasir tetap null dan LTV tidak terkatrol', async () => {
    app = buildApp();
    await app.ready();

    const existingPending = {
      id: 'res-unpaid-pending',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      status: 'confirmed',
      purchase_review_status: 'pending',
      purchase_occurred_at: null, // belum bayar
      purchase_event_sent_at: null,
      purchase_value: 150000,
      created_at: new Date(),
      customer: {
        id: 'cust-1',
        name: 'Bunda Unpaid',
        phone: '628123456789',
        adClick: null,
      },
    };

    let capturedUpdateData: any = null;
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(existingPending as any);
    vi.mocked(prisma.reservation.update).mockImplementation(async ({ data }: any) => {
      capturedUpdateData = data;
      return { ...existingPending, ...data } as any;
    });

    vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({ success: true, eventId: 'evt-approved-1' } as any);
    const ltvSpy = vi.spyOn(customerService, 'recalculateCustomerLtv');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/res-unpaid-pending/approve-purchase',
      headers: HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(capturedUpdateData).toBeDefined();
    // Iklan disetujui & event dicatat terkirim
    expect(capturedUpdateData.purchase_review_status).toBe('approved');
    expect(capturedUpdateData.purchase_event_sent_at).toBeInstanceOf(Date);
    // Integritas Kasir: purchase_occurred_at TIDAK ditimpa (tetap null)
    expect(capturedUpdateData.purchase_occurred_at).toBeUndefined();

    // Guard LTV: jangan katrol LTV bila uang belum diterima
    expect(ltvSpy).not.toHaveBeenCalled();
  });

  // 5. bayar_lapangan_tidak_kirim_ganda_dan_pertahankan_approved
  it('5. bayar_lapangan_tidak_kirim_ganda_dan_pertahankan_approved — recordPayment setelah approve tidak mengirim CAPI ganda & mempertahankan status approved', async () => {
    const existingApproved = {
      id: 'res-approved-before-pay',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      status: 'confirmed',
      purchase_review_status: 'approved',
      purchase_event_sent_at: new Date('2026-10-14T08:00:00.000Z'),
      purchase_occurred_at: null,
      purchase_value: 150000,
      customer: {
        id: 'cust-1',
        name: 'Bunda Lapangan',
        phone: '628123456789',
      },
    };

    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(existingApproved as any);
    let capturedUpdateData: any = null;
    vi.mocked(prisma.reservation.update).mockImplementation(async ({ data }: any) => {
      capturedUpdateData = data;
      return { ...existingApproved, ...data } as any;
    });

    const capiSpy = vi.spyOn(capiService, 'sendCapiEvent');

    const result = await StaffReservationService.recordPayment({
      reservationId: 'res-approved-before-pay',
      staffId: 'staff-1',
      staffName: 'Bidan Siti',
      tenantId: DEFAULT_TENANT_ID,
      paymentMethod: 'CASH',
      amount: 150000,
    });

    expect(result.success).toBe(true);
    // Invarian Anti-Kirim-Ganda: recordPayment DILARANG panggil sendCapiEvent
    expect(capiSpy).not.toHaveBeenCalled();

    // Kasir terisi Lunas & status approved dipertahankan
    expect(capturedUpdateData).toBeDefined();
    expect(capturedUpdateData.purchase_occurred_at).toBeInstanceOf(Date);
    expect(capturedUpdateData.purchase_review_status).toBe('approved');
    expect(capturedUpdateData.purchase_event_sent_at).toEqual(existingApproved.purchase_event_sent_at);
    expect(capturedUpdateData.status).toBe('completed');
  });

  // 6. payment_message_tidak_bypass_antrean
  it('6. payment_message_tidak_bypass_antrean — maybeFirePurchaseEvent selalu menahan event ke pending (tidak bypass CAPI langsung)', async () => {
    const reservation = {
      id: 'res-detected-by-msg',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      status: 'confirmed',
      purchase_review_status: null,
      purchase_occurred_at: null,
      purchase_event_sent_at: null,
      purchase_value: 160000,
      treatment_detail: 'Pijat Bayi Ceria',
      customer: {
        id: 'cust-1',
        name: 'Bunda Transfer',
        phone: '628123456789',
      },
    };

    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(reservation as any);
    let capturedUpdateData: any = null;
    vi.mocked(prisma.reservation.update).mockImplementation(async ({ data }: any) => {
      capturedUpdateData = data;
      return { ...reservation, ...data } as any;
    });

    const capiSpy = vi.spyOn(capiService, 'sendCapiEvent');

    await maybeFirePurchaseEvent({
      customer: reservation.customer,
      conversation: { id: 'conv-1' },
      text: 'Payment 160000 sudah ditransfer ya',
      tenantId: DEFAULT_TENANT_ID,
    });

    // Tidak boleh menembak CAPI langsung
    expect(capiSpy).not.toHaveBeenCalled();

    // Event ditahan ke antrean pending
    expect(capturedUpdateData).toBeDefined();
    expect(capturedUpdateData.purchase_review_status).toBe('pending');
    expect(capturedUpdateData.purchase_event_sent_at).toBeUndefined();
    expect(capturedUpdateData.purchase_occurred_at).toBeInstanceOf(Date);
  });

  // 7. outlier_ditolak_tidak_muncul_di_default
  it('7. outlier_ditolak_tidak_muncul_di_default — ignored_outlier dikeluarkan dari meja antrean default, tetapi ada di filter all', async () => {
    app = buildApp();
    await app.ready();

    let capturedWhere: any = null;
    vi.mocked(prisma.reservation.findMany).mockImplementation(async ({ where }: any) => {
      capturedWhere = where;
      return [];
    });

    // Request default (tanpa filter status)
    const resDefault = await app.inject({
      method: 'GET',
      url: '/api/admin/capi-queue',
      headers: HEADERS,
    });
    expect(resDefault.statusCode).toBe(200);
    // Verifikasi OR clause hanya mencakup pending dan approved
    expect(capturedWhere.OR).toEqual(
      expect.arrayContaining([
        { purchase_review_status: { in: ['pending', 'approved'] } },
        { purchase_occurred_at: { not: null } },
        { status: 'completed' },
      ])
    );
    // Di default, statusFilter tidak menyaring ignored_outlier
    expect(capturedWhere.purchase_review_status).toBeUndefined();

    // Request dengan status=ignored_outlier eksplisit
    await app.inject({
      method: 'GET',
      url: '/api/admin/capi-queue?status=ignored_outlier',
      headers: HEADERS,
    });
    expect(capturedWhere.purchase_review_status).toBe('ignored_outlier');
  });

  // 8. kasir_dan_keuangan_konsisten
  it('8. kasir_dan_keuangan_konsisten — reservasi belum bayar konsisten isReservationPaid=false & TAGIH_DI_TEMPAT', () => {
    const unpaidConfirmed = {
      id: 'res-check-unpaid',
      status: 'confirmed',
      purchase_occurred_at: null,
      purchase_review_status: 'approved', // iklan sudah diapprove
    };

    expect(isReservationPaid(unpaidConfirmed)).toBe(false);
    expect(getPaymentDisplayStatus(unpaidConfirmed)).toBe('TAGIH_DI_TEMPAT');

    const paidCompleted = {
      id: 'res-check-paid',
      status: 'completed',
      purchase_occurred_at: new Date(),
      purchase_review_status: 'approved',
    };

    expect(isReservationPaid(paidCompleted)).toBe(true);
    expect(getPaymentDisplayStatus(paidCompleted)).toBe('LUNAS');
  });
});

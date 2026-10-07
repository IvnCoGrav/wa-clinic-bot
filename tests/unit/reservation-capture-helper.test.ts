import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tryCaptureReservationFormFromRaw } from '../../src/services/reservation-lifecycle.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { reservationCoreService } from '../../src/services/reservation-core.service';

// Mock parser untuk test parse fail (vi.mock di-hoist ke paling atas)
vi.mock('../../src/utils/reservation-text-parser', () => {
  let parseFail: { success: false; error: string; missingFields: string[]; reservation: null } | null = null;
  return {
    isReservationFormMessage: vi.fn((raw: string) => raw?.includes('Nama:') === true),
    parseReservationText: vi.fn((raw: string) => {
      if (parseFail) return parseFail;
      // Default valid parse
      return {
        success: true,
        error: null,
        missingFields: [],
        reservation: {
          treatmentCategory: 'BABY',
          treatmentDetail: 'Pijat Bayi',
          bookingDate: new Date('2026-10-10'),
          name: 'Bunda Test',
          kec: 'Jambangan',
          kota: 'Surabaya',
          address: 'Jl. Test No. 1',
          babies: [],
          payment: {},
        },
      };
    }),
    __setParseFail: (fail: typeof parseFail) => { parseFail = fail; },
  };
});

// Import mock agar bisa set parseFail per-test
import * as parserMock from '../../src/utils/reservation-text-parser';

/**
 * Test helper kanonis tryCaptureReservationFormFromRaw (Fase 1.2 audit arsitektur).
 */
describe('ReservationLifecycle — tryCaptureReservationFormFromRaw', () => {
  let testPhone: string;
  let testCustomer: any;
  let testConversation: any;

  beforeEach(async () => {
    vi.restoreAllMocks();
    // Reset parser mock
    (parserMock as any).__setParseFail?.(null);
    testPhone = `628123000${Date.now().toString().slice(-3)}`;
    testCustomer = await customerService.getOrCreateCustomer(testPhone, 'Test Capture', DEFAULT_TENANT_ID);
    testConversation = await conversationService.getOrCreateConversation(testCustomer.id, DEFAULT_TENANT_ID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('form reservasi valid → captured=true, simpan via core, fire CAPI InitiateCheckout', async () => {
    const raw = `Nama: Bunda Test
Kelurahan: Jambangan
Kecamatan: Jambangan
Kota: Surabaya
Layanan: Pijat Bayi
Tanggal: 2026-10-10
Jam: 10:00`;

    const saveSpy = vi.spyOn(reservationCoreService, 'saveReservation').mockResolvedValue({
      reservation: { id: 'res-test-1', treatmentDetail: 'Pijat Bayi' },
      isNew: true,
      isUpdate: false,
    });
    const capiSpy = vi.spyOn(await import('../../src/services/capi.service'), 'fireCapiEvent').mockResolvedValue(undefined);

    const result = await tryCaptureReservationFormFromRaw({
      tenantId: DEFAULT_TENANT_ID,
      customerId: testCustomer.id,
      chatId: `${testPhone}@c.us`,
      raw,
      history: [{ role: 'user', content: 'Hai' }, { role: 'assistant', content: 'Halo' }],
      source: 'WEBHOOK_HUMAN_GRACE_CAPTURE',
      customer: testCustomer,
    });

    expect(result.captured).toBe(true);
    expect(result.isNew).toBe(true);
    expect(saveSpy).toHaveBeenCalledOnce();
    expect(capiSpy).toHaveBeenCalledOnce();
    expect(capiSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'InitiateCheckout',
        tenantId: DEFAULT_TENANT_ID,
        customData: expect.objectContaining({ source: 'WEBHOOK_HUMAN_GRACE_CAPTURE' }),
      })
    );
  });

  it('teks bukan form reservasi → captured=false, tidak simpan, tidak fire CAPI', async () => {
    const raw = 'Halo bund, mau tanya harga pijat bayi';

    const saveSpy = vi.spyOn(reservationCoreService, 'saveReservation').mockResolvedValue({});
    const capiSpy = vi.spyOn(await import('../../src/services/capi.service'), 'fireCapiEvent').mockResolvedValue(undefined);

    const result = await tryCaptureReservationFormFromRaw({
      tenantId: DEFAULT_TENANT_ID,
      customerId: testCustomer.id,
      chatId: `${testPhone}@c.us`,
      raw,
      history: [],
      source: 'WEBHOOK_HUMAN_GRACE_CAPTURE',
      customer: testCustomer,
    });

    expect(result.captured).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(capiSpy).not.toHaveBeenCalled();
  });

  it('form tapi parse gagal (field required hilang) → captured=false + parseError + missingFields', async () => {
    // Set parser mock untuk return error
    (parserMock as any).__setParseFail({
      success: false,
      error: 'Missing required field: kelurahan',
      missingFields: ['kelurahan', 'kecamatan'],
      reservation: null,
    });

    const raw = `Nama: Bunda Test
Layanan: Pijat Bayi`;

    const saveSpy = vi.spyOn(reservationCoreService, 'saveReservation').mockResolvedValue({});

    const result = await tryCaptureReservationFormFromRaw({
      tenantId: DEFAULT_TENANT_ID,
      customerId: testCustomer.id,
      chatId: `${testPhone}@c.us`,
      raw,
      history: [],
      source: 'WEBHOOK_HOLD_DISABLED_CAPTURE',
      customer: testCustomer,
    });

    expect(result.captured).toBe(false);
    expect(result.parseError).toContain('kelurahan');
    expect(result.missingFields).toContain('kelurahan');
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('jam eksplisit dari history dipakai untuk bookingDate (WIB → UTC)', async () => {
    const raw = `Nama: Bunda Test
Kelurahan: Jambangan
Kecamatan: Jambangan
Kota: Surabaya
Layanan: Cukur Rambut
Tanggal: 2026-10-10`;

    const saveSpy = vi.spyOn(reservationCoreService, 'saveReservation').mockImplementation(async (params) => ({
      reservation: { id: 'res-test-2', ...params },
      isNew: true,
      isUpdate: false,
    }));

    // History punya "jam 14.30" → harus dipakai
    const history = [
      { role: 'user', content: 'Halo' },
      { role: 'assistant', content: 'Halo juga' },
      { role: 'user', content: 'Mau jam 14.30 ya bund' }, // ← jam eksplisit
    ];

    const result = await tryCaptureReservationFormFromRaw({
      tenantId: DEFAULT_TENANT_ID,
      customerId: testCustomer.id,
      chatId: `${testPhone}@c.us`,
      raw,
      history,
      source: 'WEBHOOK_HUMAN_EXPLICIT_CAPTURE',
      customer: testCustomer,
    });

    expect(result.captured).toBe(true);
    // bookingDate dikirim sebagai Date; toISOString() mengembalikan UTC.
    // 14:30 WIB (+07:00) = 07:30 UTC. Cek jam UTC di ISO string.
    const calledWith = saveSpy.mock.calls[0][0];
    expect(calledWith.bookingDate).toBeInstanceOf(Date);
    expect(calledWith.bookingDate!.toISOString()).toContain('07:30:00');
  });

  it('source di-map ke kanonis: WEBHOOK_* → WEBHOOK', async () => {
    const raw = `Nama: Bunda Test
Kelurahan: Jambangan
Kecamatan: Jambangan
Kota: Surabaya
Layanan: Pijat Bayi
Tanggal: 2026-10-10`;

    const saveSpy = vi.spyOn(reservationCoreService, 'saveReservation').mockResolvedValue({
      reservation: { id: 'res-test-3' },
      isNew: true,
      isUpdate: false,
    });

    await tryCaptureReservationFormFromRaw({
      tenantId: DEFAULT_TENANT_ID,
      customerId: testCustomer.id,
      chatId: `${testPhone}@c.us`,
      raw,
      history: [],
      source: 'WEBHOOK_HUMAN_GRACE_CAPTURE',
      customer: testCustomer,
    });

    const calledWith = saveSpy.mock.calls[0][0];
    expect(calledWith.source).toBe('WEBHOOK'); // mapped from WEBHOOK_HUMAN_GRACE_CAPTURE
  });
});
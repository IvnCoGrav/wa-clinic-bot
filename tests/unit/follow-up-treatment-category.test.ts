/**
 * Fase 1–2: Follow-up WAJIB state-gated per kategori treatment.
 *
 * Kontrak yang diuji (seam publik, bukan internal):
 *  1. `createNextTreatmentFollowUps` menyimpan `treatment_category` pada baris
 *     NEXT_TREATMENT (state di data, bukan disimpulkan saat kirim).
 *  2. `executeFollowUp` memilih keluarga template MOMS vs ANAK dari state
 *     (`follow_ups.treatment_category` → fallback `reservation.treatment_category`).
 *  3. Customer MOMS DILARANG menerima narasi bayi ("si kecil", nama anak).
 *  4. Customer anak (BABY/KIDS/BOTH) tetap menerima narasi anak (anti-regresi).
 *  5. `REVIEW_H1` kategori KIDS masuk klaster anak (bukan MOMS).
 *  6. Template default MOMS tidak boleh memuat variabel `{babyName}`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import {
  getRollingFollowUpMessage,
  FOLLOWUP_ROLLING_TEMPLATES,
} from '../../src/config/followup-templates';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const MOMS_TEMPLATE_TYPES = [
  'NEXT_TREATMENT_MOMS_1',
  'NEXT_TREATMENT_MOMS_2',
  'NEXT_TREATMENT_MOMS_3',
] as const;

const makeFu = (overrides: any = {}): any => ({
  id: 'fu-cat-1',
  tenant_id: DEFAULT_TENANT_ID,
  customer_id: 'cust-cat-1',
  type: 'NEXT_TREATMENT',
  stage: 1,
  scheduled_at: new Date(Date.now() - 1000),
  status: 'QUEUED',
  customer: {
    id: 'cust-cat-1',
    name: 'Ismail',
    phone: '6281252901109',
    children: [],
    labels: [],
    conversations: [],
  },
  ...overrides,
});

/** Jalankan executeFollowUp dengan dependensi eksternal di-stub, tangkap teks terkirim. */
async function runAndCapture(
  fu: any,
  opts: { template?: any } = {}
): Promise<{ text: string; templateLookupTypes: string[] }> {
  const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
  vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);
  // Recent/Upcoming-Visit Guard: tidak ada kunjungan baru / booking di depan.
  vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);
  vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 1 } as any);
  vi.spyOn(prisma.followUp, 'findUnique').mockResolvedValue({
    status: 'QUEUED',
    scheduled_at: new Date(),
  } as any);
  vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
  const tplSpy = vi
    .spyOn(prisma.followUpTemplate, 'findFirst')
    .mockResolvedValue((opts.template ?? null) as any);

  const { typingService } = await import('../../src/services/typing.service');
  const sendSpy = vi
    .spyOn(typingService, 'simulateHumanReply')
    .mockResolvedValue({ success: true } as any);

  const ok = await followUpService.executeFollowUp(fu, DEFAULT_TENANT_ID);
  expect(ok).toBe(true);
  expect(sendSpy).toHaveBeenCalledTimes(1);

  return {
    text: String((sendSpy.mock.calls[0][0] as any).replyText || ''),
    templateLookupTypes: tplSpy.mock.calls.map((c: any) => String(c[0]?.where?.type || '')),
  };
}

describe('Follow-up state-gated per kategori treatment (MOMS vs ANAK)', () => {
  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.FOLLOWUP_CREATE_REMINDER_REVIEW;
  });

  it('1. createNextTreatmentFollowUps menyimpan treatment_category pada SEMUA baris NEXT_TREATMENT', async () => {
    vi.spyOn(prisma.followUp, 'findFirst').mockResolvedValue(null as any);
    const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

    const bookingDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await followUpService.createNextTreatmentFollowUps(
      'cust-moms-1',
      bookingDate,
      DEFAULT_TENANT_ID,
      'res-moms-1',
      'MOMS'
    );

    const rows = createSpy.mock.calls
      .map((c: any) => c[0]?.data)
      .filter((d: any) => d?.type === 'NEXT_TREATMENT');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.treatment_category).toBe('MOMS');
    }
  });

  it('2. kompatibilitas data lama: tanpa kategori → kolom TIDAK diisi (bukan ditebak)', async () => {
    vi.spyOn(prisma.followUp, 'findFirst').mockResolvedValue(null as any);
    const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

    await followUpService.createNextTreatmentFollowUps(
      'cust-legacy-1',
      new Date(Date.now() + 24 * 60 * 60 * 1000),
      DEFAULT_TENANT_ID,
      'res-legacy-1'
    );

    const rows = createSpy.mock.calls
      .map((c: any) => c[0]?.data)
      .filter((d: any) => d?.type === 'NEXT_TREATMENT');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.treatment_category).toBeUndefined();
    }
  });

  it('3. customer MOMS → template MOMS, DILARANG menyinggung bayi', async () => {
    const { text, templateLookupTypes } = await runAndCapture(
      makeFu({ treatment_category: 'MOMS' })
    );

    expect(templateLookupTypes).toContain('NEXT_TREATMENT_MOMS_1');
    expect(templateLookupTypes).not.toContain('NEXT_TREATMENT_1');
    expect(text).toMatch(/Ismail/);
    expect(text).not.toMatch(/si kecil/i);
    expect(text).not.toMatch(/perkembangan/i);
    expect(text).not.toMatch(/tumbuh kembang/i);
  });

  it('4. data lama tanpa kolom → fallback state relasi reservasi (MOMS) tetap MOMS', async () => {
    const { text, templateLookupTypes } = await runAndCapture(
      makeFu({
        treatment_category: null,
        reservation: {
          id: 'res-oksitosin',
          booking_date: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
          treatment_category: 'MOMS',
          treatment_detail: 'Oksitosin Massage Fullbody',
        },
      })
    );

    expect(templateLookupTypes).toContain('NEXT_TREATMENT_MOMS_1');
    expect(text).not.toMatch(/si kecil/i);
    expect(text).not.toMatch(/perkembangan/i);
  });

  it('5. anti-regresi: customer BABY tetap menerima nama anak', async () => {
    const { text, templateLookupTypes } = await runAndCapture(
      makeFu({
        treatment_category: 'BABY',
        customer: {
          id: 'cust-baby-1',
          name: 'Rina',
          phone: '628111222333',
          children: [{ id: 'ch-1', name: 'Kenzo' }],
          labels: [],
          conversations: [],
        },
      })
    );

    expect(templateLookupTypes).toContain('NEXT_TREATMENT_1');
    expect(text).toContain('Kenzo');
  });

  it('6. REVIEW_H1 kategori KIDS masuk klaster anak (bukan review MOMS)', async () => {
    process.env.FOLLOWUP_CREATE_REMINDER_REVIEW = 'true';
    vi.spyOn(prisma.customer, 'findUnique').mockResolvedValue(null as any);
    vi.spyOn(prisma.followUp, 'findFirst').mockResolvedValue(null as any);
    const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

    await followUpService.createReservationFollowUps({
      reservationId: 'res-kids-1',
      customerId: 'cust-kids-1',
      bookingDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      treatmentCategory: 'KIDS',
      tenantId: DEFAULT_TENANT_ID,
    });

    const review = createSpy.mock.calls
      .map((c: any) => c[0]?.data)
      .find((d: any) => String(d?.type || '').startsWith('REVIEW_H1'));
    expect(review?.type).toBe('REVIEW_H1_BABY');
  });

  it('7. kontrak template default MOMS: 3 varian, tanpa {babyName}, tanpa narasi bayi', () => {
    for (const type of MOMS_TEMPLATE_TYPES) {
      const variants = (FOLLOWUP_ROLLING_TEMPLATES as any)[type];
      expect(Array.isArray(variants)).toBe(true);
      expect(variants.length).toBe(3);

      for (const idx of [0, 1, 2]) {
        const { text } = getRollingFollowUpMessage(type as any, {
          name: 'Ismail',
          babyName: 'dek Kenzo',
          index: idx,
        });
        expect(text).toMatch(/Ismail/);
        expect(text).not.toMatch(/\{babyName\}/);
        expect(text).not.toMatch(/si kecil/i);
        expect(text).not.toMatch(/dek\s+[A-Z]/);
        expect(text).not.toMatch(/tumbuh kembang/i);
      }
    }
  });

  it('8. template kustom DB MOMS dipakai lewat kunci tipe MOMS (bukan tipe anak)', async () => {
    const { text, templateLookupTypes } = await runAndCapture(makeFu({ treatment_category: 'MOMS' }), {
      template: { text: 'Halo Bunda {name}! Kami siap bantu jadwalkan perawatan Bunda lagi ya. 😊' },
    });

    expect(templateLookupTypes).toContain('NEXT_TREATMENT_MOMS_1');
    expect(text).toContain('Kami siap bantu jadwalkan perawatan Bunda lagi');
  });
});

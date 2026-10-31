/**
 * Fase 4 — Sapaan gender-aware dari STATE (bukan tebakan).
 *
 * Sumber kebenaran: `customer.preferences.genderGreeting` (mirror durable yang
 * sudah ditulis pipeline V3). Kontrak:
 *  1. `Bapak` -> sapaan pembuka "Bapak <nama>", TIDAK PERNAH "Bunda <nama>".
 *  2. Tanpa preferensi -> default "Bunda" (anti-regresi).
 *  3. Nama yang sudah membawa sapaan ("Pak Ismail") tidak digandakan.
 *  4. Rujukan "Bunda" di TENGAH kalimat (merujuk ibu/pasien) TIDAK dimutilasi.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import { formatGreeting } from '../../src/utils/name-sanitizer';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const makeFu = (overrides: any = {}): any => ({
  id: 'fu-hon-1',
  tenant_id: DEFAULT_TENANT_ID,
  customer_id: 'cust-hon-1',
  type: 'NEXT_TREATMENT',
  stage: 1,
  scheduled_at: new Date(Date.now() - 1000),
  status: 'QUEUED',
  customer: {
    id: 'cust-hon-1',
    name: 'Ismail',
    phone: '6281252901109',
    children: [],
    labels: [],
    conversations: [],
    preferences: {},
  },
  ...overrides,
});

async function captureText(fu: any, template?: any): Promise<string> {
  const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
  vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);
  vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);
  vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 1 } as any);
  vi.spyOn(prisma.followUp, 'findUnique').mockResolvedValue({ status: 'QUEUED', scheduled_at: new Date() } as any);
  vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
  vi.spyOn(prisma.followUpTemplate, 'findFirst').mockResolvedValue((template ?? null) as any);

  const { typingService } = await import('../../src/services/typing.service');
  const sendSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true } as any);

  const ok = await followUpService.executeFollowUp(fu, DEFAULT_TENANT_ID);
  expect(ok).toBe(true);
  expect(sendSpy).toHaveBeenCalledTimes(1);
  return String((sendSpy.mock.calls[0][0] as any).replyText || '');
}

describe('Fase 4 — sapaan gender-aware pada follow-up', () => {
  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    vi.restoreAllMocks();
  });

  it('1. preferensi Bapak -> sapaan pembuka Bapak, bukan Bunda', async () => {
    const text = await captureText(
      makeFu({
        treatment_category: 'MOMS',
        customer: {
          ...makeFu().customer,
          preferences: { genderGreeting: 'Bapak' },
        },
      })
    );

    expect(text).toContain('Bapak Ismail');
    expect(text).not.toContain('Bunda Ismail');
  });

  it('2. tanpa preferensi -> default Bunda (anti-regresi)', async () => {
    const text = await captureText(makeFu({ treatment_category: 'MOMS' }));
    expect(text).toContain('Bunda Ismail');
  });

  it('3. custom_text "Bunda {name}" + preferensi Bapak -> tidak menghasilkan sapaan ganda', async () => {
    const text = await captureText(
      makeFu({
        treatment_category: 'MOMS',
        customer: { ...makeFu().customer, preferences: { genderGreeting: 'Bapak' } },
      }),
      { text: 'Halo Bunda {name}! Kami siap bantu jadwalkan perawatan Bunda lagi ya.' }
    );

    expect(text).toContain('Halo Bapak Ismail');
    expect(text).not.toMatch(/Bunda\s+Bapak/i);
    expect(text).not.toContain('Bunda Ismail');
  });

  it('4. rujukan "Bunda" di tengah kalimat tidak dimutilasi', async () => {
    const text = await captureText(
      makeFu({
        treatment_category: 'MOMS',
        customer: { ...makeFu().customer, preferences: { genderGreeting: 'Bapak' } },
      }),
      { text: 'Halo Bunda {name}! Bagaimana kondisi badan Bunda setelah treatment kemarin?' }
    );

    expect(text).toContain('kondisi badan Bunda');
  });

  it('5. helper formatGreeting: nama sudah bersapaan tidak digandakan', () => {
    expect(formatGreeting('Pak Ismail', 'Bapak')).toBe('Bapak Ismail');
    expect(formatGreeting('Ismail', 'Bapak')).toBe('Bapak Ismail');
    expect(formatGreeting('Bunda Rina', 'Bunda')).toBe('Bunda Rina');
    expect(formatGreeting('', 'Bapak')).toBe('Bapak');
    expect(formatGreeting('Rina')).toBe('Bunda Rina');
  });
});

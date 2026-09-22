import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRollingVariant, getWibDateKey } from '../../src/config/followup-templates';
import { followUpService } from '../../src/services/follow-up.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Follow-Up Rolling Variant — Adversarial Unit Tests', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('1. Determinisme: ID sama + tanggal WIB sama → varian sama; tanggal WIB beda → boleh beda', () => {
    const id = 'cust-determinism-1';
    const d1 = new Date('2026-09-22T10:00:00+07:00');
    const d2 = new Date('2026-09-22T15:30:00+07:00'); // hari WIB sama
    const d3 = new Date('2026-09-23T10:00:00+07:00'); // hari WIB beda
    expect(getRollingVariant(id, d1)).toBe(getRollingVariant(id, d2));
    // hari beda tidak harus sama — cukup pastikan rentang valid
    expect([1, 2, 3]).toContain(getRollingVariant(id, d3));
  });

  it('2. Distribusi smoke: 300 ID sintetis → tiap varian 1..3 muncul >15% (anti kunci stage=variant)', () => {
    const counts = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
    const base = new Date('2026-09-22T09:40:00+07:00');
    for (let i = 0; i < 300; i++) {
      const v = getRollingVariant(`cust-smoke-${i}`, base);
      counts[v]++;
    }
    expect(counts[1]).toBeGreaterThan(45); // >15% dari 300
    expect(counts[2]).toBeGreaterThan(45);
    expect(counts[3]).toBeGreaterThan(45);
  });

  it('3. Edge WIB-midnight: instan sama dalam UTC vs WIB harus hasilkan varian sama', () => {
    // 2026-09-22 00:30 WIB == 2026-09-21 17:30 UTC — instan identik, hari WIB sama (2026-09-22)
    const wibMidnight = new Date('2026-09-22T00:30:00+07:00');
    const utcSameInstant = new Date('2026-09-21T17:30:00.000Z');
    expect(wibMidnight.getTime()).toBe(utcSameInstant.getTime());
    const id = 'cust-midnight-1';
    expect(getRollingVariant(id, wibMidnight)).toBe(getRollingVariant(id, utcSameInstant));
    // kunci WIB untuk keduanya harus 2026-09-22, bukan 2026-09-21 (UTC slice lama akan salah)
    expect(getWibDateKey(wibMidnight)).toBe('2026-09-22');
    expect(getWibDateKey(utcSameInstant)).toBe('2026-09-22');
    // bukti fix timezone: implementasi UTC-lama (slice langsung) akan beda
    const utcSlice = (d: Date) => d.toISOString().slice(0, 10);
    expect(utcSlice(wibMidnight)).toBe('2026-09-21'); // UTC-lama salah hari
    expect(getWibDateKey(wibMidnight)).not.toBe(utcSlice(wibMidnight));
  });

  it('4. Input invalid: customerId kosong / scheduledAt null/invalid → tetap 1..3, tidak throw', () => {
    expect([1, 2, 3]).toContain(getRollingVariant('', null));
    expect([1, 2, 3]).toContain(getRollingVariant('', undefined));
    expect([1, 2, 3]).toContain(getRollingVariant('', 'not-a-date' as any));
    expect([1, 2, 3]).toContain(getRollingVariant('', new Date('invalid')));
    expect(getWibDateKey(null)).toBe('');
    expect(getWibDateKey('invalid' as any)).toBe('');
    expect(getWibDateKey(new Date('invalid'))).toBe('');
  });

  it('5. listFollowUps enrich: tiap row ada variant 1..3 dan konsisten dengan helper', async () => {
    const rows = [
      { id: 'fu-1', customer_id: 'cust-a', customer: { id: 'cust-a' }, scheduled_at: new Date('2026-09-22T09:40:00+07:00'), type: 'NO_PURCHASE', stage: 1, status: 'QUEUED' },
      { id: 'fu-2', customer_id: 'cust-b', customer: { id: 'cust-b' }, scheduled_at: new Date('2026-09-23T09:40:00+07:00'), type: 'NEXT_TREATMENT', stage: 2, status: 'QUEUED' },
      { id: 'fu-3', customer_id: 'cust-c', customer: { id: 'cust-c' }, scheduled_at: new Date('2026-09-24T09:40:00+07:00'), type: 'NO_PURCHASE', stage: 1, status: 'PENDING' },
    ];
    // prisma di tests/setup dimock sebagai in-memory client; gunakan vi.spyOn pada followUp sub-object yang ada
    // count/findMany mungkin tidak ada di mock — mock langsung via any
    (prisma.followUp as any).count = vi.fn().mockResolvedValue(3);
    (prisma.followUp as any).findMany = vi.fn().mockResolvedValue(rows);

    const result = await followUpService.listFollowUps(DEFAULT_TENANT_ID, { page: 1, pageSize: 20 });
    expect(result.data).toHaveLength(3);
    for (const item of result.data) {
      expect([1, 2, 3]).toContain(item.variant);
      expect(item.variant).toBe(getRollingVariant(item.customer_id, item.scheduled_at));
      expect(item.customer_id).toBeDefined();
    }
  });

  it('6. executeFollowUp WABA memakai fu.variant bila pre-set, mengabaikan hash', async () => {
    const { wabaTemplateService } = await import('../../src/services/waba-template.service');

    const mockGateway = { providerType: 'WABA', sendTemplateMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'wamid-1' }) };
    const gatewaySpy = vi.spyOn(await import('../../src/integrations/whatsapp/factory'), 'resolveGatewayForTenant').mockResolvedValue(mockGateway as any);
    const mappingSpy = vi.spyOn(wabaTemplateService, 'getTemplateMapping').mockResolvedValue({
      templateName: 'followup_no_purchase_1', languageCode: 'id', category: 'UTILITY', status: 'APPROVED', isActive: true, isDefault: false,
    } as any);
    vi.spyOn(wabaTemplateService, 'isUsable').mockReturnValue(true);
    const { wabaConsentService } = await import('../../src/services/waba-consent.service');
    // UTILITY tidak butuh consent — tidak perlu mock canSendMarketing
    vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    const convSpy = vi.spyOn(await import('../../src/services/conversation.service').then(m => m.conversationService), 'getOrCreateConversation').mockResolvedValue(null as any);
    void convSpy;

    const fuWaba: any = {
      id: 'fu-waba-1',
      customer_id: 'cust-waba-1',
      variant: 2, // pre-set manual
      type: 'NO_PURCHASE',
      stage: 1,
      scheduled_at: new Date('2026-09-22T09:40:00+07:00'),
      customer: { id: 'cust-waba-1', phone: '6281234567890', name: 'Sari' },
    };
    // Inject gateway via resolveGatewayForTenant already mocked
    const ok = await (followUpService as any).executeFollowUpWaba(fuWaba, 'NO_PURCHASE_1', 'Sari', DEFAULT_TENANT_ID);
    expect(mappingSpy).toHaveBeenCalledWith(DEFAULT_TENANT_ID, 'NO_PURCHASE_1', 2);
    expect(ok).toBe(true);
    gatewaySpy.mockRestore();
    mappingSpy.mockRestore();
  });

  it('7. custom_text precedence: WAHA tetap prioritaskan custom_text walau variant dihitung', async () => {
    const fuMock: any = {
      id: 'fu-custom-1',
      customer_id: 'cust-custom-1',
      type: 'NO_PURCHASE',
      stage: 1,
      custom_text: 'Pesan kustom Bunda {name} jam {time} — {babyName}',
      scheduled_at: new Date('2026-09-22T09:40:00+07:00'),
      customer: { id: 'cust-custom-1', name: 'Rina', phone: '6281234567890', children: [{ name: 'Kenzo' }] },
    };
    const { typingService } = await import('../../src/services/typing.service');
    const simulateSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ status: 'sent', chatId: '6281234567890', messageCount: 1, totalTypingMs: 100 } as any);
    vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    const { resolveGatewayForTenant } = await import('../../src/integrations/whatsapp/factory');
    vi.spyOn(await import('../../src/integrations/whatsapp/factory'), 'resolveGatewayForTenant').mockResolvedValue({ providerType: 'WAHA' } as any);
    void resolveGatewayForTenant;

    const ok = await followUpService.executeFollowUp(fuMock, DEFAULT_TENANT_ID);
    expect(ok).toBe(true);
    const sent = simulateSpy.mock.calls[0][0].replyText as string;
    expect(sent).toContain('Rina');
    expect(sent).not.toContain('{name}');
    // custom_text dipertahankan, bukan template rolling
    expect(sent).toContain('Pesan kustom');
    simulateSpy.mockRestore();
  });

  it('8. getWibDateKey format YYYY-MM-DD dan konsisten lintas representasi', () => {
    const iso = '2026-09-22T09:40:00.000Z'; // 16:40 WIB → 2026-09-22 WIB
    expect(getWibDateKey(iso)).toBe('2026-09-22');
    expect(getWibDateKey(new Date(iso))).toBe('2026-09-22');
    // 2026-09-21T20:00Z = 2026-09-22 03:00 WIB → 2026-09-22
    expect(getWibDateKey('2026-09-21T20:00:00.000Z')).toBe('2026-09-22');
    // 2026-09-21T16:00Z = 2026-09-21 23:00 WIB → 2026-09-21
    expect(getWibDateKey('2026-09-21T16:00:00.000Z')).toBe('2026-09-21');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * #157a — Jalur form WA (state machine) WAJIB memakai kontrak intake kanonis:
 *  - same-day → status `pending` + penanda `[SAME_DAY_REQUEST]` (KB-2 awareness admin)
 *  - requestId kanonis → double-submit/redelivery tidak menggandakan baris
 * Adversarial: menguji perilaku via state riil (bukan hafalan kalimat).
 */
describe('#157a — form WA same-day intake contract', () => {
  const machine = new ConversationStateMachine({
    simulateHumanReply: vi.fn().mockResolvedValue({ success: true }),
    sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
  } as any);

  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    vi.restoreAllMocks();
  });

  function buildForm(dateLine: string): string {
    return [
      'Berikut list untuk reservasi :',
      '',
      `Hari dan tanggal : ${dateLine}`,
      'Nama Bunda: Shafira',
      'Alamat & Shareloc : pandean 2/27, Kel. Peneleh',
      'Kec : Genteng',
      'Kota : Surabaya',
      'No. Hp : 081217639971',
      '',
      'Pilihan treatment (Baby & Kids)',
      '',
      'Nama Bayi : Danish',
      'Usia Bayi/Anak : 1 bulan',
      'Treatment : pijat bayi ceria',
    ].join('\n');
  }

  it('form same-day → saveReservation status pending + tag [SAME_DAY_REQUEST] + requestId', async () => {
    const phone = `6287${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, 'Bunda Shafira', DEFAULT_TENANT_ID);
    const conv = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);

    const spy = vi
      .spyOn(reservationCoreService, 'saveReservation')
      .mockResolvedValue({ reservation: { id: 'r-sameday', status: 'pending' }, isNew: true, isUpdate: false } as any);

    const res = await machine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation: conv,
      incomingMessage: {
        id: `msg_sameday_${Date.now()}`,
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: buildForm('hari ini jam 10.00') },
      },
    } as any);

    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0] as any;
    expect(arg.status).toBe('pending');
    expect(arg.requestId).toBeDefined();
    expect(String(arg.rawText)).toContain('[SAME_DAY_REQUEST]');
    expect(res.isHumanHandling).toBe(true);
  });

  it('form beda hari → status confirmed + requestId terisi (idempotency aktif)', async () => {
    const phone = `6287${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, 'Bunda Shafira', DEFAULT_TENANT_ID);
    const conv = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);

    const spy = vi
      .spyOn(reservationCoreService, 'saveReservation')
      .mockResolvedValue({ reservation: { id: 'r-future', status: 'confirmed' }, isNew: true, isUpdate: false } as any);

    await machine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation: conv,
      incomingMessage: {
        id: `msg_future_${Date.now()}`,
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: buildForm('25 Desember 2027 jam 10.00') },
      },
    } as any);

    const arg = spy.mock.calls[0][0] as any;
    expect(arg.status).toBe('confirmed');
    expect(arg.requestId).toBeDefined();
    expect(String(arg.rawText)).not.toContain('[SAME_DAY_REQUEST]');
  });
});

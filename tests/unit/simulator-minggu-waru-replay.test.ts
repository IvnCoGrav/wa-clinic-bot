import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationState } from '@prisma/client';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Replay persis kasus simulator 725870 (bukti: logs/llm-2026-09-11.jsonl
 * llm_1789098711706 + llm_1789098754163). Prosedur: MERAH sebelum fix,
 * HIJAU sesudah Fase 1–2.
 *
 * Turn 1 "Hari Minggu pagi kosong tidak ya ?" (lokasi unknown):
 *   draf buruk: janji cekkan tanpa tanya lokasi.
 * Turn 2 "baik kak": draf buruk: "Area Kecamatan Waru...".
 */
describe('Replay simulator Minggu-Waru — hierarki jadwal + anti-halu domisili', () => {
  const sentToCustomer: string[] = [];
  const testStateMachine = new ConversationStateMachine({
    simulateHumanReply: async (params: any) => {
      sentToCustomer.push(params.replyText);
      return { success: true };
    },
  } as any);

  // Draf buruk asli dari log (fixture regresi).
  const BAD_TURN_1 =
    'Untuk ketersediaan jadwal di hari Minggu pagi, kami bantu cekkan ketersediaan jadwal Bidan yang ready terlebih dahulu ya Bunda 😊🙏\n\nNanti segera kami infokan ya Bunda 🤗';
  const BAD_TURN_2 =
    'Untuk ketersediaan jadwal, kami perlu tahu lebih lanjut mengenai lokasi Bunda 😊\n\nArea Kecamatan Waru ini masih cukup luas. Kalau boleh tahu, rumah Bunda di kelurahan atau perumahan mana ya? Biar kami bantu cekkan jarak dan slot Bidan yang ready. 🤗';

  function mockDraft(text: string) {
    return { choices: [{ message: { content: text } }] } as any;
  }

  async function freshCustomer(name: string) {
    const phone = `62885${Date.now()}${Math.floor(Math.random() * 1000)}`;
    return customerService.getOrCreateCustomer(phone, name, DEFAULT_TENANT_ID);
  }

  async function turn(customer: any, body: string, n: number) {
    return testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_rw_${n}_${Date.now()}`,
        from: customer.phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body },
      },
    });
  }

  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    sentToCustomer.length = 0;
    vi.restoreAllMocks();
  });

  it('Turn 1: prompt membawa hierarki 5a (lokasi-unknown → tanya domisili, bukan cekkan)', async () => {
    const customer = await freshCustomer('Bunda Minggu');
    const execSpy = vi
      .spyOn(V3AgentRunner, 'executeChatCompletion')
      .mockResolvedValue(mockDraft(BAD_TURN_1));

    await turn(customer, 'Hari Minggu pagi kosong tidak ya ?', 1);

    expect(execSpy).toHaveBeenCalled();
    // Verifikasi jujur untuk fix prompt-only: hierarki 5a > 5b/21 HARUS ada
    // di system prompt yang dikirim ke LLM pada turn tanya-jadwal ini.
    const sysPrompt = String(execSpy.mock.calls[0][0]?.payload?.messages?.[0]?.content || '');
    expect(sysPrompt).toMatch(/PRIORITAS 1.*LOKASI BELUM DIKETAHUI/i);
    expect(sysPrompt).toMatch(/ABAIKAN.*cekkan\/infokan/i);
  });

  it('Turn 2: "baik kak" tanpa lokasi → DILARANG menyebut kecamatan mana pun', async () => {
    const customer = await freshCustomer('Bunda Baik');
    const execSpy = vi
      .spyOn(V3AgentRunner, 'executeChatCompletion')
      .mockResolvedValueOnce(mockDraft(BAD_TURN_2))
      .mockResolvedValue(mockDraft('Kalau boleh tahu rumah Bunda di daerah mana ya?'));

    const result = await turn(customer, 'baik kak', 2);

    expect(execSpy).toHaveBeenCalled();
    expect(result.shouldSendReply).toBe(true);
    // Perilaku benar (Fase 2/D6): tidak ada klaim domisili kecamatan.
    expect(result.replyText).not.toMatch(/kecamatan\s+[a-z]+/i);
    expect(result.replyText).toMatch(/daerah mana|kelurahan/i);
  });
});

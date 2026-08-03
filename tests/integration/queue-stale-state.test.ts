import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { queueService } from '../../src/services/queue.service';
import { stateMachine } from '../../src/state-machine/machine';
import { FastifyInstance } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Integration test: 2 pesan berurutan cepat pada customer yang sama.
 * Pesan pertama memajukan current_state; pesan kedua harus diproses dengan state
 * HASIL pesan pertama (fresh-fetch di worker), bukan snapshot dari waktu enqueue —
 * sehingga bot tidak mengulang balasan identik (bug stale state / race condition).
 */
describe('Queue Stale-State Fix: 2 Rapid Affirmations', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  it('POST /webhook: 2 pesan afirmasi beruntun diproses dengan state hasil pesan pertama', async () => {
    const phone = `628666${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Stale State Integration', DEFAULT_TENANT_ID);
    expect(customer.id).toBeTruthy();

    // Seed lokasi tersimpan supaya afirmasi di INITIAL memajukan state (greeting.ts).
    customer.kelurahan = 'Jambangan';
    customer.kecamatan = 'Jambangan';
    customer.lat = -7.34;
    customer.lng = 112.75;

    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      { currentState: 'INITIAL', isHumanHandling: false, previousState: null },
      DEFAULT_TENANT_ID
    );

    // Spy untuk menangkap state yang dilihat tiap pemrosesan job.
    const statesSeen: string[] = [];
    const repliesSeen: string[] = [];
    const processSpy = vi.spyOn(stateMachine, 'processMessage').mockImplementation(async (ctx) => {
      statesSeen.push(ctx.conversation.current_state);
      const result: any = ctx.incomingMessage.text?.body?.toLowerCase().includes('betul')
        ? { nextState: 'AWAITING_INTEREST', replyText: 'Baik Bunda, lanjut ke pilihan treatment ya?', shouldSendReply: false }
        : { nextState: 'AWAITING_INTEREST', replyText: 'Mau treatment apa bunda?', shouldSendReply: false };
      repliesSeen.push(result.replyText);
      // Simulasi persist state seperti machine.ts (updateConversationState).
      await conversationService.updateConversationState(
        ctx.conversation.id,
        { currentState: result.nextState },
        DEFAULT_TENANT_ID
      );
      return result;
    });

    const base = { event: 'message', session: 'default', payload: { from: `${phone}@c.us`, fromMe: false, timestamp: 1700000000, _data: { notifyName: 'Stale' } } };

    // Kirim 2 pesan afirmasi beruntun SEBAGAI DUA WEBHOOK TERPISAH tanpa menunggu
    // job pertama selesai di antaranya (meniru window ~19 detik).
    const res1 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: { ...base, payload: { ...base.payload, id: `stale_it_1_${Date.now()}`, body: 'betul bund' } },
    });
    const res2 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: { ...base, payload: { ...base.payload, id: `stale_it_2_${Date.now()}`, body: 'betul bund' } },
    });

    expect(res1.statusCode).toBe(200);
    expect(JSON.parse(res1.body)).toEqual({ status: 'EVENT_PROCESSED' });
    expect(res2.statusCode).toBe(200);
    expect(JSON.parse(res2.body)).toEqual({ status: 'EVENT_PROCESSED' });

    // Beri waktu worker in-memory menyelesaikan kedua job.
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(processSpy).toHaveBeenCalledTimes(2);
    // Pesan pertama diproses di INITIAL, pesan kedua di AWAITING_INTEREST
    // (hasil update dari pesan pertama) — bukan keduanya di INITIAL.
    expect(statesSeen).toEqual(['INITIAL', 'AWAITING_INTEREST']);

    // Verifikasi state akhir tersimpan di store.
    const refreshed = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(refreshed.current_state).toBe('AWAITING_INTEREST');

    processSpy.mockRestore();
  });
});

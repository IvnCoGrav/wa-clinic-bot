import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildApp } from '../../src/app';
import { queueService } from '../../src/services/queue.service';
import { messageService } from '../../src/services/message.service';
import { wahaTenantService } from '../../src/services/waha-tenant.service';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';

describe('WAHA Inbound & Outbound Quoted Message Ingestion (Tugas 2.2 & Tugas 2.4)', () => {
  const app = buildApp();
  const fixturesDir = path.resolve(__dirname, '../fixtures/quoted');

  beforeEach(async () => {
    vi.restoreAllMocks();
    wahaTenantService.resetCache();
    vi.spyOn(wahaTenantService, 'resolveTenantBySession').mockResolvedValue('default-tenant');
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    await queueService.forceDisconnectRedis();
    await seedAiScopeAll();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  it('1. WAHA Inbound teks reply: incomingMessage.quoted dan payloadRaw.quoted_message tersimpan', async () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, 'waha-noweb-inbound-text-reply.json'), 'utf-8')
    );
    // Berikan waMessageId baru agar lolos idempotency
    const uniqueId = `waha_inbound_quote_${Date.now()}_${Math.random()}`;
    raw.payload.id = uniqueId;
    raw.payload.timestamp = Math.floor(Date.now() / 1000);

    const queueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue('job-waha-1' as any);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: raw,
    });

    expect(res.statusCode).toBe(200);
    expect(queueSpy).toHaveBeenCalled();
    const queuedJob = queueSpy.mock.calls[0][0];
    expect(queuedJob.incomingMessage.quoted).toBeDefined();
    expect(queuedJob.incomingMessage.quoted.wa_message_id).toBe('true_6281200000001@c.us_3EB0BOT111111111111');
    expect(queuedJob.incomingMessage.quoted.content).toContain('Halo Bunda, untuk tindik bayi ada 2 pilihan');
  });

  it('2. WAHA Outbound dari HP: logOutboundMessageWithRetry menerima payloadRaw.quoted_message', async () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, 'waha-noweb-outbound-hp-reply.json'), 'utf-8')
    );
    const uniqueId = `waha_outbound_hp_${Date.now()}_${Math.random()}`;
    raw.payload.id = uniqueId;
    raw.payload.timestamp = Math.floor(Date.now() / 1000);

    const logOutboundSpy = vi.spyOn(messageService, 'logMessage').mockResolvedValue({
      id: 'logged_outbound_msg_id',
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: raw,
    });

    expect(res.statusCode).toBe(200);
    expect(logOutboundSpy).toHaveBeenCalled();
    const callArgs = logOutboundSpy.mock.calls[0][0];
    expect(callArgs.direction).toBe('OUTBOUND');
    expect(callArgs.payloadRaw).toBeDefined();
    expect(callArgs.payloadRaw.quoted_message).toBeDefined();
    expect(callArgs.payloadRaw.quoted_message.content).toContain('Bisa untuk bayi usia 3 bulan?');
  });
});

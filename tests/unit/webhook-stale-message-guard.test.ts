import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { queueService } from '../../src/services/queue.service';
import { messageService } from '../../src/services/message.service';
import { FastifyInstance } from 'fastify';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';

describe('Webhook Stale Message Timestamp Guard', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    await seedAiScopeAll();
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  beforeEach(() => {
    process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS = '180'; // 3 menit
  });

  it('should process fresh message (< 180s old) normally with EVENT_PROCESSED', async () => {
    const freshTimestamp = Math.floor(Date.now() / 1000) - 10; // 10 detik lalu
    const waMessageId = `fresh_msg_${Date.now()}`;
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: waMessageId,
        from: '628111222333@c.us',
        fromMe: false,
        timestamp: freshTimestamp,
        body: 'Halo Bidan Yusi, mau tanya jadwal',
        _data: { notifyName: 'Bunda Fresh' },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'EVENT_PROCESSED' });
  });

  it('should drop old/stale message (> 180s old) with IGNORED_STALE_MESSAGE but log to database', async () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 jam lalu (catch-up message)
    const waMessageId = `stale_msg_${Date.now()}`;
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: waMessageId,
        from: '628444555666@c.us',
        fromMe: false,
        timestamp: staleTimestamp,
        body: 'Halo pesan lama 1 jam lalu saat reconnect',
        _data: { notifyName: 'Bunda Stale' },
      },
    };

    const logSpy = vi.spyOn(messageService, 'logMessage');

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'IGNORED_STALE_MESSAGE' });
    // Pastikan pesan tetap dicatat ke database (audit trail / live chat)
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        waMessageId,
        direction: 'INBOUND',
        content: 'Halo pesan lama 1 jam lalu saat reconnect',
      })
    );
  });

  it('should handle timestamp in milliseconds format (> 10000000000)', async () => {
    const staleTimestampMs = Date.now() - 500000; // 500 detik lalu (ms)
    const waMessageId = `stale_ms_msg_${Date.now()}`;
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: waMessageId,
        from: '628777888999@c.us',
        fromMe: false,
        timestamp: staleTimestampMs,
        body: 'Pesan lama format ms',
        _data: { notifyName: 'Bunda Ms' },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'IGNORED_STALE_MESSAGE' });
  });
});

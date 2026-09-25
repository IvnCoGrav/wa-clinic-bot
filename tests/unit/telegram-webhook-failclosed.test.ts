import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { telegramWebhookRoutes } from '../../src/routes/telegram-webhook.route';

/**
 * SEC-AUDIT-01 adversarial: webhook Telegram WAJIB fail-closed.
 * - Secret tak dikonfigurasi (env kosong) → 403, bukan lolos.
 * - Secret salah / header hilang → 403 via timing-safe compare.
 * - Secret benar → guard lolos (handler lanjut).
 */
describe('Telegram Webhook Fail-Closed (SEC-AUDIT-01)', () => {
  let app: FastifyInstance;
  let prevSecret: string | undefined;

  beforeEach(async () => {
    vi.restoreAllMocks();
    prevSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    app = Fastify();
    await app.register(telegramWebhookRoutes);
    await app.ready();
  });

  afterEach(async () => {
    if (prevSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = prevSecret;
    await app.close().catch(() => {});
  });

  const postUpdate = (headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/webhook/telegram',
      headers,
      payload: { update_id: 99, message: { message_id: 1, chat: { id: 1, type: 'private' } } },
    });

  it('menolak 403 saat TELEGRAM_WEBHOOK_SECRET tidak dikonfigurasi (fail-closed, bukan fail-open)', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const res = await postUpdate({ 'x-telegram-bot-api-secret-token': 'apapun' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('Unauthorized');
  });

  it('menolak 403 saat secret dikonfigurasi tapi header salah', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'secret-asli-server';
    const res = await postUpdate({ 'x-telegram-bot-api-secret-token': 'secret-penyerang' });
    expect(res.statusCode).toBe(403);
  });

  it('menolak 403 saat header secret hilang', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'secret-asli-server';
    const res = await postUpdate();
    expect(res.statusCode).toBe(403);
  });

  it('meloloskan guard saat secret benar (handler lanjut, bukan 403)', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'secret-asli-server';
    const res = await postUpdate({ 'x-telegram-bot-api-secret-token': 'secret-asli-server' });
    // Payload tanpa teks → handler mengembalikan 200 ignored (bukti guard lolos)
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('GET health check tetap publik 200 (di luar guard POST)', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const res = await app.inject({ method: 'GET', url: '/api/webhook/telegram' });
    expect(res.statusCode).toBe(200);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';

describe('Webhook Timing-Safe & Fail-Closed Security Tests (SEC-05 & SEC-07)', () => {
  const app = buildApp();
  const wahaSecret = 'super_secret_waha_webhook_token_999';
  const telegramSecret = 'super_secret_telegram_webhook_token_888';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key';
    process.env.WAHA_WEBHOOK_SECRET = wahaSecret;
    process.env.TELEGRAM_WEBHOOK_SECRET = telegramSecret;
  });

  describe('1. WAHA Webhook Authentication (SEC-07 Fix)', () => {
    it('rejects WAHA webhook requests with invalid or missing secret with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhook',
        headers: {
          'x-webhook-secret': 'wrong_secret_token',
        },
        payload: {
          event: 'message',
          payload: {},
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain('Unauthorized');
    });

    it('accepts WAHA webhook requests with valid timing-safe secret', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhook',
        headers: {
          'x-webhook-secret': wahaSecret,
        },
        payload: {
          event: 'message.ack',
          payload: { id: 'msg-123', ack: 2, timestamp: Date.now() },
        },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('2. Telegram Webhook Authentication (SEC-05 Fix)', () => {
    it('rejects Telegram webhook requests with invalid secret token with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhook/telegram',
        headers: {
          'x-telegram-bot-api-secret-token': 'wrong_telegram_token',
        },
        payload: {
          message: { text: '/server', chat: { id: 12345 } },
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain('Unauthorized: Invalid Telegram secret token');
    });

    it('accepts Telegram webhook requests with valid secret token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhook/telegram',
        headers: {
          'x-telegram-bot-api-secret-token': telegramSecret,
        },
        payload: {
          message: { text: '/test', chat: { id: 12345 } },
        },
      });

      expect(res.statusCode).toBe(200);
    });
  });
});

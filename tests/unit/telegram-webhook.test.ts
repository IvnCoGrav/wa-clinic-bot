import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { telegramWebhookRoutes } from '../../src/routes/telegram-webhook.route';
import { prisma } from '../../src/db/client';
import { telegramService } from '../../src/services/telegram.service';

describe('Telegram Webhook & 1-Click Pairing Integration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.restoreAllMocks();
    app = Fastify();
    await app.register(telegramWebhookRoutes);
    await app.ready();
  });

  it('GET /api/webhook/telegram should return healthy status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/webhook/telegram',
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.status).toBe('ok');
  });

  it('POST /api/webhook/telegram: /start PAIR_123 should link chat to tenant and reply confirmation', async () => {
    const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true });
    
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: 'tenant-kala',
      name: 'Klinik Kala',
      telegram_pairing_token: 'PAIR_123',
    } as any);

    vi.mocked(prisma.tenant.update).mockResolvedValue({} as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/telegram',
      payload: {
        update_id: 1,
        message: {
          message_id: 10,
          chat: { id: 1383337873, first_name: 'Ivan', type: 'private' },
          from: { id: 1383337873, first_name: 'Ivan' },
          text: '/start PAIR_123',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { telegram_pairing_token: 'PAIR_123' },
    });
    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-kala' },
      data: { telegram_chat_id: '1383337873' },
    });
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '1383337873',
        text: expect.stringContaining('Koneksi Berhasil'),
      })
    );
  });

  it('POST /api/webhook/telegram: /set_daily_report in a topic should bind topic ID to tenant', async () => {
    const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true });

    vi.mocked(prisma.tenant.findMany).mockResolvedValue([
      {
        id: 'tenant-kala',
        name: 'Klinik Kala',
        telegram_chat_id: '-1002345678901',
      } as any,
    ]);

    vi.mocked(prisma.tenant.update).mockResolvedValue({} as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/telegram',
      payload: {
        update_id: 2,
        message: {
          message_id: 20,
          chat: { id: -1002345678901, title: 'Kala Ops', type: 'supergroup' },
          message_thread_id: 42,
          text: '/set_daily_report',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-kala' },
      data: {
        telegram_topic_daily_report: '42',
        telegram_chat_id: '-1002345678901:42',
      },
    });
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '-1002345678901',
        messageThreadId: '42',
        text: expect.stringContaining('Topik Laporan Harian Ditetapkan'),
      })
    );
  });

  it('POST /api/webhook/telegram: /set_error_alerts in a topic should bind error topic', async () => {
    const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true });

    vi.mocked(prisma.tenant.findMany).mockResolvedValue([
      {
        id: 'tenant-kala',
        name: 'Klinik Kala',
        telegram_chat_id: '-1002345678901',
      } as any,
    ]);

    vi.mocked(prisma.tenant.update).mockResolvedValue({} as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/telegram',
      payload: {
        update_id: 3,
        message: {
          message_id: 25,
          chat: { id: -1002345678901, title: 'Kala Ops', type: 'supergroup' },
          message_thread_id: 50,
          text: '/set_error_alerts',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-kala' },
      data: {
        telegram_topic_system_errors: '50',
      },
    });
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '-1002345678901',
        messageThreadId: '50',
        text: expect.stringContaining('Topik Error Sistem Ditetapkan'),
      })
    );
  });

  it('POST /api/webhook/telegram: /status_telegram should reply with configured topics', async () => {
    const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true });

    vi.mocked(prisma.tenant.findMany).mockResolvedValue([
      {
        id: 'tenant-kala',
        name: 'Klinik Kala',
        telegram_chat_id: '-1002345678901',
        telegram_topic_daily_report: '42',
        telegram_topic_system_errors: '50',
        telegram_topic_medical_alerts: '65',
      } as any,
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/telegram',
      payload: {
        update_id: 4,
        message: {
          message_id: 30,
          chat: { id: -1002345678901, title: 'Kala Ops', type: 'supergroup' },
          text: '/status',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Status Integrasi Telegram — Klinik Kala'),
      })
    );
  });

  it('POST /api/webhook/telegram: /server (and /status_server) should reply with comprehensive server health card', async () => {
    const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/telegram',
      payload: {
        update_id: 5,
        message: {
          message_id: 35,
          chat: { id: 1383337873, first_name: 'Ivan', type: 'private' },
          text: '/server',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('STATUS KESEHATAN SERVER & INFRASTRUKTUR'),
      })
    );
  });
});

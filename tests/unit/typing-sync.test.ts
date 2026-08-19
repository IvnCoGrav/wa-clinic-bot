import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { livechatAdminRoutes } from '../../src/routes/admin/livechat.subroute';
import { webhookRoutes } from '../../src/routes/webhook.route';
import { conversationService } from '../../src/services/conversation.service';
import { messageService } from '../../src/services/message.service';
import { wahaClient } from '../../src/integrations/waha/client';

describe('Live Chat Typing & Delivery Status Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.restoreAllMocks();
    app = Fastify();
    await app.register(livechatAdminRoutes);
    await app.register(webhookRoutes);
    await app.ready();
  });

  describe('POST /api/admin/conversations/:id/typing', () => {
    it('sends sendSeen and startTyping when isTyping is true', async () => {
      vi.spyOn(conversationService, 'getConversationById').mockResolvedValueOnce({
        id: 'conv_123',
        customer_id: 'cust_123',
        tenant_id: 'default-tenant',
        customer: { phone: '628123456789', is_sandbox_test: false },
      } as any);

      const sendSeenSpy = vi.spyOn(wahaClient, 'sendSeen').mockResolvedValueOnce(true);
      const startTypingSpy = vi.spyOn(wahaClient, 'startTyping').mockResolvedValueOnce(true);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/conversations/conv_123/typing',
        payload: { isTyping: true },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.isTyping).toBe(true);
      expect(sendSeenSpy).toHaveBeenCalledWith('628123456789', undefined);
      expect(startTypingSpy).toHaveBeenCalledWith('628123456789');
    });

    it('sends stopTyping when isTyping is false', async () => {
      vi.spyOn(conversationService, 'getConversationById').mockResolvedValueOnce({
        id: 'conv_123',
        customer_id: 'cust_123',
        tenant_id: 'default-tenant',
        customer: { phone: '628123456789', is_sandbox_test: false },
      } as any);

      const stopTypingSpy = vi.spyOn(wahaClient, 'stopTyping').mockResolvedValueOnce(true);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/conversations/conv_123/typing',
        payload: { isTyping: false },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.isTyping).toBe(false);
      expect(stopTypingSpy).toHaveBeenCalledWith('628123456789');
    });

    it('ignores typing signal for sandbox dummy chat', async () => {
      vi.spyOn(conversationService, 'getConversationById').mockResolvedValueOnce({
        id: 'conv_sandbox',
        customer_id: 'cust_sandbox',
        tenant_id: 'default-tenant',
        customer: { phone: '62899990001', is_sandbox_test: true },
      } as any);

      const startTypingSpy = vi.spyOn(wahaClient, 'startTyping');

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/conversations/conv_sandbox/typing',
        payload: { isTyping: true },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sandbox).toBe(true);
      expect(startTypingSpy).not.toHaveBeenCalled();
    });
  });

  describe('POST /webhook with event message.ack', () => {
    it('processes ack: 2 as delivered', async () => {
      const updateSpy = vi.spyOn(messageService, 'updateDeliveryStatus').mockResolvedValueOnce({ matched: true });

      const res = await app.inject({
        method: 'POST',
        url: '/webhook',
        payload: {
          event: 'message.ack',
          session: 'default',
          payload: {
            id: 'false_628123456789@c.us_3EB0123456',
            ack: 2,
            timestamp: 1787140000,
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ACK_PROCESSED');
      expect(updateSpy).toHaveBeenCalledWith(
        'false_628123456789@c.us_3EB0123456',
        'default-tenant',
        'delivered',
        1787140000
      );
    });

    it('processes ack: 3 as read', async () => {
      const updateSpy = vi.spyOn(messageService, 'updateDeliveryStatus').mockResolvedValueOnce({ matched: true });

      const res = await app.inject({
        method: 'POST',
        url: '/webhook',
        payload: {
          event: 'message.ack',
          session: 'default',
          payload: {
            id: 'false_628123456789@c.us_3EB0123456',
            ack: 3,
            timestamp: 1787140010,
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ACK_PROCESSED');
      expect(updateSpy).toHaveBeenCalledWith(
        'false_628123456789@c.us_3EB0123456',
        'default-tenant',
        'read',
        1787140010
      );
    });
  });
});

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { WahaWebhookEvent } from '../integrations/waha/types';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { wahaTenantService } from '../services/waha-tenant.service';
import { contextStorage } from '../utils/context';
import { safeCompare } from '../utils/auth';
import {
  handleLabelChatEvent,
  handleAckEvent,
  handleRevokeEvent,
  handleReactionEvent,
  handleEditedEvent,
  isRevokeEvent,
  isReactionEvent,
  isEditedEvent,
  handleOutboundEchoEvent,
  handleInboundMessageEvent,
} from './webhook';

dotenv.config();

export async function webhookRoutes(fastify: FastifyInstance) {
  /**
   * POST /webhook
   * Webhook handler untuk event pesan masuk dari WAHA (WhatsApp HTTP API).
   * Termasuk IDEMPOTENCY CHECK (`wa_message_id`) & EXPLICIT GUARD CLAUSE for HUMAN HANDLING.
   */
  fastify.post('/webhook', {
    // SEC-AUDIT-13: kuota tinggi (bukan tanpa batas) agar burst sync WAHA tetap
    // lolos namun flooding CPU/memori tetap terkendali.
    config: { rateLimit: { max: 5000, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest<{ Body: WahaWebhookEvent }>, reply: FastifyReply) => {
    const correlationId = crypto.randomUUID();
    return contextStorage.run({ correlationId }, async () => {
      // --- SECURITY VERIFICATION (X-Webhook-Secret) (SEC-07 Fix) ---
      const webhookSecret = process.env.WAHA_WEBHOOK_SECRET;
      if (webhookSecret) {
        const clientSecret = (request.headers['x-webhook-secret'] || request.headers['x-waha-signature'] || '') as string;
        if (!clientSecret || !safeCompare(clientSecret, webhookSecret)) {
          console.warn(`[SECURITY WARNING] Unauthorized webhook access attempt from IP: ${request.ip}`);
          return reply.status(401).send({ error: 'Unauthorized: Invalid or missing webhook secret token.' });
        }
      }

      const event = request.body;
      if (!event) {
        return reply.status(200).send({ status: 'IGNORED_EVENT_TYPE' });
      }

      // --- PLAN 8 FASE 4 + P0-1 (audit #199): Tenant enforcement ---
      let resolvedTenantId = DEFAULT_TENANT_ID;
      let tenantName: string | undefined;
      try {
        const eventSession = (event as any)?.session as string | undefined;
        const resolved = await wahaTenantService.resolveTenantBySession(eventSession);
        if (!resolved) {
          console.warn(`[WAHA TENANT] session=${eventSession} tidak dapat di-resolve → webhook DITOLAK (fail-closed).`);
          return reply.status(200).send({ status: 'UNKNOWN_TENANT_REJECTED' });
        }
        resolvedTenantId = resolved;
        try {
          const { prisma } = await import('../db/client');
          const t = await prisma.tenant.findUnique({ where: { id: resolvedTenantId }, select: { name: true } });
          tenantName = t?.name?.trim();
        } catch {}
        if (eventSession && resolvedTenantId !== DEFAULT_TENANT_ID) {
          console.log(`[WAHA TENANT] session=${eventSession} → tenant=${resolvedTenantId}`);
        }
      } catch (tenantErr: any) {
        console.warn('[WAHA TENANT] resolusi tenant gagal → DITOLAK (fail-closed):', tenantErr?.message);
        return reply.status(200).send({ status: 'TENANT_RESOLUTION_FAILED' });
      }

      // 1. Label Events
      if (event.event === 'label.chat.added' || event.event === 'label.chat.deleted') {
        await handleLabelChatEvent(event, resolvedTenantId);
        return reply.status(200).send({ status: 'LABEL_EVENT_PROCESSED' });
      }

      // 2. Message ACK
      if (event.event === 'message.ack') {
        return handleAckEvent(event, resolvedTenantId, reply);
      }

      // 3. Message Revoke / Deleted
      if (isRevokeEvent(event)) {
        return handleRevokeEvent(event, resolvedTenantId, reply);
      }

      // 4. Message Reaction
      if (isReactionEvent(event)) {
        return handleReactionEvent(event, resolvedTenantId, reply);
      }

      // 5. Message Edited
      if (isEditedEvent(event)) {
        return handleEditedEvent(event, resolvedTenantId, reply);
      }

      // Filter hanya event "message" atau "message.any"
      if (event.event !== 'message' && event.event !== 'message.any') {
        return reply.status(200).send({ status: 'IGNORED_EVENT_TYPE' });
      }

      const payload = event.payload;
      if (!payload) {
        return reply.status(200).send({ status: 'IGNORED_EVENT_TYPE' });
      }

      // Early Filter Inbound Duplikat dari message.any:
      if (event.event === 'message.any' && !payload.fromMe) {
        return reply.status(200).send({ status: 'IGNORED_REDUNDANT_INBOUND_ANY' });
      }

      // 6. Outbound Echo dari HP WhatsApp fisik / Live Chat / Bot
      if (payload.fromMe) {
        return handleOutboundEchoEvent(payload, resolvedTenantId, tenantName, reply);
      }

      // 7. Inbound Message (Customer -> Bot)
      return handleInboundMessageEvent(payload, resolvedTenantId, reply, correlationId);
    });
  });
}

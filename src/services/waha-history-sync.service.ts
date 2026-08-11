import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';
import { Direction } from '@prisma/client';
import { customerService } from './customer.service';
import { conversationService } from './conversation.service';
import { messageService } from './message.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export interface WahaHistorySyncResult {
  success: boolean;
  syncedChats: number;
  skippedChats: number;
  syncedMessages: number;
  totalChats: number;
  nextOffset: number;
  hasMore: boolean;
  error?: string;
}

const DEFAULT_BATCH = 50;
const DEFAULT_MESSAGES_PER_CHAT = 100;

/**
 * Sinkronisasi history chat dari WAHA ke DB bot (mirip WhatsApp Web):
 * - Ambil daftar chat dari WAHA (store fullSync), batch per `limit`.
 * - Per chat: resolusi LID -> nomor HP, upsert customer + conversation + messages.
 * - Dedupe by wa_message_id → aman dijalankan ulang (idempoten).
 * - Skip: grup (@g.us), broadcast, nomor sandbox test (6289999), chat tanpa nomor valid.
 */
export class WahaHistorySyncService {
  public async syncChats(
    limit = DEFAULT_BATCH,
    offset = 0,
    messagesPerChat = DEFAULT_MESSAGES_PER_CHAT,
    tenantId = DEFAULT_TENANT_ID
  ): Promise<WahaHistorySyncResult> {
    try {
      const chats = await wahaClient.getChats();
      const totalChats = chats.length;
      const batch = chats.slice(offset, offset + limit);

      let syncedChats = 0;
      let skippedChats = 0;
      let syncedMessages = 0;

      for (const chat of batch) {
        // Lewati grup WhatsApp & broadcast/status
        if (chat.id.includes('@g.us') || chat.id.includes('broadcast') || chat.id.includes('@newsletter')) {
          skippedChats++;
          continue;
        }

        // Resolusi nomor HP dari JID (@lid / @c.us / @s.whatsapp.net)
        let phone: string | null = null;
        try {
          if (chat.id.includes('@lid')) {
            phone = await wahaClient.getPhoneNumberFromLid(chat.id);
          }
        } catch (e) {
          phone = null;
        }
        if (!phone) {
          phone = chat.id.replace(/@.*$/, '');
        }
        if (!phone || !/^\d+$/.test(phone)) {
          skippedChats++;
          continue;
        }

        // Lewati nomor dummy sandbox/QA test (tidak mencemari data WhatsApp asli)
        if (phone.startsWith('6289999')) {
          skippedChats++;
          continue;
        }

        const rawMessages = await wahaClient.getMessages(chat.id, messagesPerChat);
        const textMessages = (rawMessages || [])
          .filter((m) => m.body && typeof m.body === 'string' && m.body.trim().length > 0)
          .sort((a, b) => a.timestamp - b.timestamp);

        // Nama chat sering kosong di daftar chats → coba ambil pushname via contacts (best-effort)
        let customerName = chat.name || undefined;
        if (!customerName) {
          try {
            const contact = await wahaClient.getContact(phone);
            if (contact?.pushname) customerName = contact.pushname;
          } catch (e) {
            // abaikan — nama tetap kosong, tidak fatal
          }
        }

        const customer = await customerService.getOrCreateCustomer(phone, customerName, tenantId, {
          skipFollowUpScheduling: true, // history lama tidak boleh memicu follow-up baru
        });

        // Backfill nama customer lama yang masih kosong (data hasil sync sebelumnya)
        if (customerName && !customer.name) {
          try {
            await customerService.updateCustomerName(customer.id, customerName, tenantId);
            customer.name = customerName;
          } catch (e) {
            // abaikan — nama tidak wajib
          }
        }
        const conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);

        let chatSynced = 0;
        for (const msg of textMessages) {
          if (!msg.id) continue;
          const duplicate = await messageService.isDuplicateMessage(msg.id, tenantId);
          if (duplicate) continue;

          await messageService.logMessage({
            tenantId,
            conversationId: conversation.id,
            direction: msg.fromMe ? Direction.OUTBOUND : Direction.INBOUND,
            content: msg.body,
            waMessageId: msg.id,
            senderType: msg.fromMe ? 'BOT' : undefined,
            senderName: msg.fromMe ? 'Bot' : undefined,
          });
          chatSynced++;
        }

        syncedMessages += chatSynced;
        syncedChats++;
      }

      return {
        success: true,
        syncedChats,
        skippedChats,
        syncedMessages,
        totalChats,
        nextOffset: offset + batch.length,
        hasMore: offset + batch.length < totalChats,
      };
    } catch (err: any) {
      console.error('[WAHA SYNC] History sync failed:', err.message);
      return { success: false, syncedChats: 0, skippedChats: 0, syncedMessages: 0, totalChats: 0, nextOffset: offset, hasMore: false, error: err.message };
    }
  }
}

export const wahaHistorySyncService = new WahaHistorySyncService();

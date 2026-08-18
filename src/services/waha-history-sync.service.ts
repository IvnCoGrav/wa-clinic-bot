import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';
import { Direction } from '@prisma/client';
import { customerService } from './customer.service';
import { conversationService } from './conversation.service';
import { messageService } from './message.service';
import { getLiveChatHub } from './live-chat-hub.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { isDummyOrTestContact } from '../utils/dummy-filter';

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

export interface BackgroundSyncProgress {
  isSyncing: boolean;
  status: 'idle' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  syncedChats: number;
  skippedChats: number;
  syncedMessages: number;
  totalChats: number;
  currentChatName?: string;
  currentOffset: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

const DEFAULT_BATCH = 50;
const DEFAULT_MESSAGES_PER_CHAT = 100;

/**
 * Ekstraksi nama customer dari isi pesan/form reservasi jika kontak tidak memiliki pushname di WA
 */
function extractCustomerNameFromMessages(messages: { body: string; fromMe?: boolean }[]): string | undefined {
  for (const m of messages) {
    if (!m.body || m.fromMe) continue;
    const text = m.body;
    const match = text.match(/(?:Nama(?:\s+Bunda|\s+Moms|\s+Ibu|\s+Pasien|\s+Lengkap|\s+Pemesan)?\s*[:=]\s*)([A-Za-z\s'.]{3,35})/i);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (!/^(alamat|jadwal|tanggal|treatment|paket|pilihan|kelurahan|kecamatan|terapi|pijat|surabaya|sidoarjo)/i.test(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Sinkronisasi history chat dari WAHA ke DB bot (mirip WhatsApp Web):
 * - Ambil daftar chat dan contacts lengkap dari WAHA (matching by address book name & pushname).
 * - Per chat: resolusi LID -> nomor HP, upsert customer + conversation + messages.
 * - Dedupe by wa_message_id → aman dijalankan ulang (idempoten).
 * - Skip: grup (@g.us), broadcast, nomor sandbox test (6289999), chat tanpa nomor valid.
 * - Mendukung sinkronisasi penuh di latar belakang (Background Full Sync) dengan SSE progress.
 */
export class WahaHistorySyncService {
  private syncProgressMap = new Map<string, BackgroundSyncProgress>();
  private cancelFlags = new Map<string, boolean>();

  public getBackgroundSyncStatus(tenantId = DEFAULT_TENANT_ID): BackgroundSyncProgress {
    return (
      this.syncProgressMap.get(tenantId) || {
        isSyncing: false,
        status: 'idle',
        syncedChats: 0,
        skippedChats: 0,
        syncedMessages: 0,
        totalChats: 0,
        currentOffset: 0,
      }
    );
  }

  public stopBackgroundSync(tenantId = DEFAULT_TENANT_ID): boolean {
    const current = this.syncProgressMap.get(tenantId);
    if (!current || !current.isSyncing) return false;
    this.cancelFlags.set(tenantId, true);
    current.status = 'cancelled';
    current.isSyncing = false;
    this.publishProgress(tenantId, current);
    return true;
  }

  private publishProgress(tenantId: string, progress: BackgroundSyncProgress) {
    try {
      getLiveChatHub()
        .publish({
          type: 'sync.progress',
          tenantId,
          payload: { ...progress },
        })
        .catch(() => {});
    } catch (_) {}
  }

  public async startBackgroundFullSync(
    messagesPerChat = DEFAULT_MESSAGES_PER_CHAT,
    tenantId = DEFAULT_TENANT_ID
  ): Promise<{ started: boolean; message: string; progress: BackgroundSyncProgress }> {
    const current = this.getBackgroundSyncStatus(tenantId);
    if (current.isSyncing) {
      return {
        started: false,
        message: 'Sinkronisasi riwayat obrolan di latar belakang sedang berjalan.',
        progress: current,
      };
    }

    this.cancelFlags.set(tenantId, false);
    const initialProgress: BackgroundSyncProgress = {
      isSyncing: true,
      status: 'in_progress',
      syncedChats: 0,
      skippedChats: 0,
      syncedMessages: 0,
      totalChats: 0,
      currentOffset: 0,
      startedAt: new Date(),
    };
    this.syncProgressMap.set(tenantId, initialProgress);
    this.publishProgress(tenantId, initialProgress);

    // Jalankan loop sinkronisasi di background tanpa memblokir HTTP request
    void (async () => {
      try {
        console.log(`[WAHA BACKGROUND SYNC] Memulai sinkronisasi seluruh chat di background untuk tenant: ${tenantId}...`);

        // 1. Fetch seluruh contacts dari WAHA untuk matching nama buku telepon / pushname
        const contacts = await wahaClient.getAllContacts();
        const contactMap = new Map<string, string>();
        for (const c of contacts) {
          const contactName = (c.name || c.pushname || c.shortName || '').trim();
          if (!contactName) continue;
          const clean = (c.id || '').replace(/@.*$/, '');
          if (clean) {
            contactMap.set(clean, contactName);
            contactMap.set(`${clean}@c.us`, contactName);
            contactMap.set(`${clean}@s.whatsapp.net`, contactName);
          }
          if (c.id) contactMap.set(c.id, contactName);
        }

        const chats = await wahaClient.getChats();
        const totalChats = chats.length;
        initialProgress.totalChats = totalChats;
        this.publishProgress(tenantId, initialProgress);

        let offset = 0;
        const batchSize = 10; // Batch per 10 chat agar responsif & tidak membebani memori

        while (offset < totalChats) {
          if (this.cancelFlags.get(tenantId)) {
            console.log(`[WAHA BACKGROUND SYNC] Dibatalkan oleh admin pada offset ${offset}/${totalChats}`);
            initialProgress.status = 'cancelled';
            initialProgress.isSyncing = false;
            this.publishProgress(tenantId, initialProgress);
            return;
          }

          const batch = chats.slice(offset, offset + batchSize);
          for (const chat of batch) {
            if (this.cancelFlags.get(tenantId)) break;

            if (chat.id.includes('@g.us') || chat.id.includes('broadcast') || chat.id.includes('@newsletter')) {
              initialProgress.skippedChats++;
              continue;
            }

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
            if (!phone || isDummyOrTestContact(phone, chat.name)) {
              initialProgress.skippedChats++;
              continue;
            }

            const targetChatId = chat.id.includes('@lid') ? chat.id : `${phone}@c.us`;
            const rawMessages = await wahaClient.getMessages(targetChatId, messagesPerChat);
            const textMessages = (rawMessages || [])
              .filter((m) => m.body && typeof m.body === 'string' && m.body.trim().length > 0)
              .sort((a, b) => a.timestamp - b.timestamp);

            // Matching nama dari contacts buku telepon / pushname / chat name / form text
            let customerName = chat.name || contactMap.get(phone) || contactMap.get(chat.id) || undefined;
            if (!customerName) {
              try {
                const contact = await wahaClient.getContact(phone);
                customerName = (contact?.name || contact?.pushname || contact?.shortName || '').trim() || undefined;
              } catch (e) {}
            }
            if (!customerName) {
              customerName = extractCustomerNameFromMessages(textMessages);
            }

            initialProgress.currentChatName = customerName || phone;

            const customer = await customerService.getOrCreateCustomer(phone, customerName, tenantId, {
              skipFollowUpScheduling: true,
            });

            if (customerName && customerName !== customer.name) {
              try {
                await customerService.updateCustomerName(customer.id, customerName, tenantId);
                customer.name = customerName;
              } catch (e) {}
            }

            const conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);

            let chatSynced = 0;
            let latestMsgDate: Date | null = null;

            for (const msg of textMessages) {
              if (!msg.id) continue;

              let msgDate: Date | undefined = undefined;
              const rawTimestamp = (msg as any).timestamp ?? (msg as any).t ?? (msg as any)._data?.t ?? (msg as any).messageTimestamp;
              if (rawTimestamp) {
                const rawTs = Number(rawTimestamp);
                if (!isNaN(rawTs) && rawTs > 0) {
                  const ms = rawTs > 10000000000 ? rawTs : rawTs * 1000;
                  msgDate = new Date(ms);
                } else {
                  const d = new Date(rawTimestamp);
                  if (!isNaN(d.getTime())) msgDate = d;
                }
              }
              if (msgDate && (!latestMsgDate || msgDate > latestMsgDate)) {
                latestMsgDate = msgDate;
              }

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
                createdAt: msgDate,
                skipMqlEvaluation: true,
              });
              chatSynced++;
            }

            if (latestMsgDate) {
              try {
                await prisma.conversation.update({
                  where: { id: conversation.id },
                  data: {
                    last_message_at: latestMsgDate,
                    updated_at: latestMsgDate,
                  },
                });
                const memConv = conversationService.getMemoryConversations().find((c) => c.id === conversation.id);
                if (memConv) {
                  memConv.last_message_at = latestMsgDate;
                  memConv.updated_at = latestMsgDate;
                }
              } catch (_) {}
            }

            initialProgress.syncedMessages += chatSynced;
            initialProgress.syncedChats++;
          }

          offset += batchSize;
          initialProgress.currentOffset = offset;
          this.publishProgress(tenantId, initialProgress);

          // Jeda 50ms antar batch
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        initialProgress.status = 'completed';
        initialProgress.isSyncing = false;
        initialProgress.completedAt = new Date();
        this.publishProgress(tenantId, initialProgress);
        console.log(`[WAHA BACKGROUND SYNC] Selesai: ${initialProgress.syncedChats} chat disinkronkan (${initialProgress.syncedMessages} pesan baru).`);
      } catch (err: any) {
        console.error('[WAHA BACKGROUND SYNC ERROR]', err);
        initialProgress.status = 'failed';
        initialProgress.isSyncing = false;
        initialProgress.error = err.message;
        this.publishProgress(tenantId, initialProgress);
      }
    })();

    return {
      started: true,
      message: 'Sinkronisasi riwayat obrolan di latar belakang berhasil dimulai.',
      progress: initialProgress,
    };
  }

  public async syncChats(
    limit = DEFAULT_BATCH,
    offset = 0,
    messagesPerChat = DEFAULT_MESSAGES_PER_CHAT,
    tenantId = DEFAULT_TENANT_ID
  ): Promise<WahaHistorySyncResult> {
    try {
      const contacts = await wahaClient.getAllContacts();
      const contactMap = new Map<string, string>();
      for (const c of contacts) {
        const contactName = (c.name || c.pushname || c.shortName || '').trim();
        if (!contactName) continue;
        const clean = (c.id || '').replace(/@.*$/, '');
        if (clean) {
          contactMap.set(clean, contactName);
          contactMap.set(`${clean}@c.us`, contactName);
          contactMap.set(`${clean}@s.whatsapp.net`, contactName);
        }
        if (c.id) contactMap.set(c.id, contactName);
      }

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

        const targetChatId = chat.id.includes('@lid') ? chat.id : `${phone}@c.us`;
        const rawMessages = await wahaClient.getMessages(targetChatId, messagesPerChat);
        const textMessages = (rawMessages || [])
          .filter((m) => m.body && typeof m.body === 'string' && m.body.trim().length > 0)
          .sort((a, b) => a.timestamp - b.timestamp);

        // Matching nama dari contacts buku telepon / pushname / chat name / form text
        let customerName = chat.name || contactMap.get(phone) || contactMap.get(chat.id) || undefined;
        if (!customerName) {
          try {
            const contact = await wahaClient.getContact(phone);
            customerName = (contact?.name || contact?.pushname || contact?.shortName || '').trim() || undefined;
          } catch (e) {}
        }
        if (!customerName) {
          customerName = extractCustomerNameFromMessages(textMessages);
        }

        const customer = await customerService.getOrCreateCustomer(phone, customerName, tenantId, {
          skipFollowUpScheduling: true, // history lama tidak boleh memicu follow-up baru
        });

        // Backfill nama customer lama yang masih kosong (data hasil sync sebelumnya)
        if (customerName && customerName !== customer.name) {
          try {
            await customerService.updateCustomerName(customer.id, customerName, tenantId);
            customer.name = customerName;
          } catch (e) {
            // abaikan — nama tidak wajib
          }
        }
        const conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);

        let chatSynced = 0;
        let latestMsgDate: Date | null = null;

        for (const msg of textMessages) {
          if (!msg.id) continue;

          let msgDate: Date | undefined = undefined;
          const rawTimestamp = (msg as any).timestamp ?? (msg as any).t ?? (msg as any)._data?.t ?? (msg as any).messageTimestamp;
          if (rawTimestamp) {
            const rawTs = Number(rawTimestamp);
            if (!isNaN(rawTs) && rawTs > 0) {
              const ms = rawTs > 10000000000 ? rawTs : rawTs * 1000;
              msgDate = new Date(ms);
            } else {
              const d = new Date(rawTimestamp);
              if (!isNaN(d.getTime())) msgDate = d;
            }
          }
          if (msgDate && (!latestMsgDate || msgDate > latestMsgDate)) {
            latestMsgDate = msgDate;
          }

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
            createdAt: msgDate,
            skipMqlEvaluation: true,
          });
          chatSynced++;
        }

        // Sinkronkan waktu percakapan (last_message_at & updated_at) dengan waktu asli pesan terakhir WhatsApp
        if (latestMsgDate) {
          try {
            await prisma.conversation.update({
              where: { id: conversation.id },
              data: {
                last_message_at: latestMsgDate,
                updated_at: latestMsgDate,
              },
            });
            const memConv = conversationService.getMemoryConversations().find((c) => c.id === conversation.id);
            if (memConv) {
              memConv.last_message_at = latestMsgDate;
              memConv.updated_at = latestMsgDate;
            }
          } catch (_) {}
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

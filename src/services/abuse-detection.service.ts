import { prisma } from '../db/client';
import { ConversationState } from '@prisma/client';
import { customerService } from './customer.service';
import { conversationService } from './conversation.service';

export class AbuseDetectionService {
  // Ambang batas abuse — env-drivable (Fase 4.3 docs/HARDCODED_FIX_PLAN.md)
  private readonly FLOOD_LIMIT = parseInt(process.env.FLOOD_LIMIT || '10', 10);
  private readonly FLOOD_WINDOW_MS = parseInt(process.env.FLOOD_WINDOW_MS || '60000', 10);
  private readonly SPAM_DUPLICATE_LIMIT = parseInt(process.env.SPAM_DUPLICATE_LIMIT || '5', 10);

  // Melacak timestamp pesan masuk per phone untuk deteksi flood (sliding window)
  private messageTimestamps: Map<string, number[]> = new Map();

  // Melacak histori pesan terakhir untuk deteksi spam pesan identik berulang
  private lastMessages: Map<string, string[]> = new Map();

  // Regex pencocokan kata kasar (word boundary match)
  private readonly PROFANITY_REGEX = /\b(asu|anjing|bangsat|tolol|goblok|babi|kontol|memek|jembut)\b/i;

  // Regex pencocokan link URL umum
  private readonly URL_REGEX = /https?:\/\/[^\s]+/i;

  /**
   * Mengecek apakah pesan masuk memicu salah satu kriteria abuse (flood, uninvited link, repetitive spam),
   * melakukan auto-block jika terdeteksi, atau flagging review untuk sinyal ambigu.
   */
  public async checkAndProcessAbuse(
    customer: any,
    conversation: any,
    messageBody: string,
    tenantId: string
  ): Promise<{ blocked: boolean; flagged: boolean; reason?: string }> {
    const phone = customer.phone;
    const now = Date.now();
    const cleanMessage = (messageBody || '').trim();

    // 1. TRIGGER FLOOD: >FLOOD_LIMIT pesan dalam FLOOD_WINDOW_MS dari nomor yang sama
    const timestamps = this.messageTimestamps.get(phone) || [];
    timestamps.push(now);
    
    // Filter hanya timestamp dalam FLOOD_WINDOW_MS terakhir
    const activeTimestamps = timestamps.filter(t => now - t <= this.FLOOD_WINDOW_MS);
    this.messageTimestamps.set(phone, activeTimestamps);

    if (activeTimestamps.length > this.FLOOD_LIMIT) {
      await this.applyAutoBlock(customer.id, phone, 'flood', tenantId);
      return { blocked: true, flagged: false, reason: 'flood' };
    }

    // 2. TRIGGER UNINVITED LINK: Mengirim URL selain Google Maps sebelum AWAITING_INTEREST/RESERVATION_SENT/COMPLETED
    const containsUrl = this.URL_REGEX.test(cleanMessage);
    if (containsUrl) {
      const isMapsUrl = cleanMessage.includes('maps.google.com') || 
                        cleanMessage.includes('maps.app.goo.gl') || 
                        cleanMessage.includes('google.com/maps');

      if (!isMapsUrl) {
        // Cek state saat ini
        const state = conversation.current_state;
        const isBeforeInterest = [
          ConversationState.INITIAL,
          ConversationState.AWAITING_LOCATION,
          ConversationState.LOCATION_CONFIRMED
        ].includes(state);

        if (isBeforeInterest) {
          await this.applyAutoBlock(customer.id, phone, 'uninvited_link', tenantId);
          return { blocked: true, flagged: false, reason: 'uninvited_link' };
        }
      }
    }

    // 3. TRIGGER PESAN IDENTIK BERULANG: >=SPAM_DUPLICATE_LIMIT pesan dengan konten persis sama berurutan saat human handling
    if (conversation.is_human_handling) {
      const history = this.lastMessages.get(phone) || [];
      history.push(cleanMessage.toLowerCase());
      
      // Batasi hanya melacak SPAM_DUPLICATE_LIMIT pesan terakhir
      if (history.length > this.SPAM_DUPLICATE_LIMIT) {
        history.shift();
      }
      this.lastMessages.set(phone, history);

      if (history.length === this.SPAM_DUPLICATE_LIMIT && history.every(msg => msg === history[0] && msg.length > 0)) {
        await this.applyAutoBlock(customer.id, phone, 'repetitive_spam', tenantId);
        return { blocked: true, flagged: false, reason: 'repetitive_spam' };
      }
    } else {
      // Jika tidak dalam mode human handling, tetap simpan history tetapi bersihkan jika state berubah
      this.lastMessages.delete(phone);
    }

    // 4. SINYAL AMBIGU (Flagging): Deteksi kata kasar menggunakan word boundary match
    const isProfane = this.PROFANITY_REGEX.test(cleanMessage);
    if (isProfane) {
      console.warn(`[ABUSE FLAGGED] Conversation ${conversation.id} flagged for review due to profanity: "${cleanMessage}"`);
      try {
        await prisma.conversation.updateMany({
          where: { id: conversation.id, tenant_id: tenantId },
          data: { review_flagged: true },
        });
      } catch (err) {
        // Fallback memory mode
        conversation.review_flagged = true;
      }
      return { blocked: false, flagged: true };
    }

    return { blocked: false, flagged: false };
  }

  /**
   * Menerapkan status blocked secara atomik ke customer di database/memory fallback
   */
  private async applyAutoBlock(customerId: string, phone: string, reason: string, tenantId: string) {
    console.warn(`[ABUSE DETECTED] Auto-blocking customer ${phone} (ID: ${customerId}) for reason: ${reason}`);
    
    try {
      await prisma.customer.updateMany({
        where: { id: customerId, tenant_id: tenantId },
        data: {
          status: 'blocked',
          block_reason: reason,
          blocked_at: new Date(),
        },
      });
    } catch (err) {
      // Fallback update in memory jika DB offline
      await customerService.blockCustomer(customerId, reason, tenantId);
    }
  }
}

export const abuseDetectionService = new AbuseDetectionService();

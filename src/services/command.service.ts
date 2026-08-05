import { ConversationState } from '@prisma/client';
import { StateHandlerContext } from '../state-machine/types';
import { customerService } from './customer.service';
import { conversationService } from './conversation.service';
import { messageService } from './message.service';
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * CommandService — menangani perintah slash yang diketik customer langsung di chat
 * (mis. /reset, /state, /mulai). Semua command di-handle di SATU titik interceptor:
 * state machine (machine.processMessage) agar konsisten untuk semua jalur pesan masuk
 * (webhook WAHA, WABA, maupun CLI simulator).
 *
 * Scope SEMUA command adalah PER-CUSTOMER (hanya data milik nomor/chat yang sedang
 * berbicara ini), TIDAK pernah menyentuh customer lain. Perintah bersifat verbatim —
 * hanya text yang seluruhnya berupa command (trimmed + lowercase) yang dianggap command.
 *
 * Copy balasan di sini hardcoded Indonesia (konsisten dgn CLI command lain). Untuk
 * multi-brand/tenant-aware selanjutnya, copy ini bisa dipindah ke tabel per-tenant.
 */
export interface CommandResult {
  /** Teks balasan yang dikirim ke customer. */
  replyText: string;
  /** conversationId tempat balasan OUTBOUND di-log. Untuk hard wipe ini conversation baru hasil recreate. */
  conversationId: string;
  /** nextState yang dikembalikan ke state machine (default INITIAL). */
  nextState?: ConversationState;
}

const RESET_PENDING_TTL_MS = 5 * 60 * 1000; // 5 menit
const CONFIRM_KEYWORDS = new Set(['ya', 'y', 'yes', 'konfirmasi', 'konfirm', 'setuju', 'iya', 'ya reset', 'iya reset']);

const RESET_CONFIRM_REPLY =
  'Bunda, perintah ini akan menghapus *seluruh riwayat chat & data reservasi* nomor ini ' +
  'secara permanen. Balas *YA* untuk mengonfirmasi, atau ketik pesan lain untuk membatalkan.';

const RESET_DONE_REPLY =
  'Perintah dijalankan. Seluruh riwayat chat dan data reservasi nomor ini sudah dihapus. ' +
  'Silakan mulai dari awal — ketik *Halo* untuk memulai percakapan baru. 😊';

const START_OVER_FALLBACK =
  'Baik Bunda, kita mulai dari awal. Silakan ketik *Halo* untuk memulai percakapan baru. 😊';

export class CommandService {
  /** Daftar konfirmasi /reset yang menunggu balasan YA (key: customer id). */
  private pendingResets = new Map<string, { expiresAt: number }>();

  /**
   * Deteksi apakah pesan berupa perintah slash (diawali "/"). Dipakai juga oleh
   * burst-coalesce guard supaya perintah tidak ter-merge dengan pesan lain.
   */
  public isCommandText(text: string): boolean {
    return /^\/[a-z]/.test(text.trim().toLowerCase());
  }

  /**
   * Titik masuk utama dari state machine. Mengembalikan CommandResult untuk diproses
   * (kirim balasan) atau null jika pesan bukan perintah / tidak perlu penanganan khusus.
   */
  public async tryHandle(ctx: StateHandlerContext, tenantId?: string): Promise<CommandResult | null> {
    const text = (ctx.incomingMessage?.text?.body || '').trim().toLowerCase();
    if (!text) return null;

    const { customer, conversation } = ctx;
    const tId = tenantId || customer.tenant_id || DEFAULT_TENANT_ID;

    // 1. Konfirmasi /reset pending (balasan YA) → eksekusi hard wipe.
    const pending = this.pendingResets.get(customer.id);
    if (pending) {
      this.pendingResets.delete(customer.id); // konsumsi sekali pakai
      if (pending.expiresAt >= Date.now() && CONFIRM_KEYWORDS.has(text)) {
        const newConversationId = await this.hardWipe(customer, conversation, tId);
        return { replyText: RESET_DONE_REPLY, conversationId: newConversationId };
      }
      // Bukan keyword konfirmasi (atau sudah expired) → batal, proses ulang sebagai pesan biasa.
      return null;
    }

    switch (text) {
      case '/reset':
      case '/reset konfirm':
        this.pendingResets.set(customer.id, { expiresAt: Date.now() + RESET_PENDING_TTL_MS });
        return { replyText: RESET_CONFIRM_REPLY, conversationId: conversation.id };

      case '/state':
        return { replyText: this.buildStateInfo(customer, conversation), conversationId: conversation.id };

      case '/mulai':
      case '/start':
        return this.startOver(ctx, tId);

      default:
        return null;
    }
  }

  /**
   * HARD WIPE: menghapus seluruh data milik customer ini (chat+reservasi+child+follow-up)
   * lewat cascade delete. Best-effort untuk side-effect eksternal (Google Calendar, staging,
   * label WAHA, memory store) supaya tidak meninggalkan orphan.
   */
  private async hardWipe(customer: any, conversation: any, tenantId: string): Promise<string> {
    const phone = customer.phone;
    const name = customer.name;
    const wasSandbox = !!customer.is_sandbox_test;

    // 1. Cancel event Google Calendar milik reservasi (cegah orphan).
    try {
      const reservations = await prisma.reservation.findMany({
        where: { customer_id: customer.id, tenant_id: tenantId, google_calendar_event_id: { not: null } },
        select: { google_calendar_event_id: true },
      });
      const { googleCalendarService } = await import('./google-calendar.service');
      for (const r of reservations) {
        if (r.google_calendar_event_id) {
          googleCalendarService.deleteEvent(r.google_calendar_event_id).catch(() => {});
        }
      }
    } catch (err: any) {
      console.warn('[COMMAND /reset] Gagal cancel Google Calendar event:', err.message);
    }

    // 2. Hapus staging yang tersangkut di conversation ini (tidak punya relasi FK).
    try {
      await prisma.medicalFaqStaging.deleteMany({ where: { conversation_id: conversation.id } });
    } catch (err: any) {
      console.warn('[COMMAND /reset] Gagal hapus MedicalFaqStaging:', err.message);
    }
    try {
      await prisma.generalFaqStaging.deleteMany({ where: { conversation_id: conversation.id } });
    } catch (err: any) {
      console.warn('[COMMAND /reset] Gagal hapus GeneralFaqStaging:', err.message);
    }

    // 3. Hard-delete customer → cascade bereskan Conversation/Message/Reservation/Child/FollowUp.
    try {
      await prisma.customer.delete({ where: { id: customer.id } });
    } catch (err: any) {
      console.warn('[COMMAND /reset] Hard-delete customer gagal (DB offline?):', err.message);
    }

    // 4. Bersihkan snapshot di memory fallback store.
    customerService.clearCustomerMemory(phone);
    conversationService.clearConversationMemory(customer.id);
    messageService.clearMessageMemory(conversation.id);

    // 5. Lepas label lifecycle WAHA (best-effort).
    try {
      const { wahaClient } = await import('../integrations/waha/client');
      const chatId = `${phone}@c.us`;
      for (const label of ['hold', 'pending payment', 'repeat', 'new customer']) {
        wahaClient.removeLabel(chatId, label).catch(() => {});
      }
    } catch (err: any) {
      console.warn('[COMMAND /reset] Gagal lepas label WAHA:', err.message);
    }

    // 6. Re-create customer + conversation sebagai rumah bagi balasan konfirmasi.
    // Propagasikan flag is_sandbox_test agar jalur test tidak mencemari data asli.
    const newCustomer = await customerService.getOrCreateCustomer(phone, name, tenantId);
    if (wasSandbox && !newCustomer.is_sandbox_test) {
      try {
        await prisma.customer.update({
          where: { id: newCustomer.id },
          data: { is_sandbox_test: true },
        });
        newCustomer.is_sandbox_test = true;
      } catch (err: any) {
        console.warn('[COMMAND /reset] Propagasi is_sandbox_test gagal:', err.message);
      }
    }
    const newConversation = await conversationService.getOrCreateConversation(newCustomer.id, tenantId);
    return newConversation.id;
  }

  /** /mulai — restart percakapan ke state awal (tanpa menghapus data) + tampilkan greeting persona. */
  private async startOver(ctx: StateHandlerContext, tenantId: string): Promise<CommandResult> {
    const { customer, conversation } = ctx;

    try {
      await conversationService.updateConversationState(
        conversation.id,
        {
          currentState: ConversationState.INITIAL,
          previousState: null,
          locationAttempts: 0,
          isHumanHandling: false,
          humanHandlingSince: null,
        },
        tenantId
      );
      await customerService.resetFullLocation(customer.id, tenantId);
    } catch (err: any) {
      console.warn('[COMMAND /mulai] Reset state/lokasi gagal:', err.message);
    }

    // Reuse greeting handler utk reply persona asli (tenant-aware). Fresh snapshot tanpa lokasi.
    try {
      const { handleGreetingState } = await import('../state-machine/handlers/greeting');
      const freshCustomer = { ...customer, kelurahan: null, kecamatan: null, lat: null, lng: null };
      const freshConversation = {
        ...conversation,
        current_state: ConversationState.INITIAL,
        previous_state: null,
        is_human_handling: false,
        last_message_at: new Date(),
        created_at: conversation.created_at || new Date(),
      };
      const result = await handleGreetingState({
        ...ctx,
        tenantId,
        customer: freshCustomer,
        conversation: freshConversation,
      });
      return {
        replyText: result.replyText || START_OVER_FALLBACK,
        conversationId: conversation.id,
        nextState: result.nextState || ConversationState.AWAITING_LOCATION,
      };
    } catch (err: any) {
      console.warn('[COMMAND /mulai] Gagal generate greeting, fallback teks statis:', err.message);
      return { replyText: START_OVER_FALLBACK, conversationId: conversation.id };
    }
  }

  /** /state — info internal percakapan (debug). */
  private buildStateInfo(customer: any, conversation: any): string {
    const lines = [
      '─ [INTERNAL STATE] ─',
      `Current : ${conversation.current_state}`,
      `Previous: ${conversation.previous_state || 'null'}`,
      `Attempts: ${conversation.location_attempts ?? 0}`,
      `Human   : ${conversation.is_human_handling ? 'Ya' : 'Tidak'}`,
      `Coverage: ${customer.is_out_of_coverage ? 'LUAR JANGKAUAN' : 'Dalam jangkauan'}`,
    ];
    return lines.join('\n');
  }
}

export const commandService = new CommandService();
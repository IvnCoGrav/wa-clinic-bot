import { ConversationState } from '@prisma/client';
import { StateHandlerContext } from '../state-machine/types';
import { customerService } from './customer.service';
import { conversationService } from './conversation.service';
import { messageService } from './message.service';
import { prisma } from '../db/client';
import { getConversationRepository } from '../repositories/conversation.repository';
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
  'Bunda, perintah ini akan mengarsipkan riwayat chat & data reservasi nomor ini ' +
  '(data tidak dihapus permanen dan masih dapat dipulihkan oleh admin). ' +
  'Balas *YA* untuk mengonfirmasi, atau ketik pesan lain untuk membatalkan.';

const RESET_DONE_REPLY =
  'Perintah dijalankan. Riwayat chat dan data reservasi nomor ini telah diarsipkan ' +
  'dan percakapan dimulai dari awal. Silakan ketik *Halo* untuk memulai percakapan baru. 😊';

const START_OVER_FALLBACK =
  'Baik Bunda, kita mulai dari awal. Silakan ketik *Halo* untuk memulai percakapan baru. 😊';

export class CommandService {
  /**
   * Apakah percakapan sedang menunggu konfirmasi /reset. Status disimpan di
   * `Conversation.session_data.reset_pending_at` (persisten, per tenant), BUKAN
   * variabel proses: app & worker / beberapa replika harus melihat status yang sama.
   */
  public isResetConfirmationPending(conversation: any, now: number = Date.now()): boolean {
    const raw = conversation?.session_data?.reset_pending_at;
    const at = raw ? Date.parse(String(raw)) : NaN;
    return Number.isFinite(at) && at > 0 && now - at <= RESET_PENDING_TTL_MS;
  }

  private hasResetPendingField(conversation: any): boolean {
    return Boolean(conversation?.session_data?.reset_pending_at);
  }

  /** Tulis/hapus penanda konfirmasi /reset (merge utuh dengan session_data lain). */
  private async writeResetPending(conversation: any, tenantId: string, atIso: string | null): Promise<void> {
    const base =
      conversation?.session_data && typeof conversation.session_data === 'object'
        ? { ...(conversation.session_data as any) }
        : {};
    if (atIso) base.reset_pending_at = atIso;
    else delete base.reset_pending_at;
    // Mutasi snapshot dulu: bila DB sedang offline, service tetap konsisten dalam
    // proses ini (degradasi jujur) alih-alih kehilangan status konfirmasi.
    conversation.session_data = base;
    try {
      await getConversationRepository().updateState(conversation.id, { sessionData: base }, tenantId);
    } catch (err: any) {
      console.warn('[COMMAND /reset] Gagal menyimpan status konfirmasi (DB):', err?.message || err);
    }
  }

  /**
   * Deteksi apakah pesan berupa perintah slash (diawali "/"). Dipakai juga oleh
   * burst-coalesce guard supaya perintah tidak ter-merge dengan pesan lain.
   */
  public getResetConfirmReply(salutation: string = 'Bunda'): string {
    return (
      `${salutation}, perintah ini akan mengarsipkan riwayat chat & data reservasi nomor ini ` +
      '(data tidak dihapus permanen dan masih dapat dipulihkan oleh admin). ' +
      'Balas *YA* untuk mengonfirmasi, atau ketik pesan lain untuk membatalkan.'
    );
  }

  public getStartOverReply(salutation: string = 'Bunda'): string {
    return `Baik ${salutation}, kita mulai dari awal. Silakan ketik *Halo* untuk memulai percakapan baru. 😊`;
  }

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

    // `ctx.conversation` berasal dari job yang SELALU di-re-fetch dari DB oleh
    // queue consumer sebelum state machine berjalan, jadi session_data di sini
    // sudah segar (tidak perlu query tambahan per pesan).
    const currentConversation = conversation;

    // 1. Konfirmasi /reset pending (balasan YA) → eksekusi soft wipe.
    if (this.isResetConfirmationPending(currentConversation)) {
      // Konsumsi sekali pakai SEBELUM aksi, sehingga retry pesan yang sama
      // tidak memicu wipe kedua.
      await this.writeResetPending(currentConversation, tId, null);
      if (CONFIRM_KEYWORDS.has(text)) {
        const newConversationId = await this.hardWipe(customer, currentConversation, tId);
        return { replyText: RESET_DONE_REPLY, conversationId: newConversationId };
      }
      // Bukan keyword konfirmasi → batal, proses ulang sebagai pesan biasa.
      return null;
    }

    // Sisa penanda kedaluwarsa dibersihkan agar session_data tidak menumpuk.
    if (this.hasResetPendingField(currentConversation)) {
      await this.writeResetPending(currentConversation, tId, null);
    }

    switch (text) {
      case '/reset':
      case '/reset konfirm': {
        await this.writeResetPending(currentConversation, tId, new Date().toISOString());
        const { getBrandIdentityAsync } = await import('../config/brand');
        const brand = await getBrandIdentityAsync(tId);
        const salutation = brand.addressTermForCustomer || 'Bunda';
        return { replyText: this.getResetConfirmReply(salutation), conversationId: currentConversation.id };
      }

      case '/state':
        // SEC-AUDIT-14: /state membocorkan state machine internal. Hanya
        // diizinkan untuk nomor yang ditandai admin (is_admin_labeled) atau di
        // luar produksi (dev/CLI). Selain itu → diabaikan sebagai pesan biasa.
        if (process.env.NODE_ENV === 'production' && !customer.is_admin_labeled) {
          return null;
        }
        return { replyText: this.buildStateInfo(customer, conversation), conversationId: conversation.id };

      case '/mulai':
      case '/start':
        return this.startOver(ctx, tId);

      default:
        return null;
    }
  }

  /**
   * SOFT WIPE (SEC-AUDIT-14): mengarsipkan data customer ini dengan menandai
   * `deleted_at` — TIDAK ada DELETE fisik. Riwayat chat/reservasi/anak tetap
   * tersimpan (dapat dipulihkan admin), lalu sesi dimulai ulang dengan
   * percakapan baru. Side-effect eksternal (Google Calendar, staging, memory)
   * tetap dibersihkan best-effort.
   */
  private async hardWipe(customer: any, conversation: any, tenantId: string): Promise<string> {
    const phone = customer.phone;
    const name = customer.name;

    // 1. Cancel event Google Calendar milik reservasi (cegah orphan).
    try {
      const reservations = await prisma.reservation.findMany({
        where: { customer_id: customer.id, tenant_id: tenantId, google_calendar_event_id: { not: null } },
        select: { google_calendar_event_id: true },
      });
      const { googleCalendarService } = await import('./google-calendar.service');
      for (const r of reservations) {
        if (r.google_calendar_event_id) {
          googleCalendarService.deleteEvent(r.google_calendar_event_id, tenantId).catch(() => {});
        }
      }
    } catch (err: any) {
      console.warn('[COMMAND /reset] Gagal cancel Google Calendar event:', err.message);
    }

    // 2. Hapus staging yang tersangkut di conversation ini (data sementara, bukan medis).
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

    // 3. SOFT-DELETE: tandai arsip, BUKAN delete. Data medis tetap utuh.
    try {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { deleted_at: new Date(), status: 'archived' },
      });
    } catch (err: any) {
      console.warn('[COMMAND /reset] Soft-delete customer gagal (DB offline?):', err.message);
    }

    // 4. Bersihkan snapshot di memory fallback store.
    customerService.clearCustomerMemory(phone);
    conversationService.clearConversationMemory(customer.id);
    messageService.clearMessageMemory(conversation.id);

    // 5. Mandat Anti-Label WAHA: label lifecycle di-reset via DB internal, zero WAHA label mutation
    console.log(`[COMMAND /reset] DB-only label lifecycle reset, zero WAHA label mutation.`);

    // 6. Percakapan BARU sebagai rumah bagi balasan konfirmasi (yang lama tetap
    //    terarsip di DB). D-01: Tutup percakapan aktif lama terlebih dahulu agar partial unique terjaga.
    let newConversationId: string;
    try {
      const convRepo = getConversationRepository();
      await convRepo.closeActiveConversation(customer.id, tenantId);
      const created = await convRepo.getOrCreate(customer.id, tenantId);
      newConversationId = created.id;
      conversationService.clearConversationMemory(customer.id);
    } catch {
      const fallback = await conversationService.getOrCreateConversation(customer.id, tenantId);
      newConversationId = fallback.id;
    }
    return newConversationId;
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

    // Return template greeting resmi Kala Spa
    try {
      const { TEMPLATES } = await import('../config/persona');
      return {
        replyText: TEMPLATES.greeting(),
        conversationId: conversation.id,
        nextState: ConversationState.INITIAL,
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
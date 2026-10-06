import { prisma } from '../db/client';
import { ConversationState } from '@prisma/client';
import { clinicConfig } from '../config/clinic';
import { getLiveChatHub } from './live-chat-hub.service';
import { AI_ELIGIBILITY_ESCALATION_REASON, ACTIVE_APPOINTMENT_ESCALATION_REASON } from './ai-eligibility.service';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import { hasBypassLabel } from '../utils/customer-bypass';
import { activeReservationWhere, isActiveReservation } from '../domain/reservation-status';

const memoryConversations = new Map<string, any>();

/**
 * Fase C1 (Rencana Perbaikan Opsi C) — SATU definisi "jam aktivitas customer".
 * Sumber kanonis = pesan MASUK terakhir (`last_customer_message_at`), dengan
 * fallback ke `last_message_at` HANYA bila kolom baru belum terisi (data lawas).
 * Tujuan: pesan keluar bot (follow-up/pengingat) TIDAK boleh menghidupkan
 * percakapan tidur, dan idle reset tidak boleh memakai kronologi yang tercampur.
 */
export function getLastCustomerActivityMs(conversation: any): number {
  if (!conversation) return 0;
  const raw = conversation.last_customer_message_at ?? conversation.last_message_at;
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function buildConversationUpdatedPayload(conversation: any) {
  return {
    conversationId: conversation.id,
    currentState: conversation.current_state,
    previousState: conversation.previous_state ?? null,
    isHumanHandling: !!conversation.is_human_handling,
    humanHandlingSince: conversation.human_handling_since ?? null,
    escalationReason: conversation.escalation_reason ?? null,
    lastMessageAt: conversation.last_message_at ?? null,
    customerId: conversation.customer_id,
    isPinned: !!conversation.is_pinned,
    pinnedAt: conversation.pinned_at ?? null,
    isManualUnread: !!conversation.is_manual_unread,
    isSandboxTest: Boolean(conversation.customer?.is_sandbox_test),
    // Pulse alert SLA: status frustrasi disiarkan dalam SATU bentuk payload
    // standar agar frontend tidak perlu event/shape kedua.
    isFrustrated: !!conversation.is_frustrated,
    frustratedAt: conversation.frustrated_at ?? null,
    frustratedReason: conversation.frustrated_reason ?? null,
  };
}

export class ConversationService {
  /** F4.4b: guard idempoten peringatan pra-auto-release (in-memory, per proses). */
  private autoReleaseWarned = new Set<string>();

  /**
   * Cari conversation aktif milik customer, atau buat baru dengan state INITIAL jika belum ada.
   */
  public async getOrCreateConversation(customerId: string, tenantId: string): Promise<any> {
    // PLAN 8 FASE 5b: persistensi via Repository seam (fail-closed di produksi).
    const repo = (await import('../repositories/conversation.repository')).getConversationRepository();
    const conversation = await repo.getOrCreate(customerId, tenantId);
    memoryConversations.set(conversation.id, conversation);
    return conversation;
  }

  /**
   * Hapus snapshot conversation milik customer dari memory fallback store (dipakai saat
   * hard wipe /reset supaya tidak menyisakan snapshot stale di memori).
   */
  public clearConversationMemory(customerId: string): void {
    for (const [id, conv] of Array.from(memoryConversations.entries())) {
      if (conv && conv.customer_id === customerId) {
        memoryConversations.delete(id);
      }
    }
  }

  /**
   * Cari conversation by id (dengan memory store fallback saat DB offline).
   */
  public async getConversationById(id: string, tenantId: string): Promise<any> {
    // PLAN 8 FASE 5b: baca via Repository (fail-closed); cache baca dipertahankan.
    const repo = (await import('../repositories/conversation.repository')).getConversationRepository();
    try {
      const conv = await repo.findById(id, tenantId);
      return conv || memoryConversations.get(id) || null;
    } catch (error) {
      console.warn('[Conversation Service] getConversationById DB error (fail-closed, cek cache baca):', (error as Error)?.message);
      return memoryConversations.get(id) || null;
    }
  }

  /**
   * Sematkan / lepas sematan percakapan (Pin/Unpin).
   */
  public async togglePinConversation(conversationId: string, tenantId: string, isPinned?: boolean): Promise<any> {
    const current = await this.getConversationById(conversationId, tenantId);
    const nextPinned = typeof isPinned === 'boolean' ? isPinned : !current?.is_pinned;
    const now = nextPinned ? new Date() : null;

    try {
      const updated = await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          is_pinned: nextPinned,
          pinned_at: now,
        },
      });
      memoryConversations.set(conversationId, updated);
      return updated;
    } catch (error) {
      if (current) {
        current.is_pinned = nextPinned;
        current.pinned_at = now;
        memoryConversations.set(conversationId, current);
        return current;
      }
      return null;
    }
  }

  /**
   * Set status manual unread percakapan.
   */
  public async setManualUnread(conversationId: string, tenantId: string, isManualUnread: boolean): Promise<any> {
    const current = await this.getConversationById(conversationId, tenantId);
    try {
      const updated = await prisma.conversation.update({
        where: { id: conversationId },
        data: { is_manual_unread: isManualUnread },
      });
      memoryConversations.set(conversationId, updated);
      return updated;
    } catch (error) {
      if (current) {
        current.is_manual_unread = isManualUnread;
        memoryConversations.set(conversationId, current);
        return current;
      }
      return null;
    }
  }

  /**
   * Padamkan peringatan SLA/frustrasi secara manual (aksi admin 1-klik tanpa
   * mengetik pesan ke pasien). Idempoten; siarkan conversation.updated dengan
   * isFrustrated:false ke seluruh dashboard via SSE.
   */
  public async dismissFrustration(conversationId: string, tenantId: string): Promise<any> {
    const current = await this.getConversationById(conversationId, tenantId);
    if (!current) return null;
    let updated: any = current;
    try {
      updated = await prisma.conversation.update({
        where: { id: conversationId },
        data: { is_frustrated: false, frustrated_at: null, frustrated_reason: null },
      });
    } catch (error) {
      // Fallback memory store saat DB offline: tetap padamkan agar UI konsisten.
      updated = { ...current, is_frustrated: false, frustrated_at: null, frustrated_reason: null };
    }
    memoryConversations.set(conversationId, updated);
    this.publishConversationUpdated(updated, tenantId);
    return updated;
  }

  /**
   * Daftar percakapan per tenant dengan paging offset (dengan memory store fallback saat DB offline).
   * Urutan: Pinned chat paling atas (aksi eksplisit admin), lalu semua chat by last_message_at desc (waktu absolut jam chat masuk).
   */
  public async listConversations(
    tenantId: string,
    take = 50,
    offset = 0,
    mode: 'all' | 'real' | 'sandbox' = 'all',
    search?: string,
    label?: string,
    filter: 'all' | 'unread' | 'reservation' = 'all',
    staffId?: string
  ): Promise<any[]> {
    try {
      const where: any = {
        tenant_id: tenantId,
        messages: { some: {} },
      };

      // 1. Isolasi sandbox vs real — satu objek `customer` agar bisa digabung
      //    dengan kondisi reservasi tanpa saling menimpa.
      const customerWhere: any = {};
      if (mode === 'sandbox') {
        customerWhere.is_sandbox_test = true;
      } else if (mode === 'real' || (process.env.NODE_ENV === 'production' && mode === 'all')) {
        customerWhere.is_sandbox_test = false;
      }

      // 2. Filter reservasi aktif — paritas semantik dengan LiveChatMonitor:
      //    confirmed | en_route | pending (hanya bila booking_date null ATAU
      //    dalam jendela 2 jam) | hold (hanya booking_date dalam jendela 2 jam).
      //    Satu sumber kebenaran bentuk query ada di domain activeReservationWhere().
      if (filter === 'reservation') {
        const reservationWhere: any = activeReservationWhere();
        // Filter bidan bertugas (hanya relevan di tab reservasi). Nilai yang
        // dikenal: 'all' | 'unassigned' | {staffId}. ID tak dikenal → fail-closed
        // (tidak ada hasil) agar tidak bocor lintas tenant, kecuali 'unassigned'
        // yang memang khusus assigned_staff_id null.
        if (staffId && staffId !== 'all') {
          reservationWhere.assigned_staff_id = staffId === 'unassigned' ? null : staffId;
        }
        customerWhere.reservations = { some: reservationWhere };
      }
      if (Object.keys(customerWhere).length > 0) where.customer = customerWhere;

      // 3. Kondisi gabungan via AND eksplisit — anti-overwrite antar OR
      //    (search OR + unread OR harus berdampingan, bukan saling menimpa).
      const andClauses: any[] = [];

      if (search && search.trim()) {
        const query = search.trim();
        const digitsOnly = query.replace(/\D/g, '');
        let normalizedPhone = digitsOnly;
        if (normalizedPhone.startsWith('0')) normalizedPhone = '62' + normalizedPhone.slice(1);
        else if (normalizedPhone.startsWith('8')) normalizedPhone = '62' + normalizedPhone;

        const phoneConditions: any[] = [{ phone: { contains: query } }];
        if (digitsOnly && digitsOnly.length >= 3) {
          phoneConditions.push({ phone: { contains: digitsOnly } });
        }
        if (normalizedPhone && normalizedPhone.length >= 4 && normalizedPhone !== digitsOnly) {
          phoneConditions.push({ phone: { contains: normalizedPhone } });
        }

        andClauses.push({
          OR: [
            { customer: { name: { contains: query, mode: 'insensitive' } } },
            ...phoneConditions.map((p) => ({ customer: p })),
            { customer: { children: { some: { name: { contains: query, mode: 'insensitive' } } } } },
            { messages: { some: { content: { contains: query, mode: 'insensitive' } } } },
          ],
        });
      }

      // 4. Filter unread: inbound belum dibaca ATAU ditandai belum dibaca manual.
      if (filter === 'unread') {
        andClauses.push({
          OR: [
            { is_manual_unread: true },
            { messages: { some: { direction: 'INBOUND', read_at: null } } },
          ],
        });
      }

      if (andClauses.length > 0) where.AND = andClauses;

      if (label && label !== 'all') {
        if (label === 'medical_concern') where.escalation_reason = 'medical_concern';
        else if (label === 'unresolved_faq') where.escalation_reason = 'unresolved_faq';
        else if (label === 'human_request') where.is_human_handling = true;
      }
      const convs = await prisma.conversation.findMany({
        where,
        orderBy: [
          { is_pinned: 'desc' },
          { last_message_at: 'desc' },
        ],
        skip: offset,
        take,
      });
      convs.forEach((c) => memoryConversations.set(c.id, c));
      return convs;
    } catch (error) {
      const { customerService } = await import('./customer.service');
      const all = Array.from(memoryConversations.values())
        .filter((c) => c.tenant_id === tenantId)
        .sort((a, b) => {
          if (!!a.is_pinned !== !!b.is_pinned) return a.is_pinned ? -1 : 1;
          return new Date(b.last_message_at || b.updated_at).getTime() - new Date(a.last_message_at || a.updated_at).getTime();
        });
      const isProd = process.env.NODE_ENV === 'production';
      const effectiveFilterMode = isProd && mode === 'all' ? 'real' : mode;
      const filtered: any[] = [];
      if (effectiveFilterMode === 'all') {
        filtered.push(...all);
      } else {
        for (const c of all) {
          try {
            const cust = await customerService.getCustomerById(c.customer_id, tenantId);
            if (cust && !!cust.is_sandbox_test === (effectiveFilterMode === 'sandbox')) filtered.push(c);
          } catch (e) {
            if (effectiveFilterMode === 'real') filtered.push(c);
          }
        }
      }
      let working: any[] = filtered;

      // Filter fondasional di fallback in-memory (DB offline) — paritas dengan query Prisma.
      if (filter === 'unread') {
        try {
          const { messageService } = await import('./message.service');
          const unreadMap = await messageService.getUnreadCountsBatch(working.map((c: any) => c.id), tenantId);
          working = working.filter((c: any) => !!c.is_manual_unread || (unreadMap.get(c.id) || 0) > 0);
        } catch {
          working = working.filter((c: any) => !!c.is_manual_unread);
        }
      } else if (filter === 'reservation') {
        const next: any[] = [];
        for (const c of working) {
          try {
            const cust: any = await customerService.getCustomerById(c.customer_id, tenantId);
            const res: any[] = cust?.reservations || [];
            const matchesStaff: (r: any) => boolean =
              !staffId || staffId === 'all'
                ? () => true
                : staffId === 'unassigned'
                  ? (r: any) => !r.assigned_staff_id
                  : (r: any) => r.assigned_staff_id === staffId;
            if (res.some((r: any) => isActiveReservation(r) && matchesStaff(r))) next.push(c);
          } catch {
            // Data customer tak tersedia → fail-closed (jangan tampilkan reservasi palsu).
          }
        }
        working = next;
      }

      if (label && label !== 'all') {
        if (label === 'medical_concern') working = working.filter((c: any) => c.escalation_reason === 'medical_concern');
        else if (label === 'unresolved_faq') working = working.filter((c: any) => c.escalation_reason === 'unresolved_faq');
        else if (label === 'human_request') working = working.filter((c: any) => !!c.is_human_handling);
      }
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const digitsOnly = q.replace(/\D/g, '');
        let normalized = digitsOnly;
        if (normalized.startsWith('0')) normalized = '62' + normalized.slice(1);
        else if (normalized.startsWith('8')) normalized = '62' + normalized;
        const next: any[] = [];
        for (const c of working) {
          try {
            const cust: any = await customerService.getCustomerById(c.customer_id, tenantId);
            const nameMatch = (cust?.name || '').toLowerCase().includes(q);
            const phoneRaw = (cust?.phone || '').toLowerCase();
            const phoneDigits = (cust?.phone || '').replace(/\D/g, '');
            const phoneMatch = digitsOnly.length >= 3
              ? (phoneDigits.includes(digitsOnly) || (normalized.length >= 4 && phoneDigits.includes(normalized)) || phoneRaw.includes(q))
              : phoneRaw.includes(q);
            const childMatch = Array.isArray(cust?.children) && cust.children.some((ch: any) => (ch.name || '').toLowerCase().includes(q));
            if (nameMatch || phoneMatch || childMatch) next.push(c);
          } catch {
            // fallback: cek phone/name di conversation snapshot jika ada
            const phoneMatch = digitsOnly.length >= 3
              ? ((c.customerPhone || '') && (c.customerPhone || '').replace(/\D/g, '').includes(digitsOnly))
              : false;
            if (phoneMatch) next.push(c);
          }
        }
        working = next;
      }
      return working.slice(offset, offset + take);
    }
  }

  /**
   * Evaluasi Auto-Release Timeout pada conversation:
   * Jika flag is_human_handling aktif lebih dari HUMAN_HANDLING_TIMEOUT_HOURS (default 6 jam)
   * tanpa balasan dari human agent, otomatis kembalikan ke bot dan pulihkan previous_state!
   */
  public checkAndApplyAutoRelease(conversation: any, tenantId: string): { released: boolean; updatedConversation: any } {
    if (!conversation.is_human_handling || !conversation.human_handling_since) {
      return { released: false, updatedConversation: conversation };
    }

    // P3-2: sewa berjenjang ganti pengecualian abadi (fondasional)
    const sinceEarly = new Date(conversation.human_handling_since).getTime();
    const nowEarly = Date.now();
    const hoursEarly = (nowEarly - sinceEarly) / (1000 * 60 * 60);
    // medical_concern: sewa 24 jam (bukan abadi) — jaga safety tapi tidak livelock selamanya
    if (conversation.escalation_reason === 'medical_concern') {
      if (hoursEarly < 24) {
        console.log(`[AUTO-RELEASE SEWA] Conversation ${conversation.id} medical_concern ${hoursEarly.toFixed(1)}h <24h — belum release.`);
        return { released: false, updatedConversation: conversation };
      }
    }
    // KEBIJAKAN PERMANEN (dikunci product owner, JANGAN DIUBAH): pasien lama /
    // loyal (repeat order / legacy) SELALU ditangani CS manusia dan TIDAK PERNAH
    // di-auto-release otomatis ke bot. Sesi hanya bisa dilepas ke bot oleh aksi
    // manual CS/admin (takeover/release). Himpunan reason ini deterministik
    // (state-based), bukan pencocokan teks pesan.
    const PERMANENT_CS_LOCK_REASONS = new Set<string>([
      'EXISTING_PATIENT_MANUAL',
      'LEGACY_CUSTOMER_MANUAL',
      AI_ELIGIBILITY_ESCALATION_REASON, // 'LEGACY_AI_SCOPE_DISABLED' — kontak pra-cutoff = legacy
    ]);
    if (PERMANENT_CS_LOCK_REASONS.has(conversation.escalation_reason)) {
      console.log(`[AUTO-RELEASE SCOPE-LOCK] Conversation ${conversation.id} (${conversation.escalation_reason}) pasien lama/legacy — KUNCI PERMANEN ke CS, no auto-release.`);
      return { released: false, updatedConversation: conversation };
    }
    // JADWAL AKTIF: guard operasional (bukan "pasien lama") — sewa 48 jam agar
    // tidak menggantung selamanya setelah kunjungan selesai.
    if (conversation.escalation_reason === ACTIVE_APPOINTMENT_ESCALATION_REASON) {
      if (hoursEarly < 48) {
        console.log(`[AUTO-RELEASE SEWA] Conversation ${conversation.id} ${conversation.escalation_reason} ${hoursEarly.toFixed(1)}h <48h — belum release.`);
        return { released: false, updatedConversation: conversation };
      }
    }
    const isManualTakeover =
      conversation.escalation_reason === 'manual_reply' ||
      conversation.escalation_reason === 'manual_takeover' ||
      conversation.escalation_reason === 'admin_takeover' ||
      conversation.escalation_reason === 'admin_manual_reply' ||
      (typeof conversation.escalation_reason === 'string' && conversation.escalation_reason.startsWith('manual_'));
    if (isManualTakeover) {
      // F4.4b: lease manual = 12 jam, TAPI `human_handling_since` sudah di-slide
      // tiap balasan admin (resetHumanHandlingTimer) → efektif berbasis AKTIVITAS
      // admin, bukan sekadar waktu sejak eskalasi. Peringatan pra-lepas dikirim
      // ~2 jam sebelum release agar admin bisa intervensi.
      const MANUAL_LEASE_HOURS = 12;
      if (
        hoursEarly >= MANUAL_LEASE_HOURS - 2 &&
        hoursEarly < MANUAL_LEASE_HOURS &&
        !this.autoReleaseWarned.has(conversation.id)
      ) {
        this.autoReleaseWarned.add(conversation.id);
        console.log(`[AUTO-RELEASE WARN] Conversation ${conversation.id} (manual) ~${(MANUAL_LEASE_HOURS - hoursEarly).toFixed(1)}h lagi akan dilepas ke bot.`);
        void import('./web-push.service').then(({ webPushService }) =>
          webPushService.sendPushToRole(tenantId, 'ADMIN', {
            title: '⏳ Percakapan segera dilepas ke bot',
            body: `Tidak ada aktivitas admin ${hoursEarly.toFixed(1)} jam. Bot aktif kembali dalam ~${(MANUAL_LEASE_HOURS - hoursEarly).toFixed(1)} jam — tekan "Ambil Alih" bila masih perlu.`,
            url: `/admin/live-chat?conversationId=${conversation.id}`,
            tag: `autorelease-warn-${conversation.id}`,
          })
        ).catch(() => {});
      }
      if (hoursEarly < MANUAL_LEASE_HOURS) {
        console.log(`[AUTO-RELEASE SEWA] Conversation ${conversation.id} manual ${hoursEarly.toFixed(1)}h <12h — belum release.`);
        return { released: false, updatedConversation: conversation };
      }
    }

    const since = new Date(conversation.human_handling_since).getTime();

    const now = new Date().getTime();
    const hoursElapsed = (now - since) / (1000 * 60 * 60);

    const timeoutLimitHours = clinicConfig.humanHandlingTimeoutHours;

    if (hoursElapsed >= timeoutLimitHours) {
      console.log(
        `[AUTO-RELEASE TRIGGERED] Conversation ${conversation.id} human handling timed out (${hoursElapsed.toFixed(2)} hrs > ${timeoutLimitHours} hrs). Restoring previous_state: ${conversation.previous_state}`
      );

      // Kembalikan ke state sebelumnya (restored from previous_state)
      const restoredState = conversation.previous_state || ConversationState.INITIAL;

      conversation.is_human_handling = false;
      conversation.human_handling_since = null;
      conversation.current_state = restoredState;

      // Async sync ke DB
      this.updateConversationState(
        conversation.id,
        {
          currentState: restoredState,
          isHumanHandling: false,
          humanHandlingSince: null,
        },
        tenantId
      ).catch((err) => console.error('Failed to sync auto-release to DB:', err));

      // Mandat Anti-Label WAHA: clear is_hold_labeled langsung via DB internal —
      // menggantikan efek samping syncLabelColumn dari wahaClient.removeLabel yang dihapus.
      // is_human_handling + is_hold_labeled di DB adalah single source of truth.
      // Fire-and-forget best-effort; tidak pernah melempar ke pemanggil.
      console.log(`[AUTO-RELEASE DB] Customer conversation released (DB-only, zero WAHA label mutation).`);
      void (async () => {
        try {
          let releasePhone: string | undefined = conversation.customer?.phone;
          if (!releasePhone && conversation.customer_id) {
            const cust = await prisma.customer.findUnique({
              where: { id: conversation.customer_id },
              select: { phone: true },
            });
            releasePhone = cust?.phone ?? undefined;
          }
          if (!releasePhone) return;
          const { customerService } = await import('./customer.service');
          await customerService.setLabelFlags(releasePhone, { isHoldLabeled: false });
          console.log(`[AUTO-RELEASE DB] is_hold_labeled=false untuk ${releasePhone}.`);
        } catch (err: any) {
          console.warn('[AUTO-RELEASE DB] Gagal clear is_hold_labeled:', err.message);
        }
      })();

      return { released: true, updatedConversation: conversation };
    }

    return { released: false, updatedConversation: conversation };
  }

  /**
   * Update state percakapan, previous_state, dan attempt counter.
   */
  public async updateConversationState(
    conversationId: string,
    updates: {
      currentState?: ConversationState;
      previousState?: ConversationState | null;
      locationAttempts?: number;
      isHumanHandling?: boolean;
      humanHandlingSince?: Date | null;
      escalationReason?: string | null;
      consecutiveUnknownCount?: number;
      /** Hanya diisi pemanggil saat ada pesan riil; perubahan status TIDAK boleh menyentuh last_message_at. */
      lastMessageAt?: Date | null;
    },
    tenantId: string
  ): Promise<any> {
    // Fondasional: last_message_at murni milik messageService.logMessage (pesan riil).
    // Mutasi status (unknown count, auto-release, eskalasi, dsb) dilarang menyentuh kronologi.
    const dataToUpdate: any = {};

    if (updates.currentState !== undefined) dataToUpdate.current_state = updates.currentState;
    if (updates.previousState !== undefined) dataToUpdate.previous_state = updates.previousState;
    if (updates.locationAttempts !== undefined) dataToUpdate.location_attempts = updates.locationAttempts;
    if (updates.isHumanHandling !== undefined) dataToUpdate.is_human_handling = updates.isHumanHandling;
    if (updates.humanHandlingSince !== undefined) dataToUpdate.human_handling_since = updates.humanHandlingSince;
    if (updates.escalationReason !== undefined) dataToUpdate.escalation_reason = updates.escalationReason;
    if (updates.consecutiveUnknownCount !== undefined) dataToUpdate.consecutive_unknown_count = updates.consecutiveUnknownCount;
    if (updates.lastMessageAt !== undefined) dataToUpdate.last_message_at = updates.lastMessageAt;

    // PLAN 8 FASE 5b: tulis via Repository seam (fail-closed di produksi).
    const repo = (await import('../repositories/conversation.repository')).getConversationRepository();
    const updated = await repo.updateState(
      conversationId,
      {
        currentState: updates.currentState,
        previousState: updates.previousState,
        locationAttempts: updates.locationAttempts,
        consecutiveUnknownCount: updates.consecutiveUnknownCount,
        isHumanHandling: updates.isHumanHandling,
        humanHandlingSince: updates.humanHandlingSince,
        escalationReason: updates.escalationReason,
        ...(updates.lastMessageAt !== undefined ? { lastMessageAt: updates.lastMessageAt ?? undefined } : {}),
      },
      tenantId
    );
    memoryConversations.set(conversationId, updated);
    this.publishConversationUpdated(updated, tenantId);
    return updated;
  }

  /**
   * Reset timer auto-release (human_handling_since) saat admin membalas percakapan
   * yang sedang dalam HUMAN_HANDLING (dari dashboard atau dari HP asli via WAHA fromMe).
   * Tidak menonaktifkan human handling — hanya menggeser jendela 6 jam.
   */
  public async resetHumanHandlingTimer(conversationId: string, tenantId: string): Promise<any> {
    return this.updateConversationState(conversationId, { humanHandlingSince: new Date() }, tenantId);
  }

  /**
   * Broadcast state percakapan ke Live Chat hub (fire-and-forget).
   */
  private publishConversationUpdated(conversation: any, tenantId: string): void {
    getLiveChatHub()
      .publish({
        type: 'conversation.updated',
        tenantId,
        payload: buildConversationUpdatedPayload(conversation),
      })
      .catch(() => {});
  }

  /**
   * Transisi ke HUMAN_HANDLING: Otomatis menyimpan state saat ini ke previous_state
   */
  public async escalateToHumanHandling(
    conversation: any,
    phone: string,
    reason: string,
    tenantId: string,
    escalationReason?: string
  ): Promise<any> {
    console.log(`[HUMAN HANDOFF] Conversation ${conversation.id} escalated to human handling. Reason: ${reason}`);

    const currentStateBeforeEscalation = conversation.current_state;
    // V-B guard (fondasional): bila percakapan SUDAH HUMAN_HANDLING, JANGAN timpa
    // previous_state — state riil pra-eskalasi bisa hilang dan Release akan
    // memulihkan ke HUMAN_HANDLING (chat macet selamanya). Update di-skip dengan
    // mengirim undefined (patch diabaikan oleh updateConversationState).
    const isAlreadyHumanHandling = currentStateBeforeEscalation === ConversationState.HUMAN_HANDLING;
    const previousStateForUpdate = isAlreadyHumanHandling ? undefined : currentStateBeforeEscalation;

    // Deteksi apakah percakapan berasal dari customer Sandbox/QA Test
    let isSandbox = Boolean(conversation.customer?.is_sandbox_test);
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    const customerName = conversation.customer?.name || 'Pelanggan';
    if (!isSandbox) {
      isSandbox = isDummyOrTestContact(cleanPhone, customerName, isSandbox);
    }

    // 1. Penandaan hold via DB internal (is_hold_labeled) — single source of truth.
    //    Menggantikan efek samping syncLabelColumn dari wahaClient.addLabel yang telah
    //    dihapus per Mandat Anti-Label WAHA. Guard sama seperti semula: lewati sandbox
    //    & global_bot_disabled. Best-effort; tidak pernah melempar ke pemanggil.
    console.log(`[ESCALATION DB] Customer ${phone} dialihkan ke penanganan manusia (DB only, zero WAHA label).`);
    const isGlobalDisabled = escalationReason === 'global_bot_disabled' || escalationReason === 'Global bot disabled';
    if (!isSandbox && !isGlobalDisabled) {
      try {
        const { customerService } = await import('./customer.service');
        await customerService.setLabelFlags(phone, { isHoldLabeled: true });
        console.log(`[ESCALATION DB] is_hold_labeled=true untuk ${phone}.`);
      } catch (err: any) {
        console.warn(`[ESCALATION DB] Gagal set is_hold_labeled untuk ${phone}:`, err.message);
      }
    }

    // 2. Kirim notifikasi alert eskalasi ke Telegram Admin (hanya untuk customer riil, nonaktif untuk sandbox)
    if (!isSandbox) {
      try {
        const { alertService, AlertType, AlertSeverity } = await import('./alert.service');
        const timeStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const alertText = `🚨 *ALERT ESKALASI CS (KLINIK KALA)*\n\n• *Pelanggan*: ${customerName} (+${cleanPhone})\n• *Status Bot*: Human Handling (CS Takeover)\n• *Alasan*: ${reason}\n• *Waktu*: ${timeStr}\n\n👉 *Klik untuk Balas Pelanggan*:\nhttps://wa.me/${cleanPhone}`;

        void alertService.notifyAlert({
          type: AlertType.CS_ESCALATION,
          severity: AlertSeverity.WARNING,
          message: alertText,
          rawMessage: true,
          tenantId,
          metadata: {
            conversationId: conversation.id,
            customerPhone: cleanPhone,
            customerName,
            reason,
          },
        });
      } catch (err: any) {
        console.warn(`[TELEGRAM ESCALATION ALERT ERROR] Failed to send escalation alert:`, err.message);
      }
    }

    // 3. Kirim Web Push Notification darurat ke seluruh dashboard/HP admin (hanya untuk customer riil, nonaktif untuk sandbox)
    if (!isSandbox) {
      try {
        const { webPushService } = await import('./web-push.service');
        void webPushService.sendPushToRole(tenantId, 'ADMIN', {
          title: `🚨 Eskalasi CS: ${customerName}`,
          body: reason || 'Pelanggan membutuhkan penanganan admin',
          url: `/admin/live-chat?conversationId=${conversation.id}`,
          tag: `escalation-${conversation.id}`,
        });
      } catch {}
    }

    return await this.updateConversationState(
      conversation.id,
      {
        currentState: ConversationState.HUMAN_HANDLING,
        previousState: previousStateForUpdate,
        isHumanHandling: true,
        humanHandlingSince: new Date(),
        escalationReason: escalationReason || undefined,
      },
      tenantId
    );
  }

  /**
   * Memperbarui treatment yang terakhir dibahas dalam percakapan.
   */
  public async updateLastDiscussedTreatment(
    conversationId: string,
    tenantId: string,
    treatmentName: string
  ): Promise<any> {
    const now = new Date();
    try {
      const updated = await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          last_discussed_treatment: treatmentName,
          last_discussed_treatment_at: now,
        },
      });
      memoryConversations.set(conversationId, updated);
      this.publishConversationUpdated(updated, tenantId);
      return updated;
    } catch (error) {
      const conv = memoryConversations.get(conversationId);
      if (conv) {
        conv.last_discussed_treatment = treatmentName;
        conv.last_discussed_treatment_at = now;
        conv.updated_at = now;
        this.publishConversationUpdated(conv, tenantId);
      }
      return conv || null;
    }
  }
  public async updateLastCustomerMessageAt(conversationId: string, tenantId: string): Promise<void> {
    const now = new Date();
    try {
      await (prisma.conversation as any).update({
        where: { id: conversationId },
        data: { last_customer_message_at: now },
      });
    } catch {
      const conv = memoryConversations.get(conversationId);
      if (conv) conv.last_customer_message_at = now;
    }
  }

  /**
   * Mengembalikan semua percakapan yang di-escalate karena 'Global bot disabled'
   * kembali ke state semula & melepas flag human handling saat Bot di-ON-kan lagi.
   */
  public async releaseDisabledBotConversations(tenantId: string): Promise<number> {
    let releasedCount = 0;
    try {
      const { wahaClient } = await import('../integrations/waha/client');
      const { customerService } = await import('./customer.service');

      const isGlobalDisabledReason = (r: string | null) =>
        r && (r === 'global_bot_disabled' || r === 'Global bot disabled' || r.toLowerCase().includes('global bot'));

      let convsToRelease: any[] = [];
      try {
        convsToRelease = await prisma.conversation.findMany({
          where: {
            tenant_id: tenantId,
            is_human_handling: true,
            escalation_reason: { in: ['global_bot_disabled', 'Global bot disabled'] },
          },
        });
      } catch {
        convsToRelease = Array.from(memoryConversations.values()).filter(
          (c) => c && c.tenant_id === tenantId && c.is_human_handling && isGlobalDisabledReason(c.escalation_reason)
        );
      }

      for (const conv of convsToRelease) {
        const restoredState = conv.previous_state || ConversationState.INITIAL;
        await this.updateConversationState(
          conv.id,
          {
            currentState: restoredState,
            isHumanHandling: false,
            humanHandlingSince: null,
            escalationReason: null,
          },
          tenantId
        );
        releasedCount++;

        // Label hold tidak perlu dihapus karena saat global_bot_disabled label hold tidak ditambahkan
      }
    } catch (err: any) {
      console.warn('[GLOBAL BOT RELEASE ERROR]', err.message);
    }
    return releasedCount;
  }

  /**
   * F4.1 — Pintu TUNGGAL melepas percakapan dari HUMAN_HANDLING kembali ke bot.
   * Menyatukan semua penulis (dashboard release, kurasi FAQ, /reset, FORCE_ON)
   * agar pemulihan previous_state + clearance hold konsisten (anti-spaghetti).
   */
  public async releaseToBot(conversationId: string, tenantId: string): Promise<any> {
    const existing = await this.getConversationById(conversationId, tenantId).catch(() => null);
    const restoredState = existing?.previous_state || ConversationState.INITIAL;
    await this.updateConversationState(
      conversationId,
      {
        currentState: restoredState,
        isHumanHandling: false,
        humanHandlingSince: null,
        escalationReason: null,
      },
      tenantId
    );
    // DB-internal hold clearance (single source of truth; zero WAHA label mutation).
    try {
      if (existing?.customer_id) {
        const cust = await prisma.customer.findUnique({
          where: { id: existing.customer_id },
          select: { phone: true },
        });
        if (cust?.phone) {
          const { customerService } = await import('./customer.service');
          await customerService.setLabelFlags(cust.phone, { isHoldLabeled: false });
        }
      }
    } catch {}
    return restoredState;
  }

  public getMemoryConversations(): any[] {
    return Array.from(memoryConversations.values());
  }

  /**
   * Gerbang TUNGGAL semua pengirim PROAKTIF (cron/follow-up/broadcast).
   * State-based (tanpa cocok teks): DILARANG mengirim pesan basa-basi/pengingat
   * ke percakapan yang sedang DIpegang manusia (is_human_handling) dengan
   * aktivitas < ambang jam, atau ke kontak bypass/admin. Ambang memakai env
   * yang sudah ada (Reusability-first; tanpa dependency baru).
   */
  public bolehKirimProaktif(conversation: any, customer?: any): boolean {
    if (customer && (customer.is_admin_labeled === true || hasBypassLabel(customer))) {
      return false;
    }
    if (customer && customer.is_sandbox_test === true) return false;
    if (!conversation) return true;
    if (conversation.is_human_handling) {
      const raw = parseInt(process.env.FOLLOWUP_RECENT_CHAT_COOLDOWN_HOURS || '72', 10);
      const hours = Number.isFinite(raw) && raw > 0 ? raw : 72;
      const lastMs = getLastCustomerActivityMs(conversation);
      if (!lastMs || Date.now() - lastMs < hours * 3600000) return false;
    }
    return true;
  }
}

export const conversationService = new ConversationService();

import { prisma } from '../db/client';
import { ConversationState } from '@prisma/client';
import { clinicConfig } from '../config/clinic';
import { getLiveChatHub } from './live-chat-hub.service';
import { AI_ELIGIBILITY_ESCALATION_REASON } from './ai-eligibility.service';

const memoryConversations = new Map<string, any>();

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
  };
}

export class ConversationService {
  /**
   * Cari conversation aktif milik customer, atau buat baru dengan state INITIAL jika belum ada.
   */
  public async getOrCreateConversation(customerId: string, tenantId: string): Promise<any> {
    try {
      let conversation = await prisma.conversation.findFirst({
        where: { customer_id: customerId, tenant_id: tenantId },
        orderBy: { updated_at: 'desc' },
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            tenant_id: tenantId,
            customer_id: customerId,
            current_state: ConversationState.INITIAL,
            is_human_handling: false,
            is_pinned: false,
            is_manual_unread: false,
          },
        });
      }

      memoryConversations.set(conversation.id, conversation);
      return conversation;
    } catch (error) {
      // Memory store fallback
      let conv = Array.from(memoryConversations.values()).find((c) => c && c.customer_id === customerId && c.tenant_id === tenantId);
      if (!conv) {
        conv = {
          id: `conv_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          tenant_id: tenantId,
          customer_id: customerId,
          current_state: ConversationState.INITIAL,
          previous_state: null,
          location_attempts: 0,
          is_human_handling: false,
          human_handling_since: null,
          consecutive_unknown_count: 0,
          last_message_at: new Date(),
          is_pinned: false,
          pinned_at: null,
          is_manual_unread: false,
          created_at: new Date(),
          updated_at: new Date(),
        };
        memoryConversations.set(conv.id, conv);
      }
      return conv;
    }
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
    try {
      const conv = await prisma.conversation.findUnique({ where: { id } });
      return conv || memoryConversations.get(id) || null;
    } catch (error) {
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
   * Daftar percakapan per tenant dengan paging offset (dengan memory store fallback saat DB offline).
   * Urutan: Pinned chat paling atas (aksi eksplisit admin), lalu semua chat by last_message_at desc (waktu absolut jam chat masuk).
   */
  public async listConversations(
    tenantId: string,
    take = 50,
    offset = 0,
    mode: 'all' | 'real' | 'sandbox' = 'all',
    search?: string
  ): Promise<any[]> {
    try {
      const where: any = {
        tenant_id: tenantId,
        messages: { some: {} },
      };
      if (mode !== 'all') {
        where.customer = { is_sandbox_test: mode === 'sandbox' };
      }
      if (search && search.trim()) {
        const query = search.trim();
        const cleanDigits = query.replace(/\D/g, '');
        where.OR = [
          { customer: { name: { contains: query, mode: 'insensitive' } } },
          { customer: { phone: { contains: cleanDigits.length > 2 ? cleanDigits : query } } },
          { messages: { some: { content: { contains: query, mode: 'insensitive' } } } },
        ];
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
      const filtered = mode === 'all' ? all : [];
      if (mode !== 'all') {
        for (const c of all) {
          try {
            const cust = await customerService.getCustomerById(c.customer_id, tenantId);
            if (cust && !!cust.is_sandbox_test === (mode === 'sandbox')) filtered.push(c);
          } catch (e) {
            // Customer tak ditemukan di memory store → ikutkan saja agar tidak kehilangan data (fail-open)
            if (mode === 'real') filtered.push(c);
          }
        }
      }
      return filtered.slice(offset, offset + take);
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

    // EXPLICIT GUARD: 6-hour auto-release is DISABLED for medical_concern escalation to protect customer safety
    if (conversation.escalation_reason === 'medical_concern') {
      console.log(`[AUTO-RELEASE EXEMPTION] Conversation ${conversation.id} is in HUMAN_HANDLING due to medical_concern. Auto-release is DISABLED.`);
      return { released: false, updatedConversation: conversation };
    }

    // EXPLICIT GUARD: Legacy customer non-AI (AI Rollout Scope) TIDAK boleh auto-release
    // kembali ke bot — customer ini memang diarahkan ke human handling permanen.
    if (conversation.escalation_reason === AI_ELIGIBILITY_ESCALATION_REASON) {
      console.log(`[AUTO-RELEASE EXEMPTION] Conversation ${conversation.id} is in HUMAN_HANDLING due to ${AI_ELIGIBILITY_ESCALATION_REASON}. Auto-release is DISABLED.`);
      return { released: false, updatedConversation: conversation };
    }

    // EXPLICIT GUARD: Manual reply via WhatsApp HP atau Takeover CS via Dashboard
    // TIDAK boleh di-auto-release oleh timer malam/diam — hanya boleh dilepas manual oleh admin via UI/command.
    const isManualTakeover = 
      conversation.escalation_reason === 'manual_reply' ||
      conversation.escalation_reason === 'manual_takeover' ||
      conversation.escalation_reason === 'admin_takeover' ||
      conversation.escalation_reason === 'admin_manual_reply' ||
      (typeof conversation.escalation_reason === 'string' && conversation.escalation_reason.startsWith('manual_'));

    if (isManualTakeover) {
      console.log(`[AUTO-RELEASE EXEMPTION] Conversation ${conversation.id} is in HUMAN_HANDLING due to CS manual action (${conversation.escalation_reason}). Auto-release is DISABLED.`);
      return { released: false, updatedConversation: conversation };
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

      // Remove label "hold" from WhatsApp/WAHA chat (default OFF di produksi, aktif jika ENABLE_WAHA_HOLD_LABEL=true)
      const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL === 'true' || (process.env.NODE_ENV === 'test' && process.env.ENABLE_WAHA_HOLD_LABEL !== 'false');
      if (enableHoldLabel) {
        try {
          const { wahaClient } = require('../integrations/waha/client');
          prisma.customer.findUnique({ where: { id: conversation.customer_id } })
            .then((customer: any) => {
              if (customer) {
                wahaClient.removeLabel(`${customer.phone}@c.us`, 'hold')
                  .catch((err: any) => console.error('[LABEL ERROR] Failed to remove hold label on auto-release:', err.message));
              }
            });
        } catch (err: any) {
          console.error('[LABEL ERROR] Failed to initiate hold label removal on auto-release:', err.message);
        }
      }

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
    },
    tenantId: string
  ): Promise<any> {
    const dataToUpdate: any = {
      last_message_at: new Date(),
    };

    if (updates.currentState !== undefined) dataToUpdate.current_state = updates.currentState;
    if (updates.previousState !== undefined) dataToUpdate.previous_state = updates.previousState;
    if (updates.locationAttempts !== undefined) dataToUpdate.location_attempts = updates.locationAttempts;
    if (updates.isHumanHandling !== undefined) dataToUpdate.is_human_handling = updates.isHumanHandling;
    if (updates.humanHandlingSince !== undefined) dataToUpdate.human_handling_since = updates.humanHandlingSince;
    if (updates.escalationReason !== undefined) dataToUpdate.escalation_reason = updates.escalationReason;
    if (updates.consecutiveUnknownCount !== undefined) dataToUpdate.consecutive_unknown_count = updates.consecutiveUnknownCount;

    try {
      const existing = await prisma.conversation.findFirst({
        where: { id: conversationId, tenant_id: tenantId },
      });
      if (!existing) {
        throw new Error(`Conversation ${conversationId} not found for tenant ${tenantId}`);
      }

      const updated = await prisma.conversation.update({
        where: { id: conversationId },
        data: dataToUpdate,
      });
      memoryConversations.set(conversationId, updated);
      this.publishConversationUpdated(updated, tenantId);
      return updated;
    } catch (error) {
      // Memory fallback update
      const conv = memoryConversations.get(conversationId);
      if (conv && conv.tenant_id === tenantId) {
        if (updates.currentState !== undefined) conv.current_state = updates.currentState;
        if (updates.previousState !== undefined) conv.previous_state = updates.previousState;
        if (updates.locationAttempts !== undefined) conv.location_attempts = updates.locationAttempts;
        if (updates.isHumanHandling !== undefined) conv.is_human_handling = updates.isHumanHandling;
        if (updates.humanHandlingSince !== undefined) conv.human_handling_since = updates.humanHandlingSince;
        if (updates.escalationReason !== undefined) conv.escalation_reason = updates.escalationReason;
        if (updates.consecutiveUnknownCount !== undefined) conv.consecutive_unknown_count = updates.consecutiveUnknownCount;
        conv.updated_at = new Date();
        this.publishConversationUpdated(conv, tenantId);
      }
      return conv;
    }
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

    // 1. Tambahkan label "hold" secara fisik ke chat WAHA jika diaktifkan (default disabled di produksi)
    const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL === 'true' || (process.env.NODE_ENV === 'test' && process.env.ENABLE_WAHA_HOLD_LABEL !== 'false');
    const isGlobalDisabled = escalationReason === 'global_bot_disabled' || escalationReason === 'Global bot disabled';

    if (enableHoldLabel && !isGlobalDisabled) {
      try {
        const { wahaClient } = await import('../integrations/waha/client');
        await wahaClient.addLabel(`${phone}@c.us`, 'hold').catch((err: any) => console.warn(`[LABEL ERROR] Failed to auto-add hold label:`, err.message));
      } catch (err: any) {
        console.warn(`[WAHA CLIENT ERROR] Failed to import wahaClient:`, err.message);
      }
    } else {
      console.log(`[LABEL SKIP] Skipping WAHA hold label mutation (feature flag disabled / UI-managed).`);
    }

    // 2. Kirim notifikasi alert eskalasi ke Telegram Admin (selalu aktif via alertService)
    try {
      const { alertService, AlertType, AlertSeverity } = await import('./alert.service');
      const customerName = conversation.customer?.name || 'Pelanggan';
      const cleanPhone = phone.replace(/\D/g, '');
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

    // 3. Kirim Web Push Notification darurat ke seluruh dashboard/HP admin
    try {
      const { webPushService } = await import('./web-push.service');
      const customerName = conversation.customer?.name || 'Pelanggan';
      void webPushService.sendPushToTenant(tenantId, {
        title: `🚨 Eskalasi CS: ${customerName}`,
        body: reason || 'Pelanggan membutuhkan penanganan admin',
        url: `/admin/#/live-chat?conversationId=${conversation.id}`,
        tag: `escalation-${conversation.id}`,
      });
    } catch {}

    return await this.updateConversationState(
      conversation.id,
      {
        currentState: ConversationState.HUMAN_HANDLING,
        previousState: currentStateBeforeEscalation,
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

  public getMemoryConversations(): any[] {
    return Array.from(memoryConversations.values());
  }
}

export const conversationService = new ConversationService();

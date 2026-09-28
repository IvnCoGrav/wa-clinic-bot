import { prisma } from '../db/client';
import { Direction } from '@prisma/client';

/**
 * FrustrationSignalService (Fase 4) — Pulse alert kekecewaan pasien.
 *
 * PRINSIP FONDASIONAL (Mandat Anti-Overfitting & Minimalisasi Regex):
 * Status "butuh respon segera" ditentukan oleh STATE + SLA, BUKAN pencocokan
 * kata kunci ("lama banget", "kecewa", dsb.). Deteksi berbasis teks rapuh
 * terhadap parafrase tak terbatas dan dilarang.
 *
 * Sinyal (deterministik):
 * - Pesan terakhir percakapan adalah INBOUND (customer), dan
 * - Sudah berlalu >= SLA menit tanpa balasan ADMIN nyata (INTERNAL_NOTE tidak dihitung).
 *
 * Padam HANYA saat balasan ADMIN nyata terkirim (lihat live-chat.service.sendAdminReply).
 */

/**
 * SLA (menit) sebelum percakapan dianggap butuh respon segera.
 * Env-overridable (default: 60 menit) — jendela wajar staf melayani pasien
 * walk-in/tindakan medis sebelum sistem menandai eskalasi darurat.
 */
export function getFrustrationSlaMinutes(): number {
  const raw = parseInt(process.env.FRUSTRATION_SLA_MINUTES || '60', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}

/**
 * Batas maksimal usia pesan aktif (24 jam). Pesan lebih tua dari ini dianggap
 * kadaluarsa/arsip — percakapan kuno DILARANG ikut berkedip (alarm fatigue).
 */
export const MAX_FRUSTRATION_AGE_MINUTES = 24 * 60;

export interface FrustrationEvaluationInput {
  lastDirection: 'INBOUND' | 'OUTBOUND' | null;
  lastMessageAt: Date | null;
  now?: Date;
  slaMinutes?: number;
  maxAgeMinutes?: number;
}

/**
 * Fungsi murni deterministik: apakah percakapan harus ditandai frustrasi?
 * Berlaku hanya bila usia pesan terakhir berada di antara [slaMinutes..maxAgeMinutes].
 * Tidak menyentuh DB → mudah diuji adversarial.
 */
export function computeFrustrationSignal(input: FrustrationEvaluationInput): boolean {
  const { lastDirection, lastMessageAt } = input;
  if (lastDirection !== 'INBOUND' || !lastMessageAt) return false;
  const now = input.now ? input.now.getTime() : Date.now();
  const sla = (input.slaMinutes ?? getFrustrationSlaMinutes()) * 60 * 1000;
  const maxAge = (input.maxAgeMinutes ?? MAX_FRUSTRATION_AGE_MINUTES) * 60 * 1000;
  const age = now - new Date(lastMessageAt).getTime();
  return age >= sla && age <= maxAge;
}

export class FrustrationSignalService {
  /**
   * Evaluasi satu percakapan berdasarkan state DB dan set/turunkan flag (dua arah).
   * Idempoten: hanya menulis & menyiarkan SSE bila status berubah.
   */
  public async evaluateConversation(conversationId: string, tenantId: string): Promise<boolean> {
    const conversation = await prisma.conversation
      .findFirst({ where: { id: conversationId, tenant_id: tenantId } })
      .catch(() => null);
    if (!conversation) return false;

    // Pesan nyata terakhir (abaikan catatan internal — bukan balasan ke customer).
    const lastReal = await prisma.message
      .findFirst({
        where: { conversation_id: conversationId, tenant_id: tenantId, sender_type: { not: 'INTERNAL_NOTE' } },
        orderBy: { created_at: 'desc' },
      })
      .catch(() => null);

    const shouldFlag = computeFrustrationSignal({
      lastDirection: (lastReal?.direction as any) || null,
      lastMessageAt: (lastReal?.created_at as any) || null,
    });

    // Naikkan flag: percakapan baru melewati SLA.
    if (shouldFlag && !conversation.is_frustrated) {
      const updated = await prisma.conversation
        .update({
          where: { id: conversationId },
          data: {
            is_frustrated: true,
            frustrated_at: new Date(),
            frustrated_reason: 'SLA_BREACH',
          },
        })
        .catch(() => null);
      if (updated) await this.publishFrustrationChange(updated, tenantId);
      return true;
    }

    // Turunkan flag: percakapan ditandai frustrasi tetapi sudah dibalas (OUTBOUND) —
    // SSE memadamkan badge di seluruh dashboard tanpa refresh.
    if (!shouldFlag && conversation.is_frustrated) {
      const updated = await prisma.conversation
        .update({
          where: { id: conversationId },
          data: { is_frustrated: false, frustrated_at: null, frustrated_reason: null },
        })
        .catch(() => null);
      if (updated) await this.publishFrustrationChange(updated, tenantId);
      return true;
    }
    return false;
  }

  /**
   * Sapuan periodik: tandai percakapan yang melewati SLA di tenant tertentu,
   * sekaligus padamkan percakapan frustrasi yang sudah kadaluarsa (> max-age 24 jam).
   * Cakup semua provider (WAHA/WABA) karena berbasis state DB, bukan jalur webhook.
   * Return jumlah percakapan yang berubah status.
   */
  public async sweep(tenantId: string): Promise<number> {
    const slaMinutes = getFrustrationSlaMinutes();
    const now = Date.now();
    const cutoff = new Date(now - slaMinutes * 60 * 1000);
    const maxCutoff = new Date(now - MAX_FRUSTRATION_AGE_MINUTES * 60 * 1000);

    let changed = 0;

    // (a) Kandidat baru: belum ditandai & last_message_at dalam rentang [maxCutoff..cutoff].
    //     Batas atas maxCutoff mencegah chat kuno (>24 jam) ikut terpicu.
    const candidates = await prisma.conversation
      .findMany({
        where: {
          tenant_id: tenantId,
          is_frustrated: false,
          last_message_at: { gte: maxCutoff, lte: cutoff },
        },
        select: { id: true, customer_id: true },
        take: 200,
      })
      .catch(() => [] as Array<{ id: string; customer_id: string }>);

    for (const conv of candidates) {
      try {
        const wasChanged = await this.evaluateConversation(conv.id, tenantId);
        if (wasChanged) changed++;
      } catch {
        // best-effort; lanjutkan sapuan
      }
    }

    // (b) Bersihkan percakapan usang yang masih berstatus frustrasi padahal > 24 jam.
    const stale = await prisma.conversation
      .findMany({
        where: {
          tenant_id: tenantId,
          is_frustrated: true,
          last_message_at: { lt: maxCutoff },
        },
        select: { id: true },
        take: 200,
      })
      .catch(() => [] as Array<{ id: string }>);

    for (const conv of stale) {
      try {
        const wasChanged = await this.evaluateConversation(conv.id, tenantId);
        if (wasChanged) changed++;
      } catch {
        // best-effort; lanjutkan sapuan
      }
    }

    return changed;
  }

  /**
   * Siarkan perubahan status frustrasi ke Live Chat hub (fire-and-forget).
   * Payload memakai bentuk standar conversation.updated (isFrustrated dst.)
   * agar frontend cukup memetakan satu sumber kebenaran.
   */
  private async publishFrustrationChange(conversation: any, tenantId: string): Promise<void> {
    try {
      const { getLiveChatHub } = await import('./live-chat-hub.service');
      const { buildConversationUpdatedPayload } = await import('./conversation.service');
      await getLiveChatHub().publish({
        type: 'conversation.updated',
        tenantId,
        payload: buildConversationUpdatedPayload(conversation),
      });
    } catch {
      // best-effort; kegagalan siaran tidak boleh menggagalkan evaluasi
    }
  }
}

export const frustrationSignalService = new FrustrationSignalService();

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

/** SLA (menit) sebelum percakapan dianggap butuh respon segera. Env-overridable. */
export function getFrustrationSlaMinutes(): number {
  const raw = parseInt(process.env.FRUSTRATION_SLA_MINUTES || '15', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 15;
}

export interface FrustrationEvaluationInput {
  lastDirection: 'INBOUND' | 'OUTBOUND' | null;
  lastMessageAt: Date | null;
  now?: Date;
  slaMinutes?: number;
}

/**
 * Fungsi murni deterministik: apakah percakapan harus ditandai frustrasi?
 * Tidak menyentuh DB → mudah diuji adversarial.
 */
export function computeFrustrationSignal(input: FrustrationEvaluationInput): boolean {
  const { lastDirection, lastMessageAt } = input;
  if (lastDirection !== 'INBOUND' || !lastMessageAt) return false;
  const now = input.now ? input.now.getTime() : Date.now();
  const sla = (input.slaMinutes ?? getFrustrationSlaMinutes()) * 60 * 1000;
  const age = now - new Date(lastMessageAt).getTime();
  return age >= sla;
}

export class FrustrationSignalService {
  /**
   * Evaluasi satu percakapan berdasarkan state DB dan set/turunkan flag.
   * Idempoten: hanya menulis bila status berubah.
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

    if (shouldFlag && !conversation.is_frustrated) {
      await prisma.conversation
        .update({
          where: { id: conversationId },
          data: {
            is_frustrated: true,
            frustrated_at: new Date(),
            frustrated_reason: 'SLA_BREACH',
          },
        })
        .catch(() => {});
      return true;
    }
    return false;
  }

  /**
   * Sapuan periodik: tandai semua percakapan yang melewati SLA di tenant tertentu.
   * Cakup semua provider (WAHA/WABA) karena berbasis state DB, bukan jalur webhook.
   * Return jumlah percakapan yang baru ditandai.
   */
  public async sweep(tenantId: string): Promise<number> {
    const slaMinutes = getFrustrationSlaMinutes();
    const cutoff = new Date(Date.now() - slaMinutes * 60 * 1000);

    // Kandidat: percakapan yang belum ditandai & last_message_at lebih tua dari cutoff.
    const candidates = await prisma.conversation
      .findMany({
        where: {
          tenant_id: tenantId,
          is_frustrated: false,
          last_message_at: { lte: cutoff },
        },
        select: { id: true, customer_id: true },
        take: 200,
      })
      .catch(() => [] as Array<{ id: string; customer_id: string }>);

    let flagged = 0;
    for (const conv of candidates) {
      try {
        const changed = await this.evaluateConversation(conv.id, tenantId);
        if (changed) flagged++;
      } catch {
        // best-effort; lanjutkan sapuan
      }
    }
    return flagged;
  }
}

export const frustrationSignalService = new FrustrationSignalService();

import crypto from 'crypto';
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Stage 5 Fase 3 (RC-04) — Outbound ledger per-bubble.
 *
 * Mencatat setiap bubble outbound: SENDING → SENT/FAILED/UNKNOWN, dengan
 * provider message id. Best-effort (DB offline tidak menggagalkan pengiriman).
 * Tujuan: audit per-bubble + mencegah retry mengirim ulang bubble yang SENT.
 */
export class OutboundLedger {
  /** Catat attempt SENDING; kembalikan id (atau undefined bila tracking gagal). */
  public async begin(params: {
    tenantId?: string;
    turnId: string;
    bubbleIndex: number;
    content: string;
    provider?: string;
  }): Promise<string | undefined> {
    const { tenantId = DEFAULT_TENANT_ID, turnId, bubbleIndex, content } = params;
    if (!turnId) return undefined;
    const contentHash = crypto.createHash('sha256').update(content || '').digest('hex').slice(0, 32);
    try {
      const row = await (prisma as any).outboundAttempt.upsert({
        where: { turn_id_bubble_index: { turn_id: turnId, bubble_index: bubbleIndex } },
        create: {
          tenant_id: tenantId,
          turn_id: turnId,
          bubble_index: bubbleIndex,
          content_hash: contentHash,
          status: 'SENDING',
        },
        update: { content_hash: contentHash, status: 'SENDING' },
        select: { id: true },
      });
      return row?.id;
    } catch (err: any) {
      console.warn('[OUTBOUND LEDGER] begin gagal (best-effort):', err?.message);
      return undefined;
    }
  }

  public async markSent(attemptId: string | undefined, providerMessageId?: string): Promise<void> {
    if (!attemptId) return;
    try {
      await (prisma as any).outboundAttempt.update({
        where: { id: attemptId },
        data: { status: 'SENT', provider_message_id: providerMessageId ?? null },
      });
    } catch (err: any) {
      console.warn('[OUTBOUND LEDGER] markSent gagal (best-effort):', err?.message);
    }
  }

  public async markFailed(attemptId: string | undefined, error?: string): Promise<void> {
    if (!attemptId) return;
    try {
      await (prisma as any).outboundAttempt.update({
        where: { id: attemptId },
        data: { status: 'FAILED', error: error ?? null },
      });
    } catch (err: any) {
      console.warn('[OUTBOUND LEDGER] markFailed gagal (best-effort):', err?.message);
    }
  }

  public async markUnknown(attemptId: string | undefined, error?: string): Promise<void> {
    if (!attemptId) return;
    try {
      await (prisma as any).outboundAttempt.update({
        where: { id: attemptId },
        data: { status: 'UNKNOWN', error: error ?? null },
      });
    } catch (err: any) {
      console.warn('[OUTBOUND LEDGER] markUnknown gagal (best-effort):', err?.message);
    }
  }
}

export const outboundLedger = new OutboundLedger();

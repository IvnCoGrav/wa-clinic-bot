/**
 * purchase-value-guard.ts
 * Satu seam kanonis untuk mengevaluasi perubahan `purchase_value` setelah
 * event Purchase terkirim ke Meta CAPI.
 *
 * Keputusan bisnis (2026-11-19): nilai transaksi TETAP BOLEH diubah oleh admin.
 * Guard tidak boleh menjadi tembok mati tanpa jalan keluar; default-nya hanya
 * memberi peringatan (`warn`). Mode `block` tetap tersedia sebagai opt-in
 * eksplisit lewat env `PURCHASE_VALUE_GUARD=block`.
 *
 * Catatan Meta: CAPI tidak mendukung pembaruan nilai event secara retroaktif.
 * Mengubah nilai di DB tidak mengubah angka yang sudah diterima Meta; snapshot
 * `purchase_event_value` adalah kebenaran yang dikirim saat approval.
 */

export type PurchaseValueGuardMode = 'off' | 'warn' | 'block';

export interface PurchaseValueMutationParams {
  previousValue: number | null | undefined;
  nextValue: number | null | undefined;
  purchaseEventSentAt: Date | string | null | undefined;
  mode?: PurchaseValueGuardMode;
}

export interface PurchaseValueMutationVerdict {
  /** Nilai benar-benar berubah (bukan pengisian awal dari null/0). */
  changed: boolean;
  /** Event Purchase sudah pernah dikirim sebelum perubahan ini. */
  afterDelivery: boolean;
  /** Perubahan harus ditolak (hanya bila mode `block`). */
  blocked: boolean;
  /** Pesan peringatan siap-log (tanpa PII), undefined bila tidak relevan. */
  warning?: string;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSentAt(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

/**
 * Evaluasi murni (tanpa DB/log) agar dapat diuji adversarial dan dipakai
 * bersama oleh route edit, approval CAPI, dan pembayaran staf.
 */
export function evaluatePurchaseValueMutation(
  params: PurchaseValueMutationParams
): PurchaseValueMutationVerdict {
  const previous = toFiniteNumber(params.previousValue);
  const next = toFiniteNumber(params.nextValue);
  const mode: PurchaseValueGuardMode = params.mode ?? 'warn';

  // Pengisian awal (null/0 -> nilai) bukan mutasi; jangan memicu guard.
  const changed = previous !== null && previous > 0 && next !== null && previous !== next;
  const afterDelivery = params.purchaseEventSentAt !== null && params.purchaseEventSentAt !== undefined;
  const guarded = changed && afterDelivery;
  const blocked = guarded && mode === 'block';

  const warning =
    guarded && mode !== 'off'
      ? `[PURCHASE VALUE GUARD] Nilai transaksi berubah dari ${previous} menjadi ${next} setelah event Purchase terkirim ke Meta pada ${formatSentAt(
          params.purchaseEventSentAt as Date | string
        )}. Meta tidak menerima pembaruan nilai retroaktif; snapshot event yang terkirim tetap nilai lama.`
      : undefined;

  return { changed, afterDelivery, blocked, warning };
}

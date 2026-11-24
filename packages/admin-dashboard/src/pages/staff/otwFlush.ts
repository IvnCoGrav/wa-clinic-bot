/**
 * Rekonsiliasi antrean OTW pending (plan 2026-11-24, Fase 4).
 *
 * Kenapa terpisah dari komponen: keputusan "kirim ulang / tunda / buang" harus bisa
 * diuji tanpa jaringan, storage, atau React. Modul ini hanya mengorkestrasi:
 * baca snapshot task → putuskan (`resolveFlushDecision`) → kirim → perbarui antrean.
 *
 * Aturan penting:
 * - **Server adalah otoritas.** Bila task sudah punya `otwSentAt`, item dianggap
 *   selesai tanpa mengirim apa pun (menutup kasus "request sukses tapi klien mati").
 * - Task tidak ditemukan di daftar hari ini → `deferred`, BUKAN dibuang: jadwal bisa
 *   belum termuat saat resume.
 * - Pengiriman berurutan (bukan paralel) agar tidak menyerbu gateway WhatsApp.
 */
import { resolveFlushDecision, type SendOtwResult } from './otwDeparture';
import type { PendingOtwItem } from './otwPendingStore';

/** Snapshot minimal task yang dibutuhkan untuk memutuskan pengiriman ulang. */
export interface OtwFlushTaskSnapshot {
  bookingDate?: string | null;
  status?: string | null;
  otwSentAt?: string | null;
}

export interface OtwFlushDeps {
  list: PendingOtwItem[];
  getTask: (reservationId: string) => OtwFlushTaskSnapshot | undefined;
  send: (item: PendingOtwItem) => Promise<SendOtwResult>;
  remove: (requestId: string) => void;
  mark: (requestId: string, patch: { lastError?: string | null; attempts?: number }) => void;
  nowMs?: number;
}

export type OtwFlushOutcome =
  | 'sent'
  | 'already-sent'
  | 'reconciled'
  | 'dropped-closed'
  | 'dropped-expired'
  | 'deferred'
  | 'failed'
  | 'pending';

export interface OtwFlushReport {
  outcomes: Array<{ requestId: string; outcome: OtwFlushOutcome }>;
  sent: number;
  alreadySent: number;
  reconciled: number;
  dropped: number;
  failed: number;
  deferred: number;
}

export async function flushPendingOtwQueue(deps: OtwFlushDeps): Promise<OtwFlushReport> {
  const nowMs = deps.nowMs ?? Date.now();
  const report: OtwFlushReport = {
    outcomes: [],
    sent: 0,
    alreadySent: 0,
    reconciled: 0,
    dropped: 0,
    failed: 0,
    deferred: 0,
  };

  for (const item of deps.list) {
    const task = deps.getTask(item.reservationId);

    // 1) Server sudah mencatat OTW → selesai, jangan kirim lagi.
    if (task?.otwSentAt) {
      deps.remove(item.requestId);
      report.reconciled += 1;
      report.outcomes.push({ requestId: item.requestId, outcome: 'reconciled' });
      continue;
    }

    // 2) Task belum termuat (mis. daftar hari ini belum selesai fetch) → tunda.
    if (!task) {
      report.deferred += 1;
      report.outcomes.push({ requestId: item.requestId, outcome: 'deferred' });
      continue;
    }

    // 3) Gerbang jendela waktu + status reservasi.
    const decision = resolveFlushDecision({
      bookingDate: task.bookingDate ?? null,
      status: task.status ?? null,
      nowMs,
    });
    if (decision === 'wait') {
      report.deferred += 1;
      report.outcomes.push({ requestId: item.requestId, outcome: 'deferred' });
      continue;
    }
    if (decision === 'drop_closed' || decision === 'drop_expired') {
      deps.remove(item.requestId);
      report.dropped += 1;
      report.outcomes.push({
        requestId: item.requestId,
        outcome: decision === 'drop_closed' ? 'dropped-closed' : 'dropped-expired',
      });
      continue;
    }

    // 4) Kirim ulang dengan requestId yang SAMA (server mengenali duplikat).
    let result: SendOtwResult;
    try {
      result = await deps.send(item);
    } catch (err) {
      result = { status: 'failed', error: (err as Error)?.message || 'periksa koneksi' };
    }

    if (result.status === 'sent' || result.status === 'already-sent') {
      deps.remove(item.requestId);
      if (result.status === 'sent') report.sent += 1;
      else report.alreadySent += 1;
      report.outcomes.push({ requestId: item.requestId, outcome: result.status });
      continue;
    }

    deps.mark(item.requestId, {
      lastError: result.status === 'pending' ? 'Belum terkonfirmasi saat kirim ulang' : result.error || 'Gagal kirim ulang',
    });
    if (result.status === 'pending') report.deferred += 1;
    else report.failed += 1;
    report.outcomes.push({ requestId: item.requestId, outcome: result.status });
  }

  return report;
}

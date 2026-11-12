import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeSaveReservation } from '../../src/v3/tools/save-reservation.tool';
import { executeToolByName } from '../../src/v3/tools/tool-registry';
import { runToolWithAbort } from '../../src/v3/agent/pipeline/tool-pipeline';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * A-011 — pembatalan (AbortSignal) pada eksekusi tool.
 *
 * Yang dijaga kontraknya:
 * 1. Timeout pipeline WAJIB benar-benar meng-abort sinyal, bukan hanya
 *    "berhenti menunggu" (Promise.race lama membiarkan penulisan lanjut).
 * 2. Abort sebelum penulisan reservasi = TIDAK ada baris DB baru.
 * 3. Timeout yang terjadi SETELAH penulisan berhasil = hasil sukses dipakai
 *    (tidak dilaporkan gagal palsu ke customer).
 */

function baseInput(overrides: Record<string, any> = {}) {
  return {
    customerId: 'cust-a011',
    chatId: '628123450011@c.us',
    customerName: 'Bunda A011',
    treatmentName: 'Pijat Bayi',
    bookingDate: 'besok',
    dayMentionEvidence: ['besok'],
    address: 'Jl. Melati No. 5, Kelurahan Gadung, Kecamatan Driyorejo',
    tenantId: DEFAULT_TENANT_ID,
    ...overrides,
  };
}

describe('A-011 AbortSignal pada tool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('abort sebelum penulisan: reservasi TIDAK disimpan', async () => {
    const saveSpy = vi.spyOn(reservationCoreService, 'saveReservation').mockResolvedValue({} as any);
    const controller = new AbortController();
    controller.abort(new Error('turn dibatalkan'));

    const result = await executeSaveReservation(baseInput({ signal: controller.signal }));

    expect(result.success).toBe(false);
    expect(result.committed).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(String(result.message)).toMatch(/tidak ada jadwal yang tercatat/i);
  });

  it('tanpa signal: alur normal tetap menulis dan melaporkan committed=true', async () => {
    const saveSpy = vi
      .spyOn(reservationCoreService, 'saveReservation')
      .mockResolvedValue({ reservation: { id: 'res-1' } } as any);

    const result = await executeSaveReservation(baseInput());

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.reservationId).toBe('res-1');
  });

  it('signal yang sudah selesai (tidak aborted) tidak memblokir penulisan', async () => {
    const saveSpy = vi
      .spyOn(reservationCoreService, 'saveReservation')
      .mockResolvedValue({ reservation: { id: 'res-2' } } as any);
    const controller = new AbortController();

    const result = await executeSaveReservation(baseInput({ signal: controller.signal }));

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(result.committed).toBe(true);
  });

  it('tool-registry meneruskan signal ke gerbang tulis save_reservation', async () => {
    const saveSpy = vi.spyOn(reservationCoreService, 'saveReservation').mockResolvedValue({} as any);
    const controller = new AbortController();
    controller.abort();

    const result = await executeToolByName(
      'save_reservation',
      {
        customerName: 'Bunda A011',
        treatmentName: 'Pijat Bayi',
        bookingDate: 'besok',
        address: 'Jl. Melati No. 5, Kelurahan Gadung',
      },
      {
        tenantId: DEFAULT_TENANT_ID,
        customerId: 'cust-a011',
        conversationId: 'conv-a011',
        phone: '628123450011',
        chatId: '628123450011@c.us',
        recentUserTexts: ['besok'],
        allowedToolNames: ['save_reservation'],
        signal: controller.signal,
      }
    );

    expect(saveSpy).not.toHaveBeenCalled();
    expect(result.committed).toBe(false);
  });

  it('guard: save_reservation pada tanggal yang tidak disebut customer tetap ditolak lebih awal', async () => {
    const saveSpy = vi.spyOn(reservationCoreService, 'saveReservation').mockResolvedValue({} as any);
    const result = await executeSaveReservation(
      baseInput({ bookingDate: 'jum\'at depan', dayMentionEvidence: ['minggu besok'] })
    );
    expect(saveSpy).not.toHaveBeenCalled();
    expect(result.committed).toBe(false);
  });
});

describe('runToolWithAbort', () => {
  it('timeout meng-abort sinyal yang diterima tool', async () => {
    let observed: AbortSignal | undefined;
    const runner = (signal: AbortSignal) =>
      new Promise<string>((resolve) => {
        observed = signal;
        // Tool "mengabaikan" abort tapi tetap selesai lebih lambat.
        setTimeout(() => resolve('selesai'), 80);
      });

    await expect(runToolWithAbort(runner, 10, 'tool_lambat')).rejects.toThrow(/timeout setelah 10ms/);
    expect(observed?.aborted).toBe(true);
  });

  it('timeout sebelum tulis: runner melihat sinyal aborted dan menolak menulis', async () => {
    const writes: string[] = [];
    const runner = async (signal: AbortSignal) => {
      await new Promise((r) => setTimeout(r, 40));
      if (signal.aborted) return { success: false, committed: false };
      writes.push('baris-db');
      return { success: true, committed: true };
    };

    const result: any = await runToolWithAbort(runner, 10, 'save_reservation', { awaitSettleMs: 200 });

    // Tool memberi hasil final di jendela settle → hasil itu yang dipakai,
    // bukan error timeout, dan tidak ada penulisan yang terjadi.
    expect(result).toMatchObject({ success: false, committed: false });
    expect(writes).toHaveLength(0);
  });

  it('timeout SETELAH commit: hasil sukses dipakai, bukan error gagal palsu', async () => {
    const runner = async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { success: true, committed: true, reservationId: 'res-terlambat' };
    };

    const result: any = await runToolWithAbort(runner, 10, 'save_reservation', { awaitSettleMs: 200 });

    expect(result).toMatchObject({ success: true, committed: true, reservationId: 'res-terlambat' });
  });

  it('tanpa awaitSettleMs: timeout tetap melempar error (perilaku tool non-tulis)', async () => {
    const runner = async () => {
      await new Promise((r) => setTimeout(r, 40));
      return 'terlambat';
    };

    await expect(runToolWithAbort(runner, 10, 'search_knowledge_faq')).rejects.toThrow(/timeout/);
  });

  it('runner yang gagal sebelum timeout meneruskan error aslinya', async () => {
    const runner = async () => {
      throw new Error('katalog rusak');
    };
    await expect(
      runToolWithAbort(runner, 5_000, 'get_catalog_and_price', { awaitSettleMs: 100 })
    ).rejects.toThrow('katalog rusak');
  });
});

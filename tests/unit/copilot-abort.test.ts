import { describe, it, expect } from 'vitest';
import { CopilotService } from '../../src/services/copilot/copilot.service';

/**
 * Fase P2 — pembatalan nyata.
 *
 * Sebelumnya tombol "Batal" hanya menghentikan UI: backend tetap menjalankan
 * LLM dan semaphore per-tenant ditahan sampai selesai (bisa 5 menit) sehingga
 * pertanyaan berikutnya kena 429 COPILOT_BUSY.
 */
describe('Copilot abort signal', () => {
  it('signal yang sudah dibatalkan tidak memanggil LLM dan mengembalikan error ABORTED', async () => {
    const ac = new AbortController();
    ac.abort();

    const svc = new CopilotService();
    const res = await svc.chat({
      tenantId: 'default-tenant',
      message: 'berapa chat hari ini?',
      signal: ac.signal,
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('ABORTED');
    expect(res.llmCalls).toBe(0);
    expect(res.toolsUsed).toEqual([]);
  });
});

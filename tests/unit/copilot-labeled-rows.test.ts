import { describe, it, expect } from 'vitest';
import { buildLabeledToolRows } from '../../src/services/copilot/copilot.service';

/**
 * Regresi: budget 2.500 karakter per tool membuat hasil 31 bucket statistik
 * hanya terlihat ~16 baris oleh LLM, sehingga "total 30 hari" dilaporkan separuh.
 */
describe('buildLabeledToolRows — budget baris untuk summarize', () => {
  const buckets = Array.from({ length: 31 }, (_, i) => ({
    bucket: `2026-10-${String(i + 1).padStart(2, '0')}`,
    inboundMessages: 100 + i,
    outboundMessages: 90 + i,
    newConversations: 3,
    activeConversations: 10,
    humanHandling: 1,
    frustrated: 0,
  }));

  it('memuat SELURUH 31 bucket pada budget default (tidak lagi terpotong di ~16)', () => {
    const out = buildLabeledToolRows([{ tool: 'query_chat_stats', rows: buckets }]);

    expect((out.match(/"bucket"/g) || []).length).toBe(31);
    expect(out).toContain('2026-10-31');
    expect(out).toContain('2026-10-01');
  });

  it('tetap memotong per baris utuh saat budget kecil (JSON tidak rusak)', () => {
    const out = buildLabeledToolRows([{ tool: 'query_chat_stats', rows: buckets }], 300);

    expect((out.match(/"bucket"/g) || []).length).toBeLessThan(31);
    expect(out.startsWith('[query_chat_stats] [')).toBe(true);
    expect(out.endsWith(']')).toBe(true);
  });

  it('membuang UUID/ID internal sebelum dikirim ke LLM', () => {
    const out = buildLabeledToolRows([
      { tool: 'get_customer_history', rows: [{ id: '00000000-0000-4000-8000-000000000000', customerId: 'x', customerName: 'Bunda A' }] },
    ]);

    expect(out).not.toContain('00000000-0000-4000-8000-000000000000');
    expect(out).toContain('Bunda A');
  });
});

import { describe, it, expect } from 'vitest';
import { executeSearchKnowledgeFaq } from '../../../src/v3/tools/search-knowledge-faq.tool';

/**
 * Sesi 310995 Turn 5: saat customer bertanya persiapan SOP (baby oil/minyak
 * telon), Call 2 menodong jadwal. Akar: tool FAQ tak menyertakan panduan
 * penutup. Fase 3: message search_knowledge_faq WAJIB memuat instruksi
 * statement-only (Aturan Emas 6).
 */
describe('FAQ tool — penutup statement-only (sesi 310995)', () => {
  it('message memuat larangan menambah pertanyaan jadwal', async () => {
    const out = await executeSearchKnowledgeFaq({ query: 'persiapan minyak telon atau baby oil' });
    expect(out.success).toBe(true);
    expect(out.message).toMatch(/DILARANG MENAMBAHKAN PERTANYAAN JADWAL/i);
    expect(out.message).toMatch(/statement-only/i);
  });

  it('aturan berlaku juga di jalur fallback kosong (query tak dikenal)', async () => {
    const out = await executeSearchKnowledgeFaq({ query: 'zxqvkjhq wqxzqv kzxwqv' });
    expect(out.success).toBe(true);
    expect(out.chunks).toHaveLength(0);
    // Fallback tetap memberi arahan netral (tak menodong jadwal).
    expect(out.message).not.toMatch(/jadwalkan di hari apa/i);
  });
});

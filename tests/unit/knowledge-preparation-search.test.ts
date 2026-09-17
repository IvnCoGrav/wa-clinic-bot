import { describe, it, expect } from 'vitest';
import { resolveChunkKeywords } from '../../src/services/keyword-enrichment.service';

describe('Knowledge preparation FTS — 391501 Fase 3', () => {
  const title = 'Apa saja yang perlu disiapkan sebelum treatment?';

  it('query "persiapan sebelum pijat bayi" mengandung keyword bayi', () => {
    const kw = resolveChunkKeywords(title, null) || '';
    // FTS chunk harus punya keyword bayi/si kecil/minyak agar retrieval berhasil
    expect(kw.toLowerCase()).toMatch(/bayi/);
    expect(kw.toLowerCase()).toMatch(/si kecil|anak/);
  });

  it('query "kudu nyiapin apa" ter-cover', () => {
    const kw = (resolveChunkKeywords(title, null) || '').toLowerCase();
    expect(kw).toMatch(/kudu nyiapin/);
  });

  it('query "pakai baby oil atau minyak telon" ter-cover', () => {
    const kw = (resolveChunkKeywords(title, null) || '').toLowerCase();
    expect(kw).toMatch(/baby oil/);
    expect(kw).toMatch(/minyak telon/);
  });

  it('keyword enrichment mencakup perlengkapan bidan & homecare', () => {
    const kw = (resolveChunkKeywords(title, null) || '').toLowerCase();
    expect(kw).toMatch(/perlengkapan bidan|homecare/);
  });

  it('FAQ corpus answer mengandung baby oil & matras', async () => {
    const { faqs } = await import('../../src/cli/faq-corpus');
    const faq = faqs.find((f) => f.question === title);
    expect(faq).toBeDefined();
    expect(faq!.answer.toLowerCase()).toMatch(/baby oil/);
    expect(faq!.answer.toLowerCase()).toMatch(/matras|perlak/);
  });
});

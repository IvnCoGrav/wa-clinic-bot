import { describe, it, expect } from 'vitest';
import { knowledgeBaseService } from '../../src/services/knowledge.service';

/**
 * C-001 fase 2.2: rerank multi-sinyal benar-benar terpasang di jalur retrieval
 * (offline → in-memory fallback). Artikel dengan `keywords` yang cocok harus
 * mengalahkan artikel yang hanya kebetulan memuat satu token query.
 */
describe('Retrieval RAG — rerank keywords (C-001)', () => {
  const tenantId = 'tenant-rag-rerank';

  it('artikel dengan keywords cocok menang atas artikel token-tunggal', async () => {
    await knowledgeBaseService.upsertChunk({
      tenantId,
      title: 'Panduan kucing persia',
      content: 'Perawatan bulu dan kulit kucing persia agar tidak kusam.',
      keywords: 'kucing persia bulu rontok',
    });
    await knowledgeBaseService.upsertChunk({
      tenantId,
      title: 'Promo klinik',
      content: 'Promo kucing lucu bulan ini untuk pelanggan baru.',
      keywords: 'promo diskon',
    });

    const results = await knowledgeBaseService.searchRelevantChunks(
      'kucing persia bulu rontok',
      2,
      tenantId
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain('Panduan kucing persia');
  });

  it('tenant lain tidak menerima hasil (isolasi tetap)', async () => {
    const results = await knowledgeBaseService.searchRelevantChunks(
      'kucing persia bulu rontok',
      2,
      'tenant-lain'
    );
    expect(results).toEqual([]);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock $queryRaw berurutan: tier FTS (websearch/OR/plainto) → [], tier trigram → baris relevan.
const queryRawMock = vi.fn();

vi.mock('../../src/db/client', () => ({
  prisma: {
    $queryRaw: (...args: any[]) => queryRawMock(...args),
    knowledgeChunk: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { knowledgeBaseService } from '../../src/services/knowledge.service';

const TRIGRAM_ROW = {
  id: 'chunk-asi-1',
  tenantId: 'default-tenant',
  sourceType: 'FAQ',
  title: 'ASI tidak lancar setelah melahirkan',
  content: 'Cara memperlancar ASI: menyusui sesering mungkin...',
  keywords: 'menyusui, ASI, laktasi',
  documentName: null,
  rank: 0.72,
};

function mockFtsEmptyThenTrigram(rows: any[]) {
  queryRawMock.mockImplementation((strings: any, ..._vals: any[]) => {
    const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (sql.includes('similarity(')) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
}

describe('knowledge trigram tier (Fase 4)', () => {
  beforeEach(() => {
    queryRawMock.mockReset();
  });

  it('kata berimbuhan yang lolos FTS tetap ketemu via trigram', async () => {
    mockFtsEmptyThenTrigram([TRIGRAM_ROW]);
    const res = await knowledgeBaseService.searchRelevantChunks('menyusuinya', 3, 'default-tenant');
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('chunk-asi-1');
    expect(res[0].similarity).toBe(0.72);
    // Tier trigram benar-benar ditembak (bukan in-memory fallback)
    const trigramCalls = queryRawMock.mock.calls.filter((c: any[]) => {
      const sql = Array.isArray(c[0]) ? c[0].join(' ') : String(c[0]);
      return sql.includes('similarity(');
    });
    expect(trigramCalls.length).toBe(1);
  });

  it('typo 1 huruf ketemu via trigram tanpa token eksak', async () => {
    mockFtsEmptyThenTrigram([{ ...TRIGRAM_ROW, rank: 0.61 }]);
    const res = await knowledgeBaseService.searchRelevantChunks('menyusuii', 3, 'default-tenant');
    expect(res.length).toBe(1);
    expect(res[0].title).toContain('ASI');
  });

  it('skor trigram marjinal (<0.25) dibuang seperti tier FTS', async () => {
    mockFtsEmptyThenTrigram([{ ...TRIGRAM_ROW, rank: 0.1 }]);
    const res = await knowledgeBaseService.searchRelevantChunks('xyz abc def', 3, 'default-tenant');
    expect(res).toEqual([]);
  });

  it('tanpa baris trigram → array kosong (topik belum ada artikel)', async () => {
    mockFtsEmptyThenTrigram([]);
    const res = await knowledgeBaseService.searchRelevantChunks('topik antah berantah', 3, 'default-tenant');
    expect(res).toEqual([]);
  });
});

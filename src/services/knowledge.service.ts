import { prisma } from '../db/client';
import { SourceType } from '@prisma/client';
import { chunkTextDocument } from '../utils/text-chunker';
import { getStringSimilarity } from '../utils/similarity';

const FAQ_SOURCE_TYPE = (SourceType && SourceType.FAQ) ? SourceType.FAQ : ('FAQ' as any);
const DOC_SOURCE_TYPE = (SourceType && SourceType.DOCUMENT) ? SourceType.DOCUMENT : ('DOCUMENT' as any);

export interface KnowledgeChunkResult {
  id: string;
  tenantId?: string;
  sourceType: SourceType;
  title: string;
  content: string;
  keywords?: string | null;
  documentName?: string | null;
  similarity?: number | null;
  score?: number | null;
  rank?: number | null;
}

// In-Memory store fallback untuk offline / test environment
const memoryKnowledgeChunks: Array<{
  id: string;
  tenantId: string;
  sourceType: SourceType;
  title: string;
  content: string;
  keywords?: string | null;
  documentName?: string | null;
}> = [];

/**
 * Membersihkan query pencarian dari kata basa-basi, sapaan, dan slang percakapan.
 * Menghasilkan teks bersih yang terfokus pada kata kunci domain penting untuk FTS.
 */
export function sanitizeQueryForFts(userQuery: string): string {
  if (!userQuery || typeof userQuery !== 'string') return '';
  let text = userQuery.toLowerCase();

  // 1. Buang sapaan & kata pengantar basa-basi
  text = text.replace(/\b(selamat\s+(pagi|siang|sore|malam)|halo|hallo|hai|permisi|mohon\s+info|mau\s+tanya|ingin\s+tanya|bisa\s+tolong|bantu|kira\s+kira)\b/gi, ' ');

  // 2. Normalisasi singkatan & slang umum
  text = text
    .replace(/\bmin\.(?=\s*(?:di|usia|umur|berapa|\d))/gi, 'minimal ')
    .replace(/\bmin\b(?=\s*(?:di|usia|umur|berapa|\d))/gi, 'minimal ')
    .replace(/\bbrp\b/gi, 'berapa')
    .replace(/\butk\b/gi, 'untuk')
    .replace(/\bbln\b/gi, 'bulan')
    .replace(/\bthn\b/gi, 'tahun')
    .replace(/\bdgn\b/gi, 'dengan')
    .replace(/\b(klo|kalo)\b/gi, 'kalau')
    .replace(/\bkrn\b/gi, 'karena');

  // 3. Hapus tanda baca & stopword umum + stopword domain generik klinik (anti false-positive FTS)
  text = text
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\b(apakah|yang|nanti|ya|dong|kah|sih|bunda|kak|ga|gak|apa|di|ke|dari|ini|itu|dengan|untuk|gimana|bagaimana|siapa|saya|pijat|massage|treatment|perawatan|bisa|boleh|kalau|kalo|klo|setelah|sehabis|sebelum|pada)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

/**
 * Deteksi error skema lama: kolom `keywords` belum ter-migrasi di environment tertentu.
 * - Postgres raw query melempar Code 42703 (`column "keywords" does not exist`, via P2010).
 * - Prisma typed query (findMany/update) melempar P2022:
 *   "The column `knowledge_chunks.keywords` does not exist in the current database."
 * Jika terdeteksi, query diulang TANPA kolom keywords agar tetap berjalan
 * (graceful degrade) alih-alih jatuh ke fallback kosong.
 */
export function isMissingKeywordsColumnError(error: any): boolean {
  const msg = String((error as Error)?.message || error || '');
  const code = String((error as any)?.code || '');
  return (
    /42703|P2010|P2022/i.test(msg) ||
    /P2022/i.test(code) ||
    (/keywords/i.test(msg) && /does not exist/i.test(msg))
  );
}

export class KnowledgeBaseService {
  /**
   * Update a chunk directly in memory store (fallback/testing).
   */
  public updateInMemoryChunk(id: string, title: string, content: string, keywords?: string | null): boolean {
    const idx = memoryKnowledgeChunks.findIndex(c => c.id === id);
    if (idx !== -1) {
      memoryKnowledgeChunks[idx].title = title;
      memoryKnowledgeChunks[idx].content = content;
      if (keywords !== undefined) memoryKnowledgeChunks[idx].keywords = keywords;
      return true;
    }
    return false;
  }

  /**
   * Bulk import FAQ (Pertanyaan & Jawaban).
   * 1 row per pasangan FAQ.
   */
  public async importFaqs(faqs: Array<{ question: string; answer: string; keywords?: string }>, tenantId: string): Promise<number> {
    let count = 0;
    for (const faq of faqs) {
      const title = faq.question.trim();
      const content = `Pertanyaan: ${faq.question.trim()}\nJawaban: ${faq.answer.trim()}`;
      const keywords = typeof faq.keywords === 'string' && faq.keywords.trim() ? faq.keywords.trim() : null;

      try {
        await prisma.knowledgeChunk.create({
          data: {
            tenant_id: tenantId,
            source_type: FAQ_SOURCE_TYPE,
            title,
            content,
            keywords,
          },
        });
      } catch (error) {
        // Fallback memory
        memoryKnowledgeChunks.push({
          id: `chunk_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          tenantId,
          sourceType: FAQ_SOURCE_TYPE,
          title,
          content,
          keywords,
        });
      }
      count++;
    }
    try {
      const { faqCacheService } = await import('./faq-cache.service');
      await faqCacheService.invalidateAll(tenantId).catch(() => {});
    } catch (_) {}
    return count;
  }

  /**
   * Import file dokumen teks: auto-extract dan chunking per ~500-800 karakter tanpa potong kalimat.
   */
  public async importDocument(documentName: string, textContent: string, tenantId: string): Promise<number> {
    const chunks = chunkTextDocument(textContent);
    let count = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const title = `${documentName} (Bagian ${i + 1})`;

      try {
        await prisma.knowledgeChunk.create({
          data: {
            tenant_id: tenantId,
            source_type: DOC_SOURCE_TYPE,
            title,
            content: chunkText,
            document_name: documentName,
          },
        });
      } catch (error) {
        memoryKnowledgeChunks.push({
          id: `chunk_doc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          tenantId,
          sourceType: DOC_SOURCE_TYPE,
          title,
          content: chunkText,
          documentName,
        });
      }
      count++;
    }
    try {
      const { faqCacheService } = await import('./faq-cache.service');
      await faqCacheService.invalidateAll(tenantId).catch(() => {});
    } catch (_) {}
    return count;
  }

  /**
   * Query Postgres Full-Text Search menggunakan dictionary 'simple'.
   * Mengambil top N chunk paling relevan untuk tenant tertentu.
   */
  public async searchRelevantChunks(userQuery: string, limit = 3, tenantId: string): Promise<KnowledgeChunkResult[]> {
    if (!userQuery || userQuery.trim().length === 0) return [];

    const cleanQuery = sanitizeQueryForFts(userQuery);
    const queryToSearch = cleanQuery.length > 0 ? cleanQuery : userQuery;

    try {
      // 1. Try websearch_to_tsquery with cleanQuery (robust against extra natural language stop words & slang)
      // Kolom keywords ikut diindeks agar sinonim intent (misal "lampu merah" → Sinar Moksa) ikut ketemu.
      let rawResults = await prisma.$queryRaw<any[]>`
        SELECT id, tenant_id as "tenantId", source_type as "sourceType", title, content, keywords, document_name as "documentName",
               ts_rank(to_tsvector('simple', title || ' ' || coalesce(keywords, '') || ' ' || content), websearch_to_tsquery('simple', ${queryToSearch})) as rank
        FROM knowledge_chunks
        WHERE tenant_id = ${tenantId} AND to_tsvector('simple', title || ' ' || coalesce(keywords, '') || ' ' || content) @@ websearch_to_tsquery('simple', ${queryToSearch})
        ORDER BY rank DESC
        LIMIT ${limit};
      `;

      // 2. Fallback ke OR-based tsquery jika pencarian ketat AND bernilai 0 — dengan Relevance Gate
      if ((!rawResults || rawResults.length === 0) && cleanQuery.length > 0) {
        const terms = cleanQuery.split(/\s+/).filter((w) => w.length > 2);
        if (terms.length >= 1) {
          const orQuery = terms.join(' | ');
          let orResults = await prisma.$queryRaw<any[]>`
            SELECT id, tenant_id as "tenantId", source_type as "sourceType", title, content, keywords, document_name as "documentName",
                   ts_rank(to_tsvector('simple', title || ' ' || coalesce(keywords, '') || ' ' || content), to_tsquery('simple', ${orQuery})) as rank
            FROM knowledge_chunks
            WHERE tenant_id = ${tenantId} AND to_tsvector('simple', title || ' ' || coalesce(keywords, '') || ' ' || content) @@ to_tsquery('simple', ${orQuery})
            ORDER BY rank DESC
            LIMIT ${limit * 2};
          `;
          // Relevance Gate: pastikan minimal 1 token substantif benar-benar ada di title/content
          if (orResults && orResults.length > 0) {
            const substantiveTokens = terms.map((t) => t.toLowerCase());
            const filtered = orResults.filter((r: any) => {
              const text = `${r.title} ${r.keywords || ''} ${r.content}`.toLowerCase();
              return substantiveTokens.some((tok) => text.includes(tok));
            });
            rawResults = filtered.length > 0 ? filtered.slice(0, limit) : [];
          } else {
            rawResults = [];
          }
          // Jika gate menghasilkan 0, jangan lanjut paksa plainto — kembalikan [] (topik belum ada artikel)
          if (!rawResults || rawResults.length === 0) {
            return [];
          }
        }
      }

      // 3. Fallback to plainto_tsquery with raw userQuery if clean search yields no results.
      // Relevance Gate (konsisten Step 2): buang hasil tanpa token substantif / rank marjinal.
      if (!rawResults || rawResults.length === 0) {
        rawResults = await prisma.$queryRaw<any[]>`
          SELECT id, tenant_id as "tenantId", source_type as "sourceType", title, content, keywords, document_name as "documentName",
                 ts_rank(to_tsvector('simple', title || ' ' || coalesce(keywords, '') || ' ' || content), plainto_tsquery('simple', ${userQuery})) as rank
          FROM knowledge_chunks
          WHERE tenant_id = ${tenantId} AND to_tsvector('simple', title || ' ' || coalesce(keywords, '') || ' ' || content) @@ plainto_tsquery('simple', ${userQuery})
          ORDER BY rank DESC
          LIMIT ${limit * 2};
        `;
        if (rawResults && rawResults.length > 0) {
          const substantiveTokens = (cleanQuery || userQuery)
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 2);
          if (substantiveTokens.length > 0) {
            const filtered = rawResults.filter((r: any) => {
              const text = `${r.title} ${r.keywords || ''} ${r.content}`.toLowerCase();
              const hasToken = substantiveTokens.some((tok) => text.includes(tok));
              const rank = typeof r.rank === 'number' ? r.rank : 0;
              return hasToken && rank >= 0.025;
            });
            rawResults = filtered.length > 0 ? filtered.slice(0, limit) : [];
          }
        }
      }

      if (rawResults && rawResults.length > 0) {
        return rawResults.map((r) => ({
          id: r.id,
          tenantId: r.tenantId,
          sourceType: r.sourceType,
          title: r.title,
          content: r.content,
          keywords: r.keywords ?? null,
          documentName: r.documentName,
          similarity: typeof r.rank === 'number' ? r.rank : null,
          score: typeof r.rank === 'number' ? r.rank : null,
          rank: typeof r.rank === 'number' ? r.rank : null,
        }));
      }
    } catch (error) {
      // Defensive handling skema lama: jika kolom keywords belum ter-migrasi (42703),
      // ulangi FTS TANPA kolom keywords agar pencarian tetap berjalan di DB lama.
      if (isMissingKeywordsColumnError(error)) {
        try {
          const fallbackResults = await this.searchFtsWithoutKeywordsColumn(
            userQuery,
            queryToSearch,
            cleanQuery,
            limit,
            tenantId
          );
          if (fallbackResults && fallbackResults.length > 0) return fallbackResults;
        } catch (retryError) {
          console.warn(
            '[FTS QUERY FALLBACK] Retry tanpa kolom keywords gagal, lanjut ke in-memory:',
            (retryError as Error).message
          );
        }
      } else {
        console.warn('[FTS QUERY FALLBACK] Postgres DB unavailable or query error, using keyword fallback search:', (error as Error).message);
      }
    }

    // In-Memory Keyword Fallback Search — dengan Relevance Gate & skor similarity
    const lower = userQuery.toLowerCase();
    const lowerClean = sanitizeQueryForFts(userQuery).toLowerCase() || lower;
    const cleanTokens = lowerClean.split(/\s+/).filter((kw) => kw.length > 2);
    const keywords = cleanTokens.length > 0 ? cleanTokens : lower.split(/\s+/).filter((kw) => kw.length > 2);
    const matches = memoryKnowledgeChunks
      .filter((chunk) => {
        if (chunk.tenantId !== tenantId) return false;
        const text = `${chunk.title} ${chunk.keywords || ''} ${chunk.content}`.toLowerCase();
        return keywords.some((kw) => text.includes(kw));
      })
      .map((chunk) => {
        const text = `${chunk.title} ${chunk.content}`.toLowerCase();
        const bestKw = keywords.find((kw) => text.includes(kw)) || '';
        const sim = bestKw ? getStringSimilarity(bestKw, text.slice(0, 200)) : 0.85;
        return { ...chunk, similarity: sim, score: sim, rank: sim } as any;
      });

    return matches.slice(0, limit) as any;
  }

  /**
   * FTS kompatibel skema lama (tanpa kolom `keywords`).
   * Dipakai otomatis bila migrasi `20260907000000_add_knowledge_chunk_keywords` belum applied
   * di environment tertentu (error 42703). Hanya mengindeks title + content.
   */
  private async searchFtsWithoutKeywordsColumn(
    userQuery: string,
    queryToSearch: string,
    cleanQuery: string,
    limit: number,
    tenantId: string
  ): Promise<KnowledgeChunkResult[]> {
    let rawResults = await prisma.$queryRaw<any[]>`
      SELECT id, tenant_id as "tenantId", source_type as "sourceType", title, content, document_name as "documentName",
             ts_rank(to_tsvector('simple', title || ' ' || content), websearch_to_tsquery('simple', ${queryToSearch})) as rank
      FROM knowledge_chunks
      WHERE tenant_id = ${tenantId} AND to_tsvector('simple', title || ' ' || content) @@ websearch_to_tsquery('simple', ${queryToSearch})
      ORDER BY rank DESC
      LIMIT ${limit};
    `;
    if ((!rawResults || rawResults.length === 0) && cleanQuery.length > 0) {
      const terms = cleanQuery.split(/\s+/).filter((w) => w.length > 2);
      if (terms.length >= 1) {
        const orQuery = terms.join(' | ');
        const orResults = await prisma.$queryRaw<any[]>`
          SELECT id, tenant_id as "tenantId", source_type as "sourceType", title, content, document_name as "documentName",
                 ts_rank(to_tsvector('simple', title || ' ' || content), to_tsquery('simple', ${orQuery})) as rank
          FROM knowledge_chunks
          WHERE tenant_id = ${tenantId} AND to_tsvector('simple', title || ' ' || content) @@ to_tsquery('simple', ${orQuery})
          ORDER BY rank DESC
          LIMIT ${limit * 2};
        `;
        if (orResults && orResults.length > 0) {
          const substantiveTokens = terms.map((t) => t.toLowerCase());
          const filtered = orResults.filter((r: any) => {
            const text = `${r.title} ${r.content}`.toLowerCase();
            const hasToken = substantiveTokens.some((tok) => text.includes(tok));
            const rank = typeof r.rank === 'number' ? r.rank : 0;
            return hasToken && rank >= 0.025;
          });
          rawResults = filtered.length > 0 ? filtered.slice(0, limit) : [];
        } else {
          rawResults = [];
        }
      }
    }
    if (!rawResults || rawResults.length === 0) return [];
    return rawResults.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      sourceType: r.sourceType,
      title: r.title,
      content: r.content,
      keywords: null,
      documentName: r.documentName,
      similarity: typeof r.rank === 'number' ? r.rank : null,
      score: typeof r.rank === 'number' ? r.rank : null,
      rank: typeof r.rank === 'number' ? r.rank : null,
    }));
  }

  /**
   * Upsert generik satu chunk knowledge per tenant berdasarkan kecocokan judul.
   * Sepenuhnya data-driven (tanpa hardcode bisnis di service): seluruh isi title/content/keywords
   * berasal dari parameter (seed/script/dashboard), sehingga artikel klinis bisa diedit per tenant
   * kapan saja tanpa menyentuh kode. Fallback ke in-memory store saat DB offline (unit test).
   */
  public async upsertChunk(params: {
    tenantId: string;
    title: string;
    content: string;
    keywords?: string | null;
    sourceType?: SourceType;
    documentName?: string | null;
  }): Promise<{ id: string; created: boolean }> {
    const title = (params.title || '').trim();
    const content = (params.content || '').trim();
    if (!title || !content) throw new Error('upsertChunk membutuhkan title & content.');
    const sourceType = params.sourceType || FAQ_SOURCE_TYPE;
    const keywords = typeof params.keywords === 'string' && params.keywords.trim() ? params.keywords.trim() : null;
    try {
      const existing = await prisma.knowledgeChunk.findFirst({
        where: { tenant_id: params.tenantId, title },
      });
      if (existing) {
        try {
          await (prisma.knowledgeChunk.update as any)({
            where: { id: existing.id },
            data: {
              content,
              ...(keywords !== null ? { keywords } : {}),
              ...(params.documentName ? { document_name: params.documentName } : {}),
            },
          });
        } catch (updateError) {
          // Skema lama tanpa kolom keywords: update ulang tanpa keywords.
          if (isMissingKeywordsColumnError(updateError)) {
            await (prisma.knowledgeChunk.update as any)({
              where: { id: existing.id },
              data: { content },
            });
          } else {
            throw updateError;
          }
        }
        return { id: existing.id, created: false };
      }
      try {
        const created = await prisma.knowledgeChunk.create({
          data: {
            tenant_id: params.tenantId,
            source_type: sourceType,
            title,
            content,
            keywords,
            ...(params.documentName ? { document_name: params.documentName } : {}),
          },
        });
        return { id: created.id, created: true };
      } catch (createError) {
        // Skema lama tanpa kolom keywords: buat ulang tanpa keywords.
        if (isMissingKeywordsColumnError(createError)) {
          const created = await prisma.knowledgeChunk.create({
            data: {
              tenant_id: params.tenantId,
              source_type: sourceType,
              title,
              content,
            },
          } as any);
          return { id: (created as any).id, created: true };
        }
        throw createError;
      }
    } catch (error) {
      // Fallback in-memory (offline/test): upsert berdasarkan title + tenant.
      const idx = memoryKnowledgeChunks.findIndex(
        (c) => c.tenantId === params.tenantId && c.title.toLowerCase() === title.toLowerCase()
      );
      if (idx !== -1) {
        memoryKnowledgeChunks[idx].content = content;
        if (keywords !== null) memoryKnowledgeChunks[idx].keywords = keywords;
        return { id: memoryKnowledgeChunks[idx].id, created: false };
      }
      const id = `chunk_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      memoryKnowledgeChunks.push({
        id,
        tenantId: params.tenantId,
        sourceType,
        title,
        content,
        keywords,
        documentName: params.documentName || null,
      });
      return { id, created: true };
    }
  }

  /**
   * Menambahkan FAQ item baru ke database knowledge_chunks (official Knowledge Base)
   */
  public async addFaqItem(params: {
    tenantId: string;
    category: string;
    question: string;
    answer: string;
    status?: string;
  }): Promise<any> {
    const title = params.question.trim();
    const content = `Pertanyaan: ${params.question.trim()}\nJawaban: ${params.answer.trim()}`;
    
    try {
      return await prisma.knowledgeChunk.create({
        data: {
          tenant_id: params.tenantId,
          source_type: FAQ_SOURCE_TYPE,
          title,
          content,
        },
      });
    } catch (error) {
      const newItem = {
        id: `chunk_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        tenantId: params.tenantId,
        sourceType: FAQ_SOURCE_TYPE,
        title,
        content,
      };
      memoryKnowledgeChunks.push(newItem);
      return newItem;
    }
  }

  /**
   * Mencari kecocokan FAQ medis yang sudah disetujui di tabel MedicalFaqStaging
   */
  public async findMatchingFaq(userQuery: string, tenantId: string): Promise<any> {
    try {
      const match = await prisma.medicalFaqStaging.findFirst({
        where: {
          tenant_id: tenantId,
          status: 'APPROVED',
          OR: [
            { raw_question: { contains: userQuery, mode: 'insensitive' } },
            { general_question: { contains: userQuery, mode: 'insensitive' } },
          ],
        },
      });
      if (match) {
        return {
          id: match.id,
          category: 'medical',
          status: 'APPROVED',
          question: match.general_question,
          answer: match.general_answer,
        };
      }
    } catch (e) {
      console.warn('[findMatchingFaq fallback]', e);
    }
    return null;
  }

  /**
   * Pengecekan duplikat FAQ terhadap database KnowledgeChunk resmi.
   * Threshold default: 0.70 (70% Sorensen-Dice similarity).
   */
  public async checkDuplicateFaq(
    userQuestion: string,
    tenantId: string,
    similarityThreshold = 0.70
  ): Promise<{ isDuplicate: boolean; matchedChunk?: KnowledgeChunkResult; similarity: number }> {
    if (!userQuestion || userQuestion.trim().length === 0) {
      return { isDuplicate: false, similarity: 0 };
    }

    let chunks: KnowledgeChunkResult[] = [];
    try {
      let dbChunks;
      try {
        dbChunks = await prisma.knowledgeChunk.findMany({
          where: { tenant_id: tenantId },
        });
      } catch (findErr) {
        // Skema lama tanpa kolom keywords (P2022): baca ulang tanpa kolom tersebut.
        if (!isMissingKeywordsColumnError(findErr)) throw findErr;
        dbChunks = await prisma.knowledgeChunk.findMany({
          where: { tenant_id: tenantId },
          select: {
            id: true,
            tenant_id: true,
            source_type: true,
            title: true,
            content: true,
            document_name: true,
            created_at: true,
          },
        });
      }
      chunks = dbChunks.map((c) => ({
        id: c.id,
        tenantId: c.tenant_id,
        sourceType: c.source_type,
        title: c.title,
        content: c.content,
        documentName: c.document_name,
      }));
    } catch (err) {
      chunks = memoryKnowledgeChunks.filter((c) => c.tenantId === tenantId);
    }

    if (chunks.length === 0 && memoryKnowledgeChunks.length > 0) {
      chunks = memoryKnowledgeChunks.filter((c) => c.tenantId === tenantId);
    }

    let bestMatch: KnowledgeChunkResult | undefined = undefined;
    let highestSim = 0;

    const qLower = userQuestion.toLowerCase().trim();

    for (const chunk of chunks) {
      const titleSim = getStringSimilarity(qLower, chunk.title.toLowerCase().trim());

      let contentQuestion = chunk.content;
      if (chunk.content.includes('Pertanyaan:') && chunk.content.includes('Jawaban:')) {
        const parts = chunk.content.split('Jawaban:');
        contentQuestion = parts[0].replace('Pertanyaan:', '').trim();
      }
      const contentSim = getStringSimilarity(qLower, contentQuestion.toLowerCase().trim());
      const sim = Math.max(titleSim, contentSim);

      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = chunk;
      }
    }

    if (highestSim >= similarityThreshold && bestMatch) {
      return {
        isDuplicate: true,
        matchedChunk: bestMatch,
        similarity: highestSim,
      };
    }

    return {
      isDuplicate: false,
      matchedChunk: bestMatch,
      similarity: highestSim,
    };
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();

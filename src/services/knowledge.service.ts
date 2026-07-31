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
  documentName?: string | null;
}

// In-Memory store fallback untuk offline / test environment
const memoryKnowledgeChunks: Array<{
  id: string;
  tenantId: string;
  sourceType: SourceType;
  title: string;
  content: string;
  documentName?: string | null;
}> = [];

export class KnowledgeBaseService {
  /**
   * Update a chunk directly in memory store (fallback/testing).
   */
  public updateInMemoryChunk(id: string, title: string, content: string): boolean {
    const idx = memoryKnowledgeChunks.findIndex(c => c.id === id);
    if (idx !== -1) {
      memoryKnowledgeChunks[idx].title = title;
      memoryKnowledgeChunks[idx].content = content;
      return true;
    }
    return false;
  }

  /**
   * Bulk import FAQ (Pertanyaan & Jawaban).
   * 1 row per pasangan FAQ.
   */
  public async importFaqs(faqs: Array<{ question: string; answer: string }>, tenantId: string): Promise<number> {
    let count = 0;
    for (const faq of faqs) {
      const title = faq.question.trim();
      const content = `Pertanyaan: ${faq.question.trim()}\nJawaban: ${faq.answer.trim()}`;

      try {
        await prisma.knowledgeChunk.create({
          data: {
            tenant_id: tenantId,
            source_type: FAQ_SOURCE_TYPE,
            title,
            content,
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
        });
      }
      count++;
    }
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
    return count;
  }

  /**
   * Query Postgres Full-Text Search menggunakan dictionary 'simple'.
   * Mengambil top N chunk paling relevan untuk tenant tertentu.
   */
  public async searchRelevantChunks(userQuery: string, limit = 3, tenantId: string): Promise<KnowledgeChunkResult[]> {
    if (!userQuery || userQuery.trim().length === 0) return [];

    const cleanQuery = userQuery
      .toLowerCase()
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\b(apakah|yang|nanti|ya|dong|kah|sih|min|bunda|kak|ga|gak|apa|di|ke|dari|ini|itu|dengan|untuk|gimana|bagaimana|siapa)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const queryToSearch = cleanQuery.length > 0 ? cleanQuery : userQuery;

    try {
      // 1. Try websearch_to_tsquery with cleanQuery (robust against extra natural language stop words)
      let rawResults = await prisma.$queryRaw<any[]>`
        SELECT id, tenant_id as "tenantId", source_type as "sourceType", title, content, document_name as "documentName",
               ts_rank(to_tsvector('simple', content), websearch_to_tsquery('simple', ${queryToSearch})) as rank
        FROM knowledge_chunks
        WHERE tenant_id = ${tenantId} AND to_tsvector('simple', content) @@ websearch_to_tsquery('simple', ${queryToSearch})
        ORDER BY rank DESC
        LIMIT ${limit};
      `;

      // 2. Fallback to plainto_tsquery with raw userQuery if clean search yields no results
      if (!rawResults || rawResults.length === 0) {
        rawResults = await prisma.$queryRaw<any[]>`
          SELECT id, tenant_id as "tenantId", source_type as "sourceType", title, content, document_name as "documentName",
                 ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', ${userQuery})) as rank
          FROM knowledge_chunks
          WHERE tenant_id = ${tenantId} AND to_tsvector('simple', content) @@ plainto_tsquery('simple', ${userQuery})
          ORDER BY rank DESC
          LIMIT ${limit};
        `;
      }

      if (rawResults && rawResults.length > 0) {
        return rawResults.map((r) => ({
          id: r.id,
          tenantId: r.tenantId,
          sourceType: r.sourceType,
          title: r.title,
          content: r.content,
          documentName: r.documentName,
        }));
      }
    } catch (error) {
      console.warn('[FTS QUERY FALLBACK] Postgres DB unavailable or query error, using keyword fallback search:', (error as Error).message);
    }

    // In-Memory Keyword Fallback Search
    const lower = userQuery.toLowerCase();
    const matches = memoryKnowledgeChunks.filter((chunk) => {
      if (chunk.tenantId !== tenantId) return false;
      const text = `${chunk.title} ${chunk.content}`.toLowerCase();
      const keywords = lower.split(/\s+/);
      return keywords.some((kw) => kw.length > 2 && text.includes(kw));
    });

    return matches.slice(0, limit);
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
      const dbChunks = await prisma.knowledgeChunk.findMany({
        where: { tenant_id: tenantId },
      });
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

import { prisma } from '../db/client';
import { SourceType } from '@prisma/client';
import { chunkTextDocument } from '../utils/text-chunker';

const FAQ_SOURCE_TYPE = (SourceType && SourceType.FAQ) ? SourceType.FAQ : ('FAQ' as any);
const DOC_SOURCE_TYPE = (SourceType && SourceType.DOCUMENT) ? SourceType.DOCUMENT : ('DOCUMENT' as any);

export interface KnowledgeChunkResult {
  id: string;
  sourceType: SourceType;
  title: string;
  content: string;
  documentName?: string | null;
}

// In-Memory store fallback untuk offline / test environment
const memoryKnowledgeChunks: Array<{
  id: string;
  sourceType: SourceType;
  title: string;
  content: string;
  documentName?: string | null;
}> = [];

export class KnowledgeBaseService {
  /**
   * Bulk import FAQ (Pertanyaan & Jawaban).
   * 1 row per pasangan FAQ.
   */
  public async importFaqs(faqs: Array<{ question: string; answer: string }>): Promise<number> {
    let count = 0;
    for (const faq of faqs) {
      const title = faq.question.trim();
      const content = `Pertanyaan: ${faq.question.trim()}\nJawaban: ${faq.answer.trim()}`;

      try {
        await prisma.knowledgeChunk.create({
          data: {
            source_type: FAQ_SOURCE_TYPE,
            title,
            content,
          },
        });
      } catch (error) {
        // Fallback memory
        memoryKnowledgeChunks.push({
          id: `chunk_${Date.now()}_${Math.random().toString(36).substring(7)}`,
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
  public async importDocument(documentName: string, textContent: string): Promise<number> {
    const chunks = chunkTextDocument(textContent);
    let count = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const title = `${documentName} (Bagian ${i + 1})`;

      try {
        await prisma.knowledgeChunk.create({
          data: {
            source_type: DOC_SOURCE_TYPE,
            title,
            content: chunkText,
            document_name: documentName,
          },
        });
      } catch (error) {
        memoryKnowledgeChunks.push({
          id: `chunk_doc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
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
   * Query Postgres Full-Text Search menggunakan dictionary 'simple' (User Bug Fix #1 & #2).
   * Mengambil top N chunk paling relevan.
   */
  public async searchRelevantChunks(userQuery: string, limit = 3): Promise<KnowledgeChunkResult[]> {
    if (!userQuery || userQuery.trim().length === 0) return [];

    try {
      // Execute raw SQL using Postgres FTS with 'simple' dictionary
      const rawResults = await prisma.$queryRaw<any[]>`
        SELECT id, source_type as "sourceType", title, content, document_name as "documentName",
               ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', ${userQuery})) as rank
        FROM knowledge_chunks
        WHERE to_tsvector('simple', content) @@ plainto_tsquery('simple', ${userQuery})
        ORDER BY rank DESC
        LIMIT ${limit};
      `;

      if (rawResults && rawResults.length > 0) {
        return rawResults.map((r) => ({
          id: r.id,
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
      const text = `${chunk.title} ${chunk.content}`.toLowerCase();
      const keywords = lower.split(/\s+/);
      return keywords.some((kw) => kw.length > 2 && text.includes(kw));
    });

    return matches.slice(0, limit);
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();

import { describe, it, expect } from 'vitest';
import { chunkTextDocument } from '../../src/utils/text-chunker';
import { knowledgeBaseService } from '../../src/services/knowledge.service';

describe('Knowledge Base & Text Chunker Unit Tests', () => {
  it('should chunk large document into ~500-800 character paragraphs without breaking sentences', () => {
    const p1 = 'Paragraph 1: ' + 'This is a long sentence about beauty treatments at the clinic. '.repeat(10);
    const p2 = 'Paragraph 2: ' + 'Another paragraph detailing facial treatments, acne care, and laser therapy. '.repeat(10);
    const doc = `${p1}\n\n${p2}`;

    const chunks = chunkTextDocument(doc, 400, 800);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(900);
    });
  });

  it('should import FAQs and retrieve matching chunk via search', async () => {
    await knowledgeBaseService.importFaqs([
      {
        question: 'Berapa lama durasi treatment Facial Glowing?',
        answer: 'Treatment Facial Glowing membutuhkan waktu sekitar 60-90 menit.',
      },
      {
        question: 'Apakah ada perawatan untuk kulit berjerawat?',
        answer: 'Kami menyediakan Acne Care Therapy khusus untuk meredakan jerawat aktif.',
      },
    ]);

    const results = await knowledgeBaseService.searchRelevantChunks('jerawat acne');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('Acne Care Therapy');
  });
});

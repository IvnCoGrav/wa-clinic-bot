import { describe, it, expect } from 'vitest';
import {
  knowledgeBaseService,
  isMissingKeywordsColumnError,
} from '../../src/services/knowledge.service';
import { executeSearchKnowledgeFaq } from '../../src/v3/tools/search-knowledge-faq.tool';
import { PersonaPromptBuilder } from '../../src/v3/agent/persona';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Dynamic Knowledge Grounding & Zero-Hardcode Persona (kasus maternal 38 weeks + capek).
 * Pengetahuan klinis (usia aterm induksi + relaksasi bumil) hidup di DB knowledge_chunks
 * per tenant — TIDAK hardcoded di prompt/tool. Test berjalan offline via in-memory fallback.
 */
describe('Dynamic Knowledge Maternal — induksi 38 weeks + capek', () => {
  const MATERNAL_QUERY =
    '38 weeks apa sudah bisa pakai yang induksi ya kak ? Ini sama capek² juga soalnya';

  it('RAG dinamis menemukan chunk aterm dari knowledge base (bukan hardcode)', async () => {
    await knowledgeBaseService.upsertChunk({
      tenantId: DEFAULT_TENANT_ID,
      title: 'Panduan Usia Kehamilan untuk Pijat Induksi Alami (Induksi Massage)',
      content:
        'Pertanyaan: Panduan Usia Kehamilan untuk Pijat Induksi Alami (Induksi Massage)\n' +
        'Jawaban: Pijat induksi alami aman dan sangat dianjurkan dilakukan pada usia kehamilan ' +
        'cukup bulan (aterm), yaitu mulai 37-38 minggu ke atas hingga menjelang HPL. Perawatan ini ' +
        'membantu merangsang hormon oksitosin alami, menstimulasi titik akupresur persalinan, dan ' +
        'melenturkan otot panggul. Untuk ibu hamil yang juga merasakan capek, pegal seluruh tubuh, ' +
        'atau ketegangan otot di trimester akhir, paket Induksi Massage Fullbody (relaksasi seluruh ' +
        'tubuh dipadukan dengan titik induksi) merupakan pilihan yang paling tepat.',
      keywords:
        '38 weeks, 37 weeks, induksi, induksi alami, pijat induksi, capek, hamil trimester 3, aterm, cukup bulan, hpl',
    });

    const results = await knowledgeBaseService.searchRelevantChunks(
      MATERNAL_QUERY,
      3,
      DEFAULT_TENANT_ID
    );
    expect(results.length).toBeGreaterThan(0);
    const hit = results.find((r) =>
      `${r.title} ${r.content}`.toLowerCase().includes('induksi')
    );
    expect(hit).toBeTruthy();
    // Data klinis aterm datang dari DB, bukan dari hafalan kode.
    expect(`${hit!.title} ${hit!.content}`).toMatch(/37-38|aterm/i);
  });

  it('Tool FAQ via knowledge dinamis menjawab query maternal (tanpa fallback kosong)', async () => {
    const out = await executeSearchKnowledgeFaq({
      query: MATERNAL_QUERY,
      limit: 3,
      tenantId: DEFAULT_TENANT_ID,
    });
    expect(out.success).toBe(true);
    expect(out.chunks.length).toBeGreaterThan(0);
    expect(out.message).toMatch(/induksi/i);
  });

  it('Fallback kosong generik: tanpa false-escalation & tanpa hardcode bisnis', async () => {
    const out = await executeSearchKnowledgeFaq({
      // Token langka tanpa substring umum ("ada"/"tidak"/"pada") agar in-memory gate tetap kosong.
      query: 'zxqvkjhq wqxzqv kzxwqv',
      limit: 3,
      tenantId: DEFAULT_TENANT_ID,
    });
    expect(out.success).toBe(true);
    expect(out.chunks).toHaveLength(0);
    // Wajib mengacu ke katalog dinamis + kompetensi bidan.
    expect(out.message).toMatch(/get_catalog_and_price/);
    expect(out.message).toMatch(/Bidan Yusi/);
    // DILARANG pola lama yang memicu krisis identitas.
    expect(out.message).not.toMatch(/konsultasikan langsung ke Bidan/i);
    expect(out.message).not.toMatch(/DILARANG KERAS mengarang fakta medis/);
    // Zero-hardcode: tidak ada usia/nama paket statis di fallback.
    expect(out.message).not.toMatch(/38 minggu/);
    expect(out.message).not.toMatch(/Induksi Massage Fullbody/);
    // Eskalasi hanya untuk kegawatdaruratan patologis.
    expect(out.message).toMatch(/kegawatdaruratan medis/i);
  });

  it('Persona memuat prinsip empati + identitas tanpa data bisnis statis', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt(
      { genderGreeting: 'Bunda' },
      true
    );
    expect(prompt).toMatch(/VALIDASI KELUHAN FISIK/);
    expect(prompt).toMatch(/INTEGRITAS IDENTITAS BIDAN/);
    expect(prompt).toMatch(/Bidan Yusi/);
    // Prinsip baru wajib generik — verifikasi blok prinsip tidak menaruh data bisnis.
    const start = prompt.indexOf('[PRINSIP EMPATI & IDENTITAS BIDAN YUSI');
    const end = prompt.indexOf('[HIERARKI & ALUR MENJAWAB');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block = prompt.slice(start, end);
    expect(block).not.toMatch(/38 minggu/);
    expect(block).not.toMatch(/Induksi Massage Fullbody/);
    expect(block).not.toMatch(/Rp\s?\d/);
  });

  it('Defensive handling: error kolom keywords terdeteksi sebagai skema lama', () => {
    expect(
      isMissingKeywordsColumnError(new Error('column "keywords" does not exist'))
    ).toBe(true);
    expect(isMissingKeywordsColumnError(new Error('Database offline'))).toBe(false);
  });
});

import { knowledgeBaseService } from '../../services/knowledge.service';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export interface SearchKnowledgeFaqInput {
  query: string;
  limit?: number;
  tenantId?: string;
}

export interface KnowledgeFaqChunk {
  id: string;
  title: string;
  content: string;
  /** Skor relevansi FTS (bisa null bila dari fallback in-memory). */
  similarity: number | null;
  score?: number | null;
}

export interface SearchKnowledgeFaqOutput {
  success: boolean;
  query: string;
  chunks: KnowledgeFaqChunk[];
  message: string;
}

export const SEARCH_KNOWLEDGE_FAQ_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'search_knowledge_faq',
    description: 'Mencari artikel FAQ resmi, pengetahuan medis, panduan SOP klinik, penjelasan terapi tambahan (Sinar Moksa / inframerah hangat), aturan model cukur rambut bayi (apakah harus gundul/tidak), persiapan sebelum kunjungan, aturan mandi sebelum/sesudah, minum susu, jenis minyak/balsem, tumbuh gigi, fisioterapi, dan kondisi medis bayi/ibu dari Knowledge Base (47 artikel knowledge_chunks). WAJIB PANGGIL TOOL INI ketika customer menanyakan hal medis, khasiat/fungsi alat, model cukur rambut, atau aturan perawatan. JANGAN panggil untuk sapaan awal murni, hitung ongkir/lokasi, atau tanya harga katalog.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Kata kunci atau inti pertanyaan pasien (misal: "pijat saat tumbuh gigi", "sebelum sesudah mandi", "pijat bayi demam").'
        },
        limit: {
          type: 'number',
          description: 'Jumlah chunk maksimal yang diambil (default 3, maksimal 5).'
        }
      },
      required: ['query']
    }
  }
};

export async function executeSearchKnowledgeFaq(input: SearchKnowledgeFaqInput): Promise<SearchKnowledgeFaqOutput> {
  const query = (input.query || '').trim();
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 3) || 3, 1), 5);
  const tenantId = input.tenantId || DEFAULT_TENANT_ID;

  if (!query) {
    return { success: false, query: '', chunks: [], message: 'Query pencarian FAQ kosong.' };
  }

  try {
    const results = await knowledgeBaseService.searchRelevantChunks(query, limit, tenantId);
    const chunks: KnowledgeFaqChunk[] = (results || []).map((r: any) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      similarity: typeof r.similarity === 'number' ? r.similarity : (typeof r.rank === 'number' ? r.rank : (typeof r.score === 'number' ? r.score : null)),
      score: typeof r.score === 'number' ? r.score : (typeof r.similarity === 'number' ? r.similarity : (typeof r.rank === 'number' ? r.rank : null)),
    }));

    if (chunks.length === 0) {
      // Fallback generik zero-hardcode: tanpa nama treatment/usia statis, tanpa instruksi
      // "mengaku bukan bidan / konsultasikan ke bidan / tawarkan eskalasi" untuk ranah
      // komplementer standar. LLM menjawab sebagai Bidan Yusi memakai katalog dinamis
      // (tool get_catalog_and_price) + kompetensi kebidanan umum. Eskalasi HANYA untuk
      // kegawatdaruratan medis patologis di luar ranah komplementer.
      return {
        success: true,
        query,
        chunks: [],
        message: `Tidak ditemukan artikel FAQ spesifik untuk query "${query}". Sebagai Bidan Yusi, gunakan informasi resmi dari katalog layanan (tool get_catalog_and_price) dan prinsip kebidanan komplementer umum untuk menjawab pertanyaan Bunda secara ramah, solutif, dan profesional. HANYA tawarkan bantuan eskalasi ke tim/dokter jika pertanyaan menyangkut kegawatdaruratan medis, komplikasi patologis kehamilan (seperti pendarahan atau ketuban pecah dini), atau kebutuhan medis di luar ranah komplementer.`,
      };
    }

    const summary = chunks.map((c, i) => `Artikel ${i + 1} — ${c.title}:\n${c.content}`).join('\n\n');
    return {
      success: true,
      query,
      chunks,
      message: `Ditemukan ${chunks.length} artikel FAQ relevan untuk "${query}":\n${summary}`,
    };
  } catch (error: any) {
    console.error(JSON.stringify({ event: 'V3_TOOL_FAQ_ERROR', tenantId, query, error: error.message, timestamp: new Date().toISOString() }));
    return { success: false, query, chunks: [], message: `Gagal mencari FAQ: ${error.message}` };
  }
}

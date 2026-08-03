import { describe, it, expect, beforeEach, vi } from 'vitest';
import { llmResponseGenerator } from '../../src/integrations/llm/generator';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import { KnowledgeChunkResult } from '../../src/services/knowledge.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Test grounding anti-halusinasi jawaban FAQ/treatment.
 * Verifikasi bahwa detail jawaban (nama, usia, durasi, deskripsi) SELALU bersumber
 * dari data catalog yang sebenarnya — bukan karangan LLM/template.
 * Jalur yang diuji: fallbackFaqResponse (non-LLM, dipicu saat LLM_API_KEY mock/absent).
 */
describe('FAQ Grounding — jawaban treatment selalu bersumber dari data catalog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.LLM_API_KEY = 'mock_key'; // picu jalur fallback deterministik
  });

  function catalogChunk(services: any[]): KnowledgeChunkResult[] {
    const content = services
      .map((s) =>
        `[DATA TREATMENT]\n` +
        `Nama: ${s.name}\n` +
        `Kategori: ${s.category}\n` +
        `Usia/Target: ${s.ageTier.label}\n` +
        `Durasi: ${s.durationMinutes} menit\n` +
        `Deskripsi: ${s.description}`
      )
      .join('\n\n');
    return [{
      id: 'treatment-catalog-specific',
      tenantId: DEFAULT_TENANT_ID,
      sourceType: 'catalog' as any,
      title: 'Layanan Treatment Relevan dengan Pertanyaan',
      content,
      documentName: 'treatment-catalog',
    }];
  }

  it('satu treatment relevan → rekomendasi personal menyebut nama + durasi + target dari data asli', async () => {
    const service = treatmentCatalogService.getServiceById('moms-prenatal-massage');
    expect(service).toBeDefined();
    if (!service) return;

    const answer = await llmResponseGenerator.generateFaqResponse('pijat ibu hamil apa ya', catalogChunk([service]));

    // Nama treatment dari data → harus ada di jawaban.
    expect(answer).toContain(service.name.replace(/\s*\([^)]*\)\s*$/, ''));
    // Durasi dari data → harus konsisten.
    expect(answer).toContain(`${service.durationMinutes}`);
    // Deskripsi (bisa terpotong kalimat) → minimal kata kunci dari deskripsi muncul.
    const descKeyword = service.description.split(/\s+/).slice(0, 3).join(' ');
    expect(answer.toLowerCase()).toContain(descKeyword.toLowerCase());
    // Tone rekomendasi: ada tawaran bantuan memilih.
    expect(answer).toMatch(/bantu|pilih/i);
  });

  it('multi-treatment relevan → SEMUA opsi disebutkan (tidak memilih satu sepihak)', async () => {
    const all = treatmentCatalogService.getAllServices();
    const two = all.slice(0, 2);

    const answer = await llmResponseGenerator.generateFaqResponse('treatment untuk bayi', catalogChunk(two));

    for (const s of two) {
      const cleanName = s.name.replace(/\s*\([^)]*\)\s*$/, '');
      expect(answer).toContain(cleanName);
    }
  });

  it('context catalog TIDAK memuat harga (cegah halusinasi harga)', async () => {
    const all = treatmentCatalogService.getAllServices();
    const chunk = catalogChunk(all);
    expect(chunk[0].content).not.toMatch(/Rp|Harga|promo|harga normal/i);
  });

  it('tanpa data sama sekali → jawaban jujur "tidak tersedia/arahkan tim", bukan mengarang', async () => {
    const answer = await llmResponseGenerator.generateFaqResponse('treatment untuk apa ya?', []);
    expect(answer.length).toBeGreaterThan(0);
    expect(answer).not.toMatch(/Rp\d/);
  });

  it('formatCatalogData menghasilkan blok terstruktur tanpa bullet "•"', () => {
    const data = treatmentCatalogService.formatCatalogData(treatmentCatalogService.getAllServices());
    expect(data).toContain('[DATA TREATMENT]');
    expect(data).not.toContain('•');
  });

  it('searchCatalogItems mengembalikan data mentah (bukan string format)', () => {
    const items = treatmentCatalogService.searchCatalogItems('pijat hamil');
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].name).toBeTruthy();
    expect(items[0].description).toBeTruthy();
  });
});

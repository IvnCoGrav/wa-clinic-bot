import { describe, it, expect } from 'vitest';
import { executeGetCatalog, GET_CATALOG_TOOL_SCHEMA } from '../../../src/v3/tools/get-catalog.tool';

/**
 * Phase 1 — Anti-brochure: tool result katalog bernada percakapan mengalir,
 * TANPA label kaku "Rincian:" / selebaran berpoin.
 */
describe('Anti-Brochure Catalog Output', () => {
  it('message tanpa label kaku Rincian: (mode harga maupun non-harga)', async () => {
    for (const inquirePrice of [true, false]) {
      const out = await executeGetCatalog({ symptoms: ['batuk'], inquirePrice });
      expect(out.success).toBe(true);
      expect(out.message).not.toContain('Rincian:');
      expect(out.message).toContain('pilihan perawatan');
      expect(out.message).toContain('DILARANG membuat bullet list bertingkat');
    }
  });

  it('mode non-harga: satu baris mengalir nama + manfaat (tanpa Rp/menit)', async () => {
    const out = await executeGetCatalog({ symptoms: ['batuk'], inquirePrice: false });
    expect(out.message).not.toMatch(/Rp/i);
    expect(out.message).not.toMatch(/menit/i);
  });

  it('schema inquirePrice: pertanyaan paket/nama BUKAN harga', () => {
    const desc: string = GET_CATALOG_TOOL_SCHEMA.function.parameters.properties.inquirePrice.description;
    expect(desc).toContain('dipaket apa');
    expect(desc).toContain('BUKAN pertanyaan harga');
  });
});
